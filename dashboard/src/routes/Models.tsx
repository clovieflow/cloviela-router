/**
 * Models: catalog search, capability filtering, and alias management.
 *
 * ── Why the alias editor lives here ────────────────────────────────────────
 * Aliases were previously reachable only from Combos & Routes, which is named
 * for a different concept (multi-model fan-out) and is where an operator
 * looking for "how do I rename a model for my client" would not think to go.
 * The alias CRUD keeps its canonical owner — `useModelAliases` and friends
 * call the same `/routing/aliases` endpoints, and the Combos page keeps
 * working unchanged. This page is a second *entry point* to one owner, not a
 * second implementation.
 *
 * ── No hardcoded counts ────────────────────────────────────────────────────
 * Every number on this page is a length of a fetched array or a field the
 * catalog returned. There is no "supports 40 providers" style claim, and an
 * empty catalog renders the empty state rather than a placeholder row.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { DataTable } from "../components/ui/layout";
import { Stack } from "../components/ui/stack";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/state";
import { Toolbar } from "../components/ui/toolbar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAllModelsCatalog } from "../components/ModelPicker";
import { useModelAliases, useCreateModelAlias, useUpdateModelAlias, useDeleteModelAlias } from "../hooks/routing";
import { PageHead } from "../components/PageHead";
import { useT } from "../shared/locale-context";
import { toast } from "../shared/toast";
import { getErrorMessage } from "../shared/helpers";
import { formatNumber } from "../shared/format";
import type { FlatModelCatalogEntry, ModelAliasRow } from "../data/contracts";
import type { MessageKey } from "../shared/i18n";

/** Capability flags the catalog declares, in display order. */
const CAPABILITIES: readonly { readonly key: keyof FlatModelCatalogEntry["entry"]; readonly labelKey: MessageKey }[] = [
  { key: "reasoning", labelKey: "models.capability.reasoning" },
  { key: "toolCall", labelKey: "models.capability.toolCall" },
  { key: "vision", labelKey: "models.capability.vision" },
  { key: "document", labelKey: "models.capability.document" },
  { key: "audio", labelKey: "models.capability.audio" },
  { key: "mediaGeneration", labelKey: "models.capability.media" },
];

function CapabilityBadges({ entry }: { readonly entry: FlatModelCatalogEntry["entry"] }): ReactNode {
  const t = useT();
  const active = CAPABILITIES.filter((capability) => entry[capability.key] === true);
  if (active.length === 0) return <span style={{ color: "var(--text-tertiary)" }}>—</span>;
  return (
    <span className="capability-badges">
      {active.map((capability) => (
        <span key={capability.key} className="capability-badge">
          {t(capability.labelKey)}
        </span>
      ))}
    </span>
  );
}

/**
 * Alias editor dialog body.
 *
 * Validation is local and immediate (empty name, empty target, duplicate
 * name) so an obviously invalid form never reaches the network; the gateway
 * remains authoritative for everything else (cycle detection, collisions with
 * real model ids) and its error is surfaced verbatim.
 */
function AliasDialog({
  editing,
  aliases,
  modelOptions,
  onClose,
}: {
  readonly editing: ModelAliasRow | null;
  readonly aliases: readonly ModelAliasRow[];
  readonly modelOptions: readonly { readonly value: string; readonly label: string }[];
  readonly onClose: () => void;
}): ReactNode {
  const t = useT();
  const [name, setName] = useState(editing?.alias ?? "");
  const [target, setTarget] = useState(editing?.targetModel ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const create = useCreateModelAlias();
  const update = useUpdateModelAlias();

  const pending = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedTarget = target.trim();
    let valid = true;

    if (trimmedName.length === 0) {
      setNameError(t("models.aliasValidation.name"));
      valid = false;
    } else {
      const duplicate = aliases.find(
        (alias) => alias.alias === trimmedName && alias.id !== editing?.id,
      );
      if (duplicate) {
        setNameError(t("models.aliasValidation.duplicate", { name: trimmedName }));
        valid = false;
      } else {
        setNameError(null);
      }
    }

    if (trimmedTarget.length === 0) {
      setTargetError(t("models.aliasValidation.target"));
      valid = false;
    } else {
      setTargetError(null);
    }

    if (!valid) return;

    if (editing) {
      update.mutate(
        { id: editing.id, request: { alias: trimmedName, targetModel: trimmedTarget } },
        {
          onSuccess: () => {
            toast.success(t("models.aliasUpdated"), trimmedName);
            onClose();
          },
        },
      );
      return;
    }

    create.mutate(
      { alias: trimmedName, targetModel: trimmedTarget },
      {
        onSuccess: () => {
          toast.success(t("models.aliasCreated"), trimmedName);
          onClose();
        },
      },
    );
  };

  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="dialog-panel card-solid"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alias-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        style={{ width: "min(480px, calc(100vw - 32px))", borderRadius: 20 }}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="alias-dialog-title">
            {editing ? t("models.aliasEdit") : t("models.aliasNew")}
          </h2>
          <button type="button" className="topbar-icon-button" aria-label={t("action.close")} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="modal-body">
            <Stack gap="12px">
              <Input
                label={t("models.aliasName")}
                id="alias-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="fast-model"
                autoComplete="off"
                error={nameError ?? undefined}
                required
              />
              <Input
                label={t("models.aliasTarget")}
                id="alias-target"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  if (targetError) setTargetError(null);
                }}
                placeholder={modelOptions[0]?.value ?? "provider/model-id"}
                autoComplete="off"
                list="alias-target-options"
                error={targetError ?? undefined}
                required
              />
              <datalist id="alias-target-options">
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value} />
                ))}
              </datalist>
              {mutationError ? (
                <p className="form-error" role="alert">
                  {getErrorMessage(mutationError)}
                </p>
              ) : null}
            </Stack>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending} disabled={pending}>
              {pending ? t("action.saving") : t("action.save")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AliasSection({
  aliases,
  modelOptions,
  isLoading,
  isError,
  onRetry,
  isRetrying,
}: {
  readonly aliases: readonly ModelAliasRow[];
  readonly modelOptions: readonly { readonly value: string; readonly label: string }[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
  readonly isRetrying: boolean;
}): ReactNode {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModelAliasRow | null>(null);
  const [deleting, setDeleting] = useState<ModelAliasRow | null>(null);
  const remove = useDeleteModelAlias();

  return (
    <Card>
      <CardHeader
        title={t("models.aliasSection")}
        subtitle={t("models.aliasSectionHint")}
        icon={<Tag size={15} />}
        action={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            {t("models.aliasNew")}
          </Button>
        }
      />
      <CardBody>
        {isLoading ? (
          <LoadingState label={t("state.loading")} compact />
        ) : isError ? (
          <ErrorState
            title={t("state.error.title")}
            message={t("state.error.retryHint")}
            onRetry={onRetry}
            retrying={isRetrying}
            compact
          />
        ) : aliases.length === 0 ? (
          <EmptyState
            icon={<Tag size={20} />}
            title={t("models.aliasEmpty")}
            message={t("models.aliasEmptyHint")}
            compact
          />
        ) : (
          <DataTable headers={[t("models.aliasName"), t("models.aliasTarget"), ""]}>
            {aliases.map((alias) => (
              <tr key={alias.id}>
                <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{alias.alias}</td>
                <td style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
                  {alias.targetModel}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil size={12} />}
                    aria-label={`${t("models.aliasEdit")}: ${alias.alias}`}
                    onClick={() => {
                      setEditing(alias);
                      setDialogOpen(true);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={12} />}
                    aria-label={`${t("action.delete")}: ${alias.alias}`}
                    onClick={() => setDeleting(alias)}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </CardBody>

      {dialogOpen ? (
        <AliasDialog
          editing={editing}
          aliases={aliases}
          modelOptions={modelOptions}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t("action.delete")}
        message={t("models.aliasDeleteConfirm", { name: deleting?.alias ?? "" })}
        confirmLabel={t("action.delete")}
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          toast.success(t("models.aliasDeleted"), deleting.alias);
        }}
      />
    </Card>
  );
}

export default function Models(): ReactNode {
  const t = useT();
  const catalog = useAllModelsCatalog(true);
  const aliasesQuery = useModelAliases();
  const [search, setSearch] = useState("");
  const [activeCapabilities, setActiveCapabilities] = useState<ReadonlySet<string>>(() => new Set());

  const models = catalog.items;
  const aliases = aliasesQuery.data ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return models.filter((model) => {
      if (needle.length > 0) {
        const haystack = `${model.modelId} ${model.qualified} ${model.providerLabel} ${model.providerId}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      for (const capability of activeCapabilities) {
        const key = capability as keyof FlatModelCatalogEntry["entry"];
        if (model.entry[key] !== true) return false;
      }
      return true;
    });
  }, [models, search, activeCapabilities]);

  const toggleCapability = (key: string) => {
    setActiveCapabilities((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const modelOptions = useMemo(
    () => models.map((model) => ({ value: model.qualified, label: `${model.qualified} — ${model.providerLabel}` })),
    [models],
  );

  return (
    <div className="dashboard-page">
      <PageHead title={t("models.title")} description={t("models.subtitle")} art="models" />

      <Card>
        <CardHeader
          title={t("models.title")}
          subtitle={
            models.length === 0
              ? undefined
              : filtered.length === models.length
                ? t("models.count", { count: models.length })
                : t("models.countFiltered", { shown: filtered.length, total: models.length })
          }
          icon={<Layers size={15} />}
          action={
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw size={13} className={catalog.isLoading ? "animate-spin" : ""} />}
                onClick={() => catalog.refetch()}
                disabled={catalog.isLoading}
              >
                {catalog.isLoading ? t("action.refreshing") : t("action.refresh")}
              </Button>
              <Link to="/combos">
                <Button variant="secondary" size="sm">
                  {t("models.combosLink")}
                </Button>
              </Link>
            </div>
          }
        />
        <CardBody>
          <Stack gap="12px">
            <Toolbar
              meta={
                models.length === 0
                  ? undefined
                  : t("models.countFiltered", { shown: filtered.length, total: models.length })
              }
            >
              <div style={{ position: "relative", display: "flex", alignItems: "center", flex: "1 1 220px", minWidth: 0 }}>
                <Search
                  size={14}
                  aria-hidden="true"
                  style={{ position: "absolute", left: 10, color: "var(--text-tertiary)" }}
                />
                <input
                  type="search"
                  className="form-input"
                  style={{ paddingLeft: 30 }}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("models.search")}
                  aria-label={t("models.searchHint")}
                />
              </div>
              <div className="model-filter-bar" role="group" aria-label={t("models.capability")}>
                {CAPABILITIES.map((capability) => (
                  <button
                    key={capability.key}
                    type="button"
                    className="model-filter-chip"
                    aria-pressed={activeCapabilities.has(capability.key)}
                    onClick={() => toggleCapability(capability.key)}
                  >
                    {activeCapabilities.has(capability.key) ? <Check size={11} aria-hidden="true" /> : null}
                    {t(capability.labelKey)}
                  </button>
                ))}
                {activeCapabilities.size > 0 ? (
                  <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={() => setActiveCapabilities(new Set())}>
                    {t("models.clearFilters")}
                  </Button>
                ) : null}
              </div>
            </Toolbar>

            {catalog.isLoading ? (
              <LoadingState label={t("state.loading")} compact />
            ) : catalog.isError ? (
              <ErrorState
                title={t("state.error.title")}
                message={t("state.error.retryHint")}
                onRetry={() => catalog.refetch()}
                retrying={catalog.isLoading}
                compact
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<AlertTriangle size={20} />}
                title={models.length === 0 ? t("state.empty.title") : t("models.noResults")}
                message={models.length === 0 ? t("state.empty.message") : t("models.noResults")}
                action={
                  models.length === 0 ? (
                    <Link to="/providers">
                      <Button variant="secondary" size="sm">
                        {t("nav.providers")}
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setActiveCapabilities(new Set());
                      }}
                    >
                      {t("models.clearFilters")}
                    </Button>
                  )
                }
                compact
              />
            ) : (
              <DataTable
                headers={[
                  t("models.column.model"),
                  t("models.column.provider"),
                  t("models.column.route"),
                  t("models.column.limits"),
                  t("models.column.capabilities"),
                  t("models.column.status"),
                ]}
                maxHeight={560}
                scrollRegion
              >
                {filtered.map((model) => (
                  <tr key={`${model.providerId}-${model.qualified}-${model.kind}`}>
                    <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600, overflowWrap: "anywhere" }}>
                      {model.modelId}
                      {model.kind !== "model" ? (
                        <span className="capability-badge" style={{ marginLeft: 6 }}>
                          {model.kind}
                        </span>
                      ) : null}
                    </td>
                    <td>{model.providerLabel}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                      {model.entry.route}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {model.entry.contextLimit === null
                        ? "—"
                        : formatNumber(model.entry.contextLimit)}
                    </td>
                    <td>
                      <CapabilityBadges entry={model.entry} />
                    </td>
                    <td>
                      <span className={`badge ${model.entry.enabled ? "badge-ok" : "badge-disabled"}`}>
                        {model.entry.enabled ? t("models.enabled") : t("models.disabled")}
                      </span>
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Stack>
        </CardBody>
      </Card>

      <AliasSection
        aliases={aliases}
        modelOptions={modelOptions}
        isLoading={aliasesQuery.isPending}
        isError={aliasesQuery.isError}
        onRetry={() => void aliasesQuery.refetch()}
        isRetrying={aliasesQuery.isFetching}
      />
    </div>
  );
}
