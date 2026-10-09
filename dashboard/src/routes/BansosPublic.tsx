/**
 * Public Bansos page.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * One page an operator can hand to the people they are subsidizing. It answers
 * everything a recipient needs without a support message: where to point their
 * client, which key to use, which models they may call, how much has been
 * spent, how much is left, when access ends, and the exact code to paste.
 * No login, because the operator created every key and is the one sending the
 * link — a sign-in step would add a step without adding a check.
 *
 * ── Why ready-to-paste snippets ─────────────────────────────────────────────
 * A base URL and a key are two facts; a working request is one action. The
 * recipients of a subsidy program are frequently not the people who configure
 * their own tooling, and "paste this into a terminal" is a different level of
 * difficulty from "set your base_url and api_key". The snippets are generated
 * from the live values, so they cannot drift from what the page shows.
 *
 * ── What it deliberately does not show ──────────────────────────────────────
 * Nothing per-participant beyond what the operator published, no `adminNotes`,
 * no provider names, no upstream model ids, no other program or tenant. The
 * page renders what the server sends, and the server sends only public fields.
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
  readonly label: string;
  readonly secret: string | null;
  readonly keyPrefix: string | null;
  readonly live: boolean;
  readonly tokensConsumed: number;
  readonly tokenBudget: number | null;
  readonly expiresAt: string | null;
  readonly requestsPerMinute: number | null;
  readonly maxConcurrentRequests: number | null;
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
    readonly startsAt: string | null;
    readonly endsAt: string | null;
    readonly maxInputTokens: number | null;
    readonly maxOutputTokens: number | null;
    readonly maxRequestBytes: number | null;
    readonly maxRequestDurationMs: number | null;
    readonly maxStreamDurationMs: number | null;
    readonly termsRequired: boolean;
    readonly termsText: string | null;
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

/**
 * A quota bar.
 *
 * Renders nothing when no ceiling was configured, because a bar at 0% for an
 * unlimited key reads as "you have used nothing of your nothing".
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
  const [slug, setSlug] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<"curl" | "python" | "node">("curl");

  // The program comes from the URL: `/console/akses/<slug>`. Read from the path
  // rather than a router param so the page works opened as a bare link.
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
  const model = payload.models[0]?.publicModelId ?? "model-name";
  const key = primaryKey?.secret ?? "YOUR_KEY";

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
          <h1>{payload.program.name}</h1>
          <p className="account-row-meta">{payload.program.description ?? t("bansos.publicSubtitle")}</p>
        </div>
        <Badge tone={liveKeys.length > 0 ? "ok" : "err"}>
          {liveKeys.length > 0 ? t("bansos.publicOpen") : t("bansos.publicClosed")}
        </Badge>
      </div>

      {/* Terms come first when required: a recipient should read them before
          copying a key, not after. */}
      {payload.program.termsRequired && payload.program.termsText ? (
        <Card glass>
          <CardHeader title={t("bansos.termsText")} subtitle={t("bansos.termsTextHint")} />
          <CardBody>
            <p style={{ whiteSpace: "pre-wrap" }}>{payload.program.termsText}</p>
          </CardBody>
        </Card>
      ) : null}

      <div className="metric-grid">
        <StatCard
          label={t("bansos.publicTotalUsed")}
          value={formatNumber(payload.totals.tokensConsumed)}
          detail={t("portal.tokens")}
          tone="teal"
        />
        <StatCard
          label={t("bansos.publicBudget")}
          value={payload.totals.tokenBudget === null ? t("bansos.unlimited") : formatNumber(payload.totals.tokenBudget)}
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
          value={payload.program.globalRpm === null ? t("bansos.unlimited") : String(payload.program.globalRpm)}
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

      {/* Ready-to-paste code. The recipients are often not the people who
          configure their own tooling, and a working request is one action
          where a base URL plus a key is two facts. */}
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
        <CardHeader title={t("portal.modelsTitle")} icon={<KeyRound size={18} />} subtitle={t("portal.modelsHint")} />
        <CardBody>
          {payload.models.length === 0 ? (
            <p className="account-row-meta">{t("portal.modelsEmpty")}</p>
          ) : (
            <DataTable headers={[t("bansos.publicModelName"), t("portal.maxInput"), t("portal.maxOutput"), ""]}>
              {payload.models.map((entry) => (
                <tr key={entry.publicModelId}>
                  <td>
                    <code>{entry.publicModelId}</code>
                    {entry.displayName ? <span className="account-row-meta"> — {entry.displayName}</span> : null}
                  </td>
                  <td>
                    {entry.maxInputTokens === null
                      ? t("bansos.unlimited")
                      : formatNumber(entry.maxInputTokens)}
                  </td>
                  <td>
                    {entry.maxOutputTokens === null
                      ? t("bansos.unlimited")
                      : formatNumber(entry.maxOutputTokens)}
                  </td>
                  <td>
                    <CopyButton value={entry.publicModelId} label={t("bansos.copy")} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card glass>
        <CardHeader title={t("bansos.publicUsage")} icon={<KeyRound size={18} />} subtitle={t("bansos.publicUsageHint")} />
        <CardBody>
          <DataTable
            headers={[
              t("bansos.keyLabel"),
              t("bansos.participantStatus"),
              t("bansos.keyConsumed"),
              t("bansos.usageRemaining"),
              t("bansos.expiresAt"),
            ]}
          >
            {payload.keys.map((entry) => (
              <tr key={entry.keyPrefix ?? entry.label}>
                <td>
                  <div className="account-row-name">{entry.label}</div>
                  <code className="account-row-meta">{entry.keyPrefix ?? "—"}</code>
                </td>
                <td>
                  <Badge tone={entry.live ? "ok" : "disabled"}>
                    {entry.live ? t("bansos.keyLive") : t("bansos.keyRevoked")}
                  </Badge>
                </td>
                <td>
                  <div>{formatNumber(entry.tokensConsumed)}</div>
                  <QuotaBar used={entry.tokensConsumed} budget={entry.tokenBudget} />
                </td>
                <td>
                  {entry.tokenBudget === null
                    ? t("bansos.unlimited")
                    : formatNumber(Math.max(0, entry.tokenBudget - entry.tokensConsumed))}
                </td>
                <td>
                  {entry.expiresAt === null
                    ? t("bansos.never")
                    : new Date(entry.expiresAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </DataTable>
        </CardBody>
      </Card>

      {/* The program's own window and per-request ceilings: a recipient needs
          to know when access ends and how big a request may be. */}
      <Card glass>
        <CardHeader title={t("bansos.publicLimits")} subtitle={t("bansos.publicLimitsHint")} />
        <CardBody>
          <dl className="about-facts">
            <div className="about-fact">
              <dt className="about-fact-label">{t("bansos.sectionWindow")}</dt>
              <dd className="about-fact-value">
                {payload.program.startsAt === null && payload.program.endsAt === null
                  ? t("bansos.always")
                  : `${payload.program.startsAt === null ? "…" : new Date(payload.program.startsAt).toLocaleString()} → ${
                      payload.program.endsAt === null ? "…" : new Date(payload.program.endsAt).toLocaleString()
                    }`}
              </dd>
            </div>
            <div className="about-fact">
              <dt className="about-fact-label">{t("bansos.globalConcurrency")}</dt>
              <dd className="about-fact-value">
                {payload.program.globalConcurrency === null
                  ? t("bansos.unlimited")
                  : String(payload.program.globalConcurrency)}
              </dd>
            </div>
            <div className="about-fact">
              <dt className="about-fact-label">{t("bansos.maxInputTokens")}</dt>
              <dd className="about-fact-value">
                {payload.program.maxInputTokens === null
                  ? t("bansos.unlimited")
                  : formatNumber(payload.program.maxInputTokens)}
              </dd>
            </div>
            <div className="about-fact">
              <dt className="about-fact-label">{t("bansos.maxOutputTokens")}</dt>
              <dd className="about-fact-value">
                {payload.program.maxOutputTokens === null
                  ? t("bansos.unlimited")
                  : formatNumber(payload.program.maxOutputTokens)}
              </dd>
            </div>
            <div className="about-fact">
              <dt className="about-fact-label">{t("bansos.maxRequestBytes")}</dt>
              <dd className="about-fact-value">
                {payload.program.maxRequestBytes === null
                  ? t("bansos.unlimited")
                  : formatNumber(payload.program.maxRequestBytes)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </main>
  );
}
