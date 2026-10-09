/**
 * Bansos participant table with the actions an operator actually takes.
 *
 * Suspension is the interesting column. The brief's rule is that it must take
 * effect server-side, including for keys already issued — so the UI says so
 * where the operator is about to click it, rather than letting them believe
 * suspension is a cosmetic label.
 */
import { type ReactNode, useState } from "react";
import { KeyRound, UserPlus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/state";
import { DataTable } from "../ui/layout";
import { Dialog } from "../ui/dialog";
import { ConfirmDialog } from "../ConfirmDialog";
import {
  useBansosParticipants,
  useDeleteBansosParticipant,
  useUpdateBansosParticipant,
} from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";
import { formatNumber } from "../../shared/format";
import { BansosParticipantDialog } from "./BansosParticipantDialog";
import { BansosKeysPanel } from "./BansosKeysPanel";
import type {
  BansosParticipant,
  BansosParticipantStatus,
} from "../../data/bansos-contracts";

const STATUS_TONE: Readonly<Record<BansosParticipantStatus, "ok" | "warn" | "err" | "disabled">> = {
  active: "ok",
  pending: "warn",
  suspended: "err",
  revoked: "disabled",
};

/**
 * Message keys per status, spelled out rather than built from a template
 * string: `MessageKey` is a union of literals, so `t(\`bansos.status.${...}\`)`
 * would typecheck only if every interpolation were itself a literal. Naming
 * each key keeps a renamed status a compile error instead of a blank label.
 */
const STATUS_KEY = {
  active: "bansos.status.active",
  suspended: "bansos.status.suspended",
  revoked: "bansos.status.revoked",
  pending: "bansos.status.pending",
} as const satisfies Readonly<Record<BansosParticipantStatus, string>>;

export function BansosParticipantsPanel({ programId }: { programId: string }): ReactNode {
  const t = useT();
  const participants = useBansosParticipants(programId);
  const update = useUpdateBansosParticipant();
  const remove = useDeleteBansosParticipant();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [keysFor, setKeysFor] = useState<BansosParticipant | null>(null);

  const rows = participants.data ?? [];

  return (
    <>
      <div className="page-toolbar-sticky">
        <Button variant="primary" size="sm" icon={<UserPlus size={16} />} onClick={() => setCreating(true)}>
          {t("bansos.newParticipant")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t("bansos.participantsEmpty")}
          message={t("bansos.participantsEmptyHint")}
          icon={<UserPlus size={20} />}
          compact
        />
      ) : (
        <DataTable
          headers={[
            t("bansos.participantName"),
            t("bansos.participantStatus"),
            t("bansos.tokenAllowance"),
            t("bansos.rpm"),
            "",
          ]}
        >
          {rows.map((participant) => (
            <tr key={participant.id}>
              <td>
                <div className="account-row-name">{participant.displayName}</div>
                {participant.email ? <div className="account-row-meta">{participant.email}</div> : null}
              </td>
              <td>
                <Badge tone={STATUS_TONE[participant.status]}>
                  {t(STATUS_KEY[participant.status])}
                </Badge>
              </td>
              <td>
                {participant.tokenAllowance === null
                  ? t("bansos.unlimited")
                  : formatNumber(participant.tokenAllowance)}
              </td>
              <td>{participant.rpm === null ? t("bansos.unlimited") : String(participant.rpm)}</td>
              <td>
                <div className="account-row-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<KeyRound size={15} />}
                    onClick={() => setKeysFor(participant)}
                  >
                    {t("bansos.keys")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={update.isPending}
                    onClick={() =>
                      update.mutate({
                        participantId: participant.id,
                        programId,
                        input: {
                          status: participant.status === "active" ? "suspended" : "active",
                        },
                      })
                    }
                  >
                    {participant.status === "active"
                      ? t("bansos.status.suspended")
                      : t("bansos.status.active")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 size={15} />}
                    onClick={() => setPendingDelete(participant.id)}
                  >
                    {t("bansos.delete")}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {creating ? (
        <BansosParticipantDialog programId={programId} onClose={() => setCreating(false)} />
      ) : null}

      {keysFor !== null ? (
        <Dialog
          open
          onClose={() => setKeysFor(null)}
          title={`${t("bansos.keys")} — ${keysFor.displayName}`}
          width={860}
        >
          <BansosKeysPanel participantId={keysFor.id} programId={programId} />
        </Dialog>
      ) : null}

      {pendingDelete !== null ? (
        <ConfirmDialog
          open
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            remove.mutate({ participantId: pendingDelete, programId });
            setPendingDelete(null);
          }}
          title={t("bansos.confirmDelete")}
          message={t("bansos.confirmDeleteHint")}
          confirmLabel={t("bansos.delete")}
          cancelLabel={t("bansos.cancel")}
          danger
        />
      ) : null}
    </>
  );
}
