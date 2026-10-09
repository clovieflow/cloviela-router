/**
 * Keys held by one participant.
 *
 * ── The secret ──────────────────────────────────────────────────────────────
 * A Bansos key is returned exactly once, at issue. There is no "show again"
 * because the server keeps only a hash — so the issued dialog is the only
 * moment the credential exists in readable form, and it says so rather than
 * letting the operator close it and lose the key.
 *
 * ── Why limits are shown, not just the label ────────────────────────────────
 * Each key carries its own ceiling, resolved from the program, the participant
 * and the key's own override. The effective number is what the operator needs
 * when deciding whether to revoke; the raw per-key value alone would hide the
 * program's stricter limit.
 */
import { type ReactNode, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Stack } from "../ui/stack";
import { EmptyState } from "../ui/state";
import { DataTable } from "../ui/layout";
import { ConfirmDialog } from "../ConfirmDialog";
import { useBansosParticipantKeys, useIssueBansosKey, useRevokeBansosKey } from "../../hooks/bansos";
import { useClipboard } from "../../hooks/use-clipboard";
import { useT } from "../../shared/locale-context";
import { formatNumber } from "../../shared/format";
import type { BansosIssuedKey } from "../../data/bansos-contracts";

/** Blank = inherit; anything else must be a positive whole number. */
function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function BansosKeysPanel({
  participantId,
  programId,
}: {
  participantId: string;
  programId: string;
}): ReactNode {
  const t = useT();
  const keys = useBansosParticipantKeys(participantId);
  const issue = useIssueBansosKey();
  const revoke = useRevokeBansosKey();
  const clipboard = useClipboard();
  const [issuing, setIssuing] = useState(false);
  const [label, setLabel] = useState("");
  // Every limit the API accepts. Blank leaves the column unset, which the
  // resolver reads as "inherit from program/participant" — not as zero.
  const [lifetimeBudget, setLifetimeBudget] = useState("");
  const [rpm, setRpm] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [concurrency, setConcurrency] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [issued, setIssued] = useState<BansosIssuedKey | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const rows = keys.data ?? [];

  return (
    <>
      <div className="page-toolbar-sticky">
        <Button
          variant="primary"
          size="sm"
          icon={<KeyRound size={16} />}
          onClick={() => setIssuing(true)}
        >
          {t("bansos.issueKey")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t("bansos.keysEmpty")}
          message={t("bansos.participantsEmptyHint")}
          icon={<KeyRound size={20} />}
          compact
        />
      ) : (
        <DataTable
          headers={[
            t("bansos.keyLabel"),
            t("bansos.participantStatus"),
            t("bansos.tokenAllowance"),
            t("bansos.keyConsumed"),
            t("bansos.rpm"),
            "",
          ]}
        >
          {rows.map((key) => {
            const live = key.enabled && key.revokedAt === null;
            return (
              <tr key={key.id}>
                <td>
                  <div className="account-row-name">{key.label}</div>
                  <code className="account-row-meta">{key.keyPrefix ?? "—"}</code>
                </td>
                <td>
                  <Badge tone={live ? "ok" : "disabled"}>
                    {live ? t("bansos.keyLive") : t("bansos.keyRevoked")}
                  </Badge>
                </td>
                <td>
                  {key.lifetimeTokenBudget === null
                    ? t("bansos.unlimited")
                    : formatNumber(key.lifetimeTokenBudget)}
                </td>
                <td>{formatNumber(key.lifetimeTokensConsumed ?? 0)}</td>
                <td>{key.requestsPerMinute === null ? t("bansos.unlimited") : key.requestsPerMinute}</td>
                <td>
                  <div className="account-row-actions">
                    {live ? (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 size={15} />}
                        onClick={() => setPendingRevoke(key.id)}
                      >
                        {t("bansos.keyRevoke")}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      {issuing ? (
        <Dialog open onClose={() => setIssuing(false)} title={t("bansos.issueKey")}>
          <Stack gap="md">
            <label>
              <span>{t("bansos.keyLabel")}</span>
              <Input value={label} onChange={(event) => setLabel(event.target.value)} autoFocus />
            </label>
            <div className="two-column-grid">
              <label>
                <span>{t("bansos.tokenAllowance")}</span>
                <Input inputMode="numeric" value={lifetimeBudget} onChange={(e) => setLifetimeBudget(e.target.value)} placeholder={t("bansos.unlimited")} />
              </label>
              <label>
                <span>{t("bansos.rpm")}</span>
                <Input inputMode="numeric" value={rpm} onChange={(e) => setRpm(e.target.value)} placeholder={t("bansos.unlimited")} />
              </label>
              <label>
                <span>{t("bansos.dailyTokenBudget")}</span>
                <Input inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} placeholder={t("bansos.unlimited")} />
              </label>
              <label>
                <span>{t("bansos.monthlyTokenBudget")}</span>
                <Input inputMode="numeric" value={monthlyLimit} onChange={(e) => setMonthlyLimit(e.target.value)} placeholder={t("bansos.unlimited")} />
              </label>
              <label>
                <span>{t("bansos.concurrency")}</span>
                <Input inputMode="numeric" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} placeholder={t("bansos.unlimited")} />
              </label>
              <label>
                <span>{t("bansos.expiresAt")}</span>
                <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </label>
            </div>
            <p className="account-row-meta">{t("bansos.keyLimitsHint")}</p>
            {issue.isError ? <p role="alert">{issue.error.message}</p> : null}
            <div className="modal-form-actions">
              <Button variant="secondary" onClick={() => setIssuing(false)}>
                {t("bansos.cancel")}
              </Button>
              <Button
                variant="primary"
                loading={issue.isPending}
                onClick={() =>
                  issue.mutate(
                    {
                      participantId,
                      programId,
                      input: {
                        ...(label.trim().length > 0 ? { label: label.trim() } : {}),
                        ...(optionalNumber(lifetimeBudget) === null ? {} : { lifetimeTokenBudget: optionalNumber(lifetimeBudget) }),
                        ...(optionalNumber(rpm) === null ? {} : { rpm: optionalNumber(rpm) }),
                        ...(optionalNumber(dailyLimit) === null ? {} : { dailyTokenLimit: optionalNumber(dailyLimit) }),
                        ...(optionalNumber(monthlyLimit) === null ? {} : { monthlyTokenLimit: optionalNumber(monthlyLimit) }),
                        ...(optionalNumber(concurrency) === null ? {} : { maxConcurrentRequests: optionalNumber(concurrency) }),
                        ...(expiresAt.trim().length === 0 ? {} : { expiresAt: new Date(expiresAt).toISOString() }),
                      },
                    },
                    {
                      onSuccess: (created) => {
                        setIssuing(false);
                        setLabel("");
                        setLifetimeBudget("");
                        setRpm("");
                        setDailyLimit("");
                        setMonthlyLimit("");
                        setConcurrency("");
                        setExpiresAt("");
                        setIssued(created);
                      },
                    },
                  )
                }
              >
                {t("bansos.issueKey")}
              </Button>
            </div>
          </Stack>
        </Dialog>
      ) : null}

      {issued !== null ? (
        <Dialog open onClose={() => setIssued(null)} title={t("bansos.keyIssued")}>
          <Stack gap="md">
            <p>{t("bansos.keyIssuedHint")}</p>
            <Input readOnly value={issued.secret} onFocus={(event) => event.target.select()} />
            <div className="modal-form-actions">
              <Button
                variant="primary"
                onClick={() => void clipboard.copy(issued.secret)}
              >
                {clipboard.copied ? t("bansos.keyCopied") : t("bansos.keyCopy")}
              </Button>
              <Button variant="secondary" onClick={() => setIssued(null)}>
                {t("bansos.close")}
              </Button>
            </div>
          </Stack>
        </Dialog>
      ) : null}

      {pendingRevoke !== null ? (
        <ConfirmDialog
          open
          onClose={() => setPendingRevoke(null)}
          onConfirm={() => {
            revoke.mutate({ keyId: pendingRevoke, participantId, programId });
            setPendingRevoke(null);
          }}
          title={t("bansos.confirmRevoke")}
          message={t("bansos.confirmRevokeHint")}
          confirmLabel={t("bansos.keyRevoke")}
          cancelLabel={t("bansos.cancel")}
          danger
        />
      ) : null}
    </>
  );
}
