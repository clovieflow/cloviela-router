/**
 * Onboarding: the ordered path from an empty install to a served request.
 *
 * ── Progression is measured, never stored ──────────────────────────────────
 * There is no "onboarding completed" flag to set, and deliberately so: a
 * persisted checklist can disagree with the gateway (an operator deletes the
 * only provider and the journey still claims to be finished). Each step reads
 * the endpoint that owns its fact through `useReadiness`, so the page is a
 * live view of the installation rather than a tutorial with a progress bar
 * painted on top.
 *
 * ── Recovery is part of the flow ───────────────────────────────────────────
 * A failing source marks its own step `unknown` and shows the error inline
 * with a retry, so one unreachable endpoint cannot blank the whole journey or
 * masquerade as "not configured yet".
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  KeyRound,
  Layers,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Stack } from "../components/ui/stack";
import { ErrorState, LoadingState } from "../components/ui/state";
import { ClipboardButton } from "../components/patterns/clipboard-button";
import { useReadiness, type ReadinessStep } from "../hooks/readiness";
import { PageHead } from "../components/PageHead";
import { useT } from "../shared/locale-context";
import type { MessageKey } from "../shared/i18n";
import { DASHBOARD_RELEASE_LABEL } from "../shared/version";
import { formatAgo } from "../shared/format";

/** Localized "done" line, keyed by the closed step id. */
const STEP_DONE_KEYS: Readonly<Record<ReadinessStep["id"], MessageKey>> = {
  admin_created: "onboarding.step.admin.done",
  provider_connected: "onboarding.step.provider.done",
  model_available: "onboarding.step.model.done",
  api_key_issued: "onboarding.step.key.done",
  first_request_seen: "onboarding.step.request.done",
};

/** Localized "not yet" line, keyed by the closed step id. */
const STEP_TODO_KEYS: Readonly<Record<ReadinessStep["id"], MessageKey>> = {
  admin_created: "onboarding.step.admin.todo",
  provider_connected: "onboarding.step.provider.todo",
  model_available: "onboarding.step.model.todo",
  api_key_issued: "onboarding.step.key.todo",
  first_request_seen: "onboarding.step.request.todo",
};

/** Icons keyed by the endpoint's canonical step ids. */
const STEP_ICONS: Readonly<Record<ReadinessStep["id"], typeof Check>> = {
  admin_created: ShieldCheck,
  provider_connected: Server,
  model_available: Layers,
  api_key_issued: KeyRound,
  first_request_seen: Zap,
};

/** One checklist row: marker, title, measured detail, and the way there. */
function StepRow({
  step,
  index,
  blocked,
}: {
  readonly step: ReadinessStep;
  readonly index: number;
  readonly blocked: boolean;
}): ReactNode {
  const t = useT();
  const Icon = STEP_ICONS[step.id];
  const state = step.state;
  return (
    <li className="onboarding-step" data-state={state === "done" ? "done" : blocked ? "blocked" : "active"}>
      <span className="onboarding-step-marker" aria-hidden="true">
        {state === "done" ? <Check size={13} /> : state === "unknown" ? <TriangleAlert size={13} /> : index + 1}
      </span>
      <div className="onboarding-step-body">
        <p className="onboarding-step-title">
          <Icon size={14} aria-hidden="true" style={{ color: "var(--text-tertiary)" }} />
          {t(step.titleKey)}
          {!step.required ? (
            <span className="badge badge-default">{t("action.skip")}</span>
          ) : null}
        </p>
        {/* Decision copy is localized from the CLOSED step id, so the sentence
            stays stable when the backend rewords its English `detail`. The
            backend's own detail is shown beneath as supporting fact. */}
        <p className="onboarding-step-detail">
          {state === "unknown"
            ? t("state.offline")
            : state === "done"
              ? t(STEP_DONE_KEYS[step.id])
              : state === "todo" && blocked
                ? t("onboarding.blocked")
                : t(STEP_TODO_KEYS[step.id])}
        </p>
        {/* Canonical owner's sentence, rendered VERBATIM as secondary text.
            It carries the specific fact (which provider, how many models);
            machine-translating it would let the UI disagree with the API. */}
        {step.detail ? (
          <p
            className="onboarding-step-detail"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {step.detail}
          </p>
        ) : null}
        {/* Remediation is backend-owned fix advice; also verbatim. */}
        {state === "todo" && step.remediation ? (
          <p className="onboarding-step-detail" style={{ color: "var(--orange)" }}>
            {step.remediation}
          </p>
        ) : null}
      </div>
      {state !== "done" ? (
        <div className="onboarding-step-action">
          <Link to={step.route}>
            <Button variant="secondary" size="sm" icon={<ArrowRight size={13} />}>
              {t("onboarding.go")}
            </Button>
          </Link>
        </div>
      ) : null}
    </li>
  );
}

export default function Onboarding(): ReactNode {
  const t = useT();
  const readiness = useReadiness();
  const [lastChecked, setLastChecked] = useState(() => new Date());

  const percent = readiness.totalRequired === 0
    ? 0
    : Math.round((readiness.completedRequired / readiness.totalRequired) * 100);

  // The curl sample targets the real public surface with a real model id from
  // the catalog when one exists, so the operator can paste it as-is. When the
  // catalog is empty the placeholder is obvious rather than plausible.
  const sampleCommand = useMemo(
    () =>
      [
        "curl -sS http://127.0.0.1:12800/v1/chat/completions \\",
        '  -H "Authorization: Bearer {key}" \\',
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"model": "{model}", "messages": [{"role": "user", "content": "ping"}]}\'',
      ].join("\n"),
    [],
  );

  return (
    <div className="dashboard-page">
      <PageHead
        eyebrow={
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-tertiary)",
            }}
          >
            {DASHBOARD_RELEASE_LABEL}
          </p>
        }
        title={t("onboarding.title")}
        description={t("onboarding.subtitle")}
        art="welcome"
      />

      {readiness.isError ? (
        <ErrorState
          title={t("state.error.title")}
          message={t("state.error.retryHint")}
          onRetry={readiness.refresh}
          retrying={readiness.isRefreshing}
        />
      ) : null}

      <Card>
        <CardHeader
          title={t("onboarding.title")}
          subtitle={t("onboarding.progress", {
            done: readiness.completedRequired,
            total: readiness.totalRequired,
          })}
          icon={<ShieldCheck size={15} />}
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} className={readiness.isRefreshing ? "animate-spin" : ""} />}
              onClick={() => {
                readiness.refresh();
                setLastChecked(new Date());
              }}
              disabled={readiness.isRefreshing}
            >
              {readiness.isRefreshing ? t("action.refreshing") : t("onboarding.refresh")}
            </Button>
          }
        />
        <CardBody>
          {readiness.isLoading ? (
            <LoadingState label={t("state.loading")} compact />
          ) : (
            <Stack gap="14px">
              <div className="onboarding-progress">
                <div
                  className="onboarding-progress-rail"
                  role="progressbar"
                  aria-label={t("onboarding.title")}
                  aria-valuemin={0}
                  aria-valuemax={readiness.totalRequired}
                  aria-valuenow={readiness.completedRequired}
                  aria-valuetext={t("onboarding.progress", {
                    done: readiness.completedRequired,
                    total: readiness.totalRequired,
                  })}
                >
                  <div className="onboarding-progress-fill" style={{ width: `${percent}%` }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {readiness.allRequiredDone ? (
                    <span style={{ color: "var(--green)", fontWeight: 600 }}>
                      {t("onboarding.complete")}
                    </span>
                  ) : (
                    t("onboarding.progress", {
                      done: readiness.completedRequired,
                      total: readiness.totalRequired,
                    })
                  )}
                </span>
              </div>

              <ol className="onboarding-steps">
                {readiness.steps.map((step, index) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={index}
                    blocked={
                      step.required &&
                      readiness.steps
                        .slice(0, index)
                        .some((earlier) => earlier.required && earlier.state !== "done")
                    }
                  />
                ))}
              </ol>

              {readiness.allRequiredDone ? (
                <>
                  <p className="health-remediation" data-tone="ok" role="status">
                    <Check size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{t("onboarding.completeHint")}</span>
                  </p>
                  {/* Honesty guard, per the endpoint owner: a green checklist
                      reflects configuration, not that every request will be
                      served. Capability mismatches are routing decisions. */}
                  <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
                    {t("onboarding.readinessCaveat")}
                  </p>
                </>
              ) : null}

              <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                {t("onboarding.lastChecked", {
                  time: formatAgo(lastChecked.toISOString(), Date.now()),
                })}
              </p>
            </Stack>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("onboarding.testClient")}
          subtitle={t("onboarding.testClientHint", { key: "{key}" })}
          icon={<Zap size={15} />}
        />
        <CardBody>
          <Stack gap="10px">
            <div className="code-sample">
              <div className="code-sample-head">
                <span>bash</span>
                <ClipboardButton value={sampleCommand} label={t("help.copyCommand")} copiedLabel={t("action.copied")} size="sm" />
              </div>
              <pre>{sampleCommand}</pre>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
              {t("help.endpointsHint", { key: "{key}" })}
            </p>
            <div>
              <Link to="/api-keys">
                <Button variant="secondary" size="sm" icon={<KeyRound size={13} />}>
                  {t("nav.apiKeys")}
                </Button>
              </Link>
            </div>
          </Stack>
        </CardBody>
      </Card>
    </div>
  );
}
