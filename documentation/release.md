# Release

Release gates, the evidence that backs them, and the limitations this build
actually has. Nothing here is aspirational; every claim names the command or
artifact that produced it.

## Reproducing the build

```bash
bun install --frozen-lockfile
bun run typecheck
bun run dashboard:typecheck
bun run dashboard:build
bun run test:backend
bun run dashboard:test
bun run build
```

`bun run build` runs dashboard → AOT → standalone binary and writes
`dist/rikka-router`.

## Test database

Backend suites that touch persistence read `CARTETHYIA_TEST_DATABASE_URL` from
`.env.test`. The runner (`scripts/ci-run-tests.ts`) starts every worker with a
disposable sandbox: `HOME`, `USERPROFILE`, `TMPDIR`/`TMP`/`TEMP`, the `XDG_*`
directories, `APPDATA`/`LOCALAPPDATA`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR`
all point inside one temporary root, and `CARTETHYIA_TEST_HOME_ROOT` names it.
The CLI-tool injectors refuse any write outside that root, including through a
symlink or a dangling symlink. This guard exists because those injectors edit
real client configuration files in normal operation.

## Known limitations

These are real and should not be read as covered:

1. **Localization is partial.** The console shell, the new Rikka screens, and
   the settings/login/onboarding flows are Indonesian-first with full English
   support. Several inherited pages still render English only; the list is
   enumerated in `dashboard/src/shared/i18n.ts` (`UNTRANSLATED_SURFACES`) and
   rendered on the About screen rather than implied away.
2. **The route simulator is read-only by construction, and says so.** It
   answers from the same `RoutingEngine` the dispatcher uses, with rotation
   peeking instead of advancing, so asking "what would this do" cannot change
   what the next real request does. `selected` is reported only when a single
   candidate makes the choice certain; otherwise the page states that the
   rotation cursor decides at dispatch time.
3. **Readiness has a transition fallback.** Until
   `GET /console/api/system/readiness` is mounted, the checklist is composed
   from existing endpoints and says so on screen. The fallback is gated to
   404/405 only; any other failure surfaces as a real error.
4. **Lite is single-process.** Embedded PGlite does not coordinate across
   processes; the routing snapshot cache is per process.
5. **No Docker verification in this build environment.** Docker was not
   available where this build was verified, so the image and Compose file are
   reviewed but not executed here. Treat `docker compose up` as unverified
   until you run it.
6. **Provider credentials are not available to this build.** Every live
   provider call path is exercised against a local mock upstream; real
   third-party provider accounts are the operator's to supply.

## Evidence

Release evidence lives outside version control (`.rikka-work/evidence/` and
`.rikka-work/e2e-rikka/`) so that generated artifacts and traces do not enter
the repository. It includes:

- raw logs for each gate command with its exit code;
- browser screenshots per theme and viewport;
- accessibility audits (axe-core) per route and theme;
- gateway request traces with request ids;
- the artwork manifest with prompts, hashes, and dimensions.

A claimed pass without a corresponding artifact is not a pass.

## Artwork provenance

Original illustrations were generated for this fork with OpenAI GPT-Image-2
through OMP. `assets/manifest.json` records, per asset: the generating tool and
model selector, the prompt, the source image it derived from, output
dimensions, MIME type, SHA-256, byte size, and the intended placement. The
generated character art is an unofficial fan derivative; the character
identity remains with its rightsholders, and no commercial character rights are
granted or implied by the GPLv3 code license.
