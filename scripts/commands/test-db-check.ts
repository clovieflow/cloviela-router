import { Client } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Verifies the isolated test database is reachable.
 *
 * The variable name is `CLOVIELA_TEST_DATABASE_URL` — the same one the
 * suites read through `test/helpers/database.ts`. A second spelling
 * (`TEST_DATABASE_URL`) existed in an earlier script and made the check pass
 * while the suites skipped, so there is exactly one name now and this script
 * refuses to fall back to `DATABASE_URL`: a check that silently validated the
 * developer's *working* database would be worse than no check.
 */
const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const ENV_TEST_PATH = join(PROJECT_ROOT, ".env.test");

function readEnvTest(): Record<string, string> {
  if (!existsSync(ENV_TEST_PATH)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(ENV_TEST_PATH, "utf8").split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

const fileEnv = readEnvTest();
const databaseUrl =
  process.env.CLOVIELA_TEST_DATABASE_URL ?? fileEnv.CLOVIELA_TEST_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "CLOVIELA_TEST_DATABASE_URL is not set (checked the environment and .env.test).\n" +
      "Point it at a disposable database; DATABASE_URL is deliberately never used here.",
  );
  process.exit(1);
}

/**
 * Creates the target database when it is missing.
 *
 * The rename from `cartethyia_test` to `cloviela_test` changed a name in
 * `.env.test` without creating anything, and every suite that needs the real
 * thing then failed on `database "cloviela_test" does not exist` — a message
 * that reads like a broken checkout rather than a missing one-line step. The
 * check now makes the database it is about to verify, connecting to the
 * server's own `postgres` database first.
 *
 * Only the database is created. Tables, roles and extensions stay the
 * migrations' business, and an existing database is never touched.
 */
async function ensureDatabase(target: string): Promise<void> {
  const parsed = new URL(target);
  const name = parsed.pathname.replace(/^\//, "");
  if (name.length === 0 || name === "postgres") return;

  const adminUrl = new URL(target);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 3_000 });
  try {
    await admin.connect();
    const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) {
      // The name comes from the operator's own .env.test; it cannot be a
      // bind parameter, so it is quoted as an identifier.
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`  Created test database "${name}" (it did not exist).`);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
}

await ensureDatabase(databaseUrl).catch(() => undefined);

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 });
try {
  await client.connect();
  const result = await client.query<{ database: string }>(
    "select current_database() as database",
  );
  const database = result.rows[0]?.database ?? "unknown";
  const tables = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  console.log(`✓ Test PostgreSQL is reachable: ${database} (${tables.rows[0]?.n ?? 0} tables)`);
  console.log("  Run `bun run test` to exercise the suites against it.");
} catch (error: unknown) {
  console.error(
    `✗ Test PostgreSQL is unavailable: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
