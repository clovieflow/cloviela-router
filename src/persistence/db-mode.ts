/** Database mode + data directory resolution. */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { envValue } from "../env-compat";
import { join } from "node:path";

/** Which database backend the gateway boots against. */
export type DbMode = "full" | "lite";

/**
 * Reads `CLOVIELA_DB_MODE`. Defaults to `full` so existing deployments never
 * change behavior unless they opt in; anything else fails closed at boot.
 */
export function resolveDbMode(env: NodeJS.ProcessEnv = process.env): DbMode {
  // Read through the compatibility helper: an operator's existing `.env` says
  // CARTETHYIA_DB_MODE, and reading only the new name would silently fall back
  // to `full` — turning a working Lite install into one that demands a
  // PostgreSQL it does not have.
  const configured = envValue("CLOVIELA_DB_MODE", env);
  const raw = (configured ?? "full").trim();
  if (raw !== "full" && raw !== "lite") {
    throw new Error(`CLOVIELA_DB_MODE must be lite or full (got "${configured}")`);
  }
  return raw;
}

/**
 * Writable root for gateway-owned on-disk state (PGlite data dir, and anything
 * else that needs the disk later). `CLOVIELA_DATA_DIR` wins; otherwise the
 * per-OS convention: `%APPDATA%/Cloviela` on Windows, `~/Library/Application
 * Support/Cloviela` on macOS, `$XDG_DATA_HOME/Cloviela` (else
 * `~/.local/share/Cloviela`) on Linux.
 *
 * ── Why the old directory is still preferred when it exists ────────────────
 * The directory was named `Cartethyia` before the rename. A gateway that has
 * been running already owns a database there, and silently switching to a
 * fresh `Cloviela` directory would look exactly like total data loss: every
 * provider, key and account gone. So the legacy directory keeps being used
 * while it exists, and the new one is created only for an installation that
 * has never run. Moving across is a plain directory move the operator can do
 * whenever they like, and doing it is what finally retires the old name.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = envValue("CLOVIELA_DATA_DIR", env)?.trim();
  if (override) return override;
  const home = homedir();
  const base =
    process.platform === "win32"
      ? (env.APPDATA?.trim() || home)
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support")
        : (env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"));
  const preferred = join(base, "Cloviela");
  const legacy = join(base, "Cartethyia");
  if (!existsSync(preferred) && existsSync(legacy)) return legacy;
  return preferred;
}
