/**
 * Participant portal.
 *
 * ── Why this lives in the console bundle ────────────────────────────────────
 * It is the same document on the same origin; a second build would duplicate
 * the design system, the theme handling and the Rikka assets to render four
 * read-only screens. The separation that matters is authentication, and that
 * is enforced on the server: this page carries no console session, and every
 * request it makes goes to `/bansos/portal/*` with a token of its own.
 *
 * ── The session token ───────────────────────────────────────────────────────
 * Kept in `sessionStorage`, not `localStorage`: it is a bearer credential, and
 * a token that survives a browser restart outlives the participant's memory of
 * signing in. Closing the tab ends it. The key itself is never stored — it is
 * exchanged once and dropped.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, LogOut, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { DataTable, StatCard } from "../components/ui/layout";
import { ErrorState, LoadingState } from "../components/ui/state";
import { useT } from "../shared/locale-context";
import { formatNumber } from "../shared/format";

const TOKEN_KEY = "bansos-portal-token";

interface PortalKey {
  readonly id: string;
  readonly label: string;
  readonly keyPrefix: string | null;
  readonly live: boolean;
  readonly requestsPerMinute: number | null;
  readonly lifetimeTokenBudget: number | null;
  readonly lifetimeTokensConsumed: number | null;
  readonly maxConcurrentRequests: number | null;
}

interface PortalModel {
  readonly publicModelId: string;
  readonly displayName: string | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
}

interface PortalPayload {
  readonly participant: { readonly displayName: string; readonly status: string };
  readonly program: { readonly name: string; readonly globalRpm: number | null };
  readonly keys: readonly PortalKey[];
  readonly models: readonly PortalModel[];
  readonly allowance: { readonly tokenAllowance: number | null; readonly tokensConsumed: number };
}

async function portalRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/console/api/bansos/portal${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload !== null && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export default function BansosPortal(): ReactNode {
  const t = useT();
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (active: string) => {
    try {
      setError(null);
      setPayload(await portalRequest<PortalPayload>("/me", active));
    } catch (cause) {
      // A refused session is dropped rather than retried: the token is dead,
      // and keeping it would leave the page looking signed in while every
      // request fails.
      sessionStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setPayload(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (token !== null) void load(token);
  }, [token, load]);

  const totalConsumed = useMemo(
    () => payload?.keys.reduce((sum, key) => sum + (key.lifetimeTokensConsumed ?? 0), 0) ?? 0,
    [payload],
  );

  if (token === null) {
    return (
      <main className="auth-viewport">
        <PortalSignIn
          busy={busy}
          error={error}
          onSubmit={async (key) => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch("/console/api/bansos/portal/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key }),
              });
              const body: unknown = await response.json().catch(() => null);
              if (!response.ok) {
                throw new Error(
                  body !== null && typeof body === "object" && "message" in body
                    ? String((body as { message: unknown }).message)
                    : "Sign-in failed",
                );
              }
              const issued = body as { token: string };
              sessionStorage.setItem(TOKEN_KEY, issued.token);
              setToken(issued.token);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setBusy(false);
            }
          }}
        />
      </main>
    );
  }

  if (payload === null) {
    return (
      <main className="auth-viewport">
        {error === null ? (
          <LoadingState label={t("portal.loading")} />
        ) : (
          <ErrorState title={t("portal.signInFailed")} message={error} compact />
        )}
      </main>
    );
  }

  return (
    <main className="app-main-column" style={{ padding: "24px" }}>
      {/* Not `page-toolbar-sticky`: that pins itself below the console topbar,
          and the portal has no shell — the toolbar would stick at an offset
          that puts it on top of the first row of cards. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <h1>{payload.program.name}</h1>
          <p className="account-row-meta">
            {t("portal.signedInAs")} {payload.participant.displayName}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<LogOut size={16} />}
          onClick={() => {
            void portalRequest("/sign-out", token, { method: "POST" }).catch(() => null);
            sessionStorage.removeItem(TOKEN_KEY);
            setToken(null);
            setPayload(null);
          }}
        >
          {t("portal.signOut")}
        </Button>
      </div>

      <div className="metric-grid">
        <StatCard
          label={t("portal.consumed")}
          value={formatNumber(totalConsumed)}
          detail={t("portal.tokens")}
          tone="teal"
        />
        <StatCard
          label={t("portal.allowance")}
          value={
            payload.allowance.tokenAllowance === null
              ? t("bansos.unlimited")
              : formatNumber(payload.allowance.tokenAllowance)
          }
          detail={t("portal.tokens")}
          tone="purple"
        />
        <StatCard
          label={t("bansos.usageLiveKeys")}
          value={String(payload.keys.filter((key) => key.live).length)}
          detail={t("bansos.keys")}
          tone="green"
        />
        <StatCard
          label={t("bansos.rpm")}
          value={
            payload.program.globalRpm === null ? t("bansos.unlimited") : String(payload.program.globalRpm)
          }
          detail={t("portal.perMinute")}
          tone="orange"
        />
      </div>

      <Card glass>
        <CardHeader title={t("portal.modelsTitle")} icon={<Sparkles size={18} />} subtitle={t("portal.modelsHint")} />
        <CardBody>
          {payload.models.length === 0 ? (
            <p className="account-row-meta">{t("portal.modelsEmpty")}</p>
          ) : (
            <DataTable headers={[t("bansos.publicModel"), t("portal.maxInput"), t("portal.maxOutput")]}>
              {payload.models.map((model) => (
                <tr key={model.publicModelId}>
                  <td>
                    <code>{model.publicModelId}</code>
                    {model.displayName ? (
                      <span className="account-row-meta"> — {model.displayName}</span>
                    ) : null}
                  </td>
                  <td>{model.maxInputTokens === null ? "—" : formatNumber(model.maxInputTokens)}</td>
                  <td>{model.maxOutputTokens === null ? "—" : formatNumber(model.maxOutputTokens)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card glass>
        <CardHeader title={t("bansos.keys")} icon={<KeyRound size={18} />} subtitle={t("portal.keysHint")} />
        <CardBody>
          {payload.keys.length === 0 ? (
            <p className="account-row-meta">{t("portal.keysEmpty")}</p>
          ) : (
            <DataTable
              headers={[
                t("bansos.keyLabel"),
                t("bansos.participantStatus"),
                t("bansos.tokenAllowance"),
                t("bansos.keyConsumed"),
                t("bansos.rpm"),
              ]}
            >
              {payload.keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <div className="account-row-name">{key.label}</div>
                    <code className="account-row-meta">{key.keyPrefix ?? "—"}</code>
                  </td>
                  <td>
                    <Badge tone={key.live ? "ok" : "disabled"}>
                      {key.live ? t("bansos.keyLive") : t("bansos.keyRevoked")}
                    </Badge>
                  </td>
                  <td>
                    {key.lifetimeTokenBudget === null
                      ? t("bansos.unlimited")
                      : formatNumber(key.lifetimeTokenBudget)}
                  </td>
                  <td>{formatNumber(key.lifetimeTokensConsumed ?? 0)}</td>
                  <td>{key.requestsPerMinute === null ? t("bansos.unlimited") : key.requestsPerMinute}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </CardBody>
      </Card>
    </main>
  );
}

function PortalSignIn({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (key: string) => void | Promise<void>;
}): ReactNode {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <Card glass className="auth-window">
      <CardHeader title={t("portal.title")} subtitle={t("portal.subtitle")} icon={<KeyRound size={18} />} />
      <CardBody>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(value.trim());
          }}
        >
          <label>
            <span>{t("portal.keyLabel")}</span>
            <Input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="bs_…"
              autoFocus
              required
              minLength={8}
            />
          </label>
          <p className="account-row-meta">{t("portal.keyHint")}</p>
          {error !== null ? <p role="alert">{error}</p> : null}
          <Button
            type="submit"
            variant="primary"
            disabled={value.trim().length < 8 || busy}
            loading={busy}
          >
            {t("portal.signIn")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
