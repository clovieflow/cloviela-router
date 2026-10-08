/**
 * Truthful operational metrics.
 *
 * The Health page and the Usage cards must report *measured* numbers under
 * names that mean what they say. Three regressions are pinned here:
 *
 * 1. **Cache hit rate.** It used to be `input / (input + output)` — the
 *    prompt's share of all tokens, which reads as a constant ~100% on a
 *    cacheless provider and moves with completion volume. The real rate is
 *    cached input over the input of the rows that *reported* a cache
 *    breakdown; a provider that never reports one contributes input but no
 *    cache data and must not understate the measured rate. The same definition
 *    is asserted across health, the usage summary, the cache endpoint, and the
 *    breakdown rows so the four surfaces cannot drift.
 * 2. **Memory percent.** It used to be `rss / heapTotal` — a JS-heap
 *    reservation is not a memory budget, and the ratio exceeded 100% in
 *    practice. It is now RSS over a real ceiling (configured limit, cgroup, or
 *    host total), and the ceiling itself is published as `memory_limit_bytes`.
 * 3. **CPU percent.** It used to be `loadavg / cores` — the host run queue,
 *    which includes unrelated processes and reads ~0 while the gateway is
 *    busy. It is now process CPU time over wall time, normalized by cores.
 *
 * Rows are inserted directly because the suite needs chosen token counts; the
 * queries under test are the real ones.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { DrizzleObservabilityStore } from "../../src/console/observability/store";
import { getDb } from "../../src/persistence/postgres";
import { telemetryEvents } from "../../src/persistence/schema";
import { createWorld, type GatewayWorld } from "../helpers/fixtures";
import { requireDatabase } from "../helpers/database";

requireDatabase();

let world: GatewayWorld | undefined;

afterAll(async () => {
  await world?.cleanup();
});

/**
 * One world with three telemetry rows: a 90% cache hit, a reported zero-hit,
 * and a row that never reported a breakdown (cached NULL).
 */
async function seededWorld(): Promise<GatewayWorld> {
  const created = await createWorld({ modelId: "metrics-model" });
  const rows = [
    { input: 1000, cached: 900, output: 100 },
    { input: 500, cached: 0, output: 50 },
    { input: 2000, cached: null, output: 200 },
  ];
  await getDb()
    .insert(telemetryEvents)
    .values(
      rows.map((row) => ({
        tenantId: created.tenantId,
        requestId: randomUUID(),
        requestedModel: created.modelId,
        providerId: created.providerId,
        status: "completed" as const,
        httpStatus: 200,
        inputTokens: row.input,
        cachedInputTokens: row.cached,
        outputTokens: row.output,
        latencyMs: 120,
      })),
    );
  return created;
}

describe("cache hit rate is measured, not derived from token shares", () => {
  test("health, summary, cache endpoint, and breakdown all report cached/reporting-input", async () => {
    world = await seededWorld();
    const store = new DrizzleObservabilityStore(getDb(), undefined);

    // (900 cached) / (1000 + 500 reporting input) = 60%. The old formula would
    // have reported (3500 / 3850) ≈ 90.9% — input's share of all tokens.
    const health = await store.health(world.tenantId);
    expect(health.cache_hit_rate_percent).toBe(60);

    const summary = await store.usageSummary(world.tenantId, "24h");
    expect(summary.totals.inputTokens).toBe(3500);
    expect(summary.totals.cachedTokens).toBe(900);
    expect(summary.totals.cacheHitRate).toBe(60);

    const cache = await store.usageCache(world.tenantId, "24h");
    expect(cache.cachedTokens).toBe(900);
    expect(cache.hitRate).toBe(60);

    const byProvider = await store.usageBy(world.tenantId, "provider", "24h");
    const row = byProvider.rows.find((entry) => entry.name === world!.providerId);
    expect(row?.cached).toBe(900);
    expect(row?.cacheHitRate).toBe(60);

    // The chart's `cached` series is cached tokens, a real subset of `input`.
    const chart = await store.usageChart(world.tenantId, "24h");
    const totals = chart.buckets.reduce(
      (sum, bucket) => ({
        input: sum.input + bucket.input,
        cached: sum.cached + bucket.cached,
      }),
      { input: 0, cached: 0 },
    );
    expect(totals.input).toBe(3500);
    expect(totals.cached).toBe(900);
  });
});

describe("memory and CPU are process facts under honest names", () => {
  test("memory_percent is rss over the published limit, never over heapTotal", async () => {
    if (!world) world = await seededWorld();
    const store = new DrizzleObservabilityStore(getDb(), undefined);
    const health = await store.health(world.tenantId);
    expect(health.memory_limit_bytes).toBeGreaterThan(0);
    // With no configured override on this host, the published ceiling is the
    // host's total memory; with one, it is the override. Either way the
    // percent must be exactly rss over the published ceiling.
    const expected = Math.round((health.memory_bytes / health.memory_limit_bytes) * 10000) / 100;
    expect(health.memory_percent).toBe(expected);
    // A budget over the host total is possible only when a limit was set.
    if (process.env["CARTETHYIA_MEMORY_LIMIT_BYTES"] === undefined) {
      expect(health.memory_limit_bytes).toBe(totalmem());
    }
  });

  test("cpu_percent comes from process CPU time and is bounded by core count", async () => {
    if (!world) world = await seededWorld();
    const store = new DrizzleObservabilityStore(getDb(), undefined);
    const first = await store.health(world.tenantId);
    const second = await store.health(world.tenantId);
    const cores = Math.max(cpus().length, 1);
    for (const value of [first.cpu_percent, second.cpu_percent]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      // Share-of-all-cores: cannot exceed the machine's capacity.
      expect(value).toBeLessThanOrEqual(cores * 100);
    }
    // The delta window is real: the first read is the lifetime average, the
    // second the interval since it, and both are recomputed per call rather
    // than read from a load average that would be identical between calls.
    expect(first.cpu_cores).toBe(cores);
  });
});
