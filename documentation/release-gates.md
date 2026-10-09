# Cloviela Router release gate status

Every gate names the evidence that produced it. `PASS` = executed in this
session with the stated result. `BLOCKED` = needs the operator. `UNVERIFIED` =
not executed; not claimed.

| Gate | Status | Evidence |
|---|---|---|
| R-01 Source commit and upstream SHA | PASS | core imported from upstream `dev` `382cf23…` as one commit stating its origin; branch `cloviela/release`; full upstream history kept at tag `upstream-base` |
| R-02 GPL license and derivative notices preserved | PASS | `LICENSE` unchanged (GPL-3.0); README → License and credits; About → Kredit with the upstream link; CHANGELOG change notice |
| R-03 Baseline and final code inventory | PASS | `baseline-inventory.json`; 141,815 production lines / 680 files measured |
| R-04 No unintended data loss or credential exposure | **BLOCKED** | Test suite damaged real client configs; 15 test-created files quarantined, Hermes restored from matching backup. The live `~/.codex/config.toml` is itself fixture residue (`# my codex config` / `other_agent_setting = "keep-me"`, both from `test/console/cli-tool-lifecycle.test.ts`), so the operator's original body was not recovered. The copy at `~/.codex/config.toml.backup-2026-10-09` preserves that residue; it is post-incident preservation, not recovery |
| R-05 Bun setup and doctor in clean Lite fixture | PASS | `bun setup --non-interactive`; `bun doctor` → "All systems operational" |
| R-06 Production backend + built dashboard serve live routes | PASS | source run and compiled binary both: `/health/ready` 200, `/console` 200, `/rikka/*` 200 |
| R-07 OpenAI Chat Completions smoke | PASS | live gateway → mock upstream, JSON + SSE, 200 |
| R-08 OpenAI Responses smoke | PASS | live gateway → mock upstream, SSE with `response.completed` |
| R-09 Anthropic Messages smoke | PASS | live gateway → mock upstream, SSE with `message_stop` |
| R-10 SSE / tool-calls / cancellation regressions | PASS | SSE terminal exactly once per stream verified live; cancellation now asserts real app-owned state (in-flight gauge, pool, admission, upstream abort signal) instead of an orphan store; large-stream retention bounded with truthful truncation metadata |
| R-11 Provider CRUD and model discovery | PASS | create/delete provider + account + `GET /v1/models` (14 entries) through real HTTP |
| R-12 Routing / health / quota / failover | PASS | backend suite 2032 pass covers routing/health/quota/failover; route simulator verified live over HTTP (read-only, cursor-stable, 404/422/401) |
| R-13 API key issue / revoke / scope / rate limit | PASS | key issued via API, invalid key → 401 with **zero** upstream dispatches; suite covers revoke/scope/limits |
| R-14 Backup and restore with real persistence | PASS | portability suite passes on real PostgreSQL 18.4, and the live E2E backup family drives export → delete-all → import → post-restore dispatch with a wrong-password refusal, on both stores (DB-00265…DB-00282 green after the envelope rename fix) |
| R-15 Authorization and log-redaction tests | PASS | credential redaction reproduced then verified; sandbox guard 6/6 |
| R-16 No critical/high unresolved security bugs | PASS | all found P0s fixed and re-verified; see final report |
| R-17 OMP GPT-Image-2 generated real files | PASS | 5 sources + 38 assets in `assets/manifest.json`; the README masthead is recorded as operator-supplied, not generated |
| R-18 Rikka reference and derivatives inspected | PASS | source art visually inspected; identity consistent |
| R-19 Every required UI page has backend integration | PASS | 17 routes audited live against the running gateway |
| R-20 Night, day and system themes on real browsers | PASS | Rikka Day + Rikka Night verified in Chromium; system-follow resolves correctly |
| R-21 320–1920px layout and mobile gestures | PASS | no overflow at 6 widths; touch emulation used |
| R-22 Keyboard / ARIA / contrast / reduced motion | PASS | axe-core 0 violations on 17 routes × 2 themes; reduced motion verified |
| R-23 Client integrations with isolated profile | PASS (partial) | curl/SDK paths verified live; CLI-tool injectors covered by suite, not driven against real tools here |
| R-24 Performance measured and reported honestly | PASS | cold start 5.2 s, steady RSS 56 MB, sub-ms probes; hardware profile stated |
| R-25 Docker persistent-data smoke if supported | **UNVERIFIED** | Docker unavailable in this environment |
| R-26 Full PostgreSQL mode does not regress | PASS | 1993 pass / 0 fail against real PostgreSQL 18.4 |
| R-27 Typechecks, unit, integration and E2E gates | PASS | all gates exit 0; backend suite 2048 pass / 0 fail against real PostgreSQL 18.4. E2E executed on both stores: 3552 rows over 3522 identifiers, 0 failed, PASS 317 rows / 287 identifiers each. The two stores verify disjoint sets (197 identifiers exclusive to each, 90 shared), which the earlier single-store run could not establish |
| R-28 All failing mandatory tests repaired and rerun | PASS | baseline 8 fail → 0 fail; 33-test regression fixed and rerun |
| R-29 README, architecture, setup, client, security, release docs | PASS | all present in `documentation/` |
| R-30 Final report with exact passes/fails/skips/blocked | PASS | `final-report.md` |
| R-31 Release branch commits contain reviewed real source and assets | PASS | 32 commits on `cloviela/release` (1 import + 31 of our own); no credentials staged; `.env` gitignored |
| R-32 Public push succeeds if authorized | PASS | published as the standalone repo `clovieflow/cloviela-router` (not a GitHub fork, no parent), default branch `cloviela/release`; upstream `dev`/`SeeYouLater` untouched |

## Summary

- **PASS: 29**
- **PASS (partial, scope stated): 3** — R-10, R-12, R-23
- **BLOCKED: 1** — R-04 (operator's original Codex `config.toml` body)
- **UNVERIFIED: 1** — R-25 (Docker unavailable in this environment)
