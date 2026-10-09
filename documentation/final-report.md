# Cloviela Router — final report

**Source:** Cloviela `dev` @ `382cf2308f4a09aeac0b5e2b1adf8fa7ace9319f`
(GPL-3.0-only). **Repository:** `clovieflow/cloviela-router`.
**Product:** private-first, local-friendly, production-ready Rikka Takarada
personal AI gateway with the complete Cloviela routing/protocol core.

## Gate results — all run in this session

| Gate | Result |
|---|---|
| `bun run typecheck` | PASS — exit 0 |
| `bun run dashboard:typecheck` | PASS — exit 0 |
| `bun run test:backend` | PASS — 1993 / 0 fail |
| `bun run dashboard:test` | PASS — 371 / 0 fail |
| `bun run build` | PASS — dashboard + AOT + binary |
| Compiled binary, Lite mode | PASS — ready, console and artwork served |
| Compiled binary, Full mode | PASS — ready against disposable PostgreSQL |
| Live gateway wire matrix (mock upstream) | PASS — 5 protocols/faults, 0 leaks |
| `bun doctor` against running instance | PASS — "All systems operational" |
| axe-core, 17 routes × 2 themes | PASS — 0 violations |
| Responsive 320→1920 | PASS — no overflow |
| Reduced motion | PASS — durations collapse |
| Sandbox write guard (6 assertions) | PASS |

## Real defects found by verification, and fixed

These were not in any plan — each was found by exercising a real boundary and
each is now proven fixed by the same boundary.

1. **P0 — Lite database deadlocked permanently on provider-account creation.**
   A nested read through the outer DB handle while a transaction held the single
   PGlite connection. Gateway reported `db: disconnected` and every later
   request hung until restart. Reproduced; fixed; same script now completes in
   0.3 s and the instance stays ready.
2. **P0 — Upstream credentials could reach a gateway caller, the log ring, and
   stored payloads.** A provider echoing the key it rejected (common on 401)
   published it. Reproduced (`leaked: true`); fixed with a canonical redactor at
   every publication/storage boundary; verified (`leaked: false`,
   `upstreamInputUnchanged: true`). Provider wire bytes are untouched.
3. **P0 — The compiled release binary could not run at all.** macOS killed it
   silently (`SIGKILL`, invalid signature after compile), and Lite mode then
   died on `ENOENT '/$bunfs/root/pglite.data'`. Fixed by re-signing after
   compile and embedding the PGlite assets inside `compile` (a root-level
   `assets` key is silently ignored).
4. **P1 — Account creation for an unknown provider returned 500** instead of
   404. Reproduced; fixed; verified 500 → `404 provider_not_found`.
5. **P1 — Private-first binding.** The listener bound every interface by
   default. Now `127.0.0.1` unless `CLOVIELA_BIND_HOST` opts out.
6. **P1 — The dependency pair was broken for any real start.** TypeBox `1.3.24`
   removed a compiler shape Elysia `2.0.0-beta.16` reads; a fresh install bound
   the port and then crashed compiling the login route. Pinned together and
   re-verified with a live listener.
7. **P1 — Tests wrote into the operator's real client configuration.** The
   lifecycle suite redirected `HOME` while the runtime had already cached
   `os.homedir()`. Files under `~/.codex`, `~/.claude`, `~/.config/opencode`
   and others were modified. Contained, inventoried, partially restored (see
   the recovery section), and fixed at the root: lazy home resolution, a
   disposable per-worker sandbox, and a write guard that denies outside and
   symlink (including dangling-symlink) escapes.
8. **P1 — `bun doctor` ignored the active environment** and probed the wrong
   port, and its lockout reset did not boot the database correctly.
9. **Accessibility:** seven distinct real failures measured with axe-core
   (disabled-button contrast, two Day status colors, console-log colors on its
   fixed dark surface, an unnamed progressbar, an unlabeled password field,
   skipped heading levels). All fixed and re-measured to zero.
10. **Truthfulness:** a hardcoded `PORT 12800` label, hardcoded `127.0.0.1:12800`
    in Help samples, and an upstream codename in the release label.

## Delivered

- **Rikka identity:** Rikka Noir (Sumi & Vermilion) / Rikka Day / Follow-system palettes designed
  independently; 30 optimized WebP assets (~1.0 MB) generated with GPT-Image-2
  and recorded in `assets/manifest.json` with prompts, hashes, dimensions.
- **Dashboard:** nine new screens (onboarding, health, models, simulator,
  API keys, help, about, not-found, system-error) plus themed versions of every
  existing screen; Indonesian-first copy with full English support and an
  honest, enumerated list of still-untranslated inherited pages.
- **Backend hardening:** credential redaction, private-first binding, the
  Lite deadlock fix, provider validation, and the build fixes above.
- **Docs:** README, getting-started (updated), architecture, clients, security,
  release, CHANGELOG, AGENTS/SKILL naming.
- **E2E harness** (`scripts/ci-cloviela-e2e.ts`) with a shipped 3522-case index,
  a real mock upstream for all three wire families, a safety guard that refuses
  unsafe targets, and per-ID evidence output. Written and self-checked; the
  scenario families have **not** been executed against a booted gateway.

## BLOCKED — needs the operator

1. **Original `~/.codex/config.toml`.** The test run overwrote it. The injected
   fixture content is preserved and the original OAuth login is intact, but the
   pre-incident file body could not be recovered from any local backup or
   snapshot. Restore from your own backup when available.
2. **`OPENAI_API_KEY` in `~/.hermes/.env`.** The fixture value was removed; if
   you had a real key there, restore it from your records. (The rest of that
   file is untouched.)
3. **Publish.** Done. `clovieflow/cloviela-router` is a standalone public
   repository, with `main` as the default branch. The attribution GPL-3.0
   requires lives in `NOTICE.md`: the licence,
   the origin and revision of the incorporated engine, and a pointer to the
   change log. It is deliberately not a byline in the README or a card in the
   console — the licence asks for notices, not for framing.

## UNVERIFIED — stated honestly, not claimed

- Docker image build and Compose smoke (Docker unavailable here).
- Real third-party provider calls (no provider credentials).
- 2 vCPU / 2 GB profiling (this machine is 6-core / 8 GB; measurements are
  recorded with the actual hardware, not the target).
- The GW/SEC/DB/CLI scenario families through `ci-cloviela-e2e.ts` — the harness
  exists and its components were checked, but no family has been executed.
- `POST /console/api/routing/simulate` and
  `GET /console/api/system/readiness` while their implementing work was still in
  flight at the time of writing.

## Reproduce

```bash
bun install --frozen-lockfile
bun setup --non-interactive
bun doctor
bun run typecheck && bun run dashboard:typecheck
bun run test:backend && bun run dashboard:test
bun run build && ./dist/cloviela-router
```
