/**
 * The right-hand operational panels: provider status, model/routing summary,
 * and the recent-request table.
 *
 * ── Field discipline ────────────────────────────────────────────────────────
 * The reference design's tables carry columns this gateway does not record at
 * that grain. Every cell here maps to a field that exists on the row
 * (`UsageRequestItem`, `ProviderResponse`); where the reference shows something
 * unavailable — a per-request cost the upstream never billed, a provider
 * latency that was not probed — the cell states that rather than showing a
 * dash an operator would read as zero.
 */
import { ArrowRight, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/state";
import { useT } from "../../shared/locale-context";
import { formatDuration, formatNumber, formatTokens } from "../../shared/format";
import type { ProviderResponse, UsageRequestsResponse } from "../../data/contracts";

/** Time-of-day for a timestamp, in the browser's own locale and zone. */
function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Maps an HTTP status onto the pill tone. Absent status is not a failure. */
function statusTone(httpStatus: number | undefined, status: string): "positive" | "danger" | "warning" | "neutral" {
  if (httpStatus === undefined) return status === "error" ? "danger" : "neutral";
  if (httpStatus >= 500) return "danger";
  if (httpStatus >= 400) return "warning";
  return "positive";
}

/* ── Provider status ─────────────────────────────────────────────────────── */

export interface ProviderStatusPanelProps {
  readonly providers: readonly ProviderResponse[] | undefined;
  readonly pending: boolean;
  readonly error: boolean;
}

/**
 * Lists configured providers with their real state.
 *
 * Only providers that can serve appear: the built-in catalog is large, and a
 * list of forty-five unconfigured entries would bury the one that is working.
 */
export function ProviderStatusPanel({
  providers,
  pending,
  error,
}: ProviderStatusPanelProps): ReactNode {
  const t = useT();

  const configured = providers?.filter(
    (provider) => provider.enabled && (provider.configured === true || !provider.requiresAccount),
  );

  return (
    <Card glass>
      <CardHeader
        title={t("overview.providers.title" as never)}
        action={
          <Link to="/providers" className="cl-link-action">
            {t("overview.providers.manage" as never)}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        }
      />
      <CardBody>
        {pending ? <LoadingState label={t("overview.providers.loading" as never)} compact /> : null}
        {error ? (
          <ErrorState
            title={t("overview.providers.title" as never)}
            message={t("overview.activity.errorBody" as never)}
            compact
          />
        ) : null}
        {!pending && !error && (configured?.length ?? 0) === 0 ? (
          <EmptyState
            title={t("overview.providers.empty" as never)}
            message={t("overview.providers.emptyBody" as never)}
            compact
          />
        ) : null}
        {!pending && !error && (configured?.length ?? 0) > 0 ? (
          <ul className="cl-provider-list">
            {configured?.map((provider) => (
              <li key={provider.providerId} className="cl-provider-row">
                <span className="cl-provider-row__name">{provider.displayName}</span>
                <span className="cl-pill" data-tone="positive">
                  {t("overview.providers.connected" as never)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ── Model & routing summary ─────────────────────────────────────────────── */

export interface RoutingSummaryProps {
  /**
   * Routable models. Optional because this page has no hook that reports it —
   * the Models page owns that count — and a summary that shows a number it
   * cannot source is worse than one that omits the row.
   */
  readonly modelCount?: number | undefined;
  readonly routeCount: number | undefined;
  readonly keyCount: number | undefined;
  readonly pending: boolean;
}

export function RoutingSummary({
  modelCount,
  routeCount,
  keyCount,
  pending,
}: RoutingSummaryProps): ReactNode {
  const t = useT();

  const value = (n: number | undefined): string =>
    pending || n === undefined ? "—" : formatNumber(n);

  return (
    <Card glass>
      <CardHeader
        title={t("overview.routing.title" as never)}
        action={
          <Link to="/models" className="cl-link-action">
            {t("overview.routing.all" as never)}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        }
      />
      <CardBody>
        <dl className="cl-summary-list">
          {modelCount !== undefined ? (
            <div className="cl-summary-row">
              <dt>{t("overview.routing.models" as never)}</dt>
              <dd>{value(modelCount)}</dd>
            </div>
          ) : null}
          <div className="cl-summary-row">
            <dt>{t("overview.routing.routes" as never)}</dt>
            <dd>{value(routeCount)}</dd>
          </div>
          <div className="cl-summary-row">
            <dt>{t("overview.routing.keys" as never)}</dt>
            <dd>{value(keyCount)}</dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

/* ── Recent requests ─────────────────────────────────────────────────────── */

export interface RecentRequestsPanelProps {
  readonly requests: UsageRequestsResponse | undefined;
  readonly pending: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}

/**
 * The most recent requests, newest first.
 *
 * The table scrolls horizontally rather than dropping columns on narrow
 * screens: every column here is one an operator needs when diagnosing a
 * failure, and a hidden column is a silent lie about what was recorded.
 */
export function RecentRequestsPanel({
  requests,
  pending,
  error,
  onRetry,
}: RecentRequestsPanelProps): ReactNode {
  const t = useT();
  const items = requests?.items ?? [];

  return (
    <Card glass>
      <CardHeader
        title={t("overview.requests.title" as never)}
        action={
          <Link to="/console-log" className="cl-link-action">
            {t("overview.requests.all" as never)}
            <ExternalLink size={13} aria-hidden="true" />
          </Link>
        }
      />
      <CardBody>
        {pending ? <LoadingState label={t("overview.requests.loading" as never)} compact /> : null}
        {error ? (
          <ErrorState
            title={t("overview.requests.title" as never)}
            message={t("overview.activity.errorBody" as never)}
            onRetry={onRetry}
            compact
          />
        ) : null}
        {!pending && !error && items.length === 0 ? (
          <EmptyState
            title={t("overview.requests.empty" as never)}
            message={t("overview.requests.emptyBody" as never)}
            compact
          />
        ) : null}
        {!pending && !error && items.length > 0 ? (
          <>
            {/* Desktop: the full table. Six columns of `nowrap` cells cannot fit
                a phone, and shrinking them would truncate the model id — the one
                value an operator is usually here to read. */}
            <div className="cl-req-table__scroll">
              <table className="cl-req-table">
                <thead>
                  <tr>
                    <th scope="col">{t("overview.column.time" as never)}</th>
                    <th scope="col">{t("overview.column.provider" as never)}</th>
                    <th scope="col">{t("overview.column.model" as never)}</th>
                    <th scope="col">{t("overview.column.tokens" as never)}</th>
                    <th scope="col">{t("overview.column.latency" as never)}</th>
                    <th scope="col">{t("overview.column.status" as never)}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const tokens =
                      item.totalTokens ?? (item.inputTokens ?? 0) + (item.outputTokens ?? 0);
                    const tone = statusTone(item.httpStatus, item.status);
                    return (
                      <tr key={item.requestId}>
                        <td>{timeOfDay(item.startedAt)}</td>
                        <td>{item.providerId ?? "—"}</td>
                        {/* Full value in `title`: the cell truncates visually but
                            the identifier stays recoverable. */}
                        <td title={item.model ?? undefined}>{item.model ?? "—"}</td>
                        <td>{tokens > 0 ? formatTokens(tokens) : "—"}</td>
                        <td>{item.durationMs === undefined ? "—" : formatDuration(item.durationMs)}</td>
                        <td>
                          <span className="cl-pill" data-tone={tone}>
                            {item.httpStatus ?? item.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Phone: one card per request. Same rows, same values, laid out
                instead of clipped — a horizontally scrolled table reads as a
                table that lost its right-hand columns. */}
            <ul className="cl-req-cards">
              {items.map((item) => {
                const tokens =
                  item.totalTokens ?? (item.inputTokens ?? 0) + (item.outputTokens ?? 0);
                const tone = statusTone(item.httpStatus, item.status);
                return (
                  <li key={item.requestId} className="cl-req-card">
                    <div className="cl-req-card__head">
                      <span className="cl-req-card__model" title={item.model ?? undefined}>
                        {item.model ?? "—"}
                      </span>
                      <span className="cl-pill" data-tone={tone}>
                        {item.httpStatus ?? item.status}
                      </span>
                    </div>
                    <dl className="cl-req-card__meta">
                      <div>
                        <dt>{t("overview.column.time" as never)}</dt>
                        <dd>{timeOfDay(item.startedAt)}</dd>
                      </div>
                      <div>
                        <dt>{t("overview.column.provider" as never)}</dt>
                        <dd>{item.providerId ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>{t("overview.column.tokens" as never)}</dt>
                        <dd>{tokens > 0 ? formatTokens(tokens) : "—"}</dd>
                      </div>
                      <div>
                        <dt>{t("overview.column.latency" as never)}</dt>
                        <dd>
                          {item.durationMs === undefined ? "—" : formatDuration(item.durationMs)}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
