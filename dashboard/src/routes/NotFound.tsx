/**
 * Not found: localized 404 with real navigation recovery.
 *
 * ── Conditional framing ────────────────────────────────────────────────────
 * The screen is reached from both the authenticated shell and the public
 * document, so the recovery actions adapt: a signed-in operator gets the
 * console routes, a public visitor gets the landing page and the sign-in link.
 * Guessing wrong strands the visitor — sending an anonymous reader to
 * `/console` would bounce them through the login guard for no reason.
 */
import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Compass, Home } from "lucide-react";
import { Button } from "../components/ui/button";
import { RikkaArt } from "../components/rikka/RikkaArt";
import { useT } from "../shared/locale-context";

export interface NotFoundProps {
  /** False when rendered by the public document rather than the console shell. */
  readonly authenticated?: boolean;
}

export default function NotFound({ authenticated = false }: NotFoundProps): ReactNode {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="fullpage-viewport">
      <div className="fullpage-card">
        <div className="fullpage-head">
          <RikkaArt name="not-found" width={96} height={96} radius="16px" />
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-tertiary)",
              }}
            >
              404
            </p>
            <h1 className="fullpage-title">{t("notFound.title")}</h1>
            <p className="fullpage-desc">
              {t("notFound.message", { path: location.pathname })}
            </p>
          </div>
        </div>

        {!authenticated ? (
          <p className="fullpage-desc" style={{ marginTop: 0 }}>
            {t("notFound.publicHint")}
          </p>
        ) : null}

        <div className="fullpage-actions">
          {authenticated ? (
            <>
              <Link to="/">
                <Button variant="primary" icon={<Home size={14} />}>
                  {t("notFound.goHome")}
                </Button>
              </Link>
              <Button
                variant="secondary"
                icon={<ArrowLeft size={14} />}
                onClick={() => navigate(-1)}
              >
                {t("notFound.goBack")}
              </Button>
            </>
          ) : (
            <>
              <a href="/">
                <Button variant="primary" icon={<Home size={14} />}>
                  {t("notFound.goHome")}
                </Button>
              </a>
              <a href="/console">
                <Button variant="secondary" icon={<Compass size={14} />}>
                  {t("nav.overview")}
                </Button>
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
