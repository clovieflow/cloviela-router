/**
 * Route Simulator: read-only evaluation of the routing policy.
 *
 * ── What makes this page trustworthy ───────────────────────────────────────
 * 1. **It explains, it does not decide.** The gateway's own eligibility owner
 *    produces the answer; this page renders it. There is no routing logic in
 *    the browser, so the simulator cannot drift from what dispatch does.
 * 2. **The read-only promise is visible.** A persistent notice states that
 *    nothing was dispatched and no quota, cooldown, or concurrency state
 *    changed — the operator needs to know that before trusting the numbers.
 * 3. **Exclusions carry their cause.** Every ineligible candidate shows the
 *    reasons the gateway returned, so "why did this go to provider B" has an
 *    answer that is not a guess.
 * 4. **Two contract rules are rendered literally**, because getting either
 *    wrong would mislead:
 *    - `selectedIsDeterministic:false` (rotation or fusion) => NO winner is
 *      shown. A highlighted row next to "not deterministic" still reads as a
 *      promise, so the selected panel is omitted entirely and the ordered
 *      candidate list plus a rotation note takes its place.
 *    - `eligible:true` with `outcome:"accounts_rate_limited"` is a real,
 *      coherent state: the canonical evaluator keeps a cooling account
 *      eligible-but-deprioritized while a live request answers 429. Both are
 *      shown; neither signal is collapsed into the other.
 * 5. **A missing endpoint is reported, not faked.** A 404/405 renders the
 *    unavailable state with the exact path the UI called; any other failure is
 *    an ordinary error with a retry.
 *
 * ── Locale note ────────────────────────────────────────────────────────────
 * `reasons[].message`, `quota.status`, `notes[]` and `outcome` prose come from
 * the backend, which owns their wording. They are rendered VERBATIM, like a
 * provider's display name: translating a canonical owner's message in the UI
 * would let the screen disagree with the API. The page's own chrome is
 * localized, and the closed `code`/`outcome` sets get localized labels here so
 * the common cases read in Indonesian without touching backend strings.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Eye,
  GitBranch,
  Info,
  Layers,
  Play,
  Route as RouteIcon,
  Shuffle,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageHead } from "../components/PageHead";
import { Select } from "../components/ui/select";
import { Stack } from "../components/ui/stack";
import { EmptyState } from "../components/ui/state";
import {
  SIMULATOR_ENDPOINTS,
  SIMULATOR_ENDPOINT_PATH,
  isSimulatorUnavailable,
  useRouteSimulation,
  type SimulatorCandidate,
  type SimulatorOutcome,
} from "../hooks/route-simulator";
import { useT, type TranslateFn } from "../shared/locale-context";
import { formatAgo, formatNumber } from "../shared/format";
import type { MessageKey } from "../shared/i18n";

/** Localized label for a canonical eligibility code; unknown codes fall back
 *  to the backend's own message so a new code still reads correctly. */
function reasonLabel(code: string, fallback: string, t: TranslateFn): string {
  const key = `simulator.reason.${code}` as MessageKey;
  const localized = t(key);
  // `translate` leaves an unknown key literal; a literal key means "no label".
  return localized.startsWith("simulator.reason.") ? fallback : localized;
}

const OUTCOME_KEYS: Readonly<Record<SimulatorOutcome, MessageKey>> = {
  dispatchable: "simulator.outcome.dispatchable",
  accounts_unavailable: "simulator.outcome.accounts_unavailable",
  accounts_rate_limited: "simulator.outcome.accounts_rate_limited",
  service_kind_unsupported: "simulator.outcome.service_kind_unsupported",
};

const QUOTA_KEYS: Readonly<Record<string, MessageKey>> = {
  ok: "simulator.quota.ok",
  below_floor: "simulator.quota.below_floor",
  unknown: "simulator.quota.unknown",
  disabled: "simulator.quota.disabled",
};

/** Outcome tone: a rate limit is a warning, not a hard failure. */
function outcomeTone(outcome: SimulatorOutcome | undefined): "ok" | "warn" | "danger" {
  if (outcome === "dispatchable") return "ok";
  if (outcome === "accounts_rate_limited") return "warn";
  return "danger";
}

function CandidateRow({ candidate }: { readonly candidate: SimulatorCandidate }): ReactNode {
  const t = useT();
  const quotaKey = candidate.quota ? QUOTA_KEYS[candidate.quota.status] : undefined;
  const cooldown =
    candidate.cooldownUntil !== undefined
      ? t("simulator.cooldownUntil", { time: formatAgo(candidate.cooldownUntil) })
      : candidate.modelCooldownUntil !== undefined
        ? t("simulator.modelCooldownUntil", { time: formatAgo(candidate.modelCooldownUntil) })
        : undefined;

  return (
    <li className="simulator-candidate" data-eligible={candidate.eligible ? "true" : "false"}>
      {candidate.eligible ? (
        <CheckCircle2 size={15} aria-hidden="true" style={{ color: "var(--green)", flexShrink: 0 }} />
      ) : (
        <CircleSlash size={15} aria-hidden="true" style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: "0 1 190px" }}>
        <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {candidate.accountLabel ?? candidate.accountId ?? "—"}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", overflowWrap: "anywhere" }}>
          {candidate.providerLabel} · <code>{candidate.modelId}</code>
        </div>
      </div>
      <div className="simulator-reasons">
        {candidate.reasons.length === 0 ? (
          <span>{t("simulator.reason.none")}</span>
        ) : (
          candidate.reasons.map((reason, index) => (
            <span key={`${reason.code}-${index}`}>
              {/* The DECISION line is localized from the closed `code` set, so
                  the UI copy stays stable when the backend rewords its English
                  sentence. The canonical message follows verbatim as the
                  supporting fact (it names the specific model/provider). */}
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {reasonLabel(reason.code, reason.message, t)}
              </span>
              {reason.message && reason.message !== reasonLabel(reason.code, reason.message, t) ? (
                <span style={{ color: "var(--text-tertiary)" }}> — {reason.message}</span>
              ) : null}
            </span>
          ))
        )}
      </div>
      <div style={{ flexShrink: 0, textAlign: "right", fontSize: 11, minWidth: 88 }}>
        {candidate.wireFamily ? (
          <div style={{ color: "var(--text-tertiary)" }}>{candidate.wireFamily}</div>
        ) : null}
        {quotaKey ? (
          <div
            style={{
              color:
                candidate.quota?.status === "below_floor" ? "var(--orange)" : "var(--text-tertiary)",
            }}
          >
            {t(quotaKey)}
          </div>
        ) : null}
        {candidate.maxInflight !== undefined ? (
          <div style={{ color: "var(--text-tertiary)" }}>
            {t("simulator.column.inflight")} ≤ {formatNumber(candidate.maxInflight)}
          </div>
        ) : null}
        {cooldown ? <div style={{ color: "var(--orange)" }}>{cooldown}</div> : null}
      </div>
      <span
        className="capability-badge"
        style={{ flexShrink: 0, fontFamily: "var(--font-mono)" }}
        title={t("simulator.column.priority")}
      >
        {candidate.priority}
      </span>
    </li>
  );
}

export default function RouteSimulator(): ReactNode {
  const t = useT();
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState<string>(SIMULATOR_ENDPOINTS[0]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const simulation = useRouteSimulation();

  const unavailable = isSimulatorUnavailable(simulation.error);
  const result = simulation.data;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = model.trim();
    if (trimmed.length === 0) {
      setValidationError(t("simulator.validation.model"));
      return;
    }
    setValidationError(null);
    simulation.mutate({ model: trimmed, endpoint });
  };

  const eligibleCount = result?.candidates.filter((candidate) => candidate.eligible).length ?? 0;
  // The selected panel is only meaningful when the gateway guarantees it.
  const showWinner = result !== undefined && result.selected !== null && result.selectedIsDeterministic;
  const rotationInstead = result !== undefined && result.selectedIsDeterministic === false;

  return (
    <div className="dashboard-page">
      <PageHead title={t("simulator.title")} description={t("simulator.subtitle")} art="routing" />

      <p className="simulator-notice" role="note">
        <Eye size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong style={{ display: "block", marginBottom: 2 }}>{t("simulator.readOnlyBadge")}</strong>
          {t("simulator.readOnlyNotice")}
        </span>
      </p>

      <Card>
        <CardHeader title={t("simulator.title")} icon={<RouteIcon size={15} />} />
        <CardBody>
          <form onSubmit={submit} className="simulator-form" noValidate>
            <div className="simulator-form-field">
              <Input
                label={t("simulator.model")}
                hint={t("simulator.modelHint")}
                id="simulator-model"
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="claude-opus-5"
                error={validationError ?? undefined}
                autoComplete="off"
                maxLength={256}
                required
              />
            </div>
            <div style={{ flex: "0 1 200px" }}>
              <Select
                label={t("simulator.endpoint")}
                value={endpoint}
                onValueChange={setEndpoint}
                options={SIMULATOR_ENDPOINTS.map((value) => ({ value, label: value }))}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              icon={<Play size={14} />}
              loading={simulation.isPending}
              disabled={simulation.isPending}
            >
              {simulation.isPending ? t("simulator.running") : t("simulator.run")}
            </Button>
          </form>
        </CardBody>
      </Card>

      {unavailable ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Info size={20} />}
              title={t("simulator.unavailable.title")}
              message={t("simulator.unavailable.message")}
              action={
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
                  {t("simulator.unavailable.endpoint", { path: SIMULATOR_ENDPOINT_PATH })}
                </p>
              }
              compact
            />
          </CardBody>
        </Card>
      ) : simulation.isError ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<AlertTriangle size={20} />}
              title={t("state.error.title")}
              message={simulation.error?.message ?? t("state.error.retryHint")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => simulation.mutate({ model: model.trim(), endpoint })}
                  disabled={model.trim().length === 0}
                >
                  {t("action.retry")}
                </Button>
              }
              compact
            />
          </CardBody>
        </Card>
      ) : result === undefined ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<RouteIcon size={20} />}
              title={t("simulator.title")}
              message={t("simulator.empty")}
              compact
            />
          </CardBody>
        </Card>
      ) : (
        <Stack gap="14px">
          <Card>
            <CardHeader
              title={t("simulator.result")}
              subtitle={result.resolvedModel ? `${result.model} → ${result.resolvedModel}` : result.model}
              icon={<RouteIcon size={15} />}
              action={
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {result.strategy ? (
                    <span className="badge badge-info">{result.strategy}</span>
                  ) : null}
                  {result.strategySource ? (
                    <span className="badge badge-default">
                      {t(
                        (`simulator.strategySource.${result.strategySource}` as MessageKey),
                      )}
                    </span>
                  ) : null}
                  {result.rotationActive ? (
                    <span className="badge badge-warn">
                      <Shuffle size={10} aria-hidden="true" style={{ marginRight: 4 }} />
                      {t("simulator.rotation.active")}
                    </span>
                  ) : null}
                  {result.readOnly ? (
                    <span className="badge badge-ok" title={t("simulator.readOnlyConfirmed")}>
                      {t("simulator.readOnlyBadge")}
                    </span>
                  ) : null}
                </div>
              }
            />
            <CardBody>
              <Stack gap="12px">
                {result.outcome ? (
                  <div
                    className="health-remediation"
                    data-tone={outcomeTone(result.outcome)}
                    role="status"
                    aria-live="polite"
                  >
                    {outcomeTone(result.outcome) === "ok" ? (
                      <CheckCircle2 size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                    ) : (
                      <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                    )}
                    <span>{t(OUTCOME_KEYS[result.outcome])}</span>
                  </div>
                ) : null}

                {/* The winner box appears ONLY when the gateway guarantees it.
                    Under rotation/fusion the note below replaces it. */}
                {showWinner && result.selected ? (
                  <div className="simulator-selected">
                    <CheckCircle2 size={18} aria-hidden="true" style={{ color: "var(--green)", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        {t("simulator.selected")}
                      </p>
                      <p
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          fontFamily: "var(--font-mono)",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {result.selected.providerId}
                        {result.selected.modelId ? ` · ${result.selected.modelId}` : ""}
                        {result.selected.accountId ? ` · ${result.selected.accountId}` : ""}
                      </p>
                    </div>
                  </div>
                ) : null}

                {rotationInstead ? (
                  <div className="health-remediation" role="note">
                    <Shuffle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong style={{ display: "block", marginBottom: 2 }}>
                        {t("simulator.rotation.title")}
                      </strong>
                      {t("simulator.rotation.body")}
                    </span>
                  </div>
                ) : null}

                {result.fusion ? (
                  <div className="simulator-selected" style={{ borderColor: "var(--inner-border)", background: "var(--surface-2)" }}>
                    <Layers size={18} aria-hidden="true" style={{ color: "var(--purple)", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700 }}>{t("simulator.fusion.title")}</p>
                      <p style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2 }}>
                        {t("simulator.fusion.body")}
                      </p>
                      <p style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", marginTop: 4, overflowWrap: "anywhere" }}>
                        {t("simulator.fusion.panel")}: {result.fusion.panel.join(", ") || "—"}
                        {result.fusion.judge ? ` · ${t("simulator.fusion.judge")}: ${result.fusion.judge}` : ""}
                      </p>
                    </div>
                  </div>
                ) : null}

                {result.unmatchedMembers.length > 0 ? (
                  <div className="health-remediation" data-tone="danger" role="alert">
                    <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong style={{ display: "block", marginBottom: 2 }}>
                        {t("simulator.unmatched.title")}
                      </strong>
                      {t("simulator.unmatched.body")}{" "}
                      <code style={{ overflowWrap: "anywhere" }}>{result.unmatchedMembers.join(", ")}</code>
                    </span>
                  </div>
                ) : null}

                <div className="about-facts">
                  {result.resolutionChain.length > 0 ? (
                    <div className="about-fact">
                      <span className="about-fact-label">{t("simulator.resolutionChain")}</span>
                      <span className="about-fact-value">
                        <GitBranch size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
                        {result.resolutionChain.join(" → ")}
                      </span>
                    </div>
                  ) : null}
                  {result.surface ? (
                    <div className="about-fact">
                      <span className="about-fact-label">{t("simulator.surface")}</span>
                      <span className="about-fact-value">{result.surface}</span>
                    </div>
                  ) : null}
                  {result.revision !== undefined ? (
                    <div className="about-fact">
                      <span className="about-fact-label">{t("simulator.revision")}</span>
                      <span className="about-fact-value">{result.revision}</span>
                    </div>
                  ) : null}
                  <div className="about-fact">
                    <span className="about-fact-label">{t("simulator.endpoint")}</span>
                    <span className="about-fact-value">{result.endpoint ?? endpoint}</span>
                  </div>
                </div>

                {result.notes.length > 0 ? (
                  <div>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--text-tertiary)",
                        marginBottom: 4,
                      }}
                    >
                      {t("simulator.notes")}
                    </p>
                    {/* Backend-owned prose, rendered verbatim — see the module
                        header's locale note. */}
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      {result.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t("simulator.candidates")}
              subtitle={t("simulator.candidatesCount", {
                eligible: eligibleCount,
                total: result.candidates.length,
              })}
              icon={<RouteIcon size={15} />}
            />
            <CardBody>
              {result.candidates.length === 0 ? (
                <EmptyState title={t("simulator.selectedNone")} message={t("simulator.empty")} compact />
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {result.candidates.map((candidate, index) => (
                    <CandidateRow
                      key={`${candidate.providerId}-${candidate.accountId ?? candidate.modelId}-${index}`}
                      candidate={candidate}
                    />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </Stack>
      )}
    </div>
  );
}
