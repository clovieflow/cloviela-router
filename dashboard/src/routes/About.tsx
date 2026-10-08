/**
 * About: license, upstream attribution, the derivative notice, the unofficial
 * fan-theme disclaimer, and an honest localization-coverage statement.
 *
 * ── Why the localization gap is listed by name ─────────────────────────────
 * The product contract permits an accurate localization limitation instead of
 * full translation, but only if it is explicit. A vague "some pages may be in
 * English" is a claim the operator cannot check. This page enumerates the exact
 * routes that still render upstream English copy, from the same constant the
 * rest of the app reads, so the statement cannot silently drift from reality.
 *
 * ── Why the fan notice is not a footnote ───────────────────────────────────
 * The visual theme is derivative fan work around a licensed character. The
 * source stays GPL-3.0-only while the character identity does not belong to
 * this project, and the notice says both plainly rather than implying
 * endorsement or commercial rights.
 */
import { type ReactNode } from "react";
import { ExternalLink, Info, Scale, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Stack } from "../components/ui/stack";
import { useMissingArtNames } from "../components/rikka/RikkaArt";
import { RIKKA_ART_NAMES } from "../components/rikka/rikka-art-manifest";
import { GITHUB_REPO_URL } from "../components/patterns/github-badge";
import { PageHead } from "../components/PageHead";
import { useT } from "../shared/locale-context";
import { UNTRANSLATED_SURFACES } from "../shared/i18n";
import { DASHBOARD_RELEASE_LABEL } from "../shared/version";
import { useSystemHealth } from "../hooks/system";

export default function About(): ReactNode {
  const t = useT();
  const healthQuery = useSystemHealth();
  const missingArt = useMissingArtNames(RIKKA_ART_NAMES);
  const health = healthQuery.data;

  return (
    <div className="dashboard-page">
      <PageHead title={t("about.title")} description={t("about.subtitle")} art="app-icon" />

      <Card>
        <CardHeader title={t("about.title")} icon={<Info size={15} />} />
        <CardBody>
          <div className="about-facts">
            <div className="about-fact">
              <span className="about-fact-label">{t("about.version")}</span>
              <span className="about-fact-value">{DASHBOARD_RELEASE_LABEL}</span>
            </div>
            <div className="about-fact">
              <span className="about-fact-label">{t("about.gatewayVersion")}</span>
              <span className="about-fact-value">
                {healthQuery.isPending
                  ? t("state.loading")
                  : healthQuery.isError
                    ? t("state.offline")
                    : (health?.version ?? "—")}
              </span>
            </div>
            <div className="about-fact">
              <span className="about-fact-label">{t("about.runtime")}</span>
              <span className="about-fact-value">
                {health ? `${health.platform} · pid ${health.pid}` : "—"}
              </span>
            </div>
            <div className="about-fact">
              <span className="about-fact-label">{t("about.license")}</span>
              <span className="about-fact-value">GPL-3.0-only</span>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("about.license")} icon={<Scale size={15} />} />
        <CardBody>
          <Stack gap="12px">
            <p className="about-prose">{t("about.licenseBody")}</p>
            <div>
              <p className="about-prose" style={{ marginBottom: 6 }}>
                <strong>{t("about.upstream")}</strong>
              </p>
              <p className="about-prose">
                {t("about.upstreamBody", { repo: GITHUB_REPO_URL })}
              </p>
              <Button
                variant="secondary"
                size="sm"
                icon={<ExternalLink size={13} />}
                style={{ marginTop: 8 }}
                onClick={() => window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer")}
              >
                {GITHUB_REPO_URL.replace("https://github.com/", "")}
              </Button>
            </div>
            <div>
              <p className="about-prose" style={{ marginBottom: 6 }}>
                <strong>{t("about.derivative")}</strong>
              </p>
              <p className="about-prose">{t("about.derivativeBody")}</p>
            </div>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("about.fanNotice")} icon={<Sparkles size={15} />} />
        <CardBody>
          <div className="about-notice">
            <p className="about-prose">{t("about.fanNoticeBody")}</p>
          </div>
          <p className="about-prose" style={{ marginTop: 12 }}>
            {t("about.artCredit")}
          </p>
          {missingArt.length > 0 ? (
            <p className="about-missing-list" style={{ marginTop: 8 }} role="status">
              {t("about.artMissing", { count: missingArt.length })} {missingArt.join(", ")}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("about.localization")} />
        <CardBody>
          <Stack gap="10px">
            <p className="about-prose">{t("about.localizationBody")}</p>
            <p className="about-prose">
              <strong>
                {t("about.localizationGap", {
                  pages: UNTRANSLATED_SURFACES.map((surface) => surface.name).join(", "),
                })}
              </strong>
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.8 }}>
              {UNTRANSLATED_SURFACES.map((surface) => (
                <li key={surface.path}>
                  <code>{surface.path}</code> — {surface.name}
                </li>
              ))}
            </ul>
          </Stack>
        </CardBody>
      </Card>
    </div>
  );
}
