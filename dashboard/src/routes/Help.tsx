/**
 * Help: the setup path, real client examples, and troubleshooting that matches
 * the gateway's actual error vocabulary.
 *
 * ── Why the commands are generated, not written ────────────────────────────
 * The endpoint list is derived from the gateway's own route registration as
 * documented in `AGENTS.md`/the protocol docs, and the model placeholder is
 * filled from the live catalog when one exists. A hardcoded "40 providers"
 * banner or a sample that names a model this install cannot route would be
 * worse than no sample: the operator would paste it, get a 404, and lose trust
 * in the whole page.
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  ExternalLink,
  HelpCircle,
  LifeBuoy,
  Terminal,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Stack } from "../components/ui/stack";
import { ClipboardButton } from "../components/patterns/clipboard-button";
import { GITHUB_REPO_URL } from "../components/patterns/github-badge";
import { useAllModelsCatalog } from "../components/ModelPicker";
import { PageHead } from "../components/PageHead";
import { useT } from "../shared/locale-context";
import { DASHBOARD_RELEASE_LABEL } from "../shared/version";
import type { MessageKey } from "../shared/i18n";

/**
 * Gateway surfaces, with the method and auth they actually require.
 *
 * These are the invocation endpoints the gateway registers; each is a real
 * route, not an aspiration. `needsKey` is spelled out because a reader who
 * omits the header gets a 401 and blames the model.
 */
const ENDPOINTS: readonly {
  readonly method: string;
  readonly path: string;
  readonly purpose: string;
  readonly needsKey: boolean;
}[] = [
  { method: "POST", path: "/v1/chat/completions", purpose: "OpenAI Chat Completions", needsKey: true },
  { method: "POST", path: "/v1/responses", purpose: "OpenAI Responses", needsKey: true },
  { method: "POST", path: "/v1/responses/compact", purpose: "Responses context compaction", needsKey: true },
  { method: "POST", path: "/v1/messages", purpose: "Anthropic Messages", needsKey: true },
  { method: "POST", path: "/v1/completions", purpose: "Legacy completions", needsKey: true },
  { method: "POST", path: "/v1/search", purpose: "Native web search", needsKey: true },
  { method: "POST", path: "/v1/systemone", purpose: "System One service", needsKey: true },
  { method: "GET", path: "/v1/models", purpose: "Authorized model list", needsKey: true },
  { method: "GET", path: "/health", purpose: "Liveness probe", needsKey: false },
  { method: "GET", path: "/health/ready", purpose: "Readiness probe", needsKey: false },
  { method: "GET", path: "/metrics", purpose: "Prometheus metrics", needsKey: false },
];

const TROUBLESHOOTING: readonly { readonly symptomKey: MessageKey; readonly fixKey: MessageKey }[] = [
  { symptomKey: "help.trouble.auth", fixKey: "help.trouble.auth.fix" },
  { symptomKey: "help.trouble.noProvider", fixKey: "help.trouble.noProvider.fix" },
  { symptomKey: "help.trouble.model", fixKey: "help.trouble.model.fix" },
  { symptomKey: "help.trouble.stream", fixKey: "help.trouble.stream.fix" },
];

export default function Help(): ReactNode {
  const t = useT();
  const catalog = useAllModelsCatalog(true);

  /**
   * The gateway origin the operator is actually browsing. Hardcoding
   * `127.0.0.1:12800` handed a copy-pasteable command to anyone running a
   * different `PORT` (or behind a reverse proxy) that fails on first use.
   */
  const origin = useMemo(() => window.location.origin, []);

  // A real, routable model id when the catalog has one; an obvious placeholder
  // otherwise. Never a plausible-looking id that does not exist here.
  const sampleModel = useMemo(() => {
    const real = catalog.items.find((item) => item.kind === "model" && item.entry.enabled);
    return real?.qualified ?? "{model}";
  }, [catalog.items]);

  const chatCommand = useMemo(
    () =>
      [
        `curl -sS ${origin}/v1/chat/completions \\`,
        '  -H "Authorization: Bearer {key}" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"model":"${sampleModel}","messages":[{"role":"user","content":"ping"}]}'`,
      ].join("\n"),
    [origin, sampleModel],
  );

  const streamCommand = useMemo(
    () =>
      [
        `curl -N -sS ${origin}/v1/messages \\`,
        '  -H "x-api-key: {key}" \\',
        '  -H "anthropic-version: 2023-06-01" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"model":"${sampleModel}","max_tokens":64,"stream":true,`,
        '       "messages":[{"role":"user","content":"ping"}]}\'',
      ].join("\n"),
    [origin, sampleModel],
  );

  const pythonCommand = useMemo(
    () =>
      [
        "from openai import OpenAI",
        "",
        `client = OpenAI(base_url="${origin}/v1", api_key="{key}")`,
        `completion = client.chat.completions.create(model="${sampleModel}",`,
        '    messages=[{"role": "user", "content": "ping"}])',
        "print(completion.choices[0].message.content)",
      ].join("\n"),
    [origin, sampleModel],
  );

  return (
    <div className="dashboard-page">
      <PageHead title={t("help.title")} description={t("help.subtitle")} art="settings" />

      <Card>
        <CardHeader title={t("help.quickstart")} subtitle={t("help.quickstartHint")} icon={<BookOpen size={15} />} />
        <CardBody>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, lineHeight: 1.9, color: "var(--text-secondary)" }}>
            <li>
              <Link to="/providers" style={{ color: "var(--accent)" }}>
                {t("nav.providers")}
              </Link>
            </li>
            <li>
              <Link to="/models" style={{ color: "var(--accent)" }}>
                {t("nav.models")}
              </Link>
            </li>
            <li>
              <Link to="/api-keys" style={{ color: "var(--accent)" }}>
                {t("nav.apiKeys")}
              </Link>
            </li>
            <li>
              <Link to="/onboarding" style={{ color: "var(--accent)" }}>
                {t("nav.onboarding")}
              </Link>
            </li>
            <li>
              <Link to="/simulator" style={{ color: "var(--accent)" }}>
                {t("nav.simulator")}
              </Link>
            </li>
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("help.endpoints")}
          subtitle={t("help.endpointsHint", { key: "{key}" })}
          icon={<Terminal size={15} />}
        />
        <CardBody>
          <Stack gap="10px">
            {ENDPOINTS.map((endpoint) => {
              const value = `${endpoint.method} ${origin}${endpoint.path}`;
              return (
                <div
                  key={endpoint.path}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    padding: "8px 0",
                    borderBottom: "1px dashed var(--inner-border)",
                  }}
                >
                  <span
                    className={`badge ${endpoint.method === "GET" ? "badge-info" : "badge-accent"}`}
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {endpoint.method}
                  </span>
                  <code style={{ fontSize: 12, flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
                    {endpoint.path}
                  </code>
                  <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", flex: "1 1 160px" }}>
                    {endpoint.purpose}
                  </span>
                  <span className={`badge ${endpoint.needsKey ? "badge-warn" : "badge-ok"}`}>
                    {endpoint.needsKey ? "key" : "public"}
                  </span>
                  <ClipboardButton value={value} label={t("help.copyEndpoint")} copiedLabel={t("action.copied")} size="sm" />
                </div>
              );
            })}
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("help.clients")} icon={<HelpCircle size={15} />} />
        <CardBody>
          <Stack gap="14px">
            <div className="code-sample">
              <div className="code-sample-head">
                <span>bash — chat completions</span>
                <ClipboardButton value={chatCommand} label={t("help.copyCommand")} copiedLabel={t("action.copied")} size="sm" />
              </div>
              <pre>{chatCommand}</pre>
            </div>
            <div className="code-sample">
              <div className="code-sample-head">
                <span>bash — streaming via Anthropic wire</span>
                <ClipboardButton value={streamCommand} label={t("help.copyCommand")} copiedLabel={t("action.copied")} size="sm" />
              </div>
              <pre>{streamCommand}</pre>
            </div>
            <div className="code-sample">
              <div className="code-sample-head">
                <span>python — openai sdk</span>
                <ClipboardButton value={pythonCommand} label={t("help.copyCommand")} copiedLabel={t("action.copied")} size="sm" />
              </div>
              <pre>{pythonCommand}</pre>
            </div>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("help.troubleshooting")} icon={<LifeBuoy size={15} />} />
        <CardBody>
          <div className="trouble-list">
            {TROUBLESHOOTING.map((entry) => (
              <div key={entry.symptomKey} className="trouble-item">
                <p className="trouble-symptom">{t(entry.symptomKey)}</p>
                <p className="trouble-fix">{t(entry.fixKey)}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              size="sm"
              icon={<ExternalLink size={13} />}
              onClick={() => window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer")}
            >
              {t("help.docsLink")}
            </Button>
            <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
              {DASHBOARD_RELEASE_LABEL}
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
