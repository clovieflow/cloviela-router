# Bug remediation report

Every defect below was reproduced against the running application before it was
fixed, and the fix was verified through the real boundary — a browser, a live
gateway, or a real database engine. No entry is inferred from reading code.

Severity follows the assignment's classification. Bug IDs are local to this
report.

---

## P1 — `GET /console/api/system/readiness` was never mounted

**Feature:** console readiness checklist (Overview, Onboarding).

**Reproduction.** `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:12899/console/api/system/readiness` → `404`. Loading `/console` in Chromium and recording failed responses showed the same request returning 404 on every console boot.

**Expected.** The endpoint returns `{ ready, generatedAt, checks: [...] }` with the five step ids `admin_created | provider_connected | model_available | api_key_issued | first_request_seen`.

**Actual.** The route did not exist. The dashboard had always called it and
carried a client-side composition of the same five facts as a "transition
fallback" for exactly this 404, so the failure was invisible: Overview and
Onboarding silently fired four extra requests and rendered a checklist
assembled in the browser. The final report listed the endpoint as "still in
flight"; it had simply never been written.

**Root cause.** The frontend half shipped; the backend half did not. The
fallback that existed to cover a rollout window was never removed, which
converted a missing feature into a silent one.

**Affected callers.** `dashboard/src/hooks/readiness.ts` (`useReadiness`),
consumed by `routes/Overview.tsx` and `routes/Onboarding.tsx`.

**Fix.** `src/console/observability/contracts.ts` gains the response contract,
the store port, the operation, and the route; `src/console/observability/store.ts`
implements it with five real queries. The four gating steps decide `ready` —
a gateway with a key issued is usable even if no client has called it yet —
and every count is measured, never inferred from configuration.

**Regression test.** `test/console/readiness-endpoint.test.ts` (9 tests). It
builds its own PGlite database in the OS temp dir rather than calling
`bootDatabase()`, which resolves the operator's real data directory when
`CARTETHYIA_DATA_DIR` is unset — a plain `bun test <file>` would otherwise
write test tenants into a live gateway. That mistake was made and cleaned up
during this session; see "Process notes".

**Verified through the real boundary.** After the fix, `/console` and
`/console/onboarding` in Chromium make zero failing requests and render
measured figures from the endpoint (`1 provider(s) connected`,
`466 routable model(s)`).

---

## P2 — `var(--warn, #d97706)` referenced a token that does not exist

**Feature:** CLI tool detail — the "this key does not allow the target model"
hint.

**Reproduction.** `grep -rn -- '--warn:' dashboard/src/styles/*.css` → no
matches. The variable is defined nowhere.

**Expected.** The warning colour follows the active theme.

**Actual.** The fallback `#d97706` was always used, in both themes. It is the
only place in the dashboard that named a warning colour as `--warn`; the other
23 call sites use `--orange`.

**Root cause.** A typo'd token name, made invisible by a fallback value that
happened to look acceptable.

**Fix.** `dashboard/src/routes/CliToolDetail.tsx` uses `var(--orange)`, the
token every other surface uses for that meaning.

---

## P2 — `.btn-danger` white text failed contrast in the new dark palette

**Feature:** Settings — "Delete selected".

**Reproduction.** Live Chromium contrast pass (WCAG relative-luminance against
the composited background): `3.11:1` where `4.5:1` is required. This was the
only violation found in 14 routes.

**Expected.** At least 4.5:1 in both themes.

**Actual.** `.btn-danger` set a literal `color: #ffffff`. That is 5.89:1 on
Rikka Day's danger red, but the new dark danger red is a lighter salmon, so
white on it fell to 3.11:1.

**Root cause.** A literal colour in a shared component that both themes use.

**Fix.** `dashboard/src/styles/base.css` uses `var(--accent-foreground)`, which
resolves to ink in dark (6.00:1) and white in Day (5.89:1).

**Verified.** The same live pass now reports **0 violations across 14 routes in
both themes**.

---

## P2 — Onboarding step action overflowed narrow viewports

**Feature:** Onboarding, at 320–560px.

**Reproduction.** Chromium at 320px: `.onboarding-step-action` extends `27px`
past the viewport.

**Expected.** The action button wraps onto its own line and stays inside the
viewport.

**Actual.** At `max-width: 560px` the rule set `width: 100%` on the action
while leaving it `flex: 0 0 auto` inside a non-wrapping flex row — wider than
its container by definition.

**Fix.** `dashboard/src/styles/console.css` allows the step to wrap at that
breakpoint.

**Verified.** A 320px and 375px sweep over 14 routes now reports zero
uncontained overflow.

---

## P2 — Hardcoded system colours ignored the theme

**Feature:** console log terminal, overview bars, avatar, public landing page.

**Reproduction.** Literal `#rrggbb` / `rgba()` scan of `dashboard/src`.

**Actual.** The terminal log used `#63d6ff` (sky) for routes and `#c9a6ff`
(violet) for accounts; overview bar fills used iOS system blue/violet/green;
the avatar gradient used orange→hot pink; the landing page and the pre-bundle
`index.html` first paint were a separate navy palette.

**Root cause.** Each was a literal at its own call site rather than a token, so
no palette change could reach it.

**Fix.** Replaced at the owning layer, with terminal colours measured against
the terminal's own fixed `#050606` surface (route 11.7:1, account 9.3:1,
tokens 11.0:1, body 13.0:1).

---

## P3 — E2E harness: seven defects that made a healthy gateway look broken

These are test-infrastructure defects, but they produced the loudest false
signal in the project: 111 reported failures across three families, and a
release report that listed the entire GW/SEC/DB/CLI matrix as never executed.

Full detail and the fix table are in
[`e2e-coverage-matrix.md`](./e2e-coverage-matrix.md). The three that matter
most:

**The harness could not start.** `boundPort` read `app.port`; Elysia's
`listen()` returns the app instance and exposes the bound port at
`app.server.port`. Every run aborted with "listener did not expose a bound
port" while the gateway was serving correctly.

**A deliberate 401 disabled the account every later case needed.** The
fault-injection models (`-401`, `-429`, `-500`, …) were registered on the same
provider and account as the healthy models. A 401 from upstream makes the
gateway mark the credential invalid and disable the account — correct
behaviour — so the backup export then carried `status: "disabled"`, the
restore re-inserted it faithfully, and the post-restore dispatch failed with
"no available account". Every CLI case after it failed for the same reason.
The fault models now have their own provider and account per family.

**Streaming asserted against a truncated string.** The SSE reader kept only
the trailing buffer, and the terminal check read a 2000-character excerpt — so
`finish_reason` and `response.completed` were looked for in text that could
not contain them. Both streaming surfaces reported FAIL for streams that ended
correctly.

**After all seven fixes:** `executed 3552: PASS 317, FAIL 0`.

---

## Process notes — mistakes made and corrected

Stated because they affected the repository and the operator's data.

**A test suite wrote into the live data directory.** The first version of the
readiness regression test called `bootDatabase()`, which resolves
`~/Library/Application Support/Cartethyia` when `CARTETHYIA_DATA_DIR` is unset.
Running `bun test <file>` directly — outside the sandboxed runner — left 6
provider rows in the operator's real database. They were found by a read-only
audit query, removed by a script scoped to exactly the leaked id prefix
(`readiness-provider-%`), and confirmed gone (51 → 45 providers, 0 matching
rows). The suite now builds its own PGlite database in a temp directory and
never touches the operator's data, whatever way it is launched.

**A GitHub token appeared in tool output.** While reading the stored git
credential to rename the repository, the keychain entry printed the token
itself. It should be rotated.

---

## Unresolved

Nothing reproducible remains unfixed in the areas this session covered. Two
limitations are environmental and are reported rather than worked around:

- **`persistence=full` E2E (1656 cases)** needs a disposable PostgreSQL.
  Docker is not installed on this machine.
- **26 backend unit tests** fail for the same reason — they are the same 26
  that failed before any change in this session, verified by stashing the work
  and re-running.

No known P0 or P1 defect is open.
