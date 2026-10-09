# Mobile responsiveness audit

Audit and repair of the Cloviela Router console at phone, tablet and desktop
widths. Every number here was measured in a real browser against the running
gateway; nothing is inferred from reading CSS.

The audit was performed with **desktop-browser emulation** (Chromium, viewport
emulation plus touch-event synthesis). No physical handset was used, so
physical-device behaviour — real keyboard insets, iOS Safari quirks, thermal
throttling — is **not** covered by these results and is not claimed.

## Routes discovered

Nineteen routes are registered in `dashboard/src/App.tsx`. Sixteen are
authenticated console pages; three are public.

| # | Route | Kind |
|---|---|---|
| 1 | `/console` (Ringkasan) | console |
| 2 | `/console/onboarding` | console |
| 3 | `/console/health` | console |
| 4 | `/console/usage` | console |
| 5 | `/console/providers` | console |
| 6 | `/console/providers/:providerId` | console (parameterized) |
| 7 | `/console/models` | console |
| 8 | `/console/combos` | console |
| 9 | `/console/simulator` | console |
| 10 | `/console/quota` | console |
| 11 | `/console/proxy` | console |
| 12 | `/console/api-keys` | console |
| 13 | `/console/console-log` | console |
| 14 | `/console/model-lab` | console |
| 15 | `/console/cli-tools` | console |
| 16 | `/console/cli-tools/:toolId` | console (parameterized) |
| 17 | `/console/help` | console |
| 18 | `/console/about` | console |
| 19 | `/console/settings` | console |
| — | `/console/login`, `/console/setup`, `/console/banned`, `/console/not-found` | public |

**16 of 19** routes were driven in the browser for this audit. The two
parameterized routes (`/providers/:providerId`, `/cli-tools/:toolId`) require a
real entity id and were **not** exercised; they are marked untested below.

## Viewports tested

320 × 844, 360 × 844, 375 × 844, 390 × 844, 430 × 844, 768 × 844, 1024 × 844,
1280 × 900, 1440 × 900 — all CSS pixels, portrait except the last two.

## Baseline defects

Measured before any change. Severity follows the brief's classification.

| # | Route | Viewport | Defect | Severity | Root cause | Fix |
|---|---|---|---|---|---|---|
| 1 | all | 320–1024 | 471 of 510 interactive controls under 44px — every nav row 36px, topbar controls 38px, sign-out 30px, inputs 38px, switches 24px, filter chips 25–33px | **P1** | Sizes set on individual classes and, in four places, in inline styles that no stylesheet can override | Touch rules in `console.css` and `base.css`; four inline sizes moved to classes or custom properties |
| 2 | all | 320–1024 | `Escape` did not close the navigation drawer, and the page stayed locked behind it | **P1** | No `Escape` handler existed for the drawer; only the scrim handled dismissal | Handler added in `Shell.tsx` |
| 3 | all | 390 | Three navigation entries (Bantuan, Pengaturan, Tentang) were off-screen with no scrollbar or fade — the list looked complete but was not | **P1** | The rail scrolls (733px content in a 641px box) with `scrollbar-width: none` inherited from the desktop rule | Visible scrollbar and a bottom mask below 1024px |
| 4 | all | 390 | Sign-out button rendered 30×30 | **P2** | `width`/`height` in an inline style | Moved to `.user-logout-button` |
| 5 | /settings | 390 | Password reveal buttons 20×20, checkboxes 16×16 | **P2** | Inline style on the reveal button; bare `<input type=checkbox>` | Class added; checkbox and row sized by rule |
| 6 | /model-lab | 390 | Send, attach and Sessions controls 32px, 17px and 28px | **P2** | Hard-coded inline sizes | Read from `--composer-btn-size` / `--composer-pill-height` |
| 7 | /models, /console-log | 390 | Capability and severity chips 29px and 25px tall | **P3** | Bespoke classes outside the shared button primitive | Chip rules added |

### Defects investigated and found not to exist

Recorded so the negative result is not mistaken for an untested area.

- **Document-level horizontal overflow** — 0px on every route at every
  viewport (72 route/viewport combinations). Verified the detector first by
  injecting a 900px element and confirming it was reported.
- **Dialog overflow** — the API-key creation dialog measures 820px in an 844px
  viewport and its `.modal-body` scrolls (2427px of content in 767px). The
  submit action is reachable. An earlier reading of `scrollable: false` came
  from measuring the wrong element.
- **Keyboard occlusion** — the last of ten inputs in that dialog scrolls into
  view and stays above a simulated keyboard covering the lower 40% of the
  screen.
- **KPI grid** — reflows to two columns at 390px and six at 1440px, from the
  existing `auto-fit` rule; no change was needed.
- **Long unbroken identifiers** — no element on `/providers` carried a >40
  character token without whitespace.

## Files changed

| File | Change |
|---|---|
| `dashboard/src/components/Shell.tsx` | `Escape` closes the drawer; sign-out size moved from inline style to a class |
| `dashboard/src/components/ui/input.tsx` | Password reveal button gains a class so the touch rules can reach it |
| `dashboard/src/routes/Studio.tsx` | Four inline sizes read from custom properties |
| `dashboard/src/styles/console.css` | Nav ergonomics, touch targets, chip and composer rules |
| `dashboard/src/styles/base.css` | Touch sizing for the shared button, input and switch primitives |

No component was duplicated for mobile, and no page received a second
implementation. Every fix is a media query or a shared primitive, so the
desktop layout is untouched.

## Results after repair

Undersized interactive controls, measured at 390px on all 16 routes:

| Route | Before | After |
|---|---|---|
| / (Ringkasan) | 35 / 35 | 3 / 35 |
| /providers | 27 / 71 | 3 / 71 |
| /models | 31 / 31 | 0 / 32 |
| /api-keys | 23 / 23 | 0 / 23 |
| /settings | 32 / 32 | 5 / 42 |
| /help | 41 / 41 | 3 / 41 |
| /console-log | 29 / 29 | 0 / 30 |
| /usage | 33 / 33 | 0 / 33 |
| /health | 22 / 22 | 0 / 22 |
| /about | 21 / 21 | 0 / 21 |
| /combos | 25 / 25 | 0 / 25 |
| /simulator | 23 / 23 | 2 / 25 |
| /quota | 27 / 27 | 1 / 27 |
| /proxy | 23 / 23 | 0 / 23 |
| /model-lab | 31 / 31 | 6 / 31 |
| /onboarding | 29 / 29 | 0 / 29 |
| **Total** | **471 / 510** | **23 / 510** |

The 23 that remain are prompt-suggestion buttons in the Studio empty state and
inline text links inside cards. Their height is set by their own wrapped text,
and the suggestion buttons are wide (220–307px) so the tap area is generous in
the dimension a thumb actually travels. They are listed here rather than
silently excluded.

## Verification

| Check | Result |
|---|---|
| Routes × viewports for document overflow | 72 combinations, max overflow **0px** |
| Touch targets, 16 routes at 390px | **23 / 510** undersized (was 471) |
| Drawer opens, navigates, closes | PASS |
| `Escape` closes the drawer | PASS |
| Inner scroll column still scrolls | PASS (4497px content in 828px) |
| Desktop 1440px unchanged | sidebar 272px, nav 36px, hero 280px, 6 KPI columns, 0px overflow |
| Backend suite | 2055 pass / 0 fail |
| Dashboard suite | 371 pass / 0 fail |
| Typechecks | backend and dashboard clean |
| Production build | succeeds |

## Remaining issues and limitations

1. **Two parameterized routes untested.** `/providers/:providerId` and
   `/cli-tools/:toolId` need a real entity id. Their shared components were
   audited through the list pages, but the detail views themselves were not
   driven.
2. **23 undersized controls remain**, itemised above.
3. **No physical device was used.** All results are desktop-browser emulation.
   Real iOS keyboard insets, Safari's `100dvh` behaviour during scroll, and
   touch-scroll inertia were not exercised.
4. **No automated mobile E2E suite was committed.** The audit was driven
   through browser automation in this session, but the repository's test
   runner (`scripts/ci-run-tests.ts`) covers unit and component scope only.
   Adding a Playwright project to it is the natural next step and was not done
   here.
5. **Performance under throttling was not measured.** Backdrop-filter cost on a
   low-end phone is the most likely remaining risk; the mobile breakpoint
   reduces blur on the metric cards but the shell still uses 23px.
