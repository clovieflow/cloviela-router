/**
 * Bansos: an API key you publish.
 *
 * ── The whole idea ──────────────────────────────────────────────────────────
 * A Bansos key is an ordinary `api_keys` row with `bansos_enabled = true`.
 * Everything the feature needs is already a column on that row: the model
 * allowlist, the RPM, the concurrency, the token budget, the usage counter,
 * the expiry. Publishing a key is therefore one flag, not a workflow.
 *
 * ── Why this replaced a program layer ───────────────────────────────────────
 * The first version modelled programs, participants, subsidized models and
 * separately-issued keys. That is the shape of a multi-tenant SaaS, and it
 * turned "publish this key" into a seven-step setup with its own vocabulary.
 * The operator's actual choices — which key, which models, how fast, how many
 * tokens — were already columns on the key, so the layer above them was four
 * tables of ceremony.
 *
 * ── What enforcement still does ─────────────────────────────────────────────
 * Nothing, deliberately. A published key is admitted by `ApiKeyAdmissionService`
 * through the same path as every other key, using the same columns. There is no
 * second code path to keep in step, and a key behaves identically whether or
 * not it is published — publishing only decides whether it appears on the page.
 */
import type { ClovielaDatabase } from "../../persistence/postgres";
import { apiKeys } from "../../persistence/schema";
import { and, eq, isNull, or, gt } from "drizzle-orm";

/**
 * Whether a key is currently usable, ignoring publication.
 *
 * The authentication lookup already refuses revoked and expired keys, so this
 * is only used where a row has been read directly — the admin list and the
 * public page — to label it honestly rather than showing a revoked key as
 * live.
 */
export function isKeyLive(row: {
  readonly enabled: boolean;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
}): boolean {
  if (!row.enabled || row.revokedAt !== null) return false;
  if (row.expiresAt !== null && row.expiresAt <= new Date()) return false;
  return true;
}

/**
 * The keys published on the public page.
 *
 * Scoped to one tenant and filtered to live keys: a revoked or expired key is
 * not advertised, because the page exists to hand out working credentials.
 */
export async function listPublishedKeys(
  db: ClovielaDatabase,
  tenantId: string,
): Promise<(typeof apiKeys.$inferSelect)[]> {
  return db
    .select()
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
}
