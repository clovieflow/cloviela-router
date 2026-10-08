/**
 * Single source of truth for the `console-theme` preference.
 *
 * Shared by the pre-bundle bootstrap in `dashboard/index.html` and the
 * topbar `ThemeChooser` in `components/Shell.tsx`. Every read, write, and DOM
 * application of the theme value must flow through this module so those
 * callsites cannot drift.
 *
 * ── Why the choice and the resolved theme are two attributes ────────────────
 * The operator picks Night, Day, or System. Only Night/Day are real palettes,
 * so `theme.ts` resolves `system` against `prefers-color-scheme` and writes
 * the RESOLVED value to `data-theme` (`light` | `dark`). That keeps the
 * stylesheet free of a `prefers-color-scheme` branch that could disagree with
 * an explicit choice, and it means a `system` operator gets the OS palette
 * immediately rather than the light default the old `data-theme="system"`
 * left in place (no stylesheet matched that value).
 *
 * The raw preference is mirrored to `data-theme-choice` so the chooser can
 * show which of the three options is selected without re-reading storage.
 *
 * The inline script in `index.html` necessarily duplicates this logic (it runs
 * before the bundle loads); it is annotated to point here and must be kept in
 * sync manually if these values ever change.
 */

export type ConsoleThemeChoice = "system" | "light" | "dark";

/** The two palettes the design system actually defines. */
export type ConsoleResolvedTheme = "light" | "dark";

/** localStorage key for the persisted console theme. */
export const CONSOLE_THEME_KEY = "console-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseConsoleTheme(value: unknown): ConsoleThemeChoice {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function readConsoleTheme(fallback: ConsoleThemeChoice = "system"): ConsoleThemeChoice {
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    return parseConsoleTheme(window.localStorage.getItem(CONSOLE_THEME_KEY) ?? fallback);
  } catch {
    return fallback;
  }
}

/**
 * Resolves a stored choice to the palette that must be applied.
 *
 * `system` follows the OS; the explicit choices win outright so an operator
 * who picked Night keeps Night on a light-OS machine.
 */
export function resolveConsoleTheme(theme: ConsoleThemeChoice): ConsoleResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  const osPrefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches;
  return osPrefersDark ? "dark" : "light";
}

/** Resolves the effective dark mode for a stored choice (system follows the OS). */
export function isDarkEffective(theme: ConsoleThemeChoice): boolean {
  return resolveConsoleTheme(theme) === "dark";
}

/**
 * Applies a theme choice through the root attributes: `data-theme` carries the
 * resolved palette, `data-theme-choice` the operator's raw preference.
 */
export function applyConsoleTheme(theme: ConsoleThemeChoice): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolveConsoleTheme(theme);
  root.dataset.themeChoice = theme;
}

/** Persists a theme choice and applies it to the document. Storage errors are ignored. */
export function writeConsoleTheme(theme: ConsoleThemeChoice): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CONSOLE_THEME_KEY, theme);
    } catch {
      // Storage write error ignored — the DOM application below still takes effect.
    }
  }
  applyConsoleTheme(theme);
}

/**
 * Subscribes to OS palette changes.
 *
 * Only meaningful while the choice is `system`, but the subscription itself is
 * unconditional: the caller decides whether a change matters, and re-reading
 * `prefers-color-scheme` on every change is cheaper than tearing down and
 * rebuilding the listener each time the operator flips the choice.
 */
export function subscribeToOSTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(DARK_QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  // Safari < 14 and older WebKit expose only the deprecated pair.
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}
