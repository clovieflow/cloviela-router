/**
 * Rikka art manifest — intrinsic sizes for every shipped illustration.
 *
 * ── Why this table exists ───────────────────────────────────────────────────
 * An `<img>` without width/height reserves no space, so the surrounding text
 * jumps when the art loads (a Cumulative Layout Shift the acceptance criteria
 * forbid). These numbers are the real optimized WebP dimensions produced by the
 * parent's generator pipeline and recorded in `assets/manifest.json` and
 * `.rikka-work/art-dimensions.json`; they are the browser-side mirror of that
 * provenance, not invented values.
 *
 * Keep in sync with the generator: a wrong number here does not break the
 * image, it just re-introduces the shift this table exists to prevent.
 *
 * ── Availability ────────────────────────────────────────────────────────────
 * A path listed here is not proof the file shipped. `RikkaArt` still handles a
 * 404 by removing the decoration and reporting it, so a build that drops an
 * asset degrades instead of showing a broken box.
 */

export interface RikkaArtAsset {
  /** Path under `public/`, resolved against Vite's BASE_URL at render time. */
  readonly path: string;
  readonly width: number;
  readonly height: number;
  /** What the generator pipeline intended this asset for. */
  readonly placement: string;
}

export const RIKKA_ART = {
  "story-first-signal": {
    path: "/rikka/story/01-first-signal.webp",
    width: 1600,
    height: 900,
    placement: "Landing chapter 01 — The First Signal",
  },
  "story-welcome": {
    path: "/rikka/story/02-welcome.webp",
    width: 1600,
    height: 900,
    placement: "Landing chapter 02 — The Many Voices",
  },
  "story-quiet-control": {
    path: "/rikka/story/06-quiet-control.webp",
    width: 1600,
    height: 900,
    placement: "Landing chapter 03 — The Quiet Control",
  },
  "story-many-voices": {
    path: "/rikka/story/03-many-voices.webp",
    width: 1600,
    height: 900,
    placement: "Landing chapter 04 — The Forked Path",
  },
  "story-boundary": {
    path: "/rikka/story/05-boundary.webp",
    width: 1600,
    height: 900,
    placement: "Landing chapter 05 — The Boundary",
  },
  "story-open-shore": {
    path: "/rikka/story/07-open-shore.webp",
    width: 1600,
    height: 900,
    placement: "Landing chapter 06 — The Open Shore",
  },
  "canonical-portrait": {
    path: "/rikka/canonical-portrait.webp",
    width: 768,
    height: 768,
    placement: "Canonical character reference",
  },
  avatar: {
    path: "/rikka/avatar.webp",
    width: 128,
    height: 128,
    placement: "Profile and share identity",
  },
  "app-icon": {
    path: "/rikka/app-icon.webp",
    width: 512,
    height: 512,
    placement: "Sidebar, share header and About manifest mark",
  },
  favicon: {
    path: "/rikka/favicon.webp",
    width: 128,
    height: 128,
    placement: "Browser favicon",
  },
  night: {
    path: "/rikka/night.webp",
    width: 1600,
    height: 640,
    placement: "Rikka Noir ambient or right edge",
  },
  day: {
    path: "/rikka/day.webp",
    width: 1600,
    height: 640,
    placement: "Rikka Day ambient or right edge",
  },
  login: {
    path: "/rikka/login.webp",
    width: 600,
    height: 800,
    placement: "Desktop auth portrait, noninteractive",
  },
  "login-environment": {
    path: "/rikka/login-environment.webp",
    width: 1200,
    height: 480,
    placement: "Auth scene",
  },
  welcome: {
    path: "/rikka/welcome.webp",
    width: 1280,
    height: 400,
    placement: "Onboarding welcome banner",
  },
  "dashboard-hero": {
    path: "/rikka/dashboard-hero.webp",
    width: 1280,
    height: 400,
    placement: "Overview welcome banner (warm dusk, matches the Noir palette)",
  },
  social: {
    path: "/rikka/social.webp",
    width: 1200,
    height: 630,
    placement: "OpenGraph preview",
  },
  share: {
    path: "/rikka/share.webp",
    width: 480,
    height: 640,
    placement: "Public token-scoped enrollment character",
  },
  "theme-night-thumbnail": {
    path: "/rikka/theme-night-thumbnail.webp",
    width: 320,
    height: 128,
    placement: "Theme chooser preview",
  },
  "theme-day-thumbnail": {
    path: "/rikka/theme-day-thumbnail.webp",
    width: 320,
    height: 128,
    placement: "Theme chooser preview",
  },
  providers: {
    path: "/rikka/providers.webp",
    width: 300,
    height: 300,
    placement: "providers compact header/state vignette",
  },
  routing: {
    path: "/rikka/routing.webp",
    width: 300,
    height: 300,
    placement: "routing compact header/state vignette",
  },
  models: {
    path: "/rikka/models.webp",
    width: 300,
    height: 300,
    placement: "models compact header/state vignette",
  },
  studio: {
    path: "/rikka/studio.webp",
    width: 300,
    height: 300,
    placement: "studio compact header/state vignette",
  },
  "api-keys": {
    path: "/rikka/api-keys.webp",
    width: 300,
    height: 300,
    placement: "api-keys compact header/state vignette",
  },
  quota: {
    path: "/rikka/quota.webp",
    width: 300,
    height: 300,
    placement: "quota compact header/state vignette",
  },
  usage: {
    path: "/rikka/usage.webp",
    width: 300,
    height: 300,
    placement: "usage compact header/state vignette",
  },
  logs: {
    path: "/rikka/logs.webp",
    width: 300,
    height: 300,
    placement: "logs compact header/state vignette",
  },
  health: {
    path: "/rikka/health.webp",
    width: 300,
    height: 300,
    placement: "health compact header/state vignette",
  },
  settings: {
    path: "/rikka/settings.webp",
    width: 300,
    height: 300,
    placement: "settings compact header/state vignette",
  },
  backups: {
    path: "/rikka/backups.webp",
    width: 300,
    height: 300,
    placement: "backups compact header/state vignette",
  },
  networks: {
    path: "/rikka/networks.webp",
    width: 300,
    height: 300,
    placement: "networks compact header/state vignette",
  },
  empty: {
    path: "/rikka/empty.webp",
    width: 300,
    height: 300,
    placement: "empty compact header/state vignette",
  },
  error: {
    path: "/rikka/error.webp",
    width: 300,
    height: 300,
    placement: "error compact header/state vignette",
  },
  "not-found": {
    path: "/rikka/not-found.webp",
    width: 300,
    height: 300,
    placement: "not-found compact header/state vignette",
  },
  loading: {
    path: "/rikka/loading.webp",
    width: 300,
    height: 300,
    placement: "loading compact header/state vignette",
  },
} as const satisfies Record<string, RikkaArtAsset>;

export type RikkaArtName = keyof typeof RIKKA_ART;

/** Every asset name the manifest declares, for build-time reporting. */
export const RIKKA_ART_NAMES = Object.keys(RIKKA_ART) as readonly RikkaArtName[];

/** Absolute URL for one asset, honouring a non-root Vite `base`. */
export function rikkaArtUrl(name: RikkaArtName): string {
  const base = import.meta.env.BASE_URL;
  return `${base.replace(/\/$/, "")}${RIKKA_ART[name].path}`;
}
