/**
 * Snapshot cache bounds: TTL refresh and the invalidation race.
 *
 * `invalidate()` is per-process. In a Full deployment Bun's `reusePort` spreads
 * requests across workers, so a console mutation lands on exactly one worker;
 * every other worker keeps serving its cached snapshot until something else
 * invalidates it. The TTL is that something — without it, "changed routes
 * retained forever" is the literal behavior of every worker that did not
 * handle the write.
 *
 * These tests pin the three properties the TTL must not break while providing
 * that bound:
 * 1. a snapshot older than the TTL is rebuilt by the next reader, exactly once
 *    even under concurrent reads;
 * 2. `invalidate()` still drops the snapshot immediately (no waiting out a
 *    TTL window on the worker that saw the write);
 * 3. the existing mutation-during-build race stays correct — a build that
 *    started before a mutation may be returned to the reader that asked first,
 *    but must never populate the cache afterwards.
 */
import { describe, expect, test } from "bun:test";
import { InMemoryRouteSnapshotService } from "../../src/transport/routing/route-model";
import type { BuiltRouteSnapshot } from "../../src/transport/routing/route-model";

function snapshot(tag: string): BuiltRouteSnapshot {
  return {
    candidates: [
      {
        provider_id: "provider-a",
        model_id: tag,
        wire_family: "chat",
        endpoint: "/v1/chat/completions",
        capability_profile: {},
        tenant_id: null,
      },
    ],
    aliases: {},
    combos: {},
  };
}

/** A service whose clock the test controls, counting builds. */
function clockedService(ttlMs: number) {
  let nowMs = 1_000_000;
  let builds = 0;
  const service = new InMemoryRouteSnapshotService(
    async () => {
      builds += 1;
      return snapshot(`build-${builds}`);
    },
    { ttlMs, now: () => nowMs },
  );
  return {
    service,
    advance: (ms: number) => {
      nowMs += ms;
    },
    builds: () => builds,
  };
}

describe("snapshot TTL", () => {
  test("serves the cached snapshot inside the TTL and rebuilds after it", async () => {
    const clock = clockedService(30_000);
    const first = await clock.service.getSnapshot();
    clock.advance(29_999);
    expect(await clock.service.getSnapshot()).toBe(first);
    expect(clock.builds()).toBe(1);

    clock.advance(2);
    const refreshed = await clock.service.getSnapshot();
    expect(refreshed).not.toBe(first);
    expect(clock.builds()).toBe(2);
  });

  test("concurrent readers after expiry share one rebuild", async () => {
    const clock = clockedService(30_000);
    await clock.service.getSnapshot();
    clock.advance(30_001);
    const [a, b, c] = await Promise.all([
      clock.service.getSnapshot(),
      clock.service.getSnapshot(),
      clock.service.getSnapshot(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(clock.builds()).toBe(2);
  });

  test("invalidate() drops the snapshot immediately, before the TTL", async () => {
    const clock = clockedService(30_000);
    const first = await clock.service.getSnapshot();
    await clock.service.invalidate();
    const rebuilt = await clock.service.getSnapshot();
    expect(rebuilt).not.toBe(first);
    expect(clock.builds()).toBe(2);
    expect(rebuilt.revision).toBe(1);
  });

  test("ttlMs 0 disables caching (test seam)", async () => {
    const clock = clockedService(0);
    const first = await clock.service.getSnapshot();
    const second = await clock.service.getSnapshot();
    expect(second).not.toBe(first);
    expect(clock.builds()).toBe(2);
  });
});

describe("snapshot invalidation race", () => {
  test("a mutation during a build is not lost: the stale build never populates the cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let builds = 0;
    const service = new InMemoryRouteSnapshotService(async () => {
      builds += 1;
      const tag = `build-${builds}`;
      if (builds === 1) await gate;
      return snapshot(tag);
    });

    const pending = service.getSnapshot();
    await service.invalidate();
    release();
    const fromStaleBuild = await pending;
    // The reader that asked first gets its (pre-mutation) snapshot...
    expect(fromStaleBuild.candidates[0]?.model_id).toBe("build-1");
    // ...but the cache was cleared by the mutation, so the next reader must
    // see a fresh build rather than the superseded one.
    const next = await service.getSnapshot();
    expect(next.candidates[0]?.model_id).toBe("build-2");
    expect(builds).toBe(2);
  });

  test("a reader arriving after a mutation never receives the in-flight pre-mutation build", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let builds = 0;
    const service = new InMemoryRouteSnapshotService(async () => {
      builds += 1;
      const tag = `build-${builds}`;
      if (builds === 1) await gate;
      return snapshot(tag);
    });

    const first = service.getSnapshot();
    await service.invalidate();
    const second = service.getSnapshot();
    release();
    await first;
    const secondResult = await second;
    expect(secondResult.candidates[0]?.model_id).toBe("build-2");
  });
});
