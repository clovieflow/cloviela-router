import { cpus, totalmem } from "node:os";
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import type { RedisClient } from "../../persistence/redis";
import {
  apiKeys,
  consoleUsers,
  models,
  networkPools,
  providerAccounts,
  providers,
  telemetryEvents,
  telemetryPayloads,
} from "../../persistence/schema";
import { globalOrOwnedBy } from "../../persistence/tenant-scope";
import { decodeDatedCursor, encodeCursor } from "../../persistence/page-cursor";
import { CARTETHYIA_VERSION } from "../../transport/version";
import { resolveMemoryLimitBytes } from "../../observability/runtime-metrics";
import { CachedPreferencesReader, DrizzlePreferencesReader, type PreferencesReader } from "../../persistence/tenant-preferences";
import type {
  ObservabilityStore,
  ReadinessCheck,
  ReadinessResponse,
  UsageDimension,
  SystemHealthResponse,
  TelemetryEventView,
  TelemetryEventDetail,
  TelemetryEventListPage,
  UsageByResponse,
  UsageCacheResponse,
  UsageChartBucket,
  UsageChartResponse,
  UsageRequestDetail,
  UsageRequestItem,
  UsageRequestsResponse,
  UsageResponse,
  UsageSummaryResponse,
} from "./contracts";
import { maskClientIp } from "../../observability/redaction";
import { splitEndpointConfig } from "../../network/pool/agent";
import { payloadReferenceFromRow, readPayloadFrame } from "../../observability/payload-store";
import { ConsoleDomainError } from "../shared/errors";
import { shouldMaskClientIp } from "../shared/ip-privacy";
import { gatewayErrorSql } from "../../observability/telemetry-status";

function mapTelemetryEventRow(event: typeof telemetryEvents.$inferSelect): TelemetryEventView {
  return {
    id: event.id,
    createdAt: event.createdAt.toISOString(),
    tenantId: event.tenantId,
    requestId: event.requestId,
    ...(event.sourceSurface ? { sourceSurface: event.sourceSurface } : {}),
    ...(event.requestedModel ? { requestedModel: event.requestedModel } : {}),
    ...(event.providerId ? { providerId: event.providerId } : {}),
    ...(event.latencyMs !== null ? { latencyMs: event.latencyMs ?? undefined } : {}),
    ...(event.status ? { status: event.status } : {}),
    ...(event.inputTokens !== null ? { inputTokens: event.inputTokens ?? undefined } : {}),
    ...(event.outputTokens !== null ? { outputTokens: event.outputTokens ?? undefined } : {}),
    ...(event.estimatedCostUsd !== null
      ? { estimatedCost: Number(event.estimatedCostUsd ?? 0) }
      : {}),
    ...(event.tokensPerSec !== null ? { tokensPerSec: Number(event.tokensPerSec) } : {}),
    ...(event.firstContentDeltaAtMs !== null ? { firstContentDeltaAtMs: event.firstContentDeltaAtMs } : {}),
    ...(event.lastEventAtMs !== null ? { lastEventAtMs: event.lastEventAtMs } : {}),
  };
}
function effectiveHttpStatusExpression() {
  return sql<number>`coalesce(
    ${telemetryEvents.httpStatus},
    case ${telemetryEvents.status}
      when 'completed' then 200
      when 'cancelled' then 499
      when 'truncated' then 502
      else 500
    end
  )`;
}

/**
 * Counts gateway errors, not client outcomes.
 *
 * Delegates to the one shared predicate so the summary, health, breakdown and
 * the durable rollup cannot drift apart: 404/499/503 are recorded and shown
 * but never counted, because they are the caller's own outcome, a client
 * abort, or the gateway correctly refusing work it cannot do.
 */
function gatewayErrors() {
  return gatewayErrorSql(telemetryEvents.status, telemetryEvents.httpStatus);
}

/**
 * Opaque, monotonic (createdAt, id) cursor. `createdAt` alone is not unique
 * — two telemetry events in the same millisecond would silently skip one
 * row across pages — so we tie-break on id and encode both, matching
 * `DrizzleAuditReadStore`'s cursor.
 */

/** Resolves a `usage` period token ("24h", "7d", "30d", "all") to its inclusive start date. */
function periodStartDate(period: string): Date | undefined {
  const match = /^(\d+)([hd])$/.exec(period);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unitMs = match[2] === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() - amount * unitMs);
}


/**
 * Client identity straight from the stored `User-Agent`: the first RFC 9110
 * product token carries both the client and its version (`bun/1.2.3`,
 * `codex-cli/0.1.0`), so no prefix catalog can drift from what the client
 * actually sent. Browser agents start with the historical `Mozilla/5.0`
 * token, which names no real client, so they report as `Browser`.
 */
export function clientNameFromUserAgent(userAgent: string | null | undefined): string {
  const raw = userAgent?.trim();
  if (!raw) return "unknown";
  if (/^mozilla\//i.test(raw)) return "Browser";
  const product = raw.split(/\s+/, 1)[0] ?? "";
  const slash = product.indexOf("/");
  const token = slash <= 0 ? product : product.slice(0, slash + 1).concat(product.slice(slash + 1).split(/[;,)]/, 1)[0] ?? "");
  return token || "unknown";
}
/** Time-series bucket width for the usage chart, chosen from the window length. */
function chartBucketSeconds(period: string): number {
  const since = periodStartDate(period);
  if (!since) return 86_400;
  const windowMs = Date.now() - since.getTime();
  if (windowMs <= 2 * 3_600_000) return 300;
  if (windowMs <= 2 * 86_400_000) return 3_600;
  if (windowMs <= 10 * 86_400_000) return 21_600;
  return 86_400;
}

/**
 * The model id with the client's requested reasoning effort as a display
 * suffix — only when the request actually carried one.
 */
function modelWithEffort(event: typeof telemetryEvents.$inferSelect): string | undefined {
  const model = event.requestedModel;
  if (!model) return undefined;
  return event.requestedEffort ? `${model} (${event.requestedEffort})` : model;
}

function mapUsageRequestItem(
  event: typeof telemetryEvents.$inferSelect,
  hideClientIp: boolean,
): UsageRequestItem {
  const input = event.inputTokens ?? 0;
  const output = event.outputTokens ?? 0;
  return {
    requestId: event.requestId,
    ...(event.sourceSurface ? { surface: event.sourceSurface } : {}),
    ...(event.providerId ? { providerId: event.providerId } : {}),
    ...(event.accountId ? { accountId: event.accountId } : {}),
    ...(modelWithEffort(event) === undefined ? {} : { model: modelWithEffort(event) as string }),
    status: event.status ?? "unknown",
    ...(event.errorCategory ? { errorKind: event.errorCategory } : {}),
    ...(event.errorOrigin ? { errorOrigin: event.errorOrigin } : {}),
    httpStatus:
      event.httpStatus ??
      (event.status === "completed"
        ? 200
        : event.status === "cancelled"
          ? 499
          : event.status === "truncated"
            ? 502
            : 500),
    mode: event.stream ? "stream" : "non_stream",
    startedAt: event.createdAt.toISOString(),
    ...(event.latencyMs !== null ? { durationMs: event.latencyMs ?? undefined } : {}),
    ...(event.inputTokens !== null ? { inputTokens: event.inputTokens ?? undefined } : {}),
    ...(event.outputTokens !== null ? { outputTokens: event.outputTokens ?? undefined } : {}),
    ...(event.cachedInputTokens !== null
      ? { cachedTokens: event.cachedInputTokens ?? undefined }
      : {}),
    ...(event.reasoningTokens !== null
      ? { reasoningTokens: event.reasoningTokens ?? undefined }
      : {}),
    ...(event.endpoint ? { endpoint: event.endpoint } : {}),
    ...(event.apiKeyId ? { apiKeyId: event.apiKeyId } : {}),
    ...(event.userAgent ? { userAgent: event.userAgent } : {}),
    ...(event.userAgent ? { clientName: clientNameFromUserAgent(event.userAgent) } : {}),
    ...(event.clientIp
      ? { clientIp: hideClientIp ? maskClientIp(event.clientIp) : event.clientIp }
      : {}),
    ...(input + output > 0 ? { totalTokens: input + output } : {}),
    ...(event.ttfbMs !== null ? { ttfbMs: event.ttfbMs ?? undefined } : {}),
    ...(event.tokensPerSec !== null ? { tokensPerSec: Number(event.tokensPerSec) } : {}),
    ...(event.firstContentDeltaAtMs !== null ? { firstContentDeltaAtMs: event.firstContentDeltaAtMs } : {}),
    ...(event.lastEventAtMs !== null ? { lastEventAtMs: event.lastEventAtMs } : {}),
    ...(event.estimatedCostUsd !== null && event.estimatedCostUsd !== undefined
      ? { estimatedCost: Number(event.estimatedCostUsd) }
      : {}),
    ...(event.creditUsed !== null && event.creditUsed !== undefined
      ? { creditUsed: Number(event.creditUsed) }
      : {}),
    ...(event.resolveMs !== null && event.resolveMs !== undefined
      ? { resolveMs: event.resolveMs }
      : {}),
  };
}
async function resolveProxyLabel(
  db: CartethyiaDatabase,
  tenantId: string,
  poolId: string,
): Promise<string> {
  const rows = await db
    .select({ id: networkPools.id, endpointConfig: networkPools.endpointConfig })
    .from(networkPools)
    .where(and(eq(networkPools.id, poolId), eq(networkPools.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return `${poolId.slice(0, 8)}…`;
  const { endpoint, label } = splitEndpointConfig((row.endpointConfig ?? {}) as Record<string, unknown>);
  return label ?? endpoint ?? `${poolId.slice(0, 8)}…`;
}
const HEALTH_WINDOW_MS = 24 * 3_600_000;
const TOP_N = 50;

/** Real Drizzle-backed observability repository used by the production console. */
export class DrizzleObservabilityStore implements ObservabilityStore {
  /**
   * Previous CPU sample, for the delta the process actually spent between
   * health reads. Kept per instance so two stores in one process (a test and
   * the console) do not report each other's window.
   */
  private lastCpuSample: { readonly user: number; readonly system: number; readonly at: number } | undefined;

  constructor(
    private readonly db: CartethyiaDatabase,
    private readonly redis: RedisClient | undefined,
    /**
     * Tenant preferences, revision-cached. The Usage page reads the privacy
     * gate on the list, detail and breakdown paths, so a direct SELECT here
     * re-read the same row per request; the cache collapses that.
     */
    private readonly preferences: PreferencesReader = new CachedPreferencesReader(
      new DrizzlePreferencesReader(db),
    ),
  ) {}

  async health(tenantId: string): Promise<SystemHealthResponse> {
    return this.computeHealth(tenantId);
  }

  private async computeHealth(tenantId: string): Promise<SystemHealthResponse> {
    const memory = process.memoryUsage();
    const cpuPercent = this.sampleProcessCpuPercent();
    // The budget the operator actually configured, or the host's total — never
    // heapTotal, which is a JS-heap reservation, not a limit. `undefined` (no
    // override and no cgroup limit) falls back to total memory so the percent
    // is always against a real ceiling. `memory_limit_bytes` publishes which
    // one was used, so the figure is checkable instead of implied.
    const configuredLimit = resolveMemoryLimitBytes();
    const memoryLimitBytes = configuredLimit ?? totalmem();
    const memoryPercent = Math.round((memory.rss / Math.max(memoryLimitBytes, 1)) * 10000) / 100;

    let databaseHealthy = true;
    let total = 0;
    let errors = 0;
    let avg = 0;
    let p95 = 0;
    let p99 = 0;
    let cacheHitRate = 0;
    let avgTokensPerSec = 0;
    try {
      // Bounded 24h rolling window (matches the Overview copy) over the
      // tenant+created index — never a whole-table percentile sort.
      const since = new Date(Date.now() - HEALTH_WINDOW_MS);
      const rows = await this.db
        .select({
          total: sql<number>`count(*)`,
          errors: sql<number>`count(*) filter (where ${gatewayErrors()})`,
          avg: sql<number>`coalesce(avg(${telemetryEvents.latencyMs}), 0)`,
          p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${telemetryEvents.latencyMs}), 0)`,
          p99: sql<number>`coalesce(percentile_cont(0.99) within group (order by ${telemetryEvents.latencyMs}), 0)`,
          cachedTokens: sql<number>`coalesce(sum(${telemetryEvents.cachedInputTokens}) filter (where ${telemetryEvents.cachedInputTokens} is not null), 0)`,
          inputTokens: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}) filter (where ${telemetryEvents.cachedInputTokens} is not null), 0)`,
          avgTokensPerSec: sql<number>`coalesce(avg(${telemetryEvents.tokensPerSec}) filter (where ${telemetryEvents.tokensPerSec} is not null), 0)`,
        })
        .from(telemetryEvents)
        .where(and(eq(telemetryEvents.tenantId, tenantId), gte(telemetryEvents.createdAt, since)));
      const row = rows[0];
      total = Number(row?.total ?? 0);
      errors = Number(row?.errors ?? 0);
      avg = Math.round(Number(row?.avg ?? 0));
      p95 = Math.round(Number(row?.p95 ?? 0));
      p99 = Math.round(Number(row?.p99 ?? 0));
      // Real cache hit rate: cached input over input, restricted to the rows
      // that reported a cache breakdown (the only rows where either number is
      // meaningful). The previous formula was input/(input+output) — the
      // prompt's share of all tokens, which reads as ~100% on a cacheless
      // provider and says nothing about caching.
      const cacheInputTokens = Number(row?.inputTokens ?? 0);
      const cacheCachedTokens = Number(row?.cachedTokens ?? 0);
      cacheHitRate =
        cacheInputTokens > 0
          ? Math.round((cacheCachedTokens / cacheInputTokens) * 10000) / 100
          : 0;
      avgTokensPerSec = Number(row?.avgTokensPerSec ?? 0);
    } catch {
      databaseHealthy = false;
    }

    // No client means the memory backend, which is healthy by construction.
    let redisHealthy = this.redis === undefined;
    if (this.redis !== undefined) {
      try {
        redisHealthy = (await this.redis.ping()) === "PONG";
      } catch {
        redisHealthy = false;
      }
    }

    const status: SystemHealthResponse["status"] = !databaseHealthy
      ? "unhealthy"
      : !redisHealthy
        ? "degraded"
        : "healthy";

    return {
      version: process.env.CARTETHYIA_VERSION ?? CARTETHYIA_VERSION,
      status,
      uptime_seconds: Math.floor(process.uptime()),
      database_healthy: databaseHealthy,
      redis_healthy: redisHealthy,
      memory_bytes: memory.rss,
      memory_percent: memoryPercent,
      /** The ceiling `memory_percent` is measured against (override, cgroup, or host total). */
      memory_limit_bytes: memoryLimitBytes,
      /**
       * ── Why these are clamped ──────────────────────────────────────────────
       * Bun's memory counters stop being mutually consistent once a WebAssembly
       * module is loaded. Measured on this build, after PGlite opens its data
       * directory: rss 264.7 MB, heapUsed 1599.2 MB, heapTotal 89.1 MB,
       * external 1591.6 MB. `heapUsed > heapTotal` and
       * `heapUsed + external > rss` are both impossible for a process, and the
       * dashboard's memory breakdown subtracted them from rss and rendered a
       * negative "native" term — a total of 819 MB for a 162 MB process.
       *
       * These are published as the runtime reports them, clamped so the fields
       * cannot contradict each other or the RSS they are part of. A reader can
       * still see the raw figures in the process, and the UI no longer adds
       * numbers that overlap.
       */
      heap_used_bytes: Math.min(memory.heapUsed, memory.heapTotal),
      heap_total_bytes: memory.heapTotal,
      external_bytes: Math.min(memory.external, Math.max(0, memory.rss - memory.heapTotal)),
      cpu_percent: cpuPercent,
      cpu_cores: cpus().length,
      pid: process.pid,
      platform: `Bun ${Bun.version} · ${process.platform}`,
      request_count: total,
      error_count: errors,
      latency_avg_ms: avg,
      latency_p95_ms: p95,
      latency_p99_ms: p99,
      cache_hit_rate_percent: cacheHitRate,
      avg_tokens_per_sec: avgTokensPerSec,
    };
  }
  /**
   * Process CPU utilization as a share of all cores, from real CPU time.
   *
   * The previous value was `loadavg / cores` — the OS run-queue length, which
   * includes every other process on the host and reads ~0 on an idle machine
   * even while this gateway is busy. This samples `process.cpuUsage()` and
   * divides the delta by the wall-clock delta and the core count, so 100% means
   * every core saturated by *this process*. The first call after boot has no
   * previous sample, so it reports the lifetime average (real CPU time since
   * start over uptime) rather than inventing a zero.
   */
  private sampleProcessCpuPercent(): number {
    const usage = process.cpuUsage();
    const at = Date.now();
    const previous = this.lastCpuSample;
    this.lastCpuSample = { user: usage.user, system: usage.system, at };
    const cores = Math.max(cpus().length, 1);
    const cpuMicros = usage.user + usage.system;
    if (previous === undefined) {
      const uptimeSeconds = process.uptime();
      if (uptimeSeconds <= 0) return 0;
      return Math.round(((cpuMicros / 1e6) / uptimeSeconds / cores) * 10000) / 100;
    }
    const elapsedMs = at - previous.at;
    if (elapsedMs <= 0) return 0;
    const deltaMicros = cpuMicros - (previous.user + previous.system);
    return Math.round(((deltaMicros / 1e6) / (elapsedMs / 1000) / cores) * 10000) / 100;
  }

  async usage(tenantId: string, period: string): Promise<UsageResponse> {
    return this.computeUsage(tenantId, period);
  }

  private async computeUsage(tenantId: string, period: string): Promise<UsageResponse> {
    const since = periodStartDate(period);
    const scope = since
      ? and(eq(telemetryEvents.tenantId, tenantId), gte(telemetryEvents.createdAt, since))
      : eq(telemetryEvents.tenantId, tenantId);
    // Single indexed aggregate row instead of materializing every event
    // into the Node heap and regrouping in JS.
    const [totals] = await this.db
      .select({
        requestsTotal: sql<number>`count(*)`,
        requestsSucceeded: sql<number>`count(*) filter (where ${telemetryEvents.status} = 'completed')`,
        requestsFailed: sql<number>`count(*) filter (where ${gatewayErrors()})`,
        tokensUsed: sql<number>`coalesce(sum(${telemetryEvents.inputTokens} + ${telemetryEvents.outputTokens}), 0)`,
        estimatedCost: sql<number>`coalesce(sum(${telemetryEvents.estimatedCostUsd}), 0)`,
      })
      .from(telemetryEvents)
      .where(scope);
    const requestsTotal = Number(totals?.requestsTotal ?? 0);
    const requestsSucceeded = Number(totals?.requestsSucceeded ?? 0);
    const requestsFailed = Number(totals?.requestsFailed ?? 0);
    const modelRows = await this.db
      .select({
        modelId: telemetryEvents.requestedModel,
        count: sql<number>`count(*)`,
      })
      .from(telemetryEvents)
      .where(scope)
      .groupBy(telemetryEvents.requestedModel)
      .orderBy(sql`count(*) desc`)
      .limit(TOP_N);
    const providerRows = await this.db
      .select({
        providerId: telemetryEvents.providerId,
        count: sql<number>`count(*)`,
      })
      .from(telemetryEvents)
      .where(scope)
      .groupBy(telemetryEvents.providerId)
      .orderBy(sql`count(*) desc`)
      .limit(TOP_N);
    return {
      tenantId,
      period,
      requestsTotal,
      requestsSucceeded,
      requestsFailed,
      tokensUsed: Number(totals?.tokensUsed ?? 0),
      estimatedCost: Number(totals?.estimatedCost ?? 0),
      topModels: modelRows
        .filter((row) => row.modelId !== null)
        .map((row) => {
          if (typeof row.modelId !== "string")
            throw new ConsoleDomainError("internal_error", 500, "Usage model row missing modelId");
          return { modelId: row.modelId, count: Number(row.count) };
        }),
      topProviders: providerRows
        .filter((row) => row.providerId !== null)
        .map((row) => {
          if (typeof row.providerId !== "string")
            throw new ConsoleDomainError("internal_error", 500, "Usage provider row missing providerId");
          return { providerId: row.providerId, count: Number(row.count) };
        }),
    };
  }

  private usageScope(tenantId: string, period: string) {
    const since = periodStartDate(period);
    return since
      ? and(eq(telemetryEvents.tenantId, tenantId), gte(telemetryEvents.createdAt, since))
      : eq(telemetryEvents.tenantId, tenantId);
  }

  async usageSummary(tenantId: string, period: string): Promise<UsageSummaryResponse> {
    const [row] = await this.db
      .select({
        requests: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}), 0)`,
        cachedTokens: sql<number>`coalesce(sum(${telemetryEvents.cachedInputTokens}), 0)`,
        cacheReportingInputTokens: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}) filter (where ${telemetryEvents.cachedInputTokens} is not null), 0)`,
        outputTokens: sql<number>`coalesce(sum(${telemetryEvents.outputTokens}), 0)`,
        errors: sql<number>`count(*) filter (where ${gatewayErrors()})`,
        cancelled: sql<number>`count(*) filter (where ${telemetryEvents.status} = 'cancelled')`,
        truncated: sql<number>`count(*) filter (where ${telemetryEvents.status} = 'truncated')`,
        avgDurationMs: sql<number>`coalesce(avg(${telemetryEvents.latencyMs}), 0)`,
        estimatedCostUsd: sql<number>`coalesce(sum(${telemetryEvents.estimatedCostUsd}), 0)`,
        unpriced: sql<number>`count(*) filter (where ${telemetryEvents.status} = 'completed' and ${telemetryEvents.estimatedCostUsd} is null)`,
        avgTokensPerSec: sql<number>`coalesce(avg(${telemetryEvents.tokensPerSec}) filter (where ${telemetryEvents.tokensPerSec} is not null), 0)`,
      })
      .from(telemetryEvents)
      .where(this.usageScope(tenantId, period));
    const statusRows = await this.db
      .select({
        status: effectiveHttpStatusExpression(),
        count: sql<number>`count(*)`,
      })
      .from(telemetryEvents)
      .where(this.usageScope(tenantId, period))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const statusCounts = statusRows.map((statusRow) => ({
      status: Number(statusRow.status),
      count: Number(statusRow.count),
    }));
    const inputTokens = Number(row?.inputTokens ?? 0);
    const cachedTokens = Number(row?.cachedTokens ?? 0);
    const outputTokens = Number(row?.outputTokens ?? 0);
    // Cached input over the input of the rows that actually reported a cache
    // breakdown. Dividing by all input would understate the rate on providers
    // that never report the breakdown (they contribute 0 to the numerator but
    // their full input to the denominator); `inputTokens` above stays the
    // all-rows sum so the displayed totals remain complete.
    const cacheReportingInputTokens = Number(row?.cacheReportingInputTokens ?? 0);
    return {
      period,
      totals: {
        statusCounts,
        requests: Number(row?.requests ?? 0),
        inputTokens,
        cachedTokens,
        outputTokens,
        errors: Number(row?.errors ?? 0),
        cancelled: Number(row?.cancelled ?? 0),
        truncated: Number(row?.truncated ?? 0),
        avgDurationMs: Number(row?.avgDurationMs ?? 0),
        estimatedCostUsd: Number(row?.estimatedCostUsd ?? 0),
        partial: Number(row?.unpriced ?? 0) > 0,
        cacheHitRate:
          cacheReportingInputTokens > 0
            ? (cachedTokens / cacheReportingInputTokens) * 100
            : 0,
        avgTokensPerSec: Number(row?.avgTokensPerSec ?? 0),
      },
    };
  }

  async usageChart(tenantId: string, period: string): Promise<UsageChartResponse> {
    const since = periodStartDate(period);
    const bucketSeconds = chartBucketSeconds(period);
    const rows = await this.db
      .select({
        bucket: sql<Date>`to_timestamp(floor(extract(epoch from ${telemetryEvents.createdAt}) / ${bucketSeconds}) * ${bucketSeconds})`,
        requests: sql<number>`count(*)`,
        input: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}), 0)`,
        cached: sql<number>`coalesce(sum(${telemetryEvents.cachedInputTokens}), 0)`,
        output: sql<number>`coalesce(sum(${telemetryEvents.outputTokens}), 0)`,
      })
      .from(telemetryEvents)
      .where(this.usageScope(tenantId, period))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const byTime = new Map<number, UsageChartBucket>();
    for (const row of rows) {
      const start = Math.floor(new Date(row.bucket).getTime() / 1000) * 1000;
      if (!Number.isFinite(start)) continue;
      byTime.set(start, {
        t: new Date(start).toISOString(),
        requests: Number(row.requests ?? 0),
        input: Number(row.input ?? 0),
        cached: Number(row.cached ?? 0),
        output: Number(row.output ?? 0),
      });
    }
    const first = rows.length > 0 ? Math.min(...byTime.keys()) : undefined;
    const startMs = since ? since.getTime() : first;
    if (startMs === undefined) return { buckets: [] };
    const stepMs = bucketSeconds * 1000;
    const aligned = Math.floor(startMs / stepMs) * stepMs;
    const buckets: UsageChartBucket[] = [];
    for (let at = aligned; at <= Date.now(); at += stepMs) {
      buckets.push(
        byTime.get(at) ?? { t: new Date(at).toISOString(), requests: 0, input: 0, cached: 0, output: 0 },
      );
    }
    return { buckets };
  }

  async usageBy(
    tenantId: string,
    dimension: UsageDimension,
    period: string,
  ): Promise<UsageByResponse> {
    const column =
      dimension === "model"
        ? telemetryEvents.requestedModel
        : dimension === "key"
          ? telemetryEvents.apiKeyId
          : dimension === "client"
            ? telemetryEvents.userAgent
            : dimension === "client_ip"
              ? telemetryEvents.clientIp
              : telemetryEvents.providerId;
    const rows = await this.db
      .select({
        name: column,
        requests: sql<number>`count(*)`,
        input: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}), 0)`,
        output: sql<number>`coalesce(sum(${telemetryEvents.outputTokens}), 0)`,
        cached: sql<number>`coalesce(sum(${telemetryEvents.cachedInputTokens}), 0)`,
        cacheReportingInput: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}) filter (where ${telemetryEvents.cachedInputTokens} is not null), 0)`,
        errors: sql<number>`count(*) filter (where ${gatewayErrors()})`,
        cost: sql<string | null>`sum(${telemetryEvents.estimatedCostUsd})`,
        avgTokensPerSec: sql<number>`coalesce(avg(${telemetryEvents.tokensPerSec}) filter (where ${telemetryEvents.tokensPerSec} is not null), 0)`,
      })
      .from(telemetryEvents)
      .where(
        dimension === "key"
          ? and(this.usageScope(tenantId, period), isNotNull(telemetryEvents.apiKeyId))
          : and(this.usageScope(tenantId, period), isNotNull(column), ne(column, "")),
      )
      .groupBy(column)
      .orderBy(sql`count(*) desc`)
      .limit(100);
    const mapped = rows.map((row) => {
      const input = Number(row.input ?? 0);
      const output = Number(row.output ?? 0);
      const cached = Number(row.cached ?? 0);
      const cacheReportingInput = Number(row.cacheReportingInput ?? 0);
      if (typeof row.name !== "string" || row.name.length === 0)
        throw new ConsoleDomainError("internal_error", 500, "Usage breakdown row missing name");
      const name = dimension === "client" ? clientNameFromUserAgent(row.name) : row.name;
      return {
        name,
        requests: Number(row.requests ?? 0),
        input,
        output,
        cached,
        total: input + output,
        errors: Number(row.errors ?? 0),
        costUsd: row.cost === null ? null : Number(row.cost),
        cacheHitRate: cacheReportingInput > 0 ? (cached / cacheReportingInput) * 100 : 0,
        avgTokensPerSec: Number(row.avgTokensPerSec ?? 0),
      };
    });
    if (dimension === "client_ip") {
      // Same fail-closed gate as the request list: storage keeps the raw
      // address, only presentation masks it.
      const hideClientIp = await shouldMaskClientIp(this.preferences, tenantId);
      if (!hideClientIp) return { rows: mapped };
      // Grouping happened on the raw address, so masking can collapse distinct
      // hosts into one display name (`203.0.113.7` and `203.0.113.9` both become
      // `203.0.113.xxx`). Re-aggregate by the masked name: two rows the operator
      // cannot tell apart are one row, and the totals must not be understated.
      // The cache denominator is carried alongside so the merged rate stays a
      // real cached/reporting-input ratio rather than a re-derived guess.
      const reportingInputByRaw = new Map<string, number>(
        rows.map((row) => [
          typeof row.name === "string" ? row.name : "",
          Number(row.cacheReportingInput ?? 0),
        ]),
      );
      const merged = new Map<
        string,
        { row: (typeof mapped)[number]; cacheReportingInput: number }
      >();
      for (const row of mapped) {
        const masked = maskClientIp(row.name);
        const existing = merged.get(masked);
        if (existing === undefined) {
          merged.set(masked, {
            row: { ...row, name: masked },
            cacheReportingInput: reportingInputByRaw.get(row.name) ?? 0,
          });
          continue;
        }
        const input = existing.row.input + row.input;
        const output = existing.row.output + row.output;
        merged.set(masked, {
          row: {
            ...existing.row,
            requests: existing.row.requests + row.requests,
            input,
            output,
            cached: existing.row.cached + row.cached,
            total: input + output,
            errors: existing.row.errors + row.errors,
            costUsd:
              existing.row.costUsd === null && row.costUsd === null
                ? null
                : (existing.row.costUsd ?? 0) + (row.costUsd ?? 0),
          },
          cacheReportingInput:
            existing.cacheReportingInput + (reportingInputByRaw.get(row.name) ?? 0),
        });
      }
      return {
        rows: [...merged.values()]
          .sort((a, b) => b.row.requests - a.row.requests)
          .map(({ row, cacheReportingInput }) => ({
            ...row,
            cacheHitRate: cacheReportingInput > 0 ? (row.cached / cacheReportingInput) * 100 : 0,
          })),
      };
    }
    if (dimension !== "key") return { rows: mapped };
    const ids = [...new Set(mapped.map((row) => row.name))];
    const labels = ids.length > 0 ? await this.apiKeyLabels(tenantId, ids) : new Map<string, string>();
    return {
      rows: mapped.map((row) => {
        const label = labels.get(row.name);
        return label === undefined ? row : { ...row, label };
      }),
    };
  }

  private async apiKeyLabels(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, string>();
    const keyRows = await this.db
      .select({ id: apiKeys.id, label: apiKeys.label })
      .from(apiKeys)
      .where(and(inArray(apiKeys.id, [...unique]), eq(apiKeys.tenantId, tenantId)));
    return new Map(keyRows.map((keyRow) => [keyRow.id, keyRow.label] as const));
  }

  async usageCache(tenantId: string, period: string): Promise<UsageCacheResponse> {
    const [row] = await this.db
      .select({
        inputTokens: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}), 0)`,
        cachedTokens: sql<number>`coalesce(sum(${telemetryEvents.cachedInputTokens}), 0)`,
        cacheReportingInputTokens: sql<number>`coalesce(sum(${telemetryEvents.inputTokens}) filter (where ${telemetryEvents.cachedInputTokens} is not null), 0)`,
      })
      .from(telemetryEvents)
      .where(this.usageScope(tenantId, period));
    const inputTokens = Number(row?.inputTokens ?? 0);
    const cachedTokens = Number(row?.cachedTokens ?? 0);
    // Same definition as the health endpoint and the summary: cached input over
    // the input of rows that reported a cache breakdown. The previous formula
    // divided by input+output, so a cacheless provider's rate moved with its
    // completion volume.
    const cacheReportingInputTokens = Number(row?.cacheReportingInputTokens ?? 0);
    return {
      period,
      inputTokens,
      cachedTokens,
      cacheWriteTokens: 0,
      hitRate: cacheReportingInputTokens > 0 ? (cachedTokens / cacheReportingInputTokens) * 100 : 0,
    };
  }

  async usageRequests(
    tenantId: string,
    period: string,
    limit: number,
    httpStatus?: number,
  ): Promise<UsageRequestsResponse> {
    const scope = this.usageScope(tenantId, period);
    const filter = httpStatus === undefined
      ? scope
      : and(scope, eq(effectiveHttpStatusExpression(), httpStatus));
    const rows = await this.db
      .select()
      .from(telemetryEvents)
      .where(filter)
      .orderBy(desc(telemetryEvents.createdAt), desc(telemetryEvents.id))
      .limit(limit);
    const hideClientIp = await shouldMaskClientIp(this.preferences, tenantId);
    const keyIds = [...new Set(rows.map((row) => row.apiKeyId).filter((id): id is string => id !== null))];
    const labels = await this.apiKeyLabels(tenantId, keyIds);
    return {
      items: rows.map((row) => {
        const item = mapUsageRequestItem(row, hideClientIp);
        const label = row.apiKeyId ? labels.get(row.apiKeyId) : undefined;
        return label === undefined ? item : { ...item, apiKeyLabel: label };
      }),
    };
  }
  /**
   * First-run checklist.
   *
   * ── Why these five steps and no more ──────────────────────────────────────
   * They are the minimum for a client to get an answer: an operator exists to
   * own the gateway, a provider can serve, a model is routable, a key lets a
   * client in, and at least one request has proved the path end to end. The
   * last one does not gate `ready` — a gateway with a key issued is usable,
   * and "has anyone called it yet" is the operator's next action, not a setup
   * requirement.
   *
   * ── Why every count is a real query ───────────────────────────────────────
   * The dashboard falls back to composing these same five facts client-side
   * when this route is absent. Two implementations of one claim can disagree,
   * so the server is the canonical owner and every number here is measured,
   * never inferred from configuration.
   */
  async readiness(tenantId: string): Promise<ReadinessResponse> {
    const [adminRow] = await this.db
      .select({ id: consoleUsers.id })
      .from(consoleUsers)
      .where(and(eq(consoleUsers.tenantId, tenantId), eq(consoleUsers.isActive, true)))
      .limit(1);

    // A provider counts as connected when it is enabled AND has the credential
    // it needs: `requires_account = false` builtins (OpenCode Free) are usable
    // with zero accounts, everything else needs at least one.
    const [providerRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(providers)
      .where(
        and(
          eq(providers.enabled, true),
          globalOrOwnedBy(providers.tenantId, tenantId),
          or(
            eq(providers.requiresAccount, false),
            sql`exists (
              select 1 from ${providerAccounts}
              where ${providerAccounts.providerId} = ${providers.id}
            )`,
          ),
        ),
      );

    const [modelRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(
        and(
          eq(models.enabled, true),
          eq(providers.enabled, true),
          globalOrOwnedBy(providers.tenantId, tenantId),
        ),
      );

    const [keyRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.tenantId, tenantId),
          eq(apiKeys.enabled, true),
          isNull(apiKeys.revokedAt),
        ),
      );

    // 24h is the honest "served anything recently" window: an all-time total
    // stays non-zero forever after a single test request.
    const [requestRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(telemetryEvents)
      .where(this.usageScope(tenantId, "24h"));

    const providerCount = Number(providerRow?.count ?? 0);
    const modelCount = Number(modelRow?.count ?? 0);
    const keyCount = Number(keyRow?.count ?? 0);
    const requestCount = Number(requestRow?.count ?? 0);

    const checks: readonly ReadinessCheck[] = [
      {
        id: "admin_created",
        ok: adminRow !== undefined,
        detail: adminRow === undefined ? "No administrator account" : "Administrator account exists",
        ...(adminRow === undefined
          ? { remediation: "Create the administrator account on the setup screen." }
          : {}),
      },
      {
        id: "provider_connected",
        ok: providerCount > 0,
        detail: `${providerCount} provider(s) connected`,
        ...(providerCount > 0 ? {} : { remediation: "Add a provider account under Providers." }),
      },
      {
        id: "model_available",
        ok: modelCount > 0,
        detail: `${modelCount} routable model(s)`,
        ...(modelCount > 0
          ? {}
          : { remediation: "Refresh a provider's model catalog so models become routable." }),
      },
      {
        id: "api_key_issued",
        ok: keyCount > 0,
        detail: `${keyCount} active key(s)`,
        ...(keyCount > 0 ? {} : { remediation: "Issue a gateway key under API Keys." }),
      },
      {
        id: "first_request_seen",
        ok: requestCount > 0,
        detail: `${requestCount} request(s) in 24h`,
        ...(requestCount > 0
          ? {}
          : { remediation: "Point a client at the gateway and send one request." }),
      },
    ];

    // Only the four gating steps decide `ready`; see the note above.
    const ready = checks
      .filter((check) => check.id !== "first_request_seen")
      .every((check) => check.ok);

    return { ready, generatedAt: new Date().toISOString(), checks };
  }

  async usageRequestDetail(
    tenantId: string,
    requestId: string,
  ): Promise<UsageRequestDetail | undefined> {
    const rows = await this.db
      .select()
      .from(telemetryEvents)
      .where(and(eq(telemetryEvents.tenantId, tenantId), eq(telemetryEvents.requestId, requestId)))
      .orderBy(desc(telemetryEvents.createdAt), desc(telemetryEvents.id))
      .limit(1);
    const event = rows[0];
    if (!event) return undefined;
    const hideClientIp = await shouldMaskClientIp(this.preferences, tenantId);
    const item = mapUsageRequestItem(event, hideClientIp);
    const keyLabel = event.apiKeyId
      ? (await this.apiKeyLabels(tenantId, [event.apiKeyId])).get(event.apiKeyId)
      : undefined;
    const labeled = keyLabel === undefined ? item : { ...item, apiKeyLabel: keyLabel };
    const proxy = event.networkPoolId
      ? await resolveProxyLabel(this.db, tenantId, event.networkPoolId)
      : "direct";
    const presented = { ...labeled, proxy };
    // Filter the payload table directly instead of joining `telemetry_events`
    // only to re-apply the tenant predicate: `telemetry_payloads` carries
    // `tenant_id` itself, so the join added a second table's rows to filter for
    // no additional constraint. This matches `getEvent` above and uses
    // `telemetry_payloads_tenant_request_idx`.
    const linkedPayloadRows = await this.db
      .select({ payload: telemetryPayloads })
      .from(telemetryPayloads)
      .where(
        and(
          eq(telemetryPayloads.requestId, requestId),
          eq(telemetryPayloads.tenantId, tenantId),
        ),
      )
      .orderBy(desc(telemetryPayloads.capturedAt))
      .limit(1);
    const payloadRow = linkedPayloadRows[0]?.payload;
    const captured = await readCapturedBodies(payloadRow);
    if (!captured) {
      return { ...presented, payloads: null };
    }
    return {
      ...presented,
      payloads: {
        ...(captured.request !== undefined ? { request: captured.request } : {}),
        ...(captured.response !== undefined ? { response: captured.response } : {}),
        ...(captured.clientResponse !== undefined ? { clientResponse: captured.clientResponse } : {}),
        ...(captured.providerRequest !== undefined
          ? { providerRequest: captured.providerRequest }
          : {}),
        ...(captured.providerResponse !== undefined
          ? { providerResponse: captured.providerResponse }
          : {}),
      },
      ...(captured.signals === undefined ? {} : { payloadSignals: captured.signals }),
    };
  }

  async listEvents(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<TelemetryEventListPage> {
    const before = decodeDatedCursor(cursor);
    const filters = [eq(telemetryEvents.tenantId, tenantId)];
    if (before) {
      filters.push(
        sql`(${telemetryEvents.createdAt}, ${telemetryEvents.id}) < (${new Date(before.createdAt)}, ${before.id})`,
      );
    }
    const rows = await this.db
      .select()
      .from(telemetryEvents)
      .where(and(...filters))
      .orderBy(desc(telemetryEvents.createdAt), desc(telemetryEvents.id))
      .limit(limit + 1);
    const overflow = rows.length > limit;
    const trimmed = overflow ? rows.slice(0, limit) : rows;
    const entries = trimmed.map(mapTelemetryEventRow);
    const lastEntry = entries[entries.length - 1];
    const nextCursor =
      overflow && lastEntry !== undefined
        ? encodeCursor({ createdAt: lastEntry.createdAt, id: lastEntry.id })
        : undefined;
    return nextCursor ? { entries, nextCursor } : { entries };
  }

  async getEvent(
    tenantId: string,
    eventId: string,
    includePayload = false,
    createdAt?: string,
  ): Promise<TelemetryEventDetail | undefined> {
    const filters = [eq(telemetryEvents.tenantId, tenantId), eq(telemetryEvents.id, eventId)];
    if (createdAt) {
      const at = new Date(createdAt);
      if (!Number.isNaN(at.getTime())) filters.push(eq(telemetryEvents.createdAt, at));
    }
    const rows = await this.db
      .select()
      .from(telemetryEvents)
      .where(and(...filters))
      .limit(1);
    const event = rows[0];
    if (!event) return undefined;
    const base = mapTelemetryEventRow(event);
    if (!includePayload) return base;
    const payloadRows = await this.db
      .select()
      .from(telemetryPayloads)
      .where(
        and(
          eq(telemetryPayloads.requestId, event.requestId),
          eq(telemetryPayloads.tenantId, tenantId),
        ),
      )
      .orderBy(desc(telemetryPayloads.capturedAt))
      .limit(1);
    const payloadRow = payloadRows[0];
    if (!payloadRow) return base;
    const captured = await readCapturedBodies(payloadRow);
    if (!captured) return base;
    return {
      ...base,
      payload: {
        ...(captured.request !== undefined ? { requestBody: captured.request } : {}),
        ...(captured.response !== undefined ? { responseBody: captured.response } : {}),
      },
    };
  }
}

/**
 * Reads the captured bodies behind one `telemetry_payloads` row.
 *
 * The row stores typed frame-reference columns only; every body lives in the
 * frame file those columns name. Returns `undefined` when there is no row, no
 * usable reference, or the frame cannot be read — all three mean "nothing to
 * show", and the caller renders the request without a payload section. The raw
 * reference is never returned to a caller, so it cannot reach the dashboard.
 */
async function readCapturedBodies(
  row:
    | {
        readonly storage: string;
        readonly file: string;
        readonly offset: number;
        readonly length: number;
        readonly checksum: string;
        readonly version: number;
      }
    | null
    | undefined,
): Promise<
  | {
      request: unknown;
      response: unknown;
      clientResponse: unknown;
      providerRequest: unknown;
      providerResponse: unknown;
      signals?: { toolCalls: number; images: number; attachments: number };
    }
  | undefined
> {
  if (!row) return undefined;
  const reference = payloadReferenceFromRow(row);
  if (!reference) return undefined;
  try {
    const stored = await readPayloadFrame(reference);
    if (!stored || typeof stored !== "object") return undefined;
    const record = stored as Record<string, unknown>;
    const bodies = {
      request: record["request_body"] ?? undefined,
      response: record["response_body"] ?? undefined,
      clientResponse: record["client_response_body"] ?? undefined,
      providerRequest: record["provider_request_body"] ?? undefined,
      providerResponse: record["provider_response_body"] ?? undefined,
    };
    const signals =
      typeof record["signals"] === "object" &&
      record["signals"] !== null &&
      !Array.isArray(record["signals"])
        ? (record["signals"] as { toolCalls: number; images: number; attachments: number })
        : undefined;
    return {
      ...bodies,
      ...(signals === undefined ? {} : { signals }),
    };
  } catch {
    return undefined;
  }
}
