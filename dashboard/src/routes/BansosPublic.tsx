/**
 * Public Bansos page.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * One page an operator can hand to the people they are subsidizing. It answers
 * the only four questions a recipient has: where do I point my client, what key
 * do I use, which models can I call, and how much has been spent. No login,
 * because the operator is the one who created every key and distributes them —
 * asking a recipient to sign in with a credential they were just handed adds a
 * step without adding a check.
 *
 * ── What it deliberately does not show ──────────────────────────────────────
 * Nothing per-participant beyond what the operator chooses to publish, no
 * `adminNotes`, no provider names, no upstream model ids, no other tenants.
 * The page renders what the server sends and the server sends only what the
 * operator marked as public on the program.
 *
 * ── The key is shown, and that is a decision ────────────────────────────────
 * A Bansos key is a shared credential for a subsidized pool, not a personal
 * login. The operator publishes it here so recipients can copy it; the server
 * stores an encrypted copy for exactly this purpose, and revoking the key
 * removes it from the page on the next load. Anyone who should not have the
 * key should not have this URL — which is why the page is served from the
 * program's own slug and the operator decides who receives the link.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { DataTable, StatCard } from "../components/ui/layout";
import { ErrorState, LoadingState } from "../components/ui/state";
import { useT } from "../shared/locale-context";
import { formatNumber } from "../shared/format";

interface PublicKey {
  readonly label: string;
  readonly secret: string | null;
  readonly keyPrefix: string | null;
  readonly live: boolean;
  readonly tokensConsumed: number;
  readonly tokenBudget: number | null;
}

interface PublicModel {
  readonly publicModelId: string;
  readonly displayName: string | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
}

interface PublicPayload {
  readonly program: {
    readonly name: string;
    readonly description: string | null;
    readonly baseUrl: string;
    readonly globalRpm: number | null;
    readonly globalConcurrency: number | null;
  };
  readonly keys: readonly PublicKey[];
  readonly models: readonly PublicModel[];
  readonly totals: {
    readonly tokensConsumed: number;
    readonly tokenBudget: number | null;
    readonly liveKeys: number;
  };
}

/** Copies text and reports success; the clipboard API needs a secure context. */
function CopyButton({ value, label }: { value: string; label: string }): ReactNode {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={copied ? <Check size={15} /> : <Copy size={15} />}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {copied ? t("bansos.copied") : label}
    </Button>
  );
}

export default function BansosPublic(): ReactNode {
  const t = useT();
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);

  // The program comes from the URL: `/console/akses/<slug>`. Reading it from
  // the path rather than a router param keeps the page working when it is
  // opened as a bare link, with no route context to inherit.
  useEffect(() => {
    const match = /\/akses\/([^/?#]+)/.exec(window.location.pathname);
    setSlug(match?.[1] ?? null);
  }, []);

  const load = useCallback(async (target: string) => {
    try {
      setError(null);
      const response = await fetch(`/console/api/bansos/public/${encodeURIComponent(target)}`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body !== null && typeof body === "object" && "message" in body
            ? String((body as { message: unknown }).message)
            : `Request failed (${response.status})`,
        );
      }
      setPayload(body as PublicPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (slug !== null) void load(slug);
  }, [slug, load]);

  if (slug === null) {
    return (
      <main className="auth-viewport">
        <ErrorState title={t("bansos.publicTitle")} message={t("bansos.publicNoSlug")} compact />
      </main>
    );
  }
  if (error !== null) {
    return (
      <main className="auth-viewport">
        <ErrorState title={t("bansos.publicTitle")} message={error} compact />
      </main>
    );
  }
  if (payload === null) {
    return (
      <main className="auth-viewport">
        <LoadingState label={t("bansos.publicTitle")} />
      </main>
    );
  }

  const liveKeys = payload.keys.filter((key) => key.live);
  const primaryKey = liveKeys[0];
  const endpoint = `${payload.program.baseUrl}/v1`;

  return (
    <main className="app-main-column" style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <h1>{payload.program.name}</h1>
          <p className="account-row-meta">
            {payload.program.description ?? t("bansos.publicSubtitle")}
          </p>
        </div>
        <Badge tone={liveKeys.length > 0 ? "ok" : "err"}>
          {liveKeys.length > 0 ? t("bansos.publicOpen") : t("bansos.publicClosed")}
        </Badge>
      </div>

      <div className="metric-grid">
        <StatCard
          label={t("bansos.publicTotalUsed")}
          value={formatNumber(payload.totals.tokensConsumed)}
          detail={t("portal.tokens")}
          tone="teal"
        />
        <StatCard
          label={t("bansos.publicBudget")}
          value={
            payload.totals.tokenBudget === null
              ? t("bansos.unlimited")
              : formatNumber(payload.totals.tokenBudget)
          }
          detail={t("portal.tokens")}
          tone="purple"
        />
        <StatCard
          label={t("bansos.usageLiveKeys")}
          value={String(payload.totals.liveKeys)}
          detail={t("bansos.keys")}
          tone="green"
        />
        <StatCard
          label={t("bansos.globalRpm")}
          value={
            payload.program.globalRpm === null ? t("bansos.unlimited") : String(payload.program.globalRpm)
          }
          detail={t("portal.perMinute")}
          tone="orange"
        />
      </div>

      <Card glass>
        <CardHeader title={t("bansos.publicHowTo")} icon={<Sparkles size={18} />} />
        <CardBody>
          <div className="two-column-grid">
            <div>
              <div className="account-row-meta">{t("bansos.publicBaseUrl")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <code>{endpoint}</code>
                <CopyButton value={endpoint} label={t("bansos.copy")} />
              </div>
            </div>
            <div>
              <div className="account-row-meta">{t("bansos.publicApiKey")}</div>
              {primaryKey?.secret ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <code style={{ wordBreak: "break-all" }}>{primaryKey.secret}</code>
                  <CopyButton value={primaryKey.secret} label={t("bansos.copy")} />
                </div>
              ) : (
                <p className="account-row-meta">{t("bansos.publicNoKey")}</p>
              )}
            </div>
          </div>
          <p className="account-row-meta" style={{ marginTop: "12px" }}>
            {t("bansos.publicCompat")}
          </p>
        </CardBody>
      </Card>

      <Card glass>
        <CardHeader
          title={t("portal.modelsTitle")}
          icon={<KeyRound size={18} />}
          subtitle={t("portal.modelsHint")}
        />
        <CardBody>
          {payload.models.length === 0 ? (
            <p className="account-row-meta">{t("portal.modelsEmpty")}</p>
          ) : (
            <DataTable headers={[t("bansos.publicModelName"), t("portal.maxInput"), t("portal.maxOutput"), ""]}>
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
                  <td>
                    <CopyButton value={model.publicModelId} label={t("bansos.copy")} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card glass>
        <CardHeader title={t("bansos.publicUsage")} icon={<ExternalLink size={18} />} subtitle={t("bansos.publicUsageHint")} />
        <CardBody>
          <DataTable
            headers={[t("bansos.keyLabel"), t("bansos.participantStatus"), t("bansos.keyConsumed"), t("bansos.tokenAllowance")]}
          >
            {payload.keys.map((key) => (
              <tr key={key.keyPrefix ?? key.label}>
                <td>
                  <div className="account-row-name">{key.label}</div>
                  <code className="account-row-meta">{key.keyPrefix ?? "—"}</code>
                </td>
                <td>
                  <Badge tone={key.live ? "ok" : "disabled"}>
                    {key.live ? t("bansos.keyLive") : t("bansos.keyRevoked")}
                  </Badge>
                </td>
                <td>{formatNumber(key.tokensConsumed)}</td>
                <td>
                  {key.tokenBudget === null ? t("bansos.unlimited") : formatNumber(key.tokenBudget)}
                </td>
              </tr>
            ))}
          </DataTable>
        </CardBody>
      </Card>
    </main>
  );
}
