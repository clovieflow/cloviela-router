/**
 * Readiness panel — the Overview's answer to "is this gateway actually usable
 * right now", as opposed to "is the process alive".
 *
 * It renders the same `useReadiness` report the onboarding journey uses, so the
 * two surfaces cannot disagree about whether the install is configured. Here it
 * is compressed to a single strip: the detailed journey lives on `/onboarding`.
 */
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, CircleDashed } from "lucide-react";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Button } from "./ui/button";
import { useReadiness } from "../hooks/readiness";
import { useT } from "../shared/locale-context";
import { LoadingState } from "./ui/state";

export function ReadinessPanel(): ReactNode {
  const t = useT();
  const readiness = useReadiness();

  if (readiness.isLoading) {
    return (
      <Card>
        <CardHeader title={t("overview.readiness")} />
        <CardBody>
          <LoadingState label={t("state.loading")} compact />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={t("overview.readiness")}
        subtitle={t("onboarding.progress", {
          done: readiness.completedRequired,
          total: readiness.totalRequired,
        })}
        action={
          <Link to="/onboarding">
            <Button variant="secondary" size="sm" icon={<ArrowRight size={13} />}>
              {t("nav.onboarding")}
            </Button>
          </Link>
        }
      />
      <CardBody>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {readiness.steps
            .filter((step) => step.required)
            .map((step) => (
              <li
                key={step.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  fontSize: 12,
                  borderBottom: "1px dashed var(--inner-border)",
                }}
              >
                {step.state === "done" ? (
                  <Check size={14} aria-hidden="true" style={{ color: "var(--green)", flexShrink: 0 }} />
                ) : step.state === "unknown" ? (
                  <AlertTriangle size={14} aria-hidden="true" style={{ color: "var(--orange)", flexShrink: 0 }} />
                ) : (
                  <CircleDashed size={14} aria-hidden="true" style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                )}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: step.state === "done" ? "var(--text-secondary)" : "var(--text-primary)",
                  }}
                >
                  {t(step.titleKey)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-mono)",
                    textAlign: "right",
                    overflowWrap: "anywhere",
                    maxWidth: "52%",
                  }}
                  title={step.detail}
                >
                  {/* Backend-owned detail string, verbatim. The row's primary
                      line above is localized from the closed step id, so this
                      can reword without changing the UI copy. */}
                  {step.detail ?? (step.state === "unknown" ? "?" : "—")}
                </span>
              </li>
            ))}
        </ul>
        {readiness.usingFallback ? (
          <p style={{ marginTop: 10, fontSize: 11, color: "var(--text-tertiary)" }}>
            {t("onboarding.usingFallback")}
          </p>
        ) : null}
        {readiness.isError ? (
          <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--orange)" }} role="alert">
            {t("state.error.retryHint")}
          </p>
        ) : null}
        {readiness.allRequiredDone ? (
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--green)", fontWeight: 600 }} role="status">
            {t("onboarding.complete")}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
