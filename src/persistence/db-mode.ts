/** Database mode + data directory resolution. */
import { existsSync, renameSync } from "node:fs";
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
 * ── Why the old directory is migrated rather than merely tolerated ─────────
 * The directory was named `Cartethyia` before the rename, and an installation
 * that has been running owns its whole database there. Pointing at a fresh
 * `Cloviela` directory instead would look exactly like total data loss, so the
 * old one has to keep working.
 *
 * Leaving it in place, though, means the old name never retires: every path
 * on disk, every backup instruction and every support conversation keeps
 * saying `Cartethyia`. So the directory is *moved* — once, at startup, when
 * the new name does not exist yet. A rename within one parent directory is
 * atomic on every filesystem this runs on, so there is no window in which
 * neither directory exists.
 *
 * The move is attempted and never fatal. A read-only home, a cross-device
 * layout, or a `Cloviela` that already exists all fall back to using the old
 * directory as it is: a working installation is worth more than a tidy one,
 * and an operator can always move it by hand.
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
  if (existsSync(preferred) || !existsSync(legacy)) return preferred;
  try {
    renameSync(legacy, preferred);
    return preferred;
  } catch {
    // Could not move it. Keep using it exactly as before rather than starting
    // from an empty directory, which would present as every key and provider
    // having vanished.
    return legacy;
  }
}
