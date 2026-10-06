/**
 * Best-effort recognition of inbound CLI Tools clients for remote mapping.
 *
 * `routing:cli_mapping` remaps are keyed by API key, but several tools can
 * send the same short model slot (`opus`, `sonnet`, …). Without a client
 * gate, a Claude → DeepSeek remap would also rewrite a non-Claude caller
 * that happened to name `opus`, stealing the real Anthropic alias route.
 *
 * This is evidence for routing policy, not a security boundary: a client
 * that forges `claude-cli/…` looks like Claude Code. The gate only stops
 * the accidental cross-tool collision the operator actually hits.
 */

/** Probe shape shared with the client-router fingerprint helper. */
export interface CliClientProbe {
  readonly userAgent?: string | null;
  readonly headers?: Headers | Readonly<Record<string, string>>;
}

function readUserAgent(probe: CliClientProbe): string | undefined {
  if (probe.userAgent !== undefined && probe.userAgent !== null) {
    const trimmed = probe.userAgent.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  const headers = probe.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const value = headers.get("user-agent")?.trim();
    return value && value.length > 0 ? value : undefined;
  }
  const direct = headers["user-agent"] ?? headers["User-Agent"];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "user-agent" && typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Tool ids that currently publish remote (`mappingMode: "remote"`) routes.
 * Only Claude Code does today; expand when another tool gains a mapping table.
 */
const REMOTE_CLI_TOOL_UA: ReadonlyArray<{
  readonly toolId: string;
  readonly pattern: RegExp;
}> = [
  // Anthropic documents relying on `claude-cli` in the User-Agent for log
  // filtering; MCP traffic uses `claude-code/<version>` instead.
  { toolId: "claude", pattern: /(^|[^a-z0-9])claude-cli\//i },
  { toolId: "claude", pattern: /(^|[^a-z0-9])claude-code\//i },
];

/**
 * Returns the remote CLI tool id recognised from the probe, or `null` when
 * the caller is not a remote-mapping client. Ordinary SDKs, curl, and local
 * mapping tools (Codex, …) stay unlabelled so their model ids resolve
 * through ordinary aliases / allowlists.
 */
export function detectRemoteCliToolId(probe: CliClientProbe): string | null {
  const userAgent = readUserAgent(probe);
  if (!userAgent) return null;
  for (const entry of REMOTE_CLI_TOOL_UA) {
    if (entry.pattern.test(userAgent)) return entry.toolId;
  }
  return null;
}

/**
 * Whether this authenticated key may consume persisted CLI source→target
 * mappings for the current request. Scope alone is not enough: the inbound
 * User-Agent must identify a remote-mapping CLI tool.
 */
export function allowsCliToolMappings(
  scopes: readonly string[] | null | undefined,
  probe: CliClientProbe,
): boolean {
  if (!scopes?.includes("routing:cli_mapping")) return false;
  return detectRemoteCliToolId(probe) !== null;
}
