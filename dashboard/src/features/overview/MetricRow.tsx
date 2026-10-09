/**
 * The six operational figures on the Ringkasan page.
 *
 * ── Why a dedicated component instead of six inline cards ───────────────────
 * The reference design places six comparable metrics in one row, and their
 * value comes from being read together: an operator scanning the row learns
 * whether the gateway is healthy, how much work it has done, and what that
 * work cost. Six separately written cards drift — one grows a trend line,
 * another changes its label size — and the row stops reading as a set.
 *
 * ── Data honesty ────────────────────────────────────────────────────────────
 * Every value here is either measured or explicitly unavailable. A metric the
 * backend cannot answer renders `—` with the reason, never `0`, because a zero
 * an operator cannot distinguish from "not measured" is worse than a blank.
 *
 * No card shows a trend. `UsageSummaryTotals` carries no previous-window
 * figure, so a percentage change would have to be invented; the reference
 * design shows deltas because it was drawn against data that had them.
 */
import {
  Activity,
  Boxes,
  Coins,
  Database,
  DollarSign,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../shared/locale-context";
import { formatNumber, formatTokens } from "../../shared/format";
import type { UsageSummaryResponse } from "../../data/contracts";

/** Which metric a card presents. Drives icon, label and value formatting. */
export type MetricKind =
  | "gatewayStatus"
  | "activeProviders"
  | "requests"
  | "tokens"
  | "latency"
  | "cost";

interface MetricCardProps {
  readonly kind: MetricKind;
  /** Primary value, already formatted. `null` renders the unavailable state. */
  readonly value: string | null;
  /** Context line under the value. */
  readonly detail: ReactNode;
  /** Why the value is unavailable; shown instead of a fabricated number. */
  readonly unavailableReason?: string;
  /** Small status dot beside the label, for cards that carry health. */
  readonly tone?: "neutral" | "positive" | "warning" | "danger";
  readonly icon?: LucideIcon;
}

const ICONS: Readonly<Record<MetricKind, LucideIcon>> = {
  gatewayStatus: Activity,
  activeProviders: Boxes,
  requests: Database,
  tokens: Gauge,
  latency: Activity,
  cost: DollarSign,
};

const LABEL_KEYS: Readonly<Record<MetricKind, string>> = {
  gatewayStatus: "overview.metric.gatewayStatus",
  activeProviders: "overview.metric.activeProviders",
  requests: "overview.metric.requests",
  tokens: "overview.metric.tokens",
  latency: "overview.metric.latency",
  cost: "overview.metric.cost",
};

const TONE_COLOR: Readonly<Record<string, string>> = {
  neutral: "var(--text-tertiary)",
  positive: "var(--status-success)",
  warning: "var(--status-warning)",
  danger: "var(--status-danger)",
};

/**
 * One metric card.
 *
 * The trend arrow is rendered only when `deltaPct` is a number. A missing
 * comparison shows nothing rather than a zero, so "no change" and "not
 * measured" never look alike.
 */
function MetricCard({
  kind,
  value,
  detail,
  unavailableReason,
  tone = "neutral",
  icon,
}: MetricCardProps): ReactNode {
  const t = useT();
  const Icon = icon ?? ICONS[kind];
  const unavailable = value === null;

  return (
    <article className="cl-metric" data-kind={kind}>
      <span className="cl-metric__icon" style={{ color: TONE_COLOR[tone] }} aria-hidden="true">
        <Icon size={16} strokeWidth={1.9} />
      </span>

      <div className="cl-metric__body">
        <p className="cl-metric__label">{t(LABEL_KEYS[kind] as never)}</p>

        {unavailable ? (
          <p className="cl-metric__value cl-metric__value--empty" title={unavailableReason}>
            <span aria-hidden="true">—</span>
            <span className="cl-visually-hidden">{unavailableReason ?? t("common.unavailable" as never)}</span>
          </p>
        ) : (
          <p className="cl-metric__value">{value}</p>
        )}

        <p className="cl-metric__detail">{detail}</p>
      </div>
    </article>
  );
}

/** Inputs the Ringkasan page already loads; nothing here fetches on its own. */
export interface MetricRowProps {
  readonly summary: UsageSummaryResponse | undefined;
  readonly summaryPending: boolean;
  /** Providers that are enabled and have at least one usable account. */
  readonly activeProviders: number | null;
  readonly totalProviders: number | null;
  /** Readiness verdict from `/health/ready`, or `null` while unknown. */
  readonly ready: boolean | null;
  readonly checking: boolean;
  /** Completed setup steps, when the readiness panel has them. */
  readonly setupSteps?: { readonly done: number; readonly total: number } | undefined;
}

/**
 * The metric row.
 *
 * Each card states the window its number covers, because "12.4K requests"
 * without a period is not a fact an operator can act on.
 */
export function MetricRow({
  summary,
  summaryPending,
  activeProviders,
  totalProviders,
  ready,
  checking,
  setupSteps,
}: MetricRowProps): ReactNode {
  const t = useT();
  const totals = summary?.totals;

  const gatewayTone = checking ? "neutral" : ready === true ? "positive" : ready === false ? "danger" : "neutral";
  const gatewayValue = checking
    ? t("overview.metric.checking" as never)
    : ready === true
      ? t("overview.metric.ready" as never)
      : ready === false
        ? t("overview.metric.notReady" as never)
        : null;

  return (
    <div className="cl-metric-row" role="list">
      <div role="listitem">
        <MetricCard
          kind="gatewayStatus"
          value={gatewayValue}
          tone={gatewayTone}
          unavailableReason={t("overview.metric.statusUnknown" as never)}
          detail={
            setupSteps === undefined
              ? t("overview.metric.noSetupData" as never)
              : t("overview.metric.setupSteps" as never)
                  .replace("{done}", String(setupSteps.done))
                  .replace("{total}", String(setupSteps.total))
          }
        />
      </div>

      <div role="listitem">
        <MetricCard
          kind="activeProviders"
          value={
            activeProviders === null || totalProviders === null
              ? null
              : `${formatNumber(activeProviders)} / ${formatNumber(totalProviders)}`
          }
          unavailableReason={t("overview.metric.providersUnknown" as never)}
          detail={
            activeProviders === null
              ? t("common.unavailable" as never)
              : t("overview.metric.providersConnected" as never).replace(
                  "{count}",
                  String(activeProviders),
                )
          }
        />
      </div>

      <div role="listitem">
        <MetricCard
          kind="requests"
          value={summaryPending ? null : formatNumber(totals?.requests ?? 0)}
          unavailableReason={t("overview.metric.loading" as never)}
          detail={t("overview.metric.last24h" as never)}
        />
      </div>

      <div role="listitem">
        <MetricCard
          kind="tokens"
          value={
            summaryPending
              ? null
              : formatTokens((totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0))
          }
          unavailableReason={t("overview.metric.loading" as never)}
          detail={t("overview.metric.last24h" as never)}
        />
      </div>

      <div role="listitem">
        <MetricCard
          kind="latency"
          value={
            summaryPending || totals === undefined || totals.requests === 0
              ? null
              : `${formatNumber(Math.round(totals.avgDurationMs))} ms`
          }
          // A latency of zero across zero requests is not a measurement.
          unavailableReason={
            summaryPending
              ? t("overview.metric.loading" as never)
              : t("overview.metric.noRequests" as never)
          }
          detail={t("overview.metric.requestDuration" as never)}
        />
      </div>

      <div role="listitem">
        <MetricCard
          kind="cost"
          value={
            summaryPending || totals === undefined || totals.estimatedCostUsd === 0
              ? null
              : `$${(totals.estimatedCostUsd ?? 0).toFixed(2)}`
          }
          // Zero cost is either "nothing ran" or "no pricing for these models";
          // the API cannot tell them apart, so the card does not claim $0.00.
          unavailableReason={
            summaryPending
              ? t("overview.metric.loading" as never)
              : t("overview.metric.noCostData" as never)
          }
          detail={t("overview.metric.last24h" as never)}
          icon={Coins}
        />
      </div>
    </div>
  );
}
