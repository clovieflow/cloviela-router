/** Migration discovery + ledger helpers shared by every database backend. */
import { sql } from "drizzle-orm";
import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { ClovielaDatabase } from "./db-handle";

/**
 * SQL-only migration ledger. Migration files are the source of truth; this
 * table stores only which numbered files have already run.
 */
/**
 * The migration ledger's table name.
 *
 * It was `cartethyia_schema_migrations` before the rename. That name is a
 * persisted fact: an installation that has already migrated owns a ledger
 * there, and a gateway that looks for a different table sees an empty ledger
 * and replays every migration against a database that already has the schema.
 * The replay fails on the first `CREATE TYPE`, and the gateway cannot start.
 *
 * So the old name keeps being read while it exists, and the new name is used
 * for a database that has never migrated. {@link LEDGER_LEGACY_TABLE} is what
 * makes the check possible; both are created so either name resolves.
 */
export const MIGRATION_LEDGER_TABLE = "cloviela_schema_migrations";

/** The pre-rename ledger, still honoured when it is the one on disk. */
export const LEDGER_LEGACY_TABLE = "cartethyia_schema_migrations";

export const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
  migration_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

/**
 * Resolves which ledger actually holds this database's history.
 *
 * Called before any migration runs. The choice is made on ROW COUNT, not on
 * table existence: a boot that failed part-way can leave an empty
 * `cloviela_schema_migrations` beside a populated `cartethyia_schema_migrations`,
 * and picking the newer table merely because it exists would read zero applied
 * migrations and replay the whole schema against a database that already has
 * it — which fails on the first `CREATE TYPE` and stops the gateway starting.
 *
 * So the ledger with history wins. Two empty tables (a fresh install) resolve
 * to the current name.
 */
export async function resolveLedgerTable(
  query: (sql: string) => Promise<{ rows: readonly Record<string, unknown>[] }>,
): Promise<string> {
  const tables = await query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('${MIGRATION_LEDGER_TABLE}', '${LEDGER_LEGACY_TABLE}')`,
  );
  const present = tables.rows.map((row) => String(row["tablename"] ?? ""));
  if (present.length === 0) return MIGRATION_LEDGER_TABLE;

  const countOf = async (table: string): Promise<number> => {
    const result = await query(`SELECT count(*)::int AS n FROM ${table}`);
    const raw = result.rows[0]?.["n"];
    return typeof raw === "number" ? raw : Number(raw ?? 0);
  };
  const counts = new Map<string, number>();
  for (const table of present) counts.set(table, await countOf(table));

  const current = counts.get(MIGRATION_LEDGER_TABLE) ?? 0;
  const legacy = counts.get(LEDGER_LEGACY_TABLE) ?? 0;
  if (legacy > current) return LEDGER_LEGACY_TABLE;
  return MIGRATION_LEDGER_TABLE;
}

export function resolveMigrationsFolder(): string {
  const folder = resolve(process.cwd(), "migrations");
  if (!existsSync(folder)) {
    throw new Error(`Migrations folder not found: ${folder}`);
  }
  return folder;
}

export function migrationFiles(folder: string): readonly string[] {
  return readdirSync(folder)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
    .map((file) => resolve(folder, file));
}

export function migrationIdFor(file: string): string {
  return basename(file);
}

/**
 * Splits a migration file on the drizzle `statement-breakpoint` markers the
 * files already carry. Only the embedded backend needs per-statement
 * application (single-statement failure tolerance); the pg path sends the
 * whole file at once exactly as before.
 */
export function splitStatements(source: string): string[] {
  return source
    .split(/--> statement-breakpoint/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Readiness view of the migration ledger: the numbered SQL files discovered on
 * disk compared against the ids recorded in {@link MIGRATION_LEDGER_TABLE}.
 */
export interface MigrationLedgerStatus {
  /** Migration file names discovered on disk, in apply order. */
  readonly expected: readonly string[];
  /** Expected migrations that have no ledger row. */
  readonly pending: readonly string[];
  /** True only when every expected migration is recorded in the ledger. */
  readonly applied: boolean;
}

/**
 * Compares the migration files discovered on disk against the applied-migration
 * ledger. A reachable ledger alone is not readiness: an interrupted upgrade
 * leaves the table present while later migrations are still unapplied.
 *
 * Runs on the drizzle handle, so it is identical on every backend.
 */
export async function readMigrationLedgerStatus(
  db: ClovielaDatabase,
  folder: string = resolveMigrationsFolder(),
): Promise<MigrationLedgerStatus> {
  const expected = migrationFiles(folder).map((file) => migrationIdFor(file));
  const result = await db.execute<{ migration_id: string }>(
    sql.raw(`SELECT migration_id FROM ${MIGRATION_LEDGER_TABLE}`),
  );
  const applied = new Set(result.rows.map((row) => row.migration_id));
  const pending = expected.filter((migrationId) => !applied.has(migrationId));
  return { expected, pending, applied: pending.length === 0 };
}


/**
 * True when `error` is a missing-extension failure for a `CREATE EXTENSION`
 * statement — the one tolerated divergence between backends (PGlite does not
 * bundle `pgcrypto`, and no migration or query calls its functions; every
 * hash is `node:crypto`). Anything else, or any other statement, still throws.
 */
export function isToleratedMissingExtension(statement: string, error: unknown): boolean {
  return /^CREATE EXTENSION/i.test(statement) && String(error).includes("is not available");
}
