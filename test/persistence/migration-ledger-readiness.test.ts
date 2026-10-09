/**
 * Readiness must read the ledger that actually holds this database's history.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * The migration RUNNER resolves which ledger to use, because a pre-rename
 * installation keeps its history in `cartethyia_schema_migrations`. The
 * readiness CHECK did not: it queried `cloviela_schema_migrations` directly.
 * On a database with 41 rows in the legacy ledger and zero in the new one,
 * boot succeeded and the gateway served traffic while readiness reported
 * `migrations: "pending"` and refused the instance.
 *
 * ── Why the fixture is shaped this way ──────────────────────────────────────
 * A fresh database does not reproduce it: both ledgers are empty or the new
 * one is the only one, so reading the wrong table happens to give the right
 * answer. The fixture below creates BOTH tables with the legacy one populated
 * and the new one empty, which is exactly the state a real installation is in
 * after the rename.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyPgliteMigrations,
  buildPgliteHandle,
  createPgliteClient,
} from "../../src/persistence/db-pglite";
import type { ClovielaDatabase } from "../../src/persistence/postgres";
import {
  LEDGER_LEGACY_TABLE,
  MIGRATION_LEDGER_TABLE,
  migrationFiles,
  migrationIdFor,
  readMigrationLedgerStatus,
  resolveLedgerTable,
  resolveMigrationsFolder,
} from "../../src/persistence/migrate";

let client: PGlite | undefined;
let db: ClovielaDatabase | undefined;
let tempDir: string | undefined;

/** A database migrated normally, then shifted into the pre-rename layout. */
async function legacyLayoutDatabase(): Promise<ClovielaDatabase> {
  tempDir = mkdtempSync(join(tmpdir(), "ledger-readiness-"));
  client = await createPgliteClient(tempDir);
  // Migrate for real, so the ledger holds genuine migration ids.
  await applyPgliteMigrations(client);
  db = buildPgliteHandle(client).db;

  // Now reproduce the pre-rename layout: move every row into the legacy table
  // and leave the new one present but empty. This is the state an installation
  // is in when it was migrated by a build that used the old table name.
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${LEDGER_LEGACY_TABLE} (
       migration_id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await client.exec(
    `INSERT INTO ${LEDGER_LEGACY_TABLE} (migration_id)
     SELECT migration_id FROM ${MIGRATION_LEDGER_TABLE}
     ON CONFLICT DO NOTHING`,
  );
  await client.exec(`DELETE FROM ${MIGRATION_LEDGER_TABLE}`);
  return db;
}

afterAll(async () => {
  await client?.close().catch(() => undefined);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("migration ledger resolution", () => {
  test("the populated legacy ledger is chosen over an empty new one", async () => {
    const database = await legacyLayoutDatabase();

    const legacyCount = await database.execute<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${LEDGER_LEGACY_TABLE}`,
    );
    const newCount = await database.execute<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${MIGRATION_LEDGER_TABLE}`,
    );
    // The fixture is only meaningful if it has the shape it claims.
    expect(Number(legacyCount.rows[0]?.n)).toBeGreaterThan(0);
    expect(Number(newCount.rows[0]?.n)).toBe(0);

    const resolved = await resolveLedgerTable(async (statement) => {
      const rows = await database.execute<Record<string, unknown>>(statement);
      return { rows: rows.rows as readonly Record<string, unknown>[] };
    });
    expect(resolved).toBe(LEDGER_LEGACY_TABLE);
  });

  test("readiness reports migrations as applied, not pending", async () => {
    const database = await legacyLayoutDatabase();
    const status = await readMigrationLedgerStatus(database);

    // The failure this pins: reading the new table directly finds zero rows and
    // reports every migration pending, so a healthy gateway looks un-migrated.
    expect(status.pending).toEqual([]);
    expect(status.applied).toBe(true);
  });

  test("every migration file on disk is accounted for", async () => {
    const database = await legacyLayoutDatabase();
    const status = await readMigrationLedgerStatus(database);
    const expected = migrationFiles(resolveMigrationsFolder()).map(migrationIdFor);
    expect(status.expected).toEqual(expected);
    expect(status.expected.length).toBeGreaterThan(0);
  });
});
