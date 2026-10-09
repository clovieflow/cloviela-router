/**
 * One program, in full: its settings, the people on it, the models it pays
 * for, what they have spent, and every change made to any of it.
 *
 * ── Why a tab strip instead of one long page ────────────────────────────────
 * Participants, models and usage are separate jobs an operator does at
 * different times; stacking them would bury the participant table — the thing
 * reached for most — under the audit log. The tabs are ordinary buttons with
 * `aria-selected` so a keyboard reaches every panel in order.
 */
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Gift } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";
import { ErrorState, LoadingState } from "../ui/state";
import { StatCard } from "../ui/layout";
import { BansosParticipantsPanel } from "./BansosParticipantsPanel";
import { BansosModelsPanel } from "./BansosModelsPanel";
import { BansosUsagePanel } from "./BansosUsagePanel";
import { BansosProgramDialog } from "./BansosProgramDialog";
import { useBansosProgram } from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";
import { formatNumber } from "../../shared/format";

type Tab = "participants" | "models" | "usage";

export function BansosProgramDetail({ programId }: { programId: string }): ReactNode {
  const t = useT();
  const program = useBansosProgram(programId);
  const [tab, setTab] = useState<Tab>("participants");
  const [editing, setEditing] = useState(false);

  if (program.isPending) return <LoadingState label={t("bansos.title")} compact />;
  if (program.isError) {
    return (
      <ErrorState
        title={t("bansos.title")}
        message={program.error.message}
        onRetry={() => void program.refetch()}
        retrying={program.isFetching}
        compact
      />
    );
  }

  const data = program.data;
  const tabs: readonly { id: Tab; label: string }[] = [
    { id: "participants", label: t("bansos.participants") },
    { id: "models", label: t("bansos.models") },
    { id: "usage", label: t("bansos.usage") },
  ];

  return (
    <>
      <div className="page-toolbar-sticky">
        <Link to="/bansos">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />}>
            {t("bansos.programs")}
          </Button>
        </Link>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          {t("bansos.edit")}
        </Button>
      </div>

      <Card glass>
        <CardHeader
          title={data.name}
          subtitle={data.slug}
          icon={<Gift size={18} />}
          action={
            <Badge tone={data.enabled ? "ok" : "err"}>
              {data.enabled ? t("bansos.programEnabled") : t("bansos.status.suspended")}
            </Badge>
          }
        />
        <CardBody>
          {data.description ? <p>{data.description}</p> : null}
          <div className="metric-grid">
            <StatCard
              label={t("bansos.maxKeysPerParticipant")}
              value={String(data.maxKeysPerParticipant)}
              detail={t("bansos.keys")}
              tone="teal"
            />
            <StatCard
              label={t("bansos.globalRpm")}
              value={data.globalRpm === null ? t("bansos.unlimited") : String(data.globalRpm)}
              detail={t("bansos.rpm")}
              tone="purple"
            />
            <StatCard
              label={t("bansos.globalConcurrency")}
              value={
                data.globalConcurrency === null ? t("bansos.unlimited") : String(data.globalConcurrency)
              }
              detail={t("bansos.concurrency")}
              tone="green"
            />
            <StatCard
              label={t("bansos.defaultTokenAllowance")}
              value={
                data.defaultTokenAllowance === null
                  ? t("bansos.unlimited")
                  : formatNumber(data.defaultTokenAllowance)
              }
              detail={t("bansos.tokenAllowance")}
              tone="orange"
            />
          </div>
          <dl className="about-facts">
            <div className="about-fact">
              <dt className="about-fact-label">{t("bansos.enrollmentMode")}</dt>
              <dd className="about-fact-value">{t(ENROLLMENT_KEY[data.enrollmentMode])}</dd>
            </div>
            <div className="about-fact">
              <dt className="about-fact-label">{t("bansos.providerScope")}</dt>
              <dd className="about-fact-value">
                {data.providerId === null ? t("bansos.providerAny") : data.providerId}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <div role="tablist" className="page-toolbar-sticky">
        {tabs.map((entry) => (
          <Button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            variant={tab === entry.id ? "primary" : "secondary"}
            size="sm"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      {tab === "participants" ? <BansosParticipantsPanel programId={programId} /> : null}
      {tab === "models" ? <BansosModelsPanel programId={programId} /> : null}
      {tab === "usage" ? <BansosUsagePanel programId={programId} /> : null}

      {editing ? (
        <BansosProgramDialog program={data} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}

/**
 * Enrollment modes are a closed set, so the label lookup is a map rather than
 * an interpolated key: `MessageKey` is a union of literals and a template
 * string would widen it away.
 */
const ENROLLMENT_KEY = {
  closed: "bansos.enrollment.closed",
  invite: "bansos.enrollment.invite",
  request: "bansos.enrollment.request",
  open: "bansos.enrollment.open",
} as const;
