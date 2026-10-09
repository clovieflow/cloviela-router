/**
 * Post-restore runtime convergence: what a committed restore must do to the
 * *live* process state it just invalidated.
 *
 * A restore replaces configuration rows wholesale, but several caches and
 * registries are process state that the commit cannot reach by itself:
 *
 * - **BYOK adapters.** `registerByokProviders` runs at boot and only ever adds
 *   or updates. A provider row the restored payload no longer contains (or one
 *   whose `base_url` is now `NULL` / `enabled = false`) keeps its adapter and
 *   SSRF upstream host registered, so dispatch keeps resolving an endpoint the
 *   committed catalog no longer describes. {@link reconcileByokProviders} drops
 *   exactly those, and re-registers every row the payload *did* change, so the
 *   next request routes through the restored endpoint in the same process — no
 *   restart.
 * - **Credential cache.** Restored `provider_accounts` rows carry restored
 *   credential ciphertext under the same account ids. The TTL cache would serve
 *   the pre-restore secret for its remaining window; a restore is rare, so the
 *   whole cache is dropped rather than reasoned about per account.
 * - **Settings revision.** `console_settings` is restored too. Every
 *   preferences cache keys on the process-wide revision counter, so bumping it
 *   converges all of them instantly instead of waiting out their TTLs.
 *
 * This runs **after** the restore transaction commits and after validation, so
 * a rejected payload never reaches here: rollback semantics are untouched.
 * Tenant safety is structural, not incidental — the BYOK reconcile reads the
 * whole `providers` table (one registry per process), so a row that still
 * exists for any tenant is re-registered before anything is dropped.
 */
import type { ClovielaDatabase } from "../../persistence/postgres";
import type { ProviderRegistry } from "../../providers/provider-registry";
import { reconcileByokProviders } from "../../providers/operations/provider-catalog-service";
import { invalidateCredentialCache } from "../../providers/operations/provider-credential-service";
import { bumpSettingsRevision } from "../../persistence/tenant-preferences";
import type { SsrfPolicy } from "../../config";

/** What the completion hook changed, reported on the import response. */
export interface RestoreRuntimeSync {
  /** BYOK providers re-registered from the restored rows. */
  readonly byokRegistered: number;
  /** Stale BYOK registrations dropped because no committed row justifies them. */
  readonly byokRemoved: number;
  /** The settings revision the process moved to, so caches keyed on it converge. */
  readonly settingsRevision: number;
}

/**
 * Builds the completion hook for one process. The returned function is called
 * once per committed restore; it is idempotent (re-running reconciles to the
 * same state) and cheap relative to the restore that preceded it.
 */
export function createRestoreRuntimeSync(deps: {
  readonly db: ClovielaDatabase;
  readonly registry: ProviderRegistry;
  readonly ssrfPolicy?: SsrfPolicy;
}): () => Promise<RestoreRuntimeSync> {
  return async () => {
    const { hosts, removed } = await reconcileByokProviders(
      deps.registry,
      deps.db,
      deps.ssrfPolicy,
    );
    invalidateCredentialCache();
    return {
      byokRegistered: hosts.size,
      byokRemoved: removed,
      settingsRevision: bumpSettingsRevision(),
    };
  };
}
