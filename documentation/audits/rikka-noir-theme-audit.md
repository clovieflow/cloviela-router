# Rikka Noir — theme audit

Scope: replace the blue/purple dark palette with a warm Japanese dark theme,
without breaking Rikka Day (light) or any existing artwork.

Status: **implemented and verified in a real browser.** Contrast was measured
per rendered element, not eyeballed.

## What was there

`dashboard/src/styles/base.css` owns the palette in two blocks:

| Block | Palette | Notes |
|---|---|---|
| `:root` | Rikka Day | warm cream + indigo, light |
| `:root[data-theme="dark"]` | Rikka Night | deep indigo-slate `#0b0f1a` + lavender `#8b93f8` |

`data-theme` is always the **resolved** theme (`light` | `dark`);
`shared/theme.ts` resolves `system` against the OS preference and mirrors the
raw choice to `data-theme-choice`. The stylesheet has no
`prefers-color-scheme` branch by design.

Hardcoded colour lived in four more places, found by grepping every literal
`#rrggbb` and `rgba(...)` in `dashboard/src`:

| Location | Problem |
|---|---|
| `styles/console.css` | terminal log colours, overview bar fills, avatar gradient — literal Apple system hues (`#63d6ff`, `#c9a6ff`, `#bf5af2`, `#0a84ff`, `#30d158`, `#ff9f0a`) |
| `styles/landing.css` | the public landing page was a separate navy palette (`#05070d`, `#0b1220`) with seven blue/violet/mint chapter accents |
| `index.html` | pre-bundle first-paint literals (`#0b0f1a`) — these must match the token block or the operator sees the old palette flash before React mounts |
| TSX inline styles | `#0a84ff` proxy bars, `var(--warn, #d97706)`, `var(--green, #2f9e44)` |

## What changed

### Tokens (`base.css`)

Rikka Noir — Sumi & Vermilion. Every surface carries a brown undertone
(R>G>B) so the console reads as ink on paper rather than a blue-black panel.

| Token | Value | Role |
|---|---|---|
| `--page-bg` | `#141210` | warm charcoal |
| `--surface-1` | `#211d1b` | cards |
| `--surface-2` | `#292320` | elevated |
| `--surface-muted` | `#1c1917` | inputs |
| `--surface-hover` | `#332b27` | hover |
| `--accent` | `#de776c` | vermilion — action only |
| `--gold` | `#d1ad79` | champagne — premium detail only |
| `--text-primary` | `#f2eae0` | warm ivory |
| `--text-secondary` | `#b7a99b` | |
| `--text-tertiary` | `#9a8c80` | |
| `--border-subtle` / `--border-strong` | `#38312d` / `#52443d` | graphite |
| `--status-success/warning/danger/info` | `#8faa92` / `#d7a45f` / `#da756c` / `#9aafa8` | semantic only |
| `--teal` / `--purple` / `--rose` / `--indigo` | `#8faaa4` / `#b9a0ae` / `#d19a93` / `#b5a79c` | category tags, desaturated |

The secondary hues are deliberately desaturated. They never mean status —
they tag a wire family or a capability — and a saturated violet tag would put
the replaced palette straight back on screen.

### Two art-direction values were corrected for contrast

Measured with the WCAG relative-luminance formula against `--surface-2`
`#292320`, the lightest surface they appear on:

| Token | Proposed | Measured | Shipped | Measured |
|---|---|---|---|---|
| `--accent` | `#c95f55` | 3.87:1 ✗ | `#de776c` | 5.14:1 ✓ |
| `--text-tertiary` | `#918579` | 4.30:1 ✗ | `#9a8c80` | 4.75:1 ✓ |

### Replacements at the owning layer

- **`console.css`** — the terminal renders on a fixed `#050606` in *both*
  themes, so its colours are measured against that surface, not the page:
  route `#63d6ff`→`#9ecfbf` (11.7:1), account `#c9a6ff`→`#c8a9a2` (9.3:1),
  tokens `#ffb454`→`#e0b97e` (11.0:1), body `#c8d3cf`→`#d5cec6` (13.0:1).
  Overview bar fills and the avatar gradient now read tokens.
- **`landing.css` + `apps/landing/page.tsx`** — retoned to the Noir family;
  the seven chapter accents map to sage, gold, dusty rose, mauve, vermilion,
  amber and sage.
- **`index.html`** — first-paint literals updated so there is no old-palette
  flash.
- **`CliToolDetail.tsx`** — a real bug: `var(--warn, #d97706)` asked for a
  token that **is defined nowhere**, so that colour never followed any theme.
  It now uses `--orange`, the token every other surface uses for the same
  meaning. `ProvidersPage.tsx` dropped a dead `var(--green, #2f9e44)` fallback.

### One light-mode fix

`.btn-danger` used a literal `#ffffff`. On Rikka Day's danger red (`#a8443f`)
that is 5.89:1, but on Noir's lighter salmon (`#da756c`) it measured
**3.11:1** — the only contrast failure found. It now uses
`--accent-foreground`, which resolves to ink in dark (6.00:1) and white in
Day (5.89:1).

## Verification

### Contrast — live Chromium, per rendered element

Method: walk every text node, composite its `color` over the nearest opaque
ancestor background, and compare with the WCAG formula at the element's real
font size and weight (4.5:1 normal, 3.0:1 large).

| Theme | Routes | Result |
|---|---|---|
| Rikka Noir (dark) | 14 | 0 violations |
| Rikka Day (light) | 14 | 0 violations |

Routes: `/`, `/onboarding`, `/health`, `/usage`, `/console-log`, `/providers`,
`/models`, `/combos`, `/simulator`, `/quota`, `/api-keys`, `/proxy`,
`/model-lab`, `/settings`, `/about`.

Before the `.btn-danger` fix the same pass reported 1 violation (3.11:1).

### Route rendering — live Chromium

All 18 console routes answered HTTP 200 with real content, `data-theme=dark`,
and zero horizontal document overflow. `/console-log` renders real log lines
("2 of 2 lines"); `/providers` renders the catalog; `/models` reports
"10 model".

### Artwork

All existing Rikka Takarada illustrations are retained and unmodified. The
ambient wash (`console.css .app-bg`) was retuned from indigo/slate/rose to
vermilion/gold/sumi so the art sits in a warm field. No image was
regenerated: the art direction clash was in the surrounding chrome, not the
illustrations.

## Files changed

```
dashboard/src/styles/base.css        palette, sidebar depth, .btn-danger
dashboard/src/styles/console.css     terminal, bars, avatar, ambient wash
dashboard/src/styles/landing.css     public landing retone
dashboard/src/styles/share.css       dialog veil
dashboard/index.html                 first-paint literals
dashboard/src/apps/landing/page.tsx  card + gradient literals
dashboard/src/routes/Overview.tsx    proxy bar colour
dashboard/src/routes/CliToolDetail.tsx  undefined --warn token
dashboard/src/features/providers/ProvidersPage.tsx  dead fallback
dashboard/src/shared/i18n.ts         theme label -> Rikka Noir
dashboard/src/components/rikka/rikka-art-manifest.ts  placement label
```

## Known limits

- The landing page (`/`) is a separate dark-only story surface by design; it
  was retoned but does not have a light variant, and never had one.
- Contrast was measured on the routes listed above. Provider *detail* pages
  that require a configured provider were not reachable in the isolated audit
  instance and are covered by the same token set, not by a separate pass.
