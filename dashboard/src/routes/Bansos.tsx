/**
 * Bansos: pick a key, choose its models, set its limits, publish it.
 *
 * ── Why the page is a list of keys ──────────────────────────────────────────
 * Bansos is an API key you hand out. Everything it needs — the model
 * allowlist, the rate limit, the concurrency, the token budget, the usage
 * counter — is already a column on `api_keys`, so the page shows those keys
 * and edits those columns. There is no program to create, no participant to
 * enroll, and no second key to issue.
 *
 * ── Why the settings live in a dialog ───────────────────────────────────────
 * The list answers one question: which keys are published. The per-key limits
 * are a different job, done once per key, so they open on demand rather than
 * turning the list into a wall of inputs.
 */
import { type ReactNode, useMemo, useState } from "react";
import { Check, ExternalLink, Globe, KeyRound, Settings2 } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Dialog } from "../components/ui/dialog";
import { Stack } from "../components/ui/stack";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/state";
import { DataTable, StatCard } from "../components/ui/layout";
import { useApiKeys } from "../hooks/api-keys";
import { useUpdateBansosKey, type BansosKeySettings } from "../hooks/bansos";
import { useT } from "../shared/locale-context";
import { formatNumber } from "../shared/format";
import type { ApiKeyResponse } from "../data/contracts";

/** Blank = not configured. Anything else must be a positive whole number. */
function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function asText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "12px", fontWeight: 600 }}>{label}</span>
      {children}
      {hint ? (
        <span className="account-row-meta" style={{ display: "block", fontSize: "11px" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** The per-key settings: models, limits, expiry. */
function BansosKeyDialog({
  apiKey,
  onClose,
}: {
  apiKey: ApiKeyResponse;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const update = useUpdateBansosKey();

  const [models, setModels] = useState((apiKey.modelList ?? []).join("\n"));
  const [rpm, setRpm] = useState(asText(apiKey.requestsPerMinute));
  const [concurrency, setConcurrency] = useState(asText(apiKey.maxConcurrentRequests));
  const [budget, setBudget] = useState(asText(apiKey.lifetimeTokenBudget));
  const [daily, setDaily] = useState(asText(apiKey.dailyTokenLimit));
  const [monthly, setMonthly] = useState(asText(apiKey.monthlyTokenLimit));
  const [expiresAt, setExpiresAt] = useState(
    apiKey.expiresAt === undefined ? "" : apiKey.expiresAt.slice(0, 16),
  );

  const modelList = models
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  function submit(): void {
    const settings: BansosKeySettings = {
      // An empty list with `whitelist` would allow *every* model, so an empty
      // box means "no restriction" and is written as `blacklist` with an empty
      // list, which the access rule reads as unrestricted.
      modelAccessMode: modelList.length > 0 ? "whitelist" : "blacklist",
      modelList,
      requestsPerMinute: optionalNumber(rpm),
      maxConcurrentRequests: optionalNumber(concurrency),
      lifetimeTokenBudget: optionalNumber(budget),
      dailyTokenLimit: optionalNumber(daily),
      monthlyTokenLimit: optionalNumber(monthly),
      expiresAt: expiresAt.trim().length === 0 ? null : new Date(expiresAt).toISOString(),
    };
    update.mutate({ keyId: apiKey.id, settings }, { onSuccess: onClose });
  }

  return (
    <Dialog open onClose={onClose} title={`${t("bansos.settingsFor")} ${apiKey.label}`} width={620}>
      <Stack gap="lg">
        <Field label={t("bansos.modelsAllowed")} hint={t("bansos.modelsAllowedHint")}>
          <textarea
            className="input"
            rows={5}
            value={models}
            onChange={(e) => setModels(e.target.value)}
            placeholder={"opencodeft/big-pickle\nopencodeft/exo-free"}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "12px" }}
          />
        </Field>

        <div className="two-column-grid">
          <Field label={t("bansos.rpm")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={rpm} onChange={(e) => setRpm(e.target.value)} />
          </Field>
          <Field label={t("bansos.concurrency")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
          </Field>
          <Field label={t("bansos.tokenBudget")} hint={t("bansos.tokenBudgetHint")}>
            <Input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label={t("bansos.expiresAt")} hint={t("bansos.expiresAtHint")}>
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
          <Field label={t("bansos.dailyTokenBudget")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </Field>
          <Field label={t("bansos.monthlyTokenBudget")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </Field>
        </div>

        {update.isError ? <p role="alert">{update.error.message}</p> : null}

        <div className="modal-form-actions">
          <Button variant="secondary" onClick={onClose}>
            {t("bansos.cancel")}
          </Button>
          <Button variant="primary" loading={update.isPending} onClick={submit}>
            {t("bansos.save")}
          </Button>
        </div>
      </Stack>
    </Dialog>
  );
}

export default function Bansos(): ReactNode {
  const t = useT();
  const keys = useApiKeys();
  const update = useUpdateBansosKey();
  const [editing, setEditing] = useState<ApiKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const rows = useMemo(
    () => (keys.data ?? []).filter((key) => key.parentKeyId === undefined),
    [keys.data],
  );
  const published = rows.filter((key) => key.bansosEnabled === true);
  const totalBudget = published.reduce((sum, key) => sum + (key.lifetimeTokenBudget ?? 0), 0);
  const totalUsed = published.reduce((sum, key) => sum + key.tokensConsumed, 0);

  if (keys.isPending) return <LoadingState label={t("bansos.title")} compact />;
  if (keys.isError) {
    return (
      <ErrorState
        title={t("bansos.title")}
        message={keys.error.message}
        onRetry={() => void keys.refetch()}
        retrying={keys.isFetching}
        compact
      />
    );
  }

  const publicUrl = `${window.location.origin}/console/akses`;

  return (
    <div className="dashboard-page">
      <Card glass>
        <CardHeader title={t("bansos.publicPage")} icon={<Globe size={18} />} subtitle={t("bansos.publicPageHint")} />
        <CardBody>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <code>{publicUrl}</code>
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? <Check size={15} /> : <ExternalLink size={15} />}
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl).then(
                  () => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  },
                  () => undefined,
                );
              }}
            >
              {copied ? t("bansos.copied") : t("bansos.copyPublicLink")}
            </Button>
            <a href={publicUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">
                {t("bansos.openPublicPage")}
              </Button>
            </a>
          </div>
        </CardBody>
      </Card>

      <div className="metric-grid">
        <StatCard
          label={t("bansos.publishedKeys")}
          value={String(published.length)}
          detail={t("bansos.keys")}
          tone="green"
        />
        <StatCard
          label={t("bansos.totalBudget")}
          value={totalBudget === 0 ? t("bansos.unlimited") : formatNumber(totalBudget)}
          detail={t("portal.tokens")}
          tone="purple"
        />
        <StatCard
          label={t("bansos.totalUsed")}
          value={formatNumber(totalUsed)}
          detail={t("portal.tokens")}
          tone="teal"
        />
        <StatCard
          label={t("bansos.allKeys")}
          value={String(rows.length)}
          detail={t("bansos.keys")}
          tone="accent"
        />
      </div>

      <Card glass>
        <CardHeader title={t("bansos.pickKeys")} icon={<KeyRound size={18} />} subtitle={t("bansos.pickKeysHint")} />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              title={t("bansos.keysEmpty")}
              message={t("bansos.keysEmptyHint")}
              icon={<KeyRound size={20} />}
              compact
            />
          ) : (
            <DataTable
              headers={[
                t("bansos.keyLabel"),
                t("bansos.publicStatus"),
                t("bansos.modelsAllowed"),
                t("bansos.rpm"),
                t("bansos.keyConsumed"),
                "",
              ]}
            >
              {rows.map((key) => (
                <tr key={key.id}>
                  <td>
                    <div className="account-row-name">{key.label}</div>
                    <code className="account-row-meta">{key.keyPrefix ?? "—"}</code>
                  </td>
                  <td>
                    <Badge tone={key.bansosEnabled ? "ok" : "disabled"}>
                      {key.bansosEnabled ? t("bansos.published") : t("bansos.private")}
                    </Badge>
                  </td>
                  <td>
                    {key.modelAccessMode === "whitelist" && (key.modelList?.length ?? 0) > 0 ? (
                      <span className="account-row-meta">
                        {(key.modelList ?? []).length} {t("bansos.models")}
                      </span>
                    ) : (
                      <span className="account-row-meta">{t("bansos.allModels")}</span>
                    )}
                  </td>
                  <td>{key.requestsPerMinute ?? t("bansos.unlimited")}</td>
                  <td>
                    {formatNumber(key.tokensConsumed)}
                    {key.lifetimeTokenBudget ? ` / ${formatNumber(key.lifetimeTokenBudget)}` : ""}
                  </td>
                  <td>
                    <div className="account-row-actions">
                      <Button
                        size="sm"
                        variant={key.bansosEnabled ? "secondary" : "primary"}
                        loading={update.isPending}
                        onClick={() =>
                          update.mutate({
                            keyId: key.id,
                            settings: { bansosEnabled: !key.bansosEnabled },
                          })
                        }
                      >
                        {key.bansosEnabled ? t("bansos.unpublish") : t("bansos.publish")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Settings2 size={15} />}
                        onClick={() => setEditing(key)}
                      >
                        {t("bansos.edit")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </CardBody>
      </Card>

      {editing !== null ? <BansosKeyDialog apiKey={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
