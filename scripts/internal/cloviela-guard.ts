/**
 * Safety boundary for the Rikka E2E harness.
 *
 * Every assertion here exists because the harness boots the *real* production
 * composition (`bootstrap()` → `buildProductionDeps()`), which immediately
 * starts provider client-version refreshes, opens the configured database and
 * writes gateway-owned state under `HOME`. A harness that got any of those
 * wrong would touch a developer's real profile or a real database, so the
 * checks run before any dynamic import of production code and refuse the run
 * instead of degrading.
 *
 * Nothing in this file writes production state: it only inspects paths,
 * URLs and environment.
 */
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Reasons a run is refused. Each carries the exact offending value. */
export class GuardRefusal extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`refusing to run: ${rule}: ${message}`);
    this.name = "GuardRefusal";
  }
}

/**
 * True when `child` is inside `parent` after both are resolved. Symlinks are
 * resolved when the paths exist so a link cannot smuggle the harness out of
 * its sandbox.
 */
export function isInside(child: string, parent: string): boolean {
  const resolvedChild = existsSync(child) ? realpathSync(child) : resolve(child);
  const resolvedParent = existsSync(parent) ? realpathSync(parent) : resolve(parent);
  const rel = relative(resolvedParent, resolvedChild);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface GuardInputs {
  /** Temp root this run owns; everything writable must live under it. */
  readonly root: string;
  /** Data directory handed to `CLOVIELA_DATA_DIR`. */
  readonly dataDir: string;
  /** Install-id directory handed to `CLOVIELA_INSTALL_ID_DIR`. */
  readonly installIdDir: string;
  /** Telemetry payload directory handed to `CLOVIELA_TELEMETRY_PAYLOAD_DIR`. */
  readonly telemetryDir: string;
  /** PostgreSQL URL for the Full store, when selected. */
  readonly databaseUrl: string | undefined;
  /** Redis URL for the Full store, when selected. */
  readonly redisUrl: string | undefined;
  /** Database mode the child will boot with. */
  readonly dbMode: "lite" | "full";
}

/**
 * Database names this harness may create or drop. A unique suffix keeps two
 * concurrent runs from colliding, and the prefix makes the ownership check
 * below a one-line rule instead of a deny-list that drifts.
 */
export const HARNESS_DB_PREFIX = "rikka_e2e_";

/**
 * Redis logical indexes reserved for harness runs. Index 15 belongs to the
 * repository's own test suite (`CLOVIELA_TEST_REDIS_URL`), so a harness run
 * must never select it.
 */
export const HARNESS_REDIS_INDEXES: readonly number[] = [13, 14];
const REPOSITORY_TEST_REDIS_INDEX = 15;

/** Parses a URL without throwing, for the checks that must report, not crash. */
function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Asserts every isolation precondition. Throws {@link GuardRefusal} on the
 * first violation so the operator sees one actionable message.
 */
export function assertIsolated(inputs: GuardInputs): void {
  const home = realpathSync.native(homedir());
  const temp = realpathSync.native(tmpdir());

  if (!isInside(inputs.root, temp)) {
    throw new GuardRefusal(
      "temp-root",
      `run root ${inputs.root} is not under the OS temp directory ${temp}`,
    );
  }
  for (const [label, path] of [
    ["data-dir", inputs.dataDir],
    ["install-id-dir", inputs.installIdDir],
    ["telemetry-dir", inputs.telemetryDir],
  ] as const) {
    if (!isInside(path, inputs.root)) {
      throw new GuardRefusal(label, `${path} is outside the owned run root ${inputs.root}`);
    }
    if (isInside(path, home) && !isInside(home, inputs.root)) {
      throw new GuardRefusal(label, `${path} resolves inside the real user home ${home}`);
    }
  }

  if (inputs.dbMode === "full") {
    if (inputs.databaseUrl === undefined) {
      throw new GuardRefusal("database-url", "full mode requires --database-url");
    }
    const url = safeUrl(inputs.databaseUrl);
    if (url === undefined) {
      throw new GuardRefusal("database-url", "DATABASE_URL is not a parseable URL");
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
      throw new GuardRefusal(
        "database-host",
        `database host ${url.hostname} is not loopback; a remote server is never a disposable target`,
      );
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!database.startsWith(HARNESS_DB_PREFIX)) {
      throw new GuardRefusal(
        "database-name",
        `database "${database}" does not start with the harness prefix "${HARNESS_DB_PREFIX}"; ` +
          "the harness creates and drops this database and must never touch another one",
      );
    }
  }

  if (inputs.redisUrl !== undefined) {
    const url = safeUrl(inputs.redisUrl);
    if (url === undefined) {
      throw new GuardRefusal("redis-url", "REDIS_URL is not a parseable URL");
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
      throw new GuardRefusal("redis-host", `redis host ${url.hostname} is not loopback`);
    }
    const rawIndex = url.pathname.replace(/^\//, "");
    const index = rawIndex === "" ? 0 : Number(rawIndex);
    if (!Number.isInteger(index) || !HARNESS_REDIS_INDEXES.includes(index)) {
      throw new GuardRefusal(
        "redis-index",
        `redis database index ${rawIndex || "0"} is not one of the harness indexes ` +
          `${HARNESS_REDIS_INDEXES.join(", ")} (index ${REPOSITORY_TEST_REDIS_INDEX} belongs to the repo test suite)`,
      );
    }
  }
}

/** Creates the owned run root under the OS temp directory. */
export function createRunRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `rikka-e2e-${label}-`));
  return realpathSync.native(root);
}

/**
 * Environment a child process may inherit from the harness. Everything that
 * names a user-visible location is replaced with an owned path; secrets from
 * the developer's shell are dropped rather than forwarded.
 */
export interface ChildEnvInputs {
  readonly root: string;
  readonly dataDir: string;
  readonly installIdDir: string;
  readonly telemetryDir: string;
  readonly encryptionKey: string;
  readonly port: number;
  readonly publicOrigin: string;
  readonly nodeEnv: "test" | "production";
  readonly extra: Readonly<Record<string, string>>;
}

const FORWARDED_NAMES: readonly string[] = [
  "PATH",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "TZ",
  "BUN_INSTALL",
  "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
];

/**
 * Builds the complete environment for a child. The harness never merges
 * `process.env`: a developer's `CLOVIELA_*`, `DATABASE_URL`, `REDIS_URL`,
 * proxy variables or provider credentials must not leak into a run that is
 * supposed to be disposable.
 */
export function childEnvironment(inputs: ChildEnvInputs): Record<string, string> {
  const home = join(inputs.root, "home");
  const tmp = join(inputs.root, "tmp");
  const env: Record<string, string> = {};
  for (const name of FORWARDED_NAMES) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    NODE_ENV: inputs.nodeEnv,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    GEMINI_CONFIG_DIR: join(home, ".gemini"),
    CLOVIELA_TEST_HOME_ROOT: inputs.root,
    CLOVIELA_DATA_DIR: inputs.dataDir,
    CLOVIELA_INSTALL_ID_DIR: inputs.installIdDir,
    CLOVIELA_TELEMETRY_PAYLOAD_DIR: inputs.telemetryDir,
    CLOVIELA_ENCRYPTION_KEY: inputs.encryptionKey,
    CLOVIELA_PUBLIC_ORIGIN: inputs.publicOrigin,
    PORT: String(inputs.port),
    CLOVIELA_BIND_HOST: "127.0.0.1",
    // Private upstreams are allowed only because the mock server is loopback.
    // The harness separately asserts that no non-loopback egress happens.
    CLOVIELA_ALLOW_PRIVATE_UPSTREAMS: "true",
    CLOVIELA_ALLOWED_NETWORKS: "127.0.0.1/32,::1/128",
    ...inputs.extra,
  };
}

/**
 * Copies the forwarding-relevant subset of `process.env` plus harness
 * overrides for a *client* subprocess (omp, opencode, curl, SDK scripts). A
 * client must not see the gateway's encryption key.
 */
export function clientEnvironment(
  inputs: Omit<ChildEnvInputs, "encryptionKey" | "dataDir" | "installIdDir" | "telemetryDir"> & {
    readonly homeRoot: string;
  },
): Record<string, string> {
  const home = join(inputs.homeRoot, "home");
  const tmp = join(inputs.homeRoot, "tmp");
  const env: Record<string, string> = {};
  for (const name of FORWARDED_NAMES) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    NODE_ENV: "test",
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    GEMINI_CONFIG_DIR: join(home, ".gemini"),
    ...inputs.extra,
  };
}

/**
 * Path-only preview used in evidence. Evidence must be portable, so absolute
 * paths are reduced to a `<run-root>/…` form rather than shipping a developer's
 * directory layout.
 */
export function portablePath(path: string, root: string): string {
  if (isInside(path, root)) {
    const rel = relative(root, path);
    return rel === "" ? "<run-root>" : `<run-root>${sep}${rel}`;
  }
  return path;
}
