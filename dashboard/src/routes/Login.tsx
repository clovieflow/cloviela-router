import { LogIn, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { AuthArt } from "../components/rikka/art-surfaces";
import { RikkaArt } from "../components/rikka/RikkaArt";
import { consoleRequest } from "../data/api";
import { queryClient } from "../data/query-client";
import { queryKeys } from "../data/query-keys";
import { useT, type TranslateFn } from "../shared/locale-context";

interface LoginResult {
  readonly status: "success" | "failed";
  readonly message?: string;
  readonly requires_setup?: boolean;
}

function safeReturnPath(value: string | null): string {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

/**
 * Maps a failed sign-in to operator-facing copy.
 *
 * The gateway's lockout and rate-limit paths answer 429 (and 403 for a locked
 * address), and the raw message is either generic or absent. Rendering the
 * specific cause is the difference between "wait a minute" and "your password
 * is wrong, and now you are locked out because you kept trying".
 */
function loginFailureMessage(error: unknown, t: TranslateFn): string {
  if (typeof error !== "object" || error === null) return t("login.networkError");
  const status = "status" in error ? error.status : undefined;
  const code = "code" in error ? error.code : undefined;
  if (status === 429 || code === "rate_limited" || code === "too_many_requests") {
    return t("login.rateLimited");
  }
  if (status === 403 || code === "locked_out" || code === "ip_locked") {
    return t("login.lockedOut");
  }
  if (status === 401 || status === 400) {
    return t("login.failed");
  }
  if ("message" in error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  return t("login.networkError");
}

/**
 * The operator account name.
 *
 * Setup creates exactly one account, so the sign-in form asks only for the
 * password and sends this name with the request. Keeping the field in the
 * payload rather than removing it from the API means the server's contract,
 * its lockout keying and its audit records are all unchanged.
 */
const DEFAULT_OPERATOR_USERNAME = "admin";

export default function Login(): ReactNode {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  useEffect(() => {
    let active = true;
    void consoleRequest<{ requires_setup: boolean }>("/auth/first-boot")
      .then((result) => {
        if (!active) return;
        if (result.requires_setup) {
          navigate("/setup", { replace: true });
          return;
        }
        setCheckingSetup(false);
      })
      .catch(() => {
        if (active) setCheckingSetup(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await consoleRequest<LoginResult>("/auth/login", {
        method: "POST",
        // The account name is fixed by setup; the server still receives it.
        body: JSON.stringify({ username: DEFAULT_OPERATOR_USERNAME, password }),
      });
      if (result.status !== "success") {
        if (result.requires_setup) {
          navigate("/setup", { replace: true });
          return;
        }
        setError(result.message ?? t("login.failed"));
        return;
      }
      // Drop any cached session state (including a stale unauthenticated
      // `null`) so the protected-route guard refetches the now-authenticated
      // session instead of replaying the null and bouncing back to /login.
      queryClient.removeQueries({ queryKey: queryKeys.session.current });
      navigate(result.requires_setup ? "/setup" : safeReturnPath(params.get("returnTo")), {
        replace: true,
      });
    } catch (reason: unknown) {
      setError(loginFailureMessage(reason, t));
    } finally {
      setPending(false);
    }
  };

  if (checkingSetup) {
    return (
      <main className="auth-viewport">
        <div className="card-solid auth-window">
          <div className="auth-header">
            <div className="auth-logo" aria-hidden="true" style={{ overflow: "hidden", padding: 0 }}>
              <RikkaArt name="app-icon" width="100%" height="100%" radius="0" priority />
            </div>
            <h1 className="auth-title">{t("login.title")}</h1>
            <p className="auth-desc">{t("login.checkingSetup")}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-viewport">
      <div className="auth-split">
        <div className="card-solid auth-window">
          <div className="auth-header">
            <div className="auth-logo" aria-hidden="true" style={{ overflow: "hidden", padding: 0 }}>
              <RikkaArt name="app-icon" width="100%" height="100%" radius="0" priority />
            </div>
            <h1 className="auth-title">{t("login.title")}</h1>
            <p className="auth-desc">{t("login.subtitle")}</p>
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <Input
              label={t("login.password")}
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            {error ? (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: "var(--red-soft)",
                  color: "var(--red)",
                  fontSize: "12.5px",
                  fontWeight: 500,
                  lineHeight: 1.5,
                }}
                role="alert"
              >
                <ShieldAlert size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            ) : null}

            <Button
              variant="primary"
              type="submit"
              disabled={pending}
              style={{ width: "100%", marginTop: "6px", height: "40px" }}
              icon={<LogIn size={15} />}
              loading={pending}
            >
              {pending ? t("login.pending") : t("login.submit")}
            </Button>
          </form>
        </div>

        {/* Decorative portrait column. `AuthArt` self-hides when the asset is
            absent and below 900px, and it is aria-hidden, so it never competes
            with the form for a screen reader or a phone's width. */}
        <AuthArt alt={t("login.artAlt")} />
      </div>
    </main>
  );
}
