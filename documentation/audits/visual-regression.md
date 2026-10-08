# Rikka Noir — visual regression evidence

Screenshots captured in Chromium from the running gateway, 2026-10-09.
Viewport 1440×900 for desktop, 390×844 for mobile. Dark theme is the default
under test; light is captured to prove Rikka Day is intact.

Files live in `screenshots/` as JPEG (1200px wide, quality 72; the PNG
originals were 9.2 MB, these are 3.0 MB). All 30 are from the same session as the
contrast and layout measurements recorded in
[`rikka-noir-theme-audit.md`](./rikka-noir-theme-audit.md).

## Dark — Rikka Noir

| Screen | File | Notes |
|---|---|---|
| Overview | `dark-overview.jpg` | warm charcoal canvas, vermilion selected nav item, readiness checklist rendering measured figures |
| Onboarding | `dark-onboarding.jpg` | step list with gold check marks |
| Providers | `dark-providers.jpg` | dense catalog, warm card surfaces, readable version badges |
| Models | `dark-models.jpg` | scrollable table, 10 models |
| Routing | `dark-routing.jpg` | combo list |
| Usage | `dark-usage.jpg` | chart on the new palette |
| Logs | `dark-logs.jpg` | terminal surface, sage/taupe/champagne field colours |
| Settings | `dark-settings.jpg` | form controls |
| About | `dark-about.jpg` | Credits section, version facts |
| Simulator | `dark-simulator.jpg` | route simulator |
| API keys | `dark-keys.jpg` | key list |
| Proxy | `dark-proxy.jpg` | network pools |

## Light — Rikka Day

Same twelve screens as `light-*.jpg`. Captured to prove the dark overhaul did
not leak into the light palette. Verified by measurement as well: 0 contrast
violations across 14 routes.

## Mobile — 390×844, dark

`mobile-overview.jpg`, `mobile-onboarding.jpg`, `mobile-providers.jpg`,
`mobile-models.jpg`, `mobile-routing.jpg`, `mobile-usage.jpg`.

The sidebar collapses to a drawer, tables scroll inside their container rather
than overflowing the page, and the onboarding action wraps below its step.

## What was checked, beyond the screenshots

Screenshots show the result; they do not prove behaviour. The same session
also measured, per rendered element:

- **Contrast** — every text node composited over its nearest opaque ancestor
  background, compared with the WCAG formula at the element's real font size
  and weight. 14 routes × 2 themes → **0 violations**.
- **Layout overflow** — every element's right edge against the viewport, with
  scrollable ancestors excluded, at 320, 375, 390, 430, 768, 1024, 1440 and
  1920 px → **0 uncontained overflows**.
- **Scroll reachability** — the Models table at 320px is 274→607 px inside a
  scroll container and `scrollLeft = 99999` reaches 333, so the content is
  reachable rather than clipped.

## Known limits

- The public landing page (`/`) is a separate dark-only story surface by
  design and has no light variant; it was retoned but is not in this set.
- Provider detail pages requiring a configured provider were not reachable in
  the isolated audit instance.
