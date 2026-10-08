/**
 * Post-restore live-state convergence.
 *
 * A restore replaces configuration rows inside one transaction, but the
 * process state built from the *previous* rows is not transactional: BYOK
 * adapters are registered in a process-wide registry at boot, and the
 * registration only ever adds or updates. The regression this suite pins:
 *
 * - a provider the payload **changed** must route through its new endpoint on
 *   the very next dispatch in the same process (no restart);
 * - a provider the payload **removed** (row gone, `base_url` cleared, or
 *   disabled) must lose its live registration — an adapter that outlives its
 *   row keeps dispatching to an upstream the committed catalog no longer
 *   describes;
 * - the credential cache and settings revision must converge, because the
 *   restored ciphertext and preferences are invisible to their TTL windows;
 * - another tenant's BYOK row must survive untouched (the registry is
 *   process-wide, the reconcile reads the whole table);
 * - a restore that fails validation must never reach the hook at all, so
 *   rollback semantics are untouched.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ProviderRegistry } from "../../src/providers/provider-registry";
import { reconcileByokProviders, syncByokProvider } from "../../src/providers/operations/provider-catalog-service";
import { createRestoreRuntimeSync } from "../../src/console/backup/runtime-sync";
import { createBackupRoutes } from "../../src/console/backup/routes";
import { BackupService } from "../../src/console/backup/service";
import { ConsoleDomainError } from "../../src/console/shared/errors";
import { currentSettingsRevision } from "../../src/persistence/tenant-preferences";
import { getDb } from "../../src/persistence/postgres";
import { providers } from "../../src/persistence/schema";
import { createRunId, getTestPool, requireDatabase } from "../helpers/database";
import { createTenant } from "../helpers/fixtures";

requireDatabase();

/** One isolated tenant whose provider rows are removed on teardown. */
async function isolatedTenant(label: string): Promise<{
  tenantId: string;
  providerId: (suffix: string) => string;
  cleanup: () => Promise<void>;
}> {
  const pool = await getTestPool();
  const runId = createRunId(label);
  const client = await pool.connect();
  try {
    const tenant = await createTenant(client, runId);
    return {
      tenantId: tenant.tenantId,
      providerId: (suffix: string) => `byok-${runId}-${suffix}`,
      cleanup: async () => {
        // `providers.tenant_id` cascades from `tenants`.
        await client.query("delete from tenants where id = $1", [tenant.tenantId]);
      },
    };
  } finally {
    client.release();
  }
}

async function writeProvider(row: {
  readonly id: string;
  readonly tenantId: string | null;
  readonly baseUrl: string | null;
  readonly enabled?: boolean;
}): Promise<void> {
  await getDb()
    .insert(providers)
    .values({
      id: row.id,
      tenantId: row.tenantId,
      wireFamilyDefault: "chat",
      baseUrl: row.baseUrl,
      enabled: row.enabled ?? true,
      requiresAccount: true,
    });
}

describe("post-restore BYOK reconciliation", () => {
  test("an edited row re-registers so the new endpoint serves without restart", async () => {
    const world = await isolatedTenant("restore-sync-update");
    try {
      const registry = new ProviderRegistry();
      const id = world.providerId("edit");
      await writeProvider({ id, tenantId: world.tenantId, baseUrl: "https://old.example.test" });
      const first = await reconcileByokProviders(registry, getDb());
      expect(first.hosts.get(id)?.hostname).toBe("old.example.test");

      await getDb()
        .update(providers)
        .set({ baseUrl: "https://new.example.test" })
        .where(eq(providers.id, id));
      const second = await reconcileByokProviders(registry, getDb());
      expect(second.hosts.get(id)?.hostname).toBe("new.example.test");
      // The live registry — the thing dispatch actually reads — points at the
      // restored endpoint.
      expect(registry.upstreamHostFor(id)?.hostname).toBe("new.example.test");
    } finally {
      await world.cleanup();
    }
  });

  test("a removed row drops its stale registration, host, and adapter", async () => {
    const world = await isolatedTenant("restore-sync-remove");
    try {
      const registry = new ProviderRegistry();
      const id = world.providerId("gone");
      await writeProvider({ id, tenantId: world.tenantId, baseUrl: "https://stale.example.test" });
      await reconcileByokProviders(registry, getDb());
      expect(registry.upstreamHostFor(id)).toBeDefined();
      // Load the adapter so the "cached derived state" path is exercised too.
      expect(await registry.loadOne(id)).toBeDefined();

      await getDb().delete(providers).where(eq(providers.id, id));
      const after = await reconcileByokProviders(registry, getDb());
      // The reconcile also sweeps fingerprints left by other suites in this
      // process, so only the floor is asserted here; the per-provider state is
      // what this test owns.
      expect(after.removed).toBeGreaterThanOrEqual(1);
      expect(registry.upstreamHostFor(id)).toBeUndefined();
      expect(await registry.loadOne(id)).toBeUndefined();
    } finally {
      await world.cleanup();
    }
  });

  test("a disabled row and a cleared base_url both stop qualifying", async () => {
    const world = await isolatedTenant("restore-sync-disabled");
    try {
      const registry = new ProviderRegistry();
      const disabledId = world.providerId("disabled");
      const clearedId = world.providerId("cleared");
      await writeProvider({ id: disabledId, tenantId: world.tenantId, baseUrl: "https://a.example.test" });
      await writeProvider({ id: clearedId, tenantId: world.tenantId, baseUrl: "https://b.example.test" });
      await reconcileByokProviders(registry, getDb());

      await getDb().update(providers).set({ enabled: false }).where(eq(providers.id, disabledId));
      await getDb().update(providers).set({ baseUrl: null }).where(eq(providers.id, clearedId));
      const after = await reconcileByokProviders(registry, getDb());
      expect(after.removed).toBeGreaterThanOrEqual(2);
      expect(registry.upstreamHostFor(disabledId)).toBeUndefined();
      expect(registry.upstreamHostFor(clearedId)).toBeUndefined();
    } finally {
      await world.cleanup();
    }
  });

  test("another tenant's BYOK row survives a restore-scoped reconcile", async () => {
    const mine = await isolatedTenant("restore-sync-mine");
    const other = await isolatedTenant("restore-sync-other");
    try {
      const registry = new ProviderRegistry();
      const mineId = mine.providerId("kept");
      const otherId = other.providerId("kept");
      await writeProvider({ id: mineId, tenantId: mine.tenantId, baseUrl: "https://mine.example.test" });
      await writeProvider({ id: otherId, tenantId: other.tenantId, baseUrl: "https://other.example.test" });
      await reconcileByokProviders(registry, getDb());

      // Restore replaces `mine`'s rows: its provider is gone from the payload.
      await getDb().delete(providers).where(eq(providers.id, mineId));
      const after = await reconcileByokProviders(registry, getDb());
      expect(after.removed).toBeGreaterThanOrEqual(1);
      expect(registry.upstreamHostFor(mineId)).toBeUndefined();
      // The other tenant's row is not the restoring tenant's to remove.
      expect(registry.upstreamHostFor(otherId)?.hostname).toBe("other.example.test");
    } finally {
      await mine.cleanup();
      await other.cleanup();
    }
  });

  test("the completion hook reports the reconcile and bumps the settings revision", async () => {
    const world = await isolatedTenant("restore-sync-hook");
    try {
      const registry = new ProviderRegistry();
      const id = world.providerId("hook");
      await writeProvider({ id, tenantId: world.tenantId, baseUrl: "https://hook.example.test" });
      const before = currentSettingsRevision();
      const sync = createRestoreRuntimeSync({ db: getDb(), registry });
      const report = await sync();
      // The reconcile reads the whole `providers` table (one registry per
      // process), so the count covers every qualifying row in the database —
      // the per-provider outcome is what this suite owns.
      expect(report.byokRegistered).toBeGreaterThanOrEqual(1);
      expect(registry.upstreamHostFor(id)?.hostname).toBe("hook.example.test");
      expect(report.settingsRevision).toBeGreaterThan(before);
      expect(currentSettingsRevision()).toBe(report.settingsRevision);
    } finally {
      await world.cleanup();
    }
  });

  test("syncByokProvider still drops one provider that stopped qualifying", async () => {
    const world = await isolatedTenant("restore-sync-single");
    try {
      const registry = new ProviderRegistry();
      const id = world.providerId("single");
      await writeProvider({ id, tenantId: world.tenantId, baseUrl: "https://single.example.test" });
      await syncByokProvider(registry, getDb(), id);
      expect(registry.upstreamHostFor(id)).toBeDefined();
      await getDb().update(providers).set({ enabled: false }).where(eq(providers.id, id));
      await syncByokProvider(registry, getDb(), id);
      expect(registry.upstreamHostFor(id)).toBeUndefined();
    } finally {
      await world.cleanup();
    }
  });
});

describe("restore rollback boundary", () => {
  test("the import route invokes the completion hook only after a committed restore", async () => {
    let syncCalls = 0;
    let restoreBehavior: "commit" | "throw" = "commit";
    const routes = createBackupRoutes({
      accessResolver: () => ({
        id: "session-1",
        tenantId: "tenant-1",
        scopes: ["dashboard:write"],
        admissionIdentity: "session-1",
      }),
      backupFor: () =>
        ({
          export: async () => {
            throw new Error("unused");
          },
          restore: async () => {
            if (restoreBehavior === "throw") throw new ConsoleDomainError("restore_failed", 500, "boom");
            return { restored: { providers: 1 }, skipped: {}, format: "native" as const };
          },
          deleteAll: async () => {
            throw new Error("unused");
          },
          preview: async () => ({}),
        }) as unknown as BackupService,
      restoreRuntimeSync: async () => {
        syncCalls += 1;
        return { byokRegistered: 1, byokRemoved: 0, settingsRevision: 1 };
      },
    });
    const call = () =>
      routes.handle(
        new Request("http://console.test/backup/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "pw", backup: {} }),
        }),
      );

    const ok = await call();
    expect(ok.status).toBe(200);
    expect(syncCalls).toBe(1);
    const payload = (await ok.json()) as { runtime?: { byokRegistered: number } };
    expect(payload.runtime?.byokRegistered).toBe(1);

    restoreBehavior = "throw";
    const failed = await call();
    expect(failed.status).toBe(500);
    // A rolled-back restore must never reach the hook: the live process state
    // still describes the committed catalog.
    expect(syncCalls).toBe(1);
  });

  test("a payload that fails validation leaves registry and revision untouched", async () => {
    const world = await isolatedTenant("restore-sync-rollback");
    try {
      const registry = new ProviderRegistry();
      const id = world.providerId("rollback");
      await writeProvider({ id, tenantId: world.tenantId, baseUrl: "https://rollback.example.test" });
      await reconcileByokProviders(registry, getDb());
      const revisionBefore = currentSettingsRevision();

      // The service refuses this before `applyRestore`; the route only calls
      // the completion hook after a committed restore, so nothing here should
      // observe any mutation.
      const service = new BackupService({
        db: getDb(),
        verifyPassword: async () => true,
      });
      await expect(
        service.restore("pw", { app: "cartethyia", version: 1, sections: { config: { nope: [] } } }, world.tenantId),
      ).rejects.toThrow();

      expect(registry.upstreamHostFor(id)?.hostname).toBe("rollback.example.test");
      expect(currentSettingsRevision()).toBe(revisionBefore);
    } finally {
      await world.cleanup();
    }
  });
});
