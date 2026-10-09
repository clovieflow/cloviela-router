/**
 * Per-participant consumption and the audit trail.
 *
 * ── Why the numbers come from the keys ──────────────────────────────────────
 * `tokensConsumed` is read from the same `lifetime_tokens_consumed` counter the
 * quota check enforces against, so a report can never disagree with the
 * refusal an operator is trying to explain. A request log would be a second
 * source of truth for the same fact.
 *
 * ── Why "remaining" may be absent ───────────────────────────────────────────
 * `null` means no ceiling was ever configured, which is different from zero
 * left. The table renders "unlimited" rather than a full progress bar, because
 * showing 100% used for a participant with no budget would be a lie an
 * operator would act on.
 */
import { type ReactNode } from "react";
import { ScrollText, TrendingUp } from "lucide-react";
import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/state";
import { Card, CardBody, CardHeader } from "../ui/card";
import { DataTable } from "../ui/layout";
import { useBansosAudit, useBansosUsage } from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";
import { formatNumber } from "../../shared/format";

export function BansosUsagePanel({ programId }: { programId: string }): ReactNode {
  const t = useT();
  const usage = useBansosUsage(programId);
  const audit = useBansosAudit(programId);

  return (
    <>
      <Card glass>
        <CardHeader
          title={t("bansos.usage")}
          icon={<TrendingUp size={18} />}
          subtitle={
            usage.data === undefined
              ? undefined
              : `${formatNumber(usage.data.totals.consumed)} / ${formatNumber(usage.data.totals.budget)}`
          }
        />
        <CardBody>
          {usage.data === undefined || usage.data.usage.length === 0 ? (
            <EmptyState
              title={t("bansos.participantsEmpty")}
              message={t("bansos.participantsEmptyHint")}
              icon={<TrendingUp size={20} />}
              compact
            />
          ) : (
            <DataTable
              headers={[
                t("bansos.participantName"),
                t("bansos.usageConsumed"),
                t("bansos.usageRemaining"),
                t("bansos.usageLiveKeys"),
                t("bansos.participantStatus"),
              ]}
            >
              {usage.data.usage.map((row) => (
                <tr key={row.participantId}>
                  <td>
                    <div className="account-row-name">{row.displayName}</div>
                  </td>
                  <td>{formatNumber(row.tokensConsumed)}</td>
                  <td>
                    {row.remaining === null ? t("bansos.unlimited") : formatNumber(row.remaining)}
                  </td>
                  <td>
                    {row.liveKeys}
                    {row.revokedKeys > 0 ? (
                      <span className="account-row-meta"> (+{row.revokedKeys})</span>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={row.status === "active" ? "ok" : "err"}>
                      {row.status === "active"
                        ? t("bansos.status.active")
                        : t("bansos.status.suspended")}
                    </Badge>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card glass>
        <CardHeader title={t("bansos.audit")} icon={<ScrollText size={18} />} />
        <CardBody>
          {audit.data === undefined || audit.data.length === 0 ? (
            <EmptyState
              title={t("bansos.auditEmpty")}
              message={t("bansos.auditEmptyHint")}
              icon={<ScrollText size={20} />}
              compact
            />
          ) : (
            <DataTable
              headers={[t("bansos.auditAction"), t("bansos.auditActor"), t("bansos.auditWhen")]}
            >
              {audit.data.map((event) => (
                <tr key={event.id}>
                  <td>
                    <code>{event.action}</code>
                  </td>
                  <td>
                    <Badge tone={event.actorKind === "admin" ? "accent" : "default"}>
                      {event.actorKind}
                    </Badge>
                  </td>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </CardBody>
      </Card>
    </>
  );
}
