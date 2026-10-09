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
 */
import { type ReactNode, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { EmptyState } from "../ui/state";
import { DataTable } from "../ui/layout";
import {
  useAddBansosModel,
  useBansosModels,
  useRemoveBansosModel,
  useUpdateBansosModel,
} from "../../hooks/bansos";
import { useT } from "../../shared/locale-context";

export function BansosModelsPanel({ programId }: { programId: string }): ReactNode {
  const t = useT();
  const models = useBansosModels(programId);
  const add = useAddBansosModel();
  const update = useUpdateBansosModel();
  const remove = useRemoveBansosModel();
  const [upstream, setUpstream] = useState("");
  const [publicId, setPublicId] = useState("");

  const rows = models.data ?? [];
  const canAdd = upstream.trim().length > 0 && publicId.trim().length > 0 && !add.isPending;

  return (
    <>
      <div className="page-toolbar-sticky">
        <Input
          value={upstream}
          onChange={(event) => setUpstream(event.target.value)}
          placeholder={t("bansos.upstreamModel")}
          aria-label={t("bansos.upstreamModel")}
        />
        <Input
          value={publicId}
          onChange={(event) => setPublicId(event.target.value)}
          placeholder={t("bansos.publicModel")}
          aria-label={t("bansos.publicModel")}
        />
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={16} />}
          disabled={!canAdd}
          loading={add.isPending}
          onClick={() =>
            add.mutate(
              {
                programId,
                input: {
                  upstreamModelId: upstream.trim(),
                  publicModelId: publicId.trim(),
                },
              },
              {
                onSuccess: () => {
                  setUpstream("");
                  setPublicId("");
                },
              },
            )
          }
        >
          {t("bansos.addModel")}
        </Button>
      </div>

      {add.isError ? <p role="alert">{add.error.message}</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          title={t("bansos.modelsEmpty")}
          message={t("bansos.modelsEmptyHint")}
          icon={<Plus size={20} />}
          compact
        />
      ) : (
        <DataTable
          headers={[t("bansos.publicModel"), t("bansos.upstreamModel"), t("bansos.programEnabled"), ""]}
        >
          {rows.map((model) => (
            <tr key={model.id}>
              <td>
                <div className="account-row-name">{model.publicModelId}</div>
                <div className="account-row-meta">{t("bansos.publicModelHint")}</div>
              </td>
              <td>
                <code>{model.upstreamModelId}</code>
              </td>
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
    </>
  );
}
