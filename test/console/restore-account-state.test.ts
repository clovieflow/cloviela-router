/**
 * Reproduces the post-restore dispatch failure found by the E2E harness:
 *
 *   export 200; delete-all 200; import 200; post-restore live 503
 *   "Model '...' has no available account (1 candidate(s) unusable: disabled)"
 *
 * The harness proves the gateway returns 503 after a restore that itself
 * reported success. This suite narrows it to the account rows: it drives the
 * real export → delete → import path against its own PGlite database and then
 * asks the same question the snapshot builder asks.
 *
 * It is a probe, not a fix: the assertions describe the CORRECT behaviour, so
 * a failure here is the bug, stated precisely enough to fix.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { PGlite } from "@electric-sql/pglite";
import { exportBackup, applyRestore } from "../../src/console/backup/store";
import { restoreOrder, validateRestorePayload } from "../../src/console/backup/validate";
import { tablesForSection } from "../../src/console/backup/contracts";
import {
  applyPgliteMigrations,
  buildPgliteHandle,
  createPgliteClient,
} from "../../src/persistence/db-pglite";
import type { CartethyiaDatabase } from "../../src/persistence/postgres";
import { apiKeys, models, providerAccounts, providers, tenants } from "../../src/persistence/schema";

let client: PGlite | undefined;
let db: CartethyiaDatabase | undefined;
let tempDir: string | undefined;

async function database(): Promise<CartethyiaDatabase> {
  if (db) return db;
  tempDir = mkdtempSync(join(tmpdir(), "restore-probe-"));
  client = await createPgliteClient(tempDir);
  await applyPgliteMigrations(client);
  db = buildPgliteHandle(client).db;
  return db;
}

afterAll(async () => {
  await client?.close().catch(() => undefined);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/** One tenant with a provider, a model, and an ACTIVE account. */
async function seed(): Promise<{ tenantId: string; providerId: string; accountId: string }> {
  const database_ = await database();
  const [tenant] = await database_
    .insert(tenants)
    .values({ name: `restore-${randomUUID().slice(0, 8)}`, status: "active" })
    .returning({ id: tenants.id });
  const tenantId = tenant!.id;
  const providerId = `restore-provider-${randomUUID().slice(0, 8)}`;
  await database_.insert(providers).values({
    id: providerId,
    tenantId,
    enabled: true,
    requiresAccount: true,
  });
  await database_.insert(models).values({
    providerId,
    modelId: "restore-model",
    wireFamily: "chat",
    endpointPath: "/v1/chat/completions",
    enabled: true,
  });
  const [account] = await database_
    .insert(providerAccounts)
    .values({
      providerId,
      tenantId,
      label: "restore-account",
      credentialKind: "api_key",
      status: "active",
    })
    .returning({ id: providerAccounts.id });
  await database_.insert(apiKeys).values({
    tenantId,
    label: "restore-key",
    scopes: ["gateway:invoke"],
    keyHash: `hash-${randomUUID()}`,
  });
  return { tenantId, providerId, accountId: account!.id };
}

describe("backup restore preserves account usability", () => {
  test("an active account is still active after export -> delete -> import", async () => {
    const seedIds = await seed();
    const database_ = await database();

    const exported = await exportBackup(database_, tablesForSection("config"), seedIds.tenantId);
    const accountRows = exported.payload.sections.config?.provider_accounts ?? [];
    expect(accountRows.length).toBeGreaterThan(0);
    // The export must carry the account's status, or a restore cannot tell an
    // active account from a disabled one.
    expect(accountRows[0]).toHaveProperty("status");
    expect(accountRows[0]!.status).toBe("active");

    // Simulate the delete-all step the harness performs.
    await database_.delete(providerAccounts).where(eq(providerAccounts.tenantId, seedIds.tenantId));
    await database_.delete(models).where(eq(models.providerId, seedIds.providerId));
    await database_.delete(providers).where(eq(providers.id, seedIds.providerId));

    const validation = validateRestorePayload(exported.payload, seedIds.tenantId);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error(validation.error);
    const restore = await applyRestore(database_, validation.value, restoreOrder(), seedIds.tenantId);
    expect(restore).toBeDefined();

    const [restored] = await database_
      .select({ id: providerAccounts.id, status: providerAccounts.status, tenantId: providerAccounts.tenantId })
      .from(providerAccounts)
      .where(eq(providerAccounts.providerId, seedIds.providerId));

    expect(restored).toBeDefined();
    // THIS is the assertion the gateway's 503 violates.
    expect(restored!.status).toBe("active");
  });

  test("a restored account is visible to the snapshot's own account query", async () => {
    const seedIds = await seed();
    const database_ = await database();

    const exported = await exportBackup(database_, tablesForSection("config"), seedIds.tenantId);
    await database_.delete(providerAccounts).where(eq(providerAccounts.tenantId, seedIds.tenantId));
    await database_.delete(models).where(eq(models.providerId, seedIds.providerId));
    await database_.delete(providers).where(eq(providers.id, seedIds.providerId));
    const validation = validateRestorePayload(exported.payload, seedIds.tenantId);
    if (!validation.ok) throw new Error(validation.error);
    await applyRestore(database_, validation.value, restoreOrder(), seedIds.tenantId);

    // The route catalog filters accounts with `status != 'disabled'` and then
    // groups them per provider. Mirror that read exactly.
    const usable = await database_
      .select({ id: providerAccounts.id, status: providerAccounts.status })
      .from(providerAccounts)
      .where(eq(providerAccounts.providerId, seedIds.providerId));

    const nonDisabled = usable.filter((row) => row.status !== "disabled");
    expect(nonDisabled.length).toBeGreaterThan(0);
  });
});
