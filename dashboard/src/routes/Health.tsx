/**
 * Health: process, storage, gateway, connectivity, and runtime — with a
 * remediation line whenever something is actually wrong.
 *
 * ── Two sources, two questions ─────────────────────────────────────────────
 * `/console/api/system/health` (authenticated) reports how the process is
 * doing: memory, CPU, latency, request counters, DB/Redis reachability.
 * `/health/ready` (public) reports whether the process will accept traffic at
 * all. They are shown separately because they can disagree in the one case
 * that matters most: a draining or migration-pending process still answers the
 * console snapshot while refusing new requests.
 *
 * ── No secrets ─────────────────────────────────────────────────────────────
 * The console health payload contains no credentials or environment values,
 * and this page renders only the fields that endpoint declares. Nothing here
 * reads `process.env`, and the readiness probe's `reason` is the gateway's own
 * fixed vocabulary ("dependency not ready"), never a connection string.
 */
import { useMemo, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Gauge,
  RefreshCw,
  Server,
  Wifi,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Stack } from "../components/ui/stack";
import { LoadingState, ErrorState } from "../components/ui/state";
import { useReadinessProbe } from "../hooks/readiness";
import { useInFlight } from "../hooks/live";
import { useSystemHealth } from "../hooks/system";
import { PageHead } from "../components/PageHead";
import { useT } from "../shared/locale-context";
import { formatAgo, formatBytes, formatDuration, formatNumber, formatUptime } from "../shared/format";
import type { MessageKey } from "../shared/i18n";

/** One label/value pair inside a health group. */
function Fact({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: "ok" | "danger";
}): ReactNode {
  return (
    <div className="health-fact">
      <span className="health-fact-label">{label}</span>
      <span
        className="health-fact-value"
        style={
          tone === "ok"
            ? { color: "var(--green)" }
            : tone === "danger"
              ? { color: "var(--red)" }
              : undefined
        }
      >
        {value}
      </span>
    </div>
  );
}

const STATUS_LABEL_KEY: Readonly<Record<"healthy" | "degraded" | "unhealthy", MessageKey>> = {
  healthy: "health.status.healthy",
  degraded: "health.status.degraded",
  unhealthy: "health.status.unhealthy",
};

const REMEDIATION_KEY: Readonly<Record<"healthy" | "degraded" | "unhealthy", MessageKey>> = {
  healthy: "health.remediation.none",
  degraded: "health.remediation.degraded",
  unhealthy: "health.remediation.unhealthy",
};

export default function Health(): ReactNode {
  const t = useT();
  const healthQuery = useSystemHealth(5_000);
  const probeQuery = useReadinessProbe();
  const inFlight = useInFlight();
  const health = healthQuery.data;

  // The single worst signal decides the headline: a healthy process with a
  // failing readiness probe is not "healthy", and saying so would be the exact
  // false reassurance this page exists to prevent.
  const overall = useMemo<"healthy" | "degraded" | "unhealthy" | undefined>(() => {
    if (!health) return undefined;
    if (health.status === "unhealthy") return "unhealthy";
    if (probeQuery.data && !probeQuery.data.ready) return "degraded";
    if (!health.database_healthy) return "unhealthy";
    if (!health.redis_healthy) return "degraded";
    return health.status;
  }, [health, probeQuery.data]);

  // Storage-specific remediation wins over the generic one: "check DATABASE_URL"
  // is actionable where "gateway degraded" is not.
  const remediationKey = useMemo<MessageKey>(() => {
    if (!health) return "health.remediation.none";
    if (!health.database_healthy) return "health.remediation.db";
    if (!health.redis_healthy) return "health.remediation.redis";
    if (overall === undefined) return "health.remediation.none";
    return REMEDIATION_KEY[overall];
  }, [health, overall]);

  const remediationTone = overall === "healthy" ? "ok" : overall === "unhealthy" ? "danger" : undefined;

  return (
    <div className="dashboard-page">
      <PageHead title={t("health.title")} description={t("health.subtitle")} art="health" />

      {healthQuery.isPending ? (
        <LoadingState label={t("state.loading")} />
      ) : healthQuery.isError || !health ? (
        <ErrorState
          title={t("state.error.title")}
          message={t("state.error.retryHint")}
          onRetry={() => void healthQuery.refetch()}
          retrying={healthQuery.isFetching}
        />
      ) : (
        <Stack gap="14px">
          <Card>
            <CardHeader
              title={t("health.overall")}
              subtitle={`${health.version} · ${health.platform}`}
              icon={<Gauge size={15} />}
              action={
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {/* A live figure with no timestamp is indistinguishable from a
                      frozen one. This says when the numbers beside it were read,
                      and the dot marks the moment a poll is in flight — so a
                      stalled refresh is visible instead of silently stale. */}
                  <span className="health-freshness" aria-live="polite">
                    <span
                      className={`health-freshness-dot${healthQuery.isFetching ? " is-live" : ""}`}
                      aria-hidden="true"
                    />
                    {t("health.lastChecked", {
                      time: formatAgo(new Date(healthQuery.dataUpdatedAt)),
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw size={13} className={healthQuery.isFetching ? "animate-spin" : ""} />}
                    onClick={() => {
                      void healthQuery.refetch();
                      void probeQuery.refetch();
                    }}
                    disabled={healthQuery.isFetching}
                  >
                    {healthQuery.isFetching ? t("action.refreshing") : t("action.refresh")}
                  </Button>
                </div>
              }
            />
            <CardBody>
              <Stack gap="12px">
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                  role="status"
                  aria-live="polite"
                >
                  {overall === "healthy" ? (
                    <CheckCircle2 size={20} style={{ color: "var(--green)" }} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={20} style={{ color: "var(--red)" }} aria-hidden="true" />
                  )}
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: overall === "healthy" ? "var(--green)" : "var(--red)",
                    }}
                  >
                    {overall === undefined ? t("state.loading") : t(STATUS_LABEL_KEY[overall])}
                  </span>
                </div>

                <p className="health-remediation" data-tone={remediationTone}>
                  {overall === "healthy" ? (
                    <CheckCircle2 size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                  ) : (
                    <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                  )}
                  <span>
                    <strong style={{ display: "block", marginBottom: 2 }}>
                      {t("health.remediation")}
                    </strong>
                    {t(remediationKey)}
                  </span>
                </p>
              </Stack>
            </CardBody>
          </Card>

          <div className="health-grid">
            <Card>
              <CardHeader title={t("health.storage")} icon={<Database size={15} />} />
              <CardBody>
                <Fact
                  label={t("health.database")}
                  value={health.database_healthy ? t("health.connected") : t("health.disconnected")}
                  tone={health.database_healthy ? "ok" : "danger"}
                />
                <Fact
                  label={t("health.redis")}
                  value={health.redis_healthy ? t("health.connected") : t("health.disconnected")}
                  tone={health.redis_healthy ? "ok" : "danger"}
                />
                {probeQuery.data?.migrations ? (
                  <Fact
                    label="migrations"
                    value={probeQuery.data.migrations}
                    tone={probeQuery.data.migrations === "applied" ? "ok" : "danger"}
                  />
                ) : null}
                <Fact
                  label={t("health.readinessProbe")}
                  value={
                    probeQuery.isPending
                      ? t("state.loading")
                      : probeQuery.isError
                        ? t("state.offline")
                        : probeQuery.data?.ready
                          ? t("health.readinessReady")
                          : t("health.readinessNotReady", {
                              reason: probeQuery.data?.reason ?? "unknown",
                            })
                  }
                  tone={
                    probeQuery.isPending || probeQuery.isError
                      ? undefined
                      : probeQuery.data?.ready
                        ? "ok"
                        : "danger"
                  }
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t("health.process")} icon={<Cpu size={15} />} />
              <CardBody>
                <Fact label={t("health.uptime")} value={formatUptime(health.uptime_seconds)} />
                <Fact label={t("health.pid")} value={health.pid} />
                <Fact label={t("health.platform")} value={health.platform} />
                <Fact label={t("health.cpuCores")} value={health.cpu_cores} />
                <Fact
                  label="CPU"
                  value={`${formatNumber(health.cpu_percent, undefined)}%`}
                  tone={health.cpu_percent > 90 ? "danger" : undefined}
                />
                <Fact
                  label={t("health.memory")}
                  value={`${formatBytes(health.memory_bytes)} · ${formatNumber(health.memory_percent)}%`}
                  tone={health.memory_percent > 90 ? "danger" : undefined}
                />
                {/* The contract publishes this "so the figure is checkable": a
                    percentage with no visible denominator cannot be verified,
                    and the ceiling is the number that decides when the process
                    gets killed. */}
                <Fact
                  label={t("health.memoryLimit")}
                  value={formatBytes(health.memory_limit_bytes)}
                />
                <Fact label="heap" value={formatBytes(health.heap_used_bytes)} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t("health.gateway")} icon={<Server size={15} />} />
              <CardBody>
                <Fact label={t("health.version")} value={health.version} />
                <Fact label={t("health.requests")} value={formatNumber(health.request_count)} />
                <Fact
                  label={t("health.errors")}
                  value={formatNumber(health.error_count)}
                  tone={health.error_count > 0 ? "danger" : undefined}
                />
                <Fact
                  label={t("health.latency")}
                  value={formatDuration(health.latency_avg_ms)}
                />
                <Fact
                  label={t("health.latencyP95")}
                  value={formatDuration(health.latency_p95_ms)}
                />
                <Fact
                  label={t("health.cacheHit")}
                  value={`${formatNumber(health.cache_hit_rate_percent)}%`}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t("health.runtime")} icon={<Activity size={15} />} />
              <CardBody>
                <Fact
                  label={t("health.tokensPerSec")}
                  value={formatNumber(health.avg_tokens_per_sec)}
                />
                <Fact label="p99" value={formatDuration(health.latency_p99_ms)} />
                <Fact label="heap total" value={formatBytes(health.heap_total_bytes)} />
                <Fact label="external" value={formatBytes(health.external_bytes)} />
              </CardBody>
            </Card>

            {/* The one figure on this page that is a stream rather than a poll.
                Everything above is a snapshot taken up to five seconds ago; this
                arrives as it changes, which is what "is traffic flowing right
                now" actually needs. The dot says whether the stream is
                connected, so a stalled feed is visible rather than looking like
                a quiet gateway. */}
            <Card>
              <CardHeader
                title={t("health.traffic")}
                icon={<Activity size={15} />}
                action={
                  <span className={`health-live${inFlight.live ? " is-live" : ""}`}>
                    <span className="health-live-dot" aria-hidden="true" />
                    {inFlight.live ? t("health.live") : t("health.connecting")}
                  </span>
                }
              />
              <CardBody>
                <Fact
                  label={t("health.inFlight")}
                  value={inFlight.count === null ? "—" : formatNumber(inFlight.count)}
                  tone={inFlight.count ? "ok" : undefined}
                />
                <Fact
                  label={t("health.uniqueIps")}
                  value={inFlight.uniqueIps === null ? "—" : formatNumber(inFlight.uniqueIps)}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={t("health.connectivity")} icon={<Wifi size={15} />} />
            <CardBody>
              <Stack gap="8px">
                <Fact label={t("health.readinessProbe")} value="/health/ready" />
                <Fact label="console health" value="/console/api/system/health" />
                <Fact label="metrics" value="/metrics" />
              </Stack>
            </CardBody>
          </Card>
        </Stack>
      )}
    </div>
  );
}
