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
import { and, eq, isNull, or, gt } from "drizzle-orm";
import type { ClovielaDatabase } from "../../persistence/postgres";
import { apiKeys } from "../../persistence/schema";
import { decryptCredentialToString } from "../../security/crypto";
import { errorResponse } from "../shared/errors";

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
  return new Elysia({ prefix: "/bansos/public" }).get("/", async ({ request, set }) => {
    try {
      const tenantId = await resolveTenantId(deps.db);
      if (tenantId === undefined) {
        return { baseUrl: baseUrl(request, deps.publicOrigin), keys: [], totals: { keys: 0, tokensConsumed: 0, tokenBudget: null } };
      }

      const rows = await deps.db
        .select({
          id: apiKeys.id,
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

      return {
        baseUrl: baseUrl(request, deps.publicOrigin),
        keys,
        totals: {
          keys: keys.length,
          tokensConsumed: consumed,
          // `null` when no key ever set a ceiling, so the page can say
          // "unlimited" instead of rendering a budget of zero.
          tokenBudget: budget === 0 ? null : budget,
        },
      };
    } catch (error) {
      return errorResponse(error, set, "Could not read the published keys");
    }
  });
}
