/**
 * Request activity for the Ringkasan page.
 *
 * ── Bar chart, not an area chart ────────────────────────────────────────────
 * The Usage page uses an area chart because it reads a continuous trend across
 * a long window. Here the question is different — how many requests landed in
 * each interval — and that is a count per bucket, which bars answer without
 * implying a value between two samples that was never measured.
 *
 * ── What this chart does not show, and why ──────────────────────────────────
 * The reference design splits each bar into succeeded and failed. The API
 * cannot support that split: `UsageChartBucket` carries `requests`, `input`,
 * `cached` and `output` and nothing else. `UsageSummaryTotals` does count
 * errors, but only for the whole window, not per interval — so a failed
 * segment here would have to be invented, and a chart that invents its data is
 * worse than one that shows less. The window's error count is stated in the
 * panel header instead, where it is a real number.
 */
import { useMemo, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useT } from "../../shared/locale-context";
import { formatChartTick, formatChartTooltip, formatNumber } from "../../shared/format";
import { useReducedMotion } from "../../hooks/use-reduced-motion";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/state";
import type { UsageChartResponse } from "../../data/contracts";

export interface RequestActivityProps {
  readonly chart: UsageChartResponse | undefined;
  readonly pending: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  /** Failed requests over the whole window; `undefined` while unknown. */
  readonly errorCount: number | undefined;
}

/**
 * Buckets with no traffic still carry a zero, so the axis keeps its shape and
 * a quiet hour reads as quiet rather than as missing data.
 */
export function RequestActivity({
  chart,
  pending,
  error,
  onRetry,
  errorCount,
}: RequestActivityProps): ReactNode {
  const t = useT();
  const reducedMotion = useReducedMotion();

  const buckets = useMemo(() => chart?.buckets ?? [], [chart]);

  if (pending) return <LoadingState label={t("overview.activity.loading" as never)} />;
  if (error) {
    return (
      <ErrorState
        title={t("overview.activity.errorTitle" as never)}
        message={t("overview.activity.errorBody" as never)}
        onRetry={onRetry}
      />
    );
  }

  const totalRequests = buckets.reduce((sum, bucket) => sum + bucket.requests, 0);
  if (buckets.length === 0 || totalRequests === 0) {
    return (
      <EmptyState
        title={t("overview.activity.emptyTitle" as never)}
        message={t("overview.activity.emptyBody" as never)}
      />
    );
  }

  return (
    <>
      {errorCount !== undefined && errorCount > 0 ? (
        <p className="cl-activity__note">
          {t("overview.activity.failedNote" as never).replace("{count}", formatNumber(errorCount))}
        </p>
      ) : null}
      <div className="cl-activity__plot">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="var(--inner-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
              tickFormatter={(value: string) => formatChartTick(value)}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => formatNumber(value)}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-hover)", opacity: 0.4 }}
              contentStyle={{
                background: "var(--surface-2)",
                border: "1px solid var(--inner-border)",
                borderRadius: 12,
                fontSize: 12,
                color: "var(--text-primary)",
              }}
              formatter={(value) => [
                formatNumber(Number(value)),
                t("overview.activity.requests" as never),
              ]}
              labelFormatter={(label) => formatChartTooltip(String(label))}
            />
            <Bar
              dataKey="requests"
              fill="var(--accent)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reducedMotion}
              animationDuration={220}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
