/**
 * Model discovery for the buddy family (CodeBuddy intl / CN, WorkBuddy).
 *
 * The three sites are protocol-isomorphic but NOT path-isomorphic, and the
 * difference is load-bearing: the international sites answer
 * `/v2/enterprises/personal/models`, while the CN site answers
 * `/console/enterprises/personal/models`. Probing the CN path on an
 * international host returns HTTP 500 from the edge (APISIX) rather than 404 —
 * so a single shared path silently fails every intl sync while looking like an
 * upstream outage.
 *
 * Both shapes answer `{ code, msg, data: { models, agents } }`, not the OpenAI
 * `{data:[…]}` envelope the shared OpenAI-compatible discovery reads, which is
 * why this needs its own reader.
 *
 * Two filters decide what is actually callable, and both come from the payload:
 * - `disabled` rows are advertised but not served;
 * - when an `agents` entry named `cli` carries a model list, that list is the
 *   roster the CLI identity may call. The console publishes models a web
 *   session can reach but a CLI token cannot, and listing those would offer
 *   routes that answer with an upstream rejection.
 *
 * The static catalog beside each provider stays as the fallback for a site
 * whose directory is unreachable: discovery adds and corrects rows, it does not
 * replace the bundled list.
 */
import type { ModelDefinition } from "../../model-definition";
import { makeBuddyModel, type BuddyRawEntry } from "./buddy-catalog-shared";
import { buddyAccountUid } from "./buddy-oauth-shared";

/** Console directory path on the CN site (`copilot.tencent.com`). */
export const BUDDY_CN_MODELS_PATH = "/console/enterprises/personal/models" as const;

/**
 * Console directory path on the international sites (`codebuddy.ai`,
 * `workbuddy.ai`). The CN path above answers 500 on these hosts.
 */
export const BUDDY_INTL_MODELS_PATH = "/v2/enterprises/personal/models" as const;

/** Envelope code the console directory answers on success. */
const BUDDY_OK_CODE = 0;

interface BuddyDirectoryRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly disabled?: unknown;
  readonly maxInputTokens?: unknown;
  readonly maxOutputTokens?: unknown;
  readonly supportsImages?: unknown;
  readonly supportsToolCall?: unknown;
  readonly supportsReasoning?: unknown;
}

/**
 * Strips the version segment a provider's base URL carries so a directory path
 * that starts with its own `/v2` does not join into `/v2/v2/…`.
 *
 * The CodeBuddy intl base URL is `https://www.codebuddy.ai/v2` (the chat
 * endpoint is the version-less `/chat/completions` under it), while the model
 * directory lives at the absolute `/v2/enterprises/personal/models`. Joining
 * the two verbatim doubles the segment and the edge answers 404.
 */
function siteOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v\d+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads one site's console directory into catalog rows.
 *
 * Returns `null` when the endpoint is unusable (non-200, unparseable body, or a
 * non-zero envelope code) so the caller reports a failed sync instead of
 * persisting an empty roster over a working catalog.
 */
export async function fetchBuddyDirectoryModels(args: {
  readonly siteUrl: string;
  readonly providerId: string;
  readonly credential: string;
  readonly modelsPath: string;
  readonly endpoint: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fetcher?: typeof fetch | undefined;
}): Promise<readonly ModelDefinition[] | null> {
  const fetcher = args.fetcher ?? globalThis.fetch;
  // The directory scores by account: an access token's `sub` is the uid. An
  // opaque API key carries no identity, and the endpoint still answers for it,
  // so the header is declared absent rather than guessed.
  const uid = buddyAccountUid(args.credential);
  let response: Response;
  try {
    response = await fetcher(`${siteOrigin(args.siteUrl)}${args.modelsPath}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${args.credential}`,
        "x-product": "SaaS",
        ...(uid === undefined ? { "x-no-user-id": "1" } : { "x-user-id": uid }),
        "x-no-enterprise-id": "1",
        "x-no-department-info": "1",
      },
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const envelope = asRecord(body);
  if (envelope === undefined || envelope["code"] !== BUDDY_OK_CODE) return null;
  const data = asRecord(envelope["data"]);
  const rawModels = data?.["models"];
  if (!Array.isArray(rawModels)) return null;

  // The CLI agent's roster, when published, is the callable subset.
  const agents = data?.["agents"];
  let cliRoster: Set<string> | undefined;
  if (Array.isArray(agents)) {
    for (const entry of agents) {
      const agent = asRecord(entry);
      if (agent?.["name"] !== "cli") continue;
      const listed = agent["models"];
      if (Array.isArray(listed) && listed.length > 0) {
        cliRoster = new Set(listed.filter((id): id is string => typeof id === "string"));
      }
      break;
    }
  }

  const entries: BuddyRawEntry[] = [];
  const seen = new Set<string>();
  for (const entry of rawModels) {
    const model = asRecord(entry) as BuddyDirectoryRow | undefined;
    const id = model?.id;
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    if (model?.disabled === true) continue;
    if (cliRoster !== undefined && !cliRoster.has(id)) continue;
    seen.add(id);
    entries.push([
      id,
      typeof model?.name === "string" && model.name.length > 0 ? model.name : id,
      model?.supportsReasoning === true,
      model?.supportsImages === true,
      asNumber(model?.maxInputTokens),
      asNumber(model?.maxOutputTokens),
      model?.supportsToolCall === true,
    ]);
  }
  if (entries.length === 0) return null;
  return entries.map((entry) => makeBuddyModel(entry, args.providerId, args.endpoint));
}
