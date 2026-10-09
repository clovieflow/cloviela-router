/**
 * Create-or-edit dialog for a program.
 *
 * One component serves both because the fields are the same; only the verb
 * differs. In edit mode the slug is read-only: it is the program's stable
 * identifier in URLs and in anything an operator has already written down, so
 * renaming it silently would break links rather than rename a label.
 */
import { type ReactNode, useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Stack } from "../ui/stack";
import { useCreateBansosProgram, useUpdateBansosProgram } from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";
import type { BansosProgram } from "../../data/bansos-contracts";

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function BansosProgramDialog({
  program,
  onClose,
  onCreated,
}: {
  /** Absent = create. Present = edit that program. */
  program?: BansosProgram;
  onClose: () => void;
  onCreated?: (programId: string) => void;
}): ReactNode {
  const t = useT();
  const create = useCreateBansosProgram();
  const update = useUpdateBansosProgram();
  const editing = program !== undefined;

  const [name, setName] = useState(program?.name ?? "");
  const [slug, setSlug] = useState(program?.slug ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [maxKeys, setMaxKeys] = useState(
    program === undefined ? "" : String(program.maxKeysPerParticipant),
  );
  const [rpm, setRpm] = useState(program?.globalRpm === null || program === undefined ? "" : String(program.globalRpm));
  const [allowance, setAllowance] = useState(
    program?.defaultTokenAllowance === null || program === undefined
      ? ""
      : String(program.defaultTokenAllowance),
  );

  const pending = create.isPending || update.isPending;
  const canSubmit = name.trim().length > 0 && (editing || slug.trim().length > 0) && !pending;
  const error = create.error ?? update.error;

  function submit(): void {
    const input = {
      name: name.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
      globalRpm: optionalNumber(rpm),
      defaultTokenAllowance: optionalNumber(allowance),
      ...(optionalNumber(maxKeys) === null ? {} : { maxKeysPerParticipant: optionalNumber(maxKeys) }),
    };
    if (editing) {
      update.mutate({ programId: program.id, input }, { onSuccess: onClose });
      return;
    }
    create.mutate(
      { ...input, slug: slug.trim() },
      {
        onSuccess: (created) => {
          if (onCreated) onCreated(created.id);
          else onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? t("bansos.edit") : t("bansos.newProgram")}
    >
      <Stack gap="md">
        <label>
          <span>{t("bansos.programName")}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
        </label>
        <label>
          <span>{t("bansos.programSlug")}</span>
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            readOnly={editing}
            required
            pattern="^[a-z0-9][a-z0-9-]*$"
          />
        </label>
        <label>
          <span>{t("bansos.programDescription")}</span>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          <span>{t("bansos.maxKeysPerParticipant")}</span>
          <Input
            inputMode="numeric"
            value={maxKeys}
            onChange={(event) => setMaxKeys(event.target.value)}
          />
        </label>
        <label>
          <span>{t("bansos.globalRpm")}</span>
          <Input inputMode="numeric" value={rpm} onChange={(event) => setRpm(event.target.value)} />
        </label>
        <label>
          <span>{t("bansos.defaultTokenAllowance")}</span>
          <Input
            inputMode="numeric"
            value={allowance}
            onChange={(event) => setAllowance(event.target.value)}
          />
        </label>

        {error ? <p role="alert">{error.message}</p> : null}

        <div className="modal-form-actions">
          <Button variant="secondary" onClick={onClose}>
            {t("bansos.cancel")}
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={pending} onClick={submit}>
            {editing ? t("bansos.save") : t("bansos.create")}
          </Button>
        </div>
      </Stack>
    </Dialog>
  );
}
