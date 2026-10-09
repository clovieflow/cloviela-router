/**
 * Public Bansos endpoint.
 *
 * ── What it serves ──────────────────────────────────────────────────────────
 * The keys the operator published, with everything a recipient needs: the base
 * URL, the key itself, the models it may call, its rate limit, and how much of
 * its token budget is left. No login, because the operator created every key
 * and is the one sending the link — a sign-in step would add a step without
 * adding a check.
 *
 * ── What it must never return ───────────────────────────────────────────────
 * A published key is a credential the operator chose to show, so the key
 * itself is fine. Everything else about the account is not: no `adminNotes`,
 * no `keyHash`, no `keyEncrypted` blob, no `tenantId`, no `scopes`, no
 * `modelPrefix`, no other tenant's keys, and no unpublished key — not even as a
 * count. The select list below names every field explicitly rather than
 * spreading the row, so a column added later cannot leak by default.
 *
 * ── Why a revoked key disappears rather than showing as revoked ─────────────
 * The page exists to hand out working credentials. A dead key with its secret
 * still printed is a support ticket waiting to happen.
 */
import { Elysia } from "elysia";
import { and, desc, eq, gte, inArray, isNull, or, gt, sql } from "drizzle-orm";
import type { ClovielaDatabase } from "../../persistence/postgres";
import { apiKeys, telemetryEvents } from "../../persistence/schema";
import { decryptCredentialToString } from "../../security/crypto";
import { errorResponse } from "../shared/errors";
import { PublicModelCatalogStore } from "../providers/catalog/public-model-store";
import { resolveApiKeyAuthorization } from "../../security/api-key-auth";

/**
 * The base URL a recipient should point their client at.
 *
 * Built from the request when no origin is configured, so the page is correct
 * behind a reverse proxy without the operator editing anything: whatever host
 * served the page is the host their clients will reach.
 */
function baseUrl(request: Request, configuredOrigin: string | undefined): string {
  const origin = configuredOrigin?.trim();
  if (origin !== undefined && origin.length > 0) return origin.replace(/\/+$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * The tenant whose keys are published.
 *
 * A personal installation has one tenant, so the page does not need to be
 * addressed by anything. If more than one exists the oldest is used, which is
 * the one the console itself belongs to — and the console is where the
 * operator publishes from, so they see their own keys.
 */
async function resolveTenantId(db: ClovielaDatabase): Promise<string | undefined> {
  const rows = await db
    .select({ id: apiKeys.tenantId })
    .from(apiKeys)
    .limit(1);
  return rows[0]?.id;
}

export function createBansosPublicRoutes(deps: {
  db: ClovielaDatabase;
  /** `CLOVIELA_PUBLIC_ORIGIN`, when the operator set one. */
  publicOrigin?: string | undefined;
}): Elysia<any, any, any, any, any, any, any, any> {
  const catalog = new PublicModelCatalogStore(deps.db);
  return new Elysia({ prefix: "/bansos/public" }).get("/", async ({ request, set }) => {
    try {
      const tenantId = await resolveTenantId(deps.db);
      if (tenantId === undefined) {
        return { baseUrl: baseUrl(request, deps.publicOrigin), keys: [], totals: { keys: 0, tokensConsumed: 0, tokenBudget: null } };
      }

      const rows = await deps.db
        .select({
          id: apiKeys.id,
          keyHash: apiKeys.keyHash,
          label: apiKeys.label,
          keyPrefix: apiKeys.keyPrefix,
          keyEncrypted: apiKeys.keyEncrypted,
          requestsPerMinute: apiKeys.requestsPerMinute,
          maxConcurrentRequests: apiKeys.maxConcurrentRequests,
          dailyTokenLimit: apiKeys.dailyTokenLimit,
          monthlyTokenLimit: apiKeys.monthlyTokenLimit,
          lifetimeTokenBudget: apiKeys.lifetimeTokenBudget,
          lifetimeTokensConsumed: apiKeys.lifetimeTokensConsumed,
          modelAccessMode: apiKeys.modelAccessMode,
          modelList: apiKeys.modelList,
          expiresAt: apiKeys.expiresAt,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.tenantId, tenantId),
            eq(apiKeys.bansosEnabled, true),
            eq(apiKeys.enabled, true),
            isNull(apiKeys.revokedAt),
            or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
          ),
        );

      let consumed = 0;
      let budget = 0;
      const keys = rows.map((row) => {
        consumed += row.lifetimeTokensConsumed ?? 0;
        budget += row.lifetimeTokenBudget ?? 0;

        let secret: string | null = null;
        if (row.keyEncrypted !== null) {
          // A decryption failure means the encryption key changed since this
          // key was issued. The key still authenticates; it just cannot be
          // displayed, and printing a wrong secret would be worse than none.
          try {
            secret = decryptCredentialToString(row.keyEncrypted);
          } catch {
            secret = null;
          }
        }

        // A key that is not in whitelist mode has no model restriction, and
        // saying so is more honest than an empty list that looks like "none".
        const models =
          row.modelAccessMode === "whitelist" && Array.isArray(row.modelList)
            ? [...row.modelList]
            : [];

        return {
          id: row.id,
          label: row.label,
          prefix: row.keyPrefix,
          secret,
          models,
          modelRestricted: row.modelAccessMode === "whitelist" && models.length > 0,
          requestsPerMinute: row.requestsPerMinute,
          maxConcurrentRequests: row.maxConcurrentRequests,
          dailyTokenLimit: row.dailyTokenLimit,
          monthlyTokenLimit: row.monthlyTokenLimit,
          tokenBudget: row.lifetimeTokenBudget,
          tokensConsumed: row.lifetimeTokensConsumed ?? 0,
          remaining:
            row.lifetimeTokenBudget === null
              ? null
              : Math.max(0, row.lifetimeTokenBudget - (row.lifetimeTokensConsumed ?? 0)),
          expiresAt: row.expiresAt?.toISOString() ?? null,
        };
      });

      // ── Usage over the last 24 hours, and the recent request log ─────────
      // Scoped to the published keys by id, so the page can only ever show
      // traffic that belongs to a credential the operator chose to publish.
      // A tenant-wide query would leak every private key's activity.
      const ids = rows.map((row) => row.id);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const dayTotals =
        ids.length === 0
          ? []
          : await deps.db
              .select({
                requests: sql<number>`count(*)::int`,
                inputTokens: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}), 0)::int`,
                outputTokens: sql<number>`coalesce(sum(${telemetryEvents.outputTokens}), 0)::int`,
                failed: sql<number>`count(*) filter (where ${telemetryEvents.status} <> 'completed')::int`,
              })
              .from(telemetryEvents)
              .where(
                and(
                  inArray(telemetryEvents.apiKeyId, ids),
                  gte(telemetryEvents.createdAt, since),
                ),
              );

      const recent =
        ids.length === 0
          ? []
          : await deps.db
              .select({
                id: telemetryEvents.id,
                createdAt: telemetryEvents.createdAt,
                apiKeyId: telemetryEvents.apiKeyId,
                requestedModel: telemetryEvents.requestedModel,
                status: telemetryEvents.status,
                httpStatus: telemetryEvents.httpStatus,
                inputTokens: telemetryEvents.inputTokens,
                outputTokens: telemetryEvents.outputTokens,
                latencyMs: telemetryEvents.latencyMs,
                stream: telemetryEvents.stream,
              })
              .from(telemetryEvents)
              .where(inArray(telemetryEvents.apiKeyId, ids))
              .orderBy(desc(telemetryEvents.createdAt))
              .limit(50);

      const labelFor = new Map(rows.map((row) => [row.id, row.label]));

      // ── The model catalogue ─────────────────────────────────────────────
      // Resolved through the same code path `/v1/models` uses, with each
      // published key's own authorization. Anything printed here is therefore
      // a name the gateway accepts for that key. A hand-rolled query kept
      // listing models whose provider had no account (503 on call) or whose
      // bare id was ambiguous across providers (400), so the copy button
      // handed out strings that failed the moment they were pasted.
      //
      // Runs after decryption because `resolveApiKeyAuthorization` takes the
      // raw token — the same string a recipient will send.
      const catalogue: {
        name: string;
        provider: string | null;
        contextLimit: number | null;
        outputLimit: number | null;
        reasoning: boolean;
        toolCall: boolean;
        vision: boolean;
      }[] = [];
      const seenNames = new Set<string>();
      for (const key of keys) {
        if (key.secret === null) continue;
        const authorization = await resolveApiKeyAuthorization(deps.db, key.secret);
        if (authorization === undefined) continue;
        const listed = await catalog.listPublicModels(
          authorization.tenantId,
          authorization.snapshot,
          authorization.modelPrefix,
        );
        for (const entry of listed) {
          if (seenNames.has(entry.id)) continue;
          seenNames.add(entry.id);
          const capabilities = (entry as { capabilities?: unknown }).capabilities;
          const modalities = Array.isArray(capabilities) ? (capabilities as string[]) : [];
          catalogue.push({
            name: entry.id,
            provider: entry.owned_by ?? null,
            contextLimit: entry.context_length ?? null,
            outputLimit: entry.max_completion_tokens ?? null,
            reasoning: entry.reasoning === true,
            toolCall: entry.tool_call === true,
            vision: modalities.some((m) => typeof m === "string" && m.includes("image")),
          });
        }
      }
      catalogue.sort((a, b) => a.name.localeCompare(b.name));

      return {
        baseUrl: baseUrl(request, deps.publicOrigin),
        keys,
        totals: {
          keys: keys.length,
          tokensConsumed: consumed,
          tokenBudget: budget === 0 ? null : budget,
        },
        models: catalogue,
        last24h: {
          requests: dayTotals[0]?.requests ?? 0,
          inputTokens: dayTotals[0]?.inputTokens ?? 0,
          outputTokens: dayTotals[0]?.outputTokens ?? 0,
          failed: dayTotals[0]?.failed ?? 0,
        },
        // The key's own label, never its id: the page has no business
        // exposing internal identifiers it does not already print.
        recent: recent.map((row) => ({
          id: row.id,
          at: row.createdAt.toISOString(),
          keyLabel: labelFor.get(row.apiKeyId ?? "") ?? "—",
          model: row.requestedModel,
          ok: row.status === "completed",
          httpStatus: row.httpStatus,
          inputTokens: row.inputTokens ?? 0,
          outputTokens: row.outputTokens ?? 0,
          latencyMs: row.latencyMs,
          stream: row.stream ?? false,
        })),
      };
    } catch (error) {
      return errorResponse(error, set, "Could not read the published keys");
    }
  });
}
