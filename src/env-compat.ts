/**
 * Pre-rename environment variable compatibility.
 *
 * Every variable this project reads was spelled with the `CARTETHYIA_` prefix
 * before the rename. Those names are still honoured so an operator's existing
 * `.env` keeps working: renaming a product must not turn a running gateway
 * into one that cannot find its own configuration.
 *
 * The current prefix wins when both are set, so migrating is just "add the new
 * name, remove the old one". When the legacy spelling is finally dropped, this
 * file and its call sites are the whole change.
 *
 * The legacy prefix is assembled rather than written as one literal: a
 * find-and-replace pass over the codebase rewrote it into the current prefix
 * once already, which silently turned every fallback into an identity mapping
 * and made the gateway ignore a legacy `CARTETHYIA_DATA_DIR` override.
 */
const CURRENT_PREFIX = "CLOVIELA_";
const LEGACY_PREFIX = "CART" + "ETHYIA_";

/** Reads a variable by its current name, falling back to the pre-rename one. */
export function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const current = env[name];
  if (current !== undefined) return current;
  if (!name.startsWith(CURRENT_PREFIX)) return undefined;
  return env[`${LEGACY_PREFIX}${name.slice(CURRENT_PREFIX.length)}`];
}

// A rename pass that rewrites LEGACY_PREFIX into CURRENT_PREFIX would make
// every fallback read the name it was asked for, which is not a fallback. Fail
// loudly instead of shipping a gateway that ignores its own configuration.
if (LEGACY_PREFIX === CURRENT_PREFIX) {
  throw new Error("env-compat: the legacy prefix must differ from the current one");
}
