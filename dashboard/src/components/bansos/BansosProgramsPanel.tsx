/**
 * Bansos program list.
 *
 * The operator's entry point: every program with the numbers that matter at a
 * glance — participants, subsidized models, live keys — and the switch that
 * takes one offline. Selecting a program opens its detail view.
 *
 * The list is a real route parameter rather than local state so an operator
 * can link a colleague straight to the program under discussion, and a reload
 * lands where it left off.
 */
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Gift, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";
import { Badge } from "../ui/badge";
import { EmptyState, ErrorState, LoadingState } from "../ui/state";
import { StatCard } from "../ui/layout";
import { useBansosPrograms, useUpdateBansosProgram } from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";

export function BansosProgramsPanel({ onCreate }: { onCreate: () => void }): ReactNode {
  const t = useT();
  const programs = useBansosPrograms();
  const update = useUpdateBansosProgram();

  if (programs.isPending) return <LoadingState label={t("bansos.programs")} compact />;
  if (programs.isError) {
    return (
      <ErrorState
        title={t("bansos.programs")}
        message={programs.error.message}
        onRetry={() => void programs.refetch()}
        retrying={programs.isFetching}
        compact
      />
    );
  }

  if (programs.data.length === 0) {
    return (
      <EmptyState
        title={t("bansos.programsEmpty")}
        message={t("bansos.programsEmptyHint")}
        icon={<Gift size={20} />}
        action={
          <Button variant="primary" icon={<Plus size={16} />} onClick={onCreate}>
            {t("bansos.newProgram")}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="page-toolbar-sticky">
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={onCreate}>
          {t("bansos.newProgram")}
        </Button>
      </div>
      <div className="provider-grid">
      {programs.data.map((program) => (
        <Card key={program.id} glass interactive>
          <CardHeader
            title={program.name}
            subtitle={program.slug}
            icon={<Gift size={18} />}
            action={
              <Badge tone={program.enabled ? "ok" : "err"}>
                {program.enabled ? t("bansos.programEnabled") : t("bansos.status.suspended")}
              </Badge>
            }
          />
          <CardBody>
            {program.description ? <p className="text-secondary">{program.description}</p> : null}
            <div className="two-column-grid">
              <StatCard
                label={t("bansos.maxKeysPerParticipant")}
                value={String(program.maxKeysPerParticipant)}
                detail={t("bansos.keys")}
                tone="teal"
              />
              <StatCard
                label={t("bansos.globalRpm")}
                value={program.globalRpm === null ? t("bansos.unlimited") : String(program.globalRpm)}
                detail={t("bansos.rpm")}
                tone="purple"
              />
            </div>
            <div className="row-actions">
              <Link to={`/bansos/${encodeURIComponent(program.id)}`}>
                <Button variant="secondary" size="sm">
                  {t("bansos.participants")}
                </Button>
              </Link>
              <Button
                variant={program.enabled ? "danger" : "secondary"}
                size="sm"
                loading={update.isPending}
                onClick={() =>
                  update.mutate({
                    programId: program.id,
                    input: { enabled: !program.enabled },
                  })
                }
              >
                {program.enabled ? t("bansos.keyRevoke") : t("bansos.programEnabled")}
              </Button>
            </div>
          </CardBody>
        </Card>
      ))}
      </div>
    </>
  );
}
