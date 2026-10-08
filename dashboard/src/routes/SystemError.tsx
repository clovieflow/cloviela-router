/**
 * System error: safe recovery surface for a render failure.
 *
 * ── What is safe to show ───────────────────────────────────────────────────
 * The message and stack come from the React error boundary, which catches
 * render-phase failures in this app's own components. Those messages are
 * written by dashboard code — they describe a failed render, not a request.
 * Provider credentials never reach a React component, so they cannot appear
 * here, and the page says so explicitly rather than leaving the reader to
 * wonder whether the block above them is leaking something.
 *
 * The diagnostic id is derived from the error and the route, so an operator
 * can quote one short string in a report and a maintainer can tell two
 * different crashes apart. It is a hash of the message, not a memory address
 * or a session identifier.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertOctagon, Copy, Home, RotateCcw, Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { RikkaArt } from "../components/rikka/RikkaArt";
import { useT } from "../shared/locale-context";

/**
 * Deterministic short id for one crash.
 *
 * FNV-1a over `route + message`: stable across reloads for the same fault
 * (so two reports of the same bug match) and different for a different fault.
 * Not cryptographic, and it must not be — it identifies a report, it does not
 * protect anything.
 */
function diagnosticId(route: string, message: string): string {
  const input = `${route}::${message}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `RK-${hash.toString(16).padStart(8, "0").toUpperCase()}`;
}

export interface SystemErrorProps {
  readonly error: Error;
  /** Clears the boundary and re-renders the route; absent means reload only. */
  readonly onReset?: () => void;
}

export default function SystemError({ error, onReset }: SystemErrorProps): ReactNode {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const id = useMemo(() => diagnosticId(location.pathname, error.message), [location.pathname, error.message]);

  const copyId = () => {
    void navigator.clipboard?.writeText(id).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div className="fullpage-viewport">
      <div className="fullpage-card">
        <div className="fullpage-head">
          <RikkaArt name="error" width={96} height={96} radius="16px" />
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--red)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <AlertOctagon size={12} aria-hidden="true" />
              {t("systemError.title")}
            </p>
            <h1 className="fullpage-title">{location.pathname}</h1>
            <p className="fullpage-desc">{t("systemError.message")}</p>
          </div>
        </div>

        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-tertiary)",
              marginBottom: 5,
            }}
          >
            {t("systemError.diagnosticId")}
          </p>
          <div className="diagnostic-id">
            <span style={{ flex: 1, minWidth: 0 }}>{id}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={copied ? <Check size={12} /> : <Copy size={12} />}
              aria-label={t("systemError.copyId")}
              title={t("systemError.copyId")}
              onClick={copyId}
            />
          </div>
        </div>

        <div className="fullpage-actions">
          {onReset ? (
            <Button
              variant="primary"
              icon={<RotateCcw size={14} />}
              onClick={() => {
                onReset();
                navigate(location.pathname, { replace: true });
              }}
            >
              {t("systemError.goHome")}
            </Button>
          ) : null}
          <Button
            variant={onReset ? "secondary" : "primary"}
            icon={<RotateCcw size={14} />}
            onClick={() => window.location.reload()}
          >
            {t("systemError.reload")}
          </Button>
          <Button variant="ghost" icon={<Home size={14} />} onClick={() => navigate("/")}>
            {t("notFound.goHome")}
          </Button>
        </div>

        <details>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: 8,
            }}
          >
            {t("systemError.details")}
          </summary>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 8 }}>
            {t("systemError.leakNotice")}
          </p>
          <pre className="diagnostic-details">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </details>
      </div>
    </div>
  );
}
