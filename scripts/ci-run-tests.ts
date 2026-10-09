/**
 * The single entry point for every test invocation.
 *
 * A bare `bun test` is not enough for this suite, and the reasons are worth
 * stating so the flags are not "helpfully" removed later:
 *
 * - **`.env.test` is loaded explicitly.** Bun loads `.env` by default, which
 *   holds a developer's *runtime* database. Without this the suites would
 *   migrate and write into the working database — the exact failure the old
 *   suite was deleted over. Loading it here (rather than relying on Bun's
 *   `.env.test` auto-load) means the file that is loaded is named in one place.
 * - **`--timeout` is a hang detector, not a budget.** 15 s is far longer than
 *   any legitimate test in this suite; it exists so a deadlocked test fails
 *   with a name instead of stalling CI. A test that needs to wait is written
 *   against `helpers/clock.ts` instead of sleeping.
 * - **`--parallel` is default.** Files are isolated per worker, so the database
 *   suites must scope their rows — which `helpers/fixtures.ts` does by
 *   construction. Serializing the run instead would hide a leak that the
 *   parallel run catches.
 *
 * `--scope` picks a tree: `backend` (`test/`), `dashboard` (`dashboard/test/`),
 * or `all`. `--watch` re-runs on change. Anything else is forwarded to
 * `bun test`, so `bun run test -- --test-name-pattern admission` works.
 *
 * The scope is passed as an explicit PATH rather than as the working directory,
 * because running `bun test` from the repo root discovers `dashboard/test/`
 * too — `dashboard` is not excluded from root discovery, so the "backend" scope
 * was silently running the dashboard suites a second time. The paths below are
 * the single definition of what each scope covers.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const DASHBOARD_ROOT = join(PROJECT_ROOT, "dashboard");
const BACKEND_TESTS = join(PROJECT_ROOT, "test");
const DASHBOARD_TESTS = join(DASHBOARD_ROOT, "test");

const rawArgs = process.argv.slice(2);

/** Reads a dotenv file without overriding already-exported variables. */
function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) values[key] = value;
  }
  return values;
}

const scopeIndex = rawArgs.indexOf("--scope");
const scope = scopeIndex >= 0 ? rawArgs[scopeIndex + 1] : "all";
const passthrough = rawArgs.filter((_arg, index) => {
  // Drop the `--scope <value>` pair; everything else is forwarded to `bun test`.
  if (scopeIndex < 0) return true;
  return index !== scopeIndex && index !== scopeIndex + 1;
});
const watch = passthrough.includes("--watch");
const testArgs = passthrough.filter((arg) => arg !== "--watch");

// Set these before the worker starts: Bun caches OS home/temp paths at startup.
// Per-suite HOME changes are an additional seam, not the safety boundary.
const sandbox = mkdtempSync(join(tmpdir(), "rikka-tests-"));
const isolatedHome = join(sandbox, "home");
const isolatedTmp = join(sandbox, "tmp");
mkdirSync(isolatedHome, { recursive: true });
mkdirSync(isolatedTmp, { recursive: true });
process.on("exit", () => rmSync(sandbox, { recursive: true, force: true }));

const sharedEnv = {
  ...process.env,
  ...loadEnvFile(join(PROJECT_ROOT, ".env.test")),
  NODE_ENV: "test",
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  TMPDIR: isolatedTmp,
  TMP: isolatedTmp,
  TEMP: isolatedTmp,
  XDG_CONFIG_HOME: join(isolatedHome, ".config"),
  XDG_DATA_HOME: join(isolatedHome, ".local", "share"),
  XDG_STATE_HOME: join(isolatedHome, ".local", "state"),
  XDG_CACHE_HOME: join(isolatedHome, ".cache"),
  APPDATA: join(isolatedHome, "AppData", "Roaming"),
  LOCALAPPDATA: join(isolatedHome, "AppData", "Local"),
  CODEX_HOME: join(isolatedHome, ".codex"),
  CLAUDE_CONFIG_DIR: join(isolatedHome, ".claude"),
  CLOVIELA_TEST_HOME_ROOT: sandbox,
  CLOVIELA_DATA_DIR: join(sandbox, "runtime-data"),
  CLOVIELA_DB_MODE: "full",
};

/**
 * One `bun test` invocation.
 *
 * `paths` are the explicit test roots for the scope. They are what keeps the
 * scopes disjoint; see the header comment. `cwd` still matters because each tree
 * has its own `tsconfig.json` and dependency resolution (the dashboard has its
 * own `package.json`).
 */
function runTests(
  cwd: string,
  label: string,
  paths: readonly string[],
  options: { readonly serial?: boolean } = {},
): Promise<number> {
  const proc = Bun.spawn(
    [
      "bun",
      "test",
      ...(watch ? ["--watch"] : []),
      "--timeout",
      "15000",
      ...(options.serial === true ? [] : ["--parallel"]),
      ...paths,
      ...testArgs,
    ],
    { cwd, env: sharedEnv, stdio: ["inherit", "inherit", "inherit"] },
  );
  return proc.exited.then((code) => {
    if (code !== 0) console.error(`[test] ${label} failed with exit code ${code}`);
    return code;
  });
}

/**
 * Suites that run DDL (`ALTER TABLE`) against the shared test database.
 *
 * They are split out of the parallel batch because PostgreSQL takes an
 * `AccessExclusiveLock` for `ALTER TABLE`, and any concurrently running suite
 * that deletes a tenant takes a `RowExclusiveLock` on the same table through
 * `ON DELETE CASCADE`. The two orders deadlock, and PostgreSQL aborts one of
 * them — measured as an intermittent `40P01 deadlock detected` on whichever
 * suite happened to lose, roughly one full-suite run in three. Running these
 * four files serially after the parallel batch removes the interleaving
 * entirely; they are independent of each other and of the batch.
 */
const MIGRATION_SUITES = [
  "test/persistence/migration-bridge-pool-kind.test.ts",
  "test/persistence/migration-global-credit-limit.test.ts",
  "test/persistence/migration-max-inflight.test.ts",
  "test/persistence/migration-model-access-modes.test.ts",
] as const;

/** True when `path` is one of the serialized DDL suites. */
function isMigrationSuite(path: string): boolean {
  return MIGRATION_SUITES.some((suite) => path.endsWith(suite.replace("test/", "")));
}

/** Every `*.test.ts` under `root`, excluding the serialized DDL suites. */
function backendTestFilesExcludingMigrationSuites(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".test.ts")) continue;
      if (isMigrationSuite(full)) continue;
      files.push(full);
    }
  };
  walk(BACKEND_TESTS);
  return files.sort();
}

let exitCode = 0;
if (scope === "all" || scope === "backend") {
  if (watch) {
    // Watch mode is an interactive loop; the DDL suites are not split out
    // because a file list would not re-discover new files.
    exitCode = await runTests(PROJECT_ROOT, "backend", [BACKEND_TESTS]);
  } else {
    exitCode = await runTests(PROJECT_ROOT, "backend", backendTestFilesExcludingMigrationSuites());
    if (exitCode === 0) {
      exitCode = await runTests(PROJECT_ROOT, "backend (migrations, serial)", MIGRATION_SUITES, {
        serial: true,
      });
    }
  }
}
if (exitCode === 0 && (scope === "all" || scope === "dashboard")) {
  exitCode = await runTests(DASHBOARD_ROOT, "dashboard", [DASHBOARD_TESTS]);
}
if (scope !== "all" && scope !== "backend" && scope !== "dashboard") {
  console.error(`[test] unknown --scope "${scope}"; expected backend, dashboard, or all`);
  exitCode = 1;
}
process.exit(exitCode);
