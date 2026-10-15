/**
 * `CLOVIELA_OPENCODE_VERSION` pins the client version stamped as
 * `user-agent: opencode/<version>` on the `/zen` routes.
 *
 * Two properties are load-bearing and neither is visible from the config row
 * alone: the pin must *become* the fallback (so dispatch stamps it even with
 * no discovery), and it must leave the source list empty (so a background
 * refresh cannot discover the registry's latest and stamp that instead). Both
 * are decided while `client-versions.ts` evaluates, so the pinned case is
 * observed by re-evaluating that module behind a cache-busting specifier; the
 * plain import here is cached and keeps whatever the boot environment produced.
 */
import { describe, expect, test } from "bun:test";
import { resolveOpenCodeVersionOverride } from "../../src/config";
import { createClientVersionResolver } from "../../src/providers/operations/client-version-resolver";
import {
  getOpenCodeVersion,
  VERSION_SOURCES,
} from "../../src/providers/operations/client-versions";

const VERSION_ENV = "CLOVIELA_OPENCODE_VERSION";
const CLIENT_VERSIONS_MODULE = "../../src/providers/operations/client-versions";
const NPM_LATEST_URL = "https://registry.npmjs.org/opencode-ai/latest";
const SHIPPED_FALLBACK = "1.18.34";
const PINNED_VERSION = "1.10.0";

/** Runs `fn` with the pin set (or removed), restoring the previous value. */
async function withVersionEnv(
  value: string | undefined,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = process.env[VERSION_ENV];
  if (value === undefined) delete process.env[VERSION_ENV];
  else process.env[VERSION_ENV] = value;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env[VERSION_ENV];
    else process.env[VERSION_ENV] = saved;
  }
}

/**
 * Reads the opencode entry out of a freshly evaluated module.
 *
 * A dynamic import's result is not statically known, so every field this suite
 * asserts on is verified here rather than trusted.
 */
function readOpenCodeEntry(loaded: unknown): {
  readonly fallback: string;
  readonly sourceCount: number;
} {
  if (typeof loaded !== "object" || loaded === null || !("VERSION_SOURCES" in loaded)) {
    throw new Error("re-evaluated client-versions module exposes no VERSION_SOURCES");
  }
  const table: unknown = loaded.VERSION_SOURCES;
  if (typeof table !== "object" || table === null || !("opencode" in table)) {
    throw new Error("VERSION_SOURCES has no opencode entry");
  }
  const entry: unknown = table.opencode;
  if (typeof entry !== "object" || entry === null || !("fallback" in entry) || !("sources" in entry)) {
    throw new Error("the opencode entry is missing its fallback or sources");
  }
  const { fallback, sources } = entry;
  if (typeof fallback !== "string" || !Array.isArray(sources)) {
    throw new Error("the opencode entry has an unexpected shape");
  }
  return { fallback, sourceCount: sources.length };
}

describe("the OpenCode client version pin", () => {
  test("unset follows the npm latest: shipped fallback, registry source present", async () => {
    await withVersionEnv(undefined, () => {
      expect(resolveOpenCodeVersionOverride()).toBeUndefined();
    });
    expect(VERSION_SOURCES.opencode.fallback).toBe(SHIPPED_FALLBACK);
    expect(VERSION_SOURCES.opencode.sources).toEqual([{ url: NPM_LATEST_URL }]);
    // Dispatch stamps this value, so an unset pin keeps sending the shipped
    // release until a refresh discovers a newer one.
    expect(getOpenCodeVersion()).toBe(SHIPPED_FALLBACK);
  });

  test("a blank value reads as unset rather than as a version", async () => {
    await withVersionEnv("   ", () => {
      expect(resolveOpenCodeVersionOverride()).toBeUndefined();
    });
  });

  test("a configured pin becomes the fallback and drops the registry source", async () => {
    await withVersionEnv(PINNED_VERSION, async () => {
      expect(resolveOpenCodeVersionOverride()).toBe(PINNED_VERSION);
      // Static import cannot work here: the pin is read while the module
      // evaluates, and the cached import above already evaluated without it.
      const loaded: unknown = await import(`${CLIENT_VERSIONS_MODULE}?pin=${PINNED_VERSION}`);
      const opencode = readOpenCodeEntry(loaded);
      expect(opencode.fallback).toBe(PINNED_VERSION);
      expect(opencode.sourceCount).toBe(0);
    });
  });

  test("an empty source list leaves a refresh nothing to upgrade from", async () => {
    // Why the pin empties `sources` instead of only seeding the fallback: the
    // fallback alone is what discovery *replaces*, so keeping the registry
    // source would let the next monitor refresh upgrade straight back to the
    // release the operator pinned away from.
    const resolver = createClientVersionResolver({
      key: `opencode-pin-${crypto.randomUUID()}`,
      fallback: PINNED_VERSION,
      sources: [],
    });
    let probes = 0;
    await resolver.ensure(async () => {
      probes += 1;
      return new Response(JSON.stringify({ version: SHIPPED_FALLBACK }));
    });
    expect(probes).toBe(0);
    expect(resolver.snapshot()).toEqual({ version: PINNED_VERSION, source: "fallback" });
  });
});
