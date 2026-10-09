/**
 * Create-participant dialog.
 *
 * Only the fields an operator sets when adding someone: who they are, and
 * what they may spend. The allowance is deliberately blank rather than
 * zero-prefilled — `null` means "inherit the program default", and a `0`
 * silently would mean "may spend nothing", which is a different promise.
 */
import { type ReactNode, useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Stack } from "../ui/stack";
import { useCreateBansosParticipant } from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";

/** An empty field means "not configured", never zero. */
function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function BansosParticipantDialog({
  programId,
  onClose,
}: {
  programId: string;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const create = useCreateBansosParticipant();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [allowance, setAllowance] = useState("");
  const [rpm, setRpm] = useState("");

  const canSubmit = displayName.trim().length > 0 && !create.isPending;

  return (
    <Dialog open onClose={onClose} title={t("bansos.newParticipant")}>
      <Stack gap="md">
        <label>
          <span>{t("bansos.participantName")}</span>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoFocus
            required
          />
        </label>
        <label>
          <span>{t("bansos.participantEmail")}</span>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>{t("bansos.tokenAllowance")}</span>
          <Input
            inputMode="numeric"
            value={allowance}
            onChange={(event) => setAllowance(event.target.value)}
            placeholder={t("bansos.unlimited")}
          />
        </label>
        <label>
          <span>{t("bansos.rpm")}</span>
          <Input inputMode="numeric" value={rpm} onChange={(event) => setRpm(event.target.value)} />
        </label>

        {create.isError ? <p role="alert">{create.error.message}</p> : null}

        <div className="modal-form-actions">
          <Button variant="secondary" onClick={onClose}>
            {t("bansos.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={create.isPending}
            onClick={() => {
              create.mutate(
                {
                  programId,
                  input: {
                    displayName: displayName.trim(),
                    email: email.trim().length > 0 ? email.trim() : null,
                    tokenAllowance: optionalNumber(allowance),
                    rpm: optionalNumber(rpm),
                  },
                },
                { onSuccess: onClose },
              );
            }}
          >
            {t("bansos.create")}
          </Button>
        </div>
      </Stack>
    </Dialog>
  );
}
