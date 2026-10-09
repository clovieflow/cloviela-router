import { UserPlus } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { RikkaArt } from "../components/rikka/RikkaArt";
import { useT } from "../shared/locale-context";
import { consoleRequest } from "../data/api";
import { queryClient } from "../data/query-client";
import { queryKeys } from "../data/query-keys";

interface SetupResult {
  readonly status: "success" | "failed";
  readonly message?: string;
}

/**
 * The single operator account's name.
 *
 * Sign-in asks only for a password, so this is not a choice the operator
 * makes — it is sent with the request so the server keeps creating the same
 * account it always has.
 */
const DEFAULT_OPERATOR_USERNAME = "admin";

export default function Setup(): ReactNode {
  const t = useT();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  // Prefilled so a new installation can be opened immediately: the operator
  // changes it here, or from Settings after signing in. The field is a normal
  // editable input — nothing is hidden from the person setting the gateway up.
  //
  // This is a deliberately weak default and the gateway treats it as one: the
  // listener binds 127.0.0.1 unless an operator opts into 0.0.0.0, and the
  // Settings screen warns while the password is still this value. Change it
  // before exposing the console to anything but the local machine.
  const [password, setPassword] = useState("123456");
  const [confirm, setConfirm] = useState("123456");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 6) {
      setError("Administrator password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await consoleRequest<SetupResult>("/auth/setup", {
        method: "POST",
        body: JSON.stringify({
          username: DEFAULT_OPERATOR_USERNAME,
          password,
          ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        }),
      });
      if (result.status !== "success") {
        setError(result.message ?? "Setup failed. Please try again.");
        return;
      }
      // Clear any cached session state so a previously primed unauthenticated
      // `null` cannot steer the next sign-in back into a redirect loop.
      queryClient.removeQueries({ queryKey: queryKeys.session.current });
      navigate("/login", { replace: true });
    } catch (reason: unknown) {
      if (reason && typeof reason === "object" && "message" in reason) {
        const msg = (reason as { message: unknown }).message;
        if (typeof msg === "string") {
          setError(msg);
          return;
        }
      }
      setError("An unexpected network error occurred.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-viewport">
      <div className="card-solid auth-window">
        <div className="auth-header">
          <div className="auth-logo" aria-hidden="true" style={{ overflow: "hidden", padding: 0 }}>
            <RikkaArt name="app-icon" width="100%" height="100%" radius="0" priority />
          </div>
          <h1 className="auth-title">{t("setup.title")}</h1>
          <p className="auth-desc">{t("setup.subtitle")}</p>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <Input
            label="Display Name"
            hint="(optional)"
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            placeholder="e.g. Administrator, risun"
          />

          <Input
            label="Master Password"
            hint="(min. 6 chars)"
            id="setup-password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />

          <Input
            label="Confirm Password"
            id="setup-confirm"
            type="password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />

          {error ? (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                background: "var(--red-soft)",
                color: "var(--red)",
                fontSize: "12.5px",
                fontWeight: 500,
              }}
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <Button
            variant="primary"
            type="submit"
            disabled={pending}
            style={{ width: "100%", marginTop: "6px", height: "40px" }}
            icon={<UserPlus size={15} />}
          >
            {pending ? "Initializing…" : "Complete Setup"}
          </Button>
        </form>
      </div>
    </main>
  );
}
