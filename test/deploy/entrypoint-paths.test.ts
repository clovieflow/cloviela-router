/**
 * The container entrypoint must resolve the same directories the application
 * does, or it repairs ownership of a path nothing writes to.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * `resolveDataDir` in `src/persistence/db-mode.ts` returns a non-empty
 * `CLOVIELA_DATA_DIR` unchanged — including a relative one, which the process
 * then opens relative to its working directory (`/app` in the image). The
 * entrypoint substituted a fixed `/app/data` for any relative value, so
 * `CLOVIELA_DATA_DIR=state` had the gateway create `/app/state/pglite` while
 * the entrypoint chowned `/app/data`. The mount stayed root-owned and the
 * process, already dropped to uid 10001, could not open the database it had
 * just been pointed at.
 *
 * ── Why the test runs the script instead of reading it ──────────────────────
 * The resolution is shell, and shell has its own scoping rules — an earlier
 * attempt at this fix passed a variable by name into a helper and silently
 * expanded it in the caller's scope, producing `/app/` for `telemetry/payloads`.
 * Sourcing the real file and reading what it computed is the only check that
 * would have caught that.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRYPOINT = join(import.meta.dir, "..", "..", "docker-entrypoint.sh");

/**
 * Runs the entrypoint's directory-resolution block with a given environment
 * and reports what it decided.
 *
 * The whole script is not run: it would try to chown real paths and then
 * `exec` the gateway. The resolution block is extracted by its own markers and
 * evaluated in the same shell, so the `pick` helper and the `case` statements
 * under test are the shipped ones.
 */
function resolveDirs(env: Record<string, string>): { state: string; payload: string } {
  const source = readFileSync(ENTRYPOINT, "utf8");
  const start = source.indexOf("pick() {");
  const end = source.indexOf('case "$PAYLOAD_DIR"');
  if (start < 0 || end < 0) throw new Error("entrypoint resolution block not found");
  const block = source.slice(start, source.indexOf("\n", end) + 1);

  const script = `${block}\nprintf '%s|%s' "$STATE_DIR" "$PAYLOAD_DIR"\n`;
  const result = spawnSync("sh", ["-c", script], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`entrypoint block failed: ${result.stderr}`);
  }
  const [state, payload] = result.stdout.split("|");
  return { state: state ?? "", payload: payload ?? "" };
}

describe("container entrypoint directory resolution", () => {
  test("defaults to /app/data for both directories", () => {
    const { state, payload } = resolveDirs({});
    expect(state).toBe("/app/data");
    expect(payload).toBe("/app/data");
  });

  test("a relative state path resolves under /app, matching the application", () => {
    // The application opens `state` relative to its working directory, which
    // is /app in the image. Repairing /app/data instead would leave the real
    // database directory owned by root.
    const { state } = resolveDirs({ CLOVIELA_DATA_DIR: "state" });
    expect(state).toBe("/app/state");
  });

  test("a relative payload path resolves under /app", () => {
    const { payload } = resolveDirs({ CLOVIELA_TELEMETRY_PAYLOAD_DIR: "telemetry/payloads" });
    expect(payload).toBe("/app/telemetry/payloads");
  });

  test("an absolute state path is used verbatim", () => {
    const { state } = resolveDirs({ CLOVIELA_DATA_DIR: "/mnt/cloviela" });
    expect(state).toBe("/mnt/cloviela");
  });

  test("the pre-rename variable still works when the current one is unset", () => {
    const { state } = resolveDirs({ CARTETHYIA_DATA_DIR: "old-state" });
    expect(state).toBe("/app/old-state");
  });

  test("the current variable wins when both are set", () => {
    const { state } = resolveDirs({
      CLOVIELA_DATA_DIR: "/new",
      CARTETHYIA_DATA_DIR: "/old",
    });
    expect(state).toBe("/new");
  });

  test("an empty current variable falls through to the legacy one", () => {
    // An exported-but-empty variable is what a Compose `environment:` entry
    // with no value produces, and it must not shadow a real legacy setting.
    const { state } = resolveDirs({
      CLOVIELA_DATA_DIR: "",
      CARTETHYIA_DATA_DIR: "/legacy",
    });
    expect(state).toBe("/legacy");
  });
});
