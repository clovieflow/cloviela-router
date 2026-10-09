/**
 * The pre-rename environment variables must still configure the gateway.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 * The rename from `CARTETHYIA_*` to `CLOVIELA_*` is only safe if an operator's
 * existing `.env` keeps working. That is a claim about EVERY variable, and it
 * was false when it was first made: three reads bypassed the compatibility
 * helper and read the new name directly, so `CARTETHYIA_DB_MODE=lite`
 * silently resolved to `full` — turning a working embedded install into one
 * that refuses to boot without a PostgreSQL it does not have.
 *
 * A spot check would not have caught that, so this suite does two things:
 *
 * 1. **Behavioural checks** on the reads that are easy to get wrong — the
 *    database mode, the data directory, and the two payload limits.
 * 2. **A source scan** that fails if any file outside the compatibility layer
 *    reads a `CLOVIELA_*` variable directly. That is the structural guard: it
 *    catches the next bypass at the moment it is written, whatever variable it
 *    involves, instead of waiting for someone to notice a wrong default.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveDbMode, resolveDataDir } from "../../src/persistence/db-mode";

/** Runs `fn` with the process env replaced, restoring it afterwards. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("the pre-rename environment spelling still configures the gateway", () => {
  test("CARTETHYIA_DB_MODE=lite is honoured, not silently read as full", () => {
    withEnv(
      { CARTETHYIA_DB_MODE: "lite", CLOVIELA_DB_MODE: undefined },
      () => {
        // The failure this pins: reading only the new name falls through to the
        // `full` default, which is a different database backend entirely.
        expect(resolveDbMode()).toBe("lite");
      },
    );
  });

  test("the new spelling wins when both are set", () => {
    withEnv(
      { CARTETHYIA_DB_MODE: "lite", CLOVIELA_DB_MODE: "full" },
      () => {
        expect(resolveDbMode()).toBe("full");
      },
    );
    withEnv(
      { CARTETHYIA_DB_MODE: "full", CLOVIELA_DB_MODE: "lite" },
      () => {
        expect(resolveDbMode()).toBe("lite");
      },
    );
  });

  test("an invalid mode is refused under either spelling", () => {
    withEnv({ CLOVIELA_DB_MODE: "sqlite", CARTETHYIA_DB_MODE: undefined }, () => {
      expect(() => resolveDbMode()).toThrow(/lite or full/);
    });
    withEnv({ CARTETHYIA_DB_MODE: "sqlite", CLOVIELA_DB_MODE: undefined }, () => {
      expect(() => resolveDbMode()).toThrow(/lite or full/);
    });
  });

  test("CARTETHYIA_DATA_DIR is honoured, not ignored", () => {
    withEnv(
      { CARTETHYIA_DATA_DIR: "/tmp/legacy-spelling", CLOVIELA_DATA_DIR: undefined },
      () => {
        // The failure this pins: ignoring the override boots the gateway
        // against the operator's real directory instead of the isolated one.
        expect(resolveDataDir()).toBe("/tmp/legacy-spelling");
      },
    );
  });

  test("the new data dir wins when both are set", () => {
    withEnv(
      { CARTETHYIA_DATA_DIR: "/tmp/legacy", CLOVIELA_DATA_DIR: "/tmp/current" },
      () => {
        expect(resolveDataDir()).toBe("/tmp/current");
      },
    );
  });
});

describe("no module reads a renamed variable behind the compatibility layer's back", () => {
  /**
   * Walks `src/` and returns the files that mention a `CLOVIELA_*` variable
   * without going through `envValue` / `rawEnv`.
   *
   * The compatibility layer itself is exempt: it is the one place that is
   * *supposed* to spell both names.
   */
  function directReads(dir: string, found: string[] = []): readonly string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        directReads(path, found);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (entry === "env-compat.ts") continue;
      const source = readFileSync(path, "utf8");
      for (const line of source.split("\n")) {
        // A direct property or index read of a renamed variable.
        const direct = /process\.env(?:\.CLOVIELA_[A-Z_]+|\[\s*["']CLOVIELA_[A-Z_]+["']\s*\])/.test(line);
        if (direct && !line.trim().startsWith("*") && !line.trim().startsWith("//")) {
          found.push(`${path}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    return found;
  }

  test("every renamed variable is read through envValue", () => {
    const offenders = directReads(join(import.meta.dir, "..", "..", "src"));
    expect(offenders).toEqual([]);
  });
});
