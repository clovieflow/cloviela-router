/**
 * Subsidized model list.
 *
 * ── Why the two names are both shown ────────────────────────────────────────
 * The participant sends `publicModelId` and the gateway sends
 * `upstreamModelId`. An operator needs both on one row: the public name is
 * what they hand out, and the upstream name is what they are paying for.
 * Showing only one makes the other a support question.
 *
 * ── Why an empty list is a warning, not a hint ──────────────────────────────
 * A key issued while the program has no models is refused by the issue route
 * — that is the enforcement. The panel states it before the operator tries,
 * because the underlying cause is a property of the key's allowlist that is
 * invisible from the key screen.
 *
 * ── Why each row is editable ────────────────────────────────────────────────
 * A model carries its own token ceilings and a daily budget, and those were
 * reachable only through the API. An operator who wants one expensive model
 * capped lower than the rest needs a field, not a curl command.
 */
import { type ReactNode, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Dialog } from "../ui/dialog";
import { Stack } from "../ui/stack";
import { SectionHeading } from "../ui/layout";
import { EmptyState } from "../ui/state";
import { DataTable } from "../ui/layout";
import {
  useAddBansosModel,
  useBansosModels,
  useRemoveBansosModel,
  useUpdateBansosModel,
} from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";
import { formatNumber } from "../../shared/format";
import type { BansosModel, BansosModelInput } from "../../data/bansos-contracts";

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function asText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
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

/** Create or edit one subsidized model. */
function BansosModelDialog({
  programId,
  model,
  onClose,
}: {
  programId: string;
  model?: BansosModel;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const add = useAddBansosModel();
  const update = useUpdateBansosModel();
  const editing = model !== undefined;

  const [upstream, setUpstream] = useState(model?.upstreamModelId ?? "");
  const [publicId, setPublicId] = useState(model?.publicModelId ?? "");
  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [maxInput, setMaxInput] = useState(asText(model?.maxInputTokens));
  const [maxOutput, setMaxOutput] = useState(asText(model?.maxOutputTokens));
  const [dailyBudget, setDailyBudget] = useState(asText(model?.dailyTokenBudget));

  const pending = add.isPending || update.isPending;
  // The upstream id identifies what is being paid for; changing it on an
  // existing row would silently redirect a published name at a different
  // model, so it is fixed after creation and a new row is the way to change it.
  const canSubmit =
    publicId.trim().length > 0 && (editing || upstream.trim().length > 0) && !pending;
  const error = add.error ?? update.error;

  function submit(): void {
    const input: BansosModelInput = {
      upstreamModelId: upstream.trim(),
      publicModelId: publicId.trim(),
      displayName: displayName.trim().length > 0 ? displayName.trim() : null,
      maxInputTokens: optionalNumber(maxInput),
      maxOutputTokens: optionalNumber(maxOutput),
      dailyTokenBudget: optionalNumber(dailyBudget),
    };
    if (editing) {
      update.mutate(
        {
          programId,
          modelId: model.id,
          input: {
            publicModelId: input.publicModelId,
            displayName: input.displayName,
            maxInputTokens: input.maxInputTokens,
            maxOutputTokens: input.maxOutputTokens,
            dailyTokenBudget: input.dailyTokenBudget,
          },
        },
        { onSuccess: onClose },
      );
      return;
    }
    add.mutate({ programId, input }, { onSuccess: onClose });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? t("bansos.editModel") : t("bansos.addModel")}
      width={620}
    >
      <Stack gap="lg">
        <SectionHeading level={3} title={t("bansos.sectionIdentity")} />
        <div className="two-column-grid">
          <Field
            label={t("bansos.upstreamModel")}
            hint={editing ? t("bansos.upstreamLocked") : t("bansos.upstreamHint")}
          >
            <Input
              value={upstream}
              onChange={(e) => setUpstream(e.target.value)}
              readOnly={editing}
              placeholder="opencodeft/big-pickle"
              required
            />
          </Field>
          <Field label={t("bansos.publicModel")} hint={t("bansos.publicModelHint")}>
            <Input value={publicId} onChange={(e) => setPublicId(e.target.value)} placeholder="bansos-model" required />
          </Field>
        </div>
        <Field label={t("bansos.displayName")} hint={t("bansos.displayNameHint")}>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>

        <SectionHeading
          level={3}
          title={t("bansos.sectionModelLimits")}
          description={t("bansos.blankUnlimited")}
        />
        <div className="two-column-grid">
          <Field label={t("bansos.maxInputTokens")}>
            <Input inputMode="numeric" value={maxInput} onChange={(e) => setMaxInput(e.target.value)} />
          </Field>
          <Field label={t("bansos.maxOutputTokens")}>
            <Input inputMode="numeric" value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} />
          </Field>
        </div>
        <Field label={t("bansos.dailyTokenBudget")} hint={t("bansos.modelDailyHint")}>
          <Input inputMode="numeric" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} />
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

export function BansosModelsPanel({ programId }: { programId: string }): ReactNode {
  const t = useT();
  const models = useBansosModels(programId);
  const update = useUpdateBansosModel();
  const remove = useRemoveBansosModel();
  const [editing, setEditing] = useState<BansosModel | "new" | null>(null);

  const rows = models.data ?? [];

  return (
    <>
      <div className="page-toolbar-sticky">
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={16} />}
          onClick={() => setEditing("new")}
        >
          {t("bansos.addModel")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t("bansos.modelsEmpty")}
          message={t("bansos.modelsEmptyHint")}
          icon={<Plus size={20} />}
          compact
        />
      ) : (
        <DataTable
          headers={[
            t("bansos.publicModel"),
            t("bansos.upstreamModel"),
            t("bansos.maxInputTokens"),
            t("bansos.maxOutputTokens"),
            t("bansos.programEnabled"),
            "",
          ]}
        >
          {rows.map((model) => (
            <tr key={model.id}>
              <td>
                <div className="account-row-name">{model.publicModelId}</div>
                <div className="account-row-meta">
                  {model.displayName ?? t("bansos.publicModelHint")}
                </div>
              </td>
              <td>
                <code>{model.upstreamModelId}</code>
              </td>
              <td>{model.maxInputTokens === null ? "—" : formatNumber(model.maxInputTokens)}</td>
              <td>{model.maxOutputTokens === null ? "—" : formatNumber(model.maxOutputTokens)}</td>
              <td>
                <Badge tone={model.enabled ? "ok" : "disabled"}>
                  {model.enabled ? t("bansos.keyLive") : t("bansos.keyRevoked")}
                </Badge>
              </td>
              <td>
                <div className="account-row-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Pencil size={14} />}
                    onClick={() => setEditing(model)}
                  >
                    {t("bansos.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={update.isPending}
                    onClick={() =>
                      update.mutate({
                        programId,
                        modelId: model.id,
                        input: { enabled: !model.enabled },
                      })
                    }
                  >
                    {model.enabled ? t("bansos.status.suspended") : t("bansos.status.active")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 size={15} />}
                    onClick={() => remove.mutate({ programId, modelId: model.id })}
                  >
                    {t("bansos.delete")}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {editing !== null ? (
        <BansosModelDialog
          programId={programId}
          {...(editing === "new" ? {} : { model: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
