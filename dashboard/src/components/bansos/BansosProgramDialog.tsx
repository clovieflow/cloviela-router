/**
 * Create-or-edit dialog for a program.
 *
 * ── Why every field is here ─────────────────────────────────────────────────
 * The program row carries thirty columns and the dialog used to expose six.
 * Everything else was reachable only through the API, which means an operator
 * could set a program-wide token budget or a daily ceiling only by writing
 * curl — and a limit nobody can set is a limit that does not exist. The fields
 * are grouped into the four questions an operator actually asks: what is this,
 * who may join, how much may be spent, and when does it run.
 *
 * ── Empty means "not configured", never zero ────────────────────────────────
 * Every numeric field accepts blank, which is sent as `null` — the state the
 * resolver reads as unlimited. A `0` is refused by the API and by the parsing
 * here, because a zero that silently becomes "unlimited" or "nothing" is the
 * one outcome worse than a rejection.
 */
import { type ReactNode, useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Stack } from "../ui/stack";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { SectionHeading } from "../ui/layout";
import { useCreateBansosProgram, useUpdateBansosProgram } from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";
import type { BansosEnrollmentMode, BansosProgram } from "../../data/bansos-contracts";

/** Blank = not configured. Anything else must be a positive whole number. */
function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

/** Renders a stored value into a text field: `null` is an empty box. */
function asText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`; the API wants an ISO string. */
function asLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A local input value back to ISO, or `null` when cleared. */
function fromLocalInput(value: string): string | null {
  if (value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** One labelled field. Keeps the layout consistent without a form library. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactNode {
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

  // ── Identity ──────────────────────────────────────────────────────────────
  const [name, setName] = useState(program?.name ?? "");
  const [slug, setSlug] = useState(program?.slug ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [adminNotes, setAdminNotes] = useState(program?.adminNotes ?? "");
  const [enabled, setEnabled] = useState(program?.enabled ?? true);

  // ── Enrollment ────────────────────────────────────────────────────────────
  const [enrollmentMode, setEnrollmentMode] = useState<BansosEnrollmentMode>(
    program?.enrollmentMode ?? "request",
  );
  const [autoApprove, setAutoApprove] = useState(program?.autoApprove ?? false);
  const [maxParticipants, setMaxParticipants] = useState(asText(program?.maxParticipants));
  const [termsRequired, setTermsRequired] = useState(program?.termsRequired ?? false);
  const [termsText, setTermsText] = useState(program?.termsText ?? "");
  const [maxKeys, setMaxKeys] = useState(asText(program?.maxKeysPerParticipant ?? 3));

  // ── Spending limits ───────────────────────────────────────────────────────
  const [globalTokenBudget, setGlobalTokenBudget] = useState(asText(program?.globalTokenBudget));
  const [dailyTokenBudget, setDailyTokenBudget] = useState(asText(program?.dailyTokenBudget));
  const [monthlyTokenBudget, setMonthlyTokenBudget] = useState(asText(program?.monthlyTokenBudget));
  const [defaultTokenAllowance, setDefaultTokenAllowance] = useState(
    asText(program?.defaultTokenAllowance),
  );
  const [globalRpm, setGlobalRpm] = useState(asText(program?.globalRpm));
  const [globalConcurrency, setGlobalConcurrency] = useState(asText(program?.globalConcurrency));
  const [defaultRpm, setDefaultRpm] = useState(asText(program?.defaultRpm));
  const [defaultConcurrency, setDefaultConcurrency] = useState(asText(program?.defaultConcurrency));

  // ── Per-request ceilings ──────────────────────────────────────────────────
  const [maxInputTokens, setMaxInputTokens] = useState(asText(program?.maxInputTokens));
  const [maxOutputTokens, setMaxOutputTokens] = useState(asText(program?.maxOutputTokens));
  const [maxRequestBytes, setMaxRequestBytes] = useState(asText(program?.maxRequestBytes));
  const [maxRequestDurationMs, setMaxRequestDurationMs] = useState(
    asText(program?.maxRequestDurationMs),
  );
  const [maxStreamDurationMs, setMaxStreamDurationMs] = useState(
    asText(program?.maxStreamDurationMs),
  );

  // ── Window ────────────────────────────────────────────────────────────────
  const [startsAt, setStartsAt] = useState(asLocalInput(program?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(asLocalInput(program?.endsAt ?? null));

  // ── Provider scope ────────────────────────────────────────────────────────
  const [providerId, setProviderId] = useState(program?.providerId ?? "");
  const [providerAccountIds, setProviderAccountIds] = useState(
    (program?.providerAccountIds ?? []).join("\n"),
  );

  const pending = create.isPending || update.isPending;
  const canSubmit = name.trim().length > 0 && (editing || slug.trim().length > 0) && !pending;
  const error = create.error ?? update.error;

  function submit(): void {
    const input = {
      name: name.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
      adminNotes: adminNotes.trim().length > 0 ? adminNotes.trim() : null,
      enabled,
      enrollmentMode,
      autoApprove,
      maxParticipants: optionalNumber(maxParticipants),
      termsRequired,
      termsText: termsText.trim().length > 0 ? termsText.trim() : null,
      globalTokenBudget: optionalNumber(globalTokenBudget),
      dailyTokenBudget: optionalNumber(dailyTokenBudget),
      monthlyTokenBudget: optionalNumber(monthlyTokenBudget),
      defaultTokenAllowance: optionalNumber(defaultTokenAllowance),
      globalRpm: optionalNumber(globalRpm),
      globalConcurrency: optionalNumber(globalConcurrency),
      defaultRpm: optionalNumber(defaultRpm),
      defaultConcurrency: optionalNumber(defaultConcurrency),
      maxInputTokens: optionalNumber(maxInputTokens),
      maxOutputTokens: optionalNumber(maxOutputTokens),
      maxRequestBytes: optionalNumber(maxRequestBytes),
      maxRequestDurationMs: optionalNumber(maxRequestDurationMs),
      maxStreamDurationMs: optionalNumber(maxStreamDurationMs),
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      providerId: providerId.trim().length > 0 ? providerId.trim() : null,
      providerAccountIds: providerAccountIds
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      // A blank ceiling here means "leave the schema default", not zero.
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
    <Dialog open onClose={onClose} title={editing ? t("bansos.edit") : t("bansos.newProgram")} width={720}>
      <Stack gap="lg">
        {/* ── Identity ─────────────────────────────────────────────────── */}
        <SectionHeading level={3} title={t("bansos.sectionIdentity")} />
        <div className="two-column-grid">
          <Field label={t("bansos.programName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </Field>
          <Field label={t("bansos.programSlug")} hint={editing ? t("bansos.slugLocked") : undefined}>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              readOnly={editing}
              required
              pattern="^[a-z0-9][a-z0-9-]*$"
            />
          </Field>
        </div>
        <Field label={t("bansos.programDescription")}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("bansos.adminNotes")} hint={t("bansos.adminNotesHint")}>
          <Input value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <Switch id="program-enabled" checked={enabled} onChange={setEnabled} label={t("bansos.programEnabled")} />
          <span className="account-row-meta">{t("bansos.programEnabledHint")}</span>
        </div>

        {/* ── Enrollment ───────────────────────────────────────────────── */}
        <SectionHeading level={3} title={t("bansos.sectionEnrollment")} />
        <div className="two-column-grid">
          <Field label={t("bansos.enrollmentMode")}>
            <Select
              value={enrollmentMode}
              onValueChange={(value) => setEnrollmentMode(value as BansosEnrollmentMode)}
              options={[
                { value: "closed", label: t("bansos.enrollment.closed") },
                { value: "invite", label: t("bansos.enrollment.invite") },
                { value: "request", label: t("bansos.enrollment.request") },
                { value: "open", label: t("bansos.enrollment.open") },
              ]}
            />
          </Field>
          <Field label={t("bansos.maxParticipants")} hint={t("bansos.blankUnlimited")}>
            <Input inputMode="numeric" value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} />
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <Switch id="auto-approve" checked={autoApprove} onChange={setAutoApprove} label={t("bansos.autoApprove")} />
          <span className="account-row-meta">{t("bansos.autoApproveHint")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <Switch id="terms-required" checked={termsRequired} onChange={setTermsRequired} label={t("bansos.termsRequired")} />
        </div>
        {termsRequired ? (
          <Field label={t("bansos.termsText")} hint={t("bansos.termsTextHint")}>
            <Input value={termsText} onChange={(e) => setTermsText(e.target.value)} />
          </Field>
        ) : null}
        <Field label={t("bansos.maxKeysPerParticipant")} hint={t("bansos.maxKeysHint")}>
          <Input inputMode="numeric" value={maxKeys} onChange={(e) => setMaxKeys(e.target.value)} />
        </Field>

        {/* ── Spending ─────────────────────────────────────────────────── */}
        <SectionHeading level={3} title={t("bansos.sectionSpending")} description={t("bansos.blankUnlimited")} />
        <div className="two-column-grid">
          <Field label={t("bansos.globalTokenBudget")}>
            <Input inputMode="numeric" value={globalTokenBudget} onChange={(e) => setGlobalTokenBudget(e.target.value)} />
          </Field>
          <Field label={t("bansos.defaultTokenAllowance")} hint={t("bansos.defaultAllowanceHint")}>
            <Input inputMode="numeric" value={defaultTokenAllowance} onChange={(e) => setDefaultTokenAllowance(e.target.value)} />
          </Field>
          <Field label={t("bansos.dailyTokenBudget")}>
            <Input inputMode="numeric" value={dailyTokenBudget} onChange={(e) => setDailyTokenBudget(e.target.value)} />
          </Field>
          <Field label={t("bansos.monthlyTokenBudget")}>
            <Input inputMode="numeric" value={monthlyTokenBudget} onChange={(e) => setMonthlyTokenBudget(e.target.value)} />
          </Field>
          <Field label={t("bansos.globalRpm")}>
            <Input inputMode="numeric" value={globalRpm} onChange={(e) => setGlobalRpm(e.target.value)} />
          </Field>
          <Field label={t("bansos.globalConcurrency")}>
            <Input inputMode="numeric" value={globalConcurrency} onChange={(e) => setGlobalConcurrency(e.target.value)} />
          </Field>
          <Field label={t("bansos.defaultRpm")} hint={t("bansos.defaultRpmHint")}>
            <Input inputMode="numeric" value={defaultRpm} onChange={(e) => setDefaultRpm(e.target.value)} />
          </Field>
          <Field label={t("bansos.defaultConcurrency")} hint={t("bansos.defaultRpmHint")}>
            <Input inputMode="numeric" value={defaultConcurrency} onChange={(e) => setDefaultConcurrency(e.target.value)} />
          </Field>
        </div>

        {/* ── Per-request ceilings ─────────────────────────────────────── */}
        <SectionHeading level={3} title={t("bansos.sectionRequest")} description={t("bansos.blankUnlimited")} />
        <div className="two-column-grid">
          <Field label={t("bansos.maxInputTokens")}>
            <Input inputMode="numeric" value={maxInputTokens} onChange={(e) => setMaxInputTokens(e.target.value)} />
          </Field>
          <Field label={t("bansos.maxOutputTokens")}>
            <Input inputMode="numeric" value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(e.target.value)} />
          </Field>
          <Field label={t("bansos.maxRequestBytes")}>
            <Input inputMode="numeric" value={maxRequestBytes} onChange={(e) => setMaxRequestBytes(e.target.value)} />
          </Field>
          <Field label={t("bansos.maxRequestDurationMs")}>
            <Input inputMode="numeric" value={maxRequestDurationMs} onChange={(e) => setMaxRequestDurationMs(e.target.value)} />
          </Field>
          <Field label={t("bansos.maxStreamDurationMs")}>
            <Input inputMode="numeric" value={maxStreamDurationMs} onChange={(e) => setMaxStreamDurationMs(e.target.value)} />
          </Field>
        </div>

        {/* ── Window ───────────────────────────────────────────────────── */}
        <SectionHeading level={3} title={t("bansos.sectionWindow")} description={t("bansos.sectionWindowHint")} />
        <div className="two-column-grid">
          <Field label={t("bansos.startsAt")}>
            <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label={t("bansos.endsAt")}>
            <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>

        {/* ── Provider scope ───────────────────────────────────────────── */}
        <SectionHeading level={3} title={t("bansos.sectionProvider")} description={t("bansos.sectionProviderHint")} />
        <Field label={t("bansos.providerScope")} hint={t("bansos.providerAny")}>
          <Input value={providerId} onChange={(e) => setProviderId(e.target.value)} placeholder="opencodeft" />
        </Field>
        <Field label={t("bansos.providerAccountIds")} hint={t("bansos.providerAccountIdsHint")}>
          <textarea
            className="input"
            rows={3}
            value={providerAccountIds}
            onChange={(e) => setProviderAccountIds(e.target.value)}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "12px" }}
          />
        </Field>

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
