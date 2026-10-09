/**
 * Public Bansos page.
 *
 * ── What it is ──────────────────────────────────────────────────────────────
 * One page the operator sends to the people they are subsidizing. It shows the
 * base URL, every key that was published, the models each key may call, its
 * limits, and how much of its token budget is left — plus ready-to-paste code,
 * because a base URL and a key are two facts while a working request is one
 * action.
 *
 * ── No login ────────────────────────────────────────────────────────────────
 * The operator creates every key and is the one sending the link. Requiring a
 * sign-in would mean inventing a second credential per recipient — more to
 * distribute, more to leak — without adding a check on who may read a page
 * whose URL the operator already chose to share.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Sparkles, Terminal } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { DataTable, StatCard } from "../components/ui/layout";
import { ErrorState, LoadingState } from "../components/ui/state";
import { useT } from "../shared/locale-context";
import { formatNumber } from "../shared/format";

interface PublicKey {
  readonly id: string;
  readonly label: string;
  readonly prefix: string | null;
  readonly secret: string | null;
  readonly models: readonly string[];
  readonly modelRestricted: boolean;
  readonly requestsPerMinute: number | null;
  readonly maxConcurrentRequests: number | null;
  readonly dailyTokenLimit: number | null;
  readonly monthlyTokenLimit: number | null;
  readonly tokenBudget: number | null;
  readonly tokensConsumed: number;
  readonly remaining: number | null;
  readonly expiresAt: string | null;
}

interface PublicPayload {
  readonly baseUrl: string;
  readonly keys: readonly PublicKey[];
  readonly totals: {
    readonly keys: number;
    readonly tokensConsumed: number;
    readonly tokenBudget: number | null;
  };
}

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

/**
 * A quota bar, or nothing.
 *
 * Renders nothing when no ceiling was configured: a bar at 0% for an unlimited
 * key reads as "you have used nothing of your nothing".
 */
function QuotaBar({ used, budget }: { used: number; budget: number | null }): ReactNode {
  if (budget === null || budget <= 0) return null;
  const percent = Math.min(100, Math.round((used / budget) * 100));
  const tone = percent >= 90 ? "var(--red)" : percent >= 70 ? "var(--orange)" : "var(--green)";
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ background: "var(--surface-3, rgba(255,255,255,0.08))", borderRadius: "999px", height: "6px", overflow: "hidden", width: "100%", maxWidth: "220px" }}
    >
      <div style={{ width: `${percent}%`, height: "100%", background: tone, transition: "width 0.3s" }} />
    </div>
  );
}

export default function BansosPublic(): ReactNode {
  const t = useT();
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<"curl" | "python" | "node">("curl");

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/console/api/bansos/public");
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
    void load();
  }, [load]);

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
  if (payload.keys.length === 0) {
    return (
      <main className="auth-viewport">
        <ErrorState title={t("bansos.publicTitle")} message={t("bansos.publicNoKey")} compact />
      </main>
    );
  }

  const endpoint = `${payload.baseUrl}/v1`;
  // The first key drives the snippet; a recipient with several picks one from
  // the table below and the code still matches what the page shows.
  const primary = payload.keys[0];
  const key = primary?.secret ?? "YOUR_KEY";
  const model = primary?.models[0] ?? "model-name";

  // Generated from the live values, so a snippet can never show a URL or key
  // the page does not also show.
  const snippets: Record<typeof snippet, string> = {
    curl: `curl ${endpoint}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Halo"}]
  }'`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${endpoint}",
    api_key="${key}",
)

reply = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Halo"}],
)
print(reply.choices[0].message.content)`,
    node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${endpoint}",
  apiKey: "${key}",
});

const reply = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Halo" }],
});
console.log(reply.choices[0].message.content);`,
  };

  return (
    <main className="app-main-column" style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <h1>{t("bansos.publicTitle")}</h1>
          <p className="account-row-meta">{t("bansos.publicSubtitle")}</p>
        </div>
        <Badge tone="ok">{t("bansos.publicOpen")}</Badge>
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
          label={t("bansos.publishedKeys")}
          value={String(payload.totals.keys)}
          detail={t("bansos.keys")}
          tone="green"
        />
        <StatCard
          label={t("bansos.rpm")}
          value={primary?.requestsPerMinute === null || primary === undefined ? t("bansos.unlimited") : String(primary.requestsPerMinute)}
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
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <code style={{ wordBreak: "break-all" }}>{key}</code>
                <CopyButton value={key} label={t("bansos.copy")} />
              </div>
            </div>
          </div>
          <p className="account-row-meta" style={{ marginTop: "12px" }}>
            {t("bansos.publicCompat")}
          </p>
        </CardBody>
      </Card>

      <Card glass>
        <CardHeader title={t("bansos.publicSnippet")} icon={<Terminal size={18} />} subtitle={t("bansos.publicSnippetHint")} />
        <CardBody>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
            {(["curl", "python", "node"] as const).map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={snippet === kind ? "primary" : "secondary"}
                onClick={() => setSnippet(kind)}
              >
                {kind === "node" ? "Node.js" : kind === "python" ? "Python" : "curl"}
              </Button>
            ))}
            <CopyButton value={snippets[snippet]} label={t("bansos.copySnippet")} />
          </div>
          <pre
            style={{
              background: "var(--surface-2, rgba(0,0,0,0.25))",
              padding: "12px",
              borderRadius: "10px",
              overflowX: "auto",
              fontSize: "12px",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            <code>{snippets[snippet]}</code>
          </pre>
        </CardBody>
      </Card>

      <Card glass>
        <CardHeader title={t("bansos.pickKeys")} icon={<KeyRound size={18} />} subtitle={t("bansos.publicLimitsHint")} />
        <CardBody>
          <DataTable
            headers={[
              t("bansos.publicApiKey"),
              t("bansos.publicModelName"),
              t("bansos.rpm"),
              t("bansos.keyConsumed"),
              t("bansos.publicBudget"),
              t("bansos.expiresAt"),
              "",
            ]}
          >
            {payload.keys.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <div className="account-row-name">{entry.label}</div>
                  <code className="account-row-meta">{entry.secret ?? entry.prefix ?? "—"}</code>
                </td>
                <td>
                  {entry.modelRestricted ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {entry.models.map((name) => (
                        <code key={name} className="account-row-meta">
                          {name}
                        </code>
                      ))}
                    </div>
                  ) : (
                    <span className="account-row-meta">{t("bansos.allModels")}</span>
                  )}
                </td>
                <td>{entry.requestsPerMinute ?? t("bansos.unlimited")}</td>
                <td>
                  <div>{formatNumber(entry.tokensConsumed)}</div>
                  <QuotaBar used={entry.tokensConsumed} budget={entry.tokenBudget} />
                </td>
                <td>
                  {entry.tokenBudget === null ? t("bansos.unlimited") : formatNumber(entry.tokenBudget)}
                  {entry.remaining !== null ? (
                    <div className="account-row-meta">
                      {formatNumber(entry.remaining)} {t("portal.tokens")}
                    </div>
                  ) : null}
                </td>
                <td>
                  {entry.expiresAt === null
                    ? t("bansos.never")
                    : new Date(entry.expiresAt).toLocaleString()}
                </td>
                <td>
                  {entry.secret !== null ? (
                    <CopyButton value={entry.secret} label={t("bansos.copy")} />
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        </CardBody>
      </Card>
    </main>
  );
}
