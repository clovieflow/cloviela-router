/**
 * Create-or-edit dialog for a participant.
 *
 * ── Why the override fields are here ────────────────────────────────────────
 * A participant carries its own allowance, RPM, concurrency, expiry and model
 * allowlist, and each one tightens what the program granted. They were
 * reachable only through the API, which made "give this one person a smaller
 * cap" a curl command instead of a checkbox.
 *
 * ── Why an override cannot widen anything ───────────────────────────────────
 * The resolver takes the strictest value across program, participant and key,
 * so a number entered here that exceeds the program's is accepted and then
 * ignored. The form says so next to the field rather than silently discarding
 * it, because an operator who types 5000 and sees 60 enforced will otherwise
 * believe the gateway is broken.
 */
import { type ReactNode, useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Stack } from "../ui/stack";
import { Select } from "../ui/select";
import { SectionHeading } from "../ui/layout";
import { useCreateBansosParticipant, useUpdateBansosParticipant } from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";
import type { BansosParticipant, BansosParticipantStatus } from "../../data/bansos-contracts";

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function asText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function asLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "12px", fontWeight: 600 }}>{label}</span>
      {children}
      {hint ? (
        <span className="account-row-meta" style={{ display: "block", fontSize: "11px" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const STATUSES: readonly BansosParticipantStatus[] = ["pending", "active", "suspended", "revoked"];

const STATUS_KEY = {
  pending: "bansos.status.pending",
  active: "bansos.status.active",
  suspended: "bansos.status.suspended",
  revoked: "bansos.status.revoked",
} as const;

export function BansosParticipantDialog({
  programId,
  participant,
  onClose,
}: {
  programId: string;
  /** Absent = create. Present = edit that participant. */
  participant?: BansosParticipant;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const create = useCreateBansosParticipant();
  const update = useUpdateBansosParticipant();
  const editing = participant !== undefined;

  const [displayName, setDisplayName] = useState(participant?.displayName ?? "");
  const [email, setEmail] = useState(participant?.email ?? "");
  const [externalRef, setExternalRef] = useState(participant?.externalRef ?? "");
  const [status, setStatus] = useState<BansosParticipantStatus>(participant?.status ?? "active");
  const [adminNotes, setAdminNotes] = useState(participant?.adminNotes ?? "");
  const [tokenAllowance, setTokenAllowance] = useState(asText(participant?.tokenAllowance));
  const [rpm, setRpm] = useState(asText(participant?.rpm));
  const [concurrency, setConcurrency] = useState(asText(participant?.concurrency));
  const [expiresAt, setExpiresAt] = useState(asLocalInput(participant?.expiresAt ?? null));

  const pending = create.isPending || update.isPending;
  const canSubmit = displayName.trim().length > 0 && !pending;
  const error = create.error ?? update.error;

  function submit(): void {
    const input = {
      displayName: displayName.trim(),
      email: email.trim().length > 0 ? email.trim() : null,
      externalRef: externalRef.trim().length > 0 ? externalRef.trim() : null,
      status,
      adminNotes: adminNotes.trim().length > 0 ? adminNotes.trim() : null,
      tokenAllowance: optionalNumber(tokenAllowance),
      rpm: optionalNumber(rpm),
      concurrency: optionalNumber(concurrency),
      expiresAt: fromLocalInput(expiresAt),
    };
    if (editing) {
      update.mutate({ participantId: participant.id, programId, input }, { onSuccess: onClose });
      return;
    }
    create.mutate({ programId, input }, { onSuccess: onClose });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? t("bansos.editParticipant") : t("bansos.newParticipant")}
      width={640}
    >
      <Stack gap="lg">
        <SectionHeading level={3} title={t("bansos.sectionIdentity")} />
        <div className="two-column-grid">
          <Field label={t("bansos.participantName")}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus required />
          </Field>
          <Field label={t("bansos.participantEmail")}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="two-column-grid">
          <Field label={t("bansos.participantStatus")} hint={t("bansos.status.suspendedHint")}>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as BansosParticipantStatus)}
              options={STATUSES.map((entry) => ({ value: entry, label: t(STATUS_KEY[entry]) }))}
            />
          </Field>
          <Field label={t("bansos.externalRef")} hint={t("bansos.externalRefHint")}>
            <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
          </Field>
        </div>
        <Field label={t("bansos.adminNotes")} hint={t("bansos.adminNotesHint")}>
          <Input value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
        </Field>

        <SectionHeading
          level={3}
          title={t("bansos.sectionParticipantLimits")}
          description={t("bansos.participantLimitsHint")}
        />
        <div className="two-column-grid">
          <Field label={t("bansos.tokenAllowance")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={tokenAllowance} onChange={(e) => setTokenAllowance(e.target.value)} />
          </Field>
          <Field label={t("bansos.expiresAt")} hint={t("bansos.expiresAtHint")}>
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
          <Field label={t("bansos.rpm")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={rpm} onChange={(e) => setRpm(e.target.value)} />
          </Field>
          <Field label={t("bansos.concurrency")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
          </Field>
        </div>

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
