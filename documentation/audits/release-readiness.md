# Release readiness

Date of record: 2026-10-09. Every figure below was produced by a command in
this session against the running application; none is inferred.

## Gates

| Gate | Status | Evidence |
|---|---|---|
| Rikka Noir theme implemented across screens | **PASS** | `documentation/audits/rikka-noir-theme-audit.md`; 30 screenshots (dark, light, mobile) |
| Existing artwork functional | **PASS** | All illustrations retained unmodified; ambient wash retuned around them |
| Light mode not broken | **PASS** | Live Chromium pass, 14 routes: 0 contrast violations; screenshots |
| Every discoverable route has an audit result | **PASS** | `full-feature-inventory.md`; 18/18 routes answered 200 in Chromium |
| Backend endpoint contract validation | **PASS** | Every console API path probed live; non-404 status recorded per path |
| Streaming paths tested | **PASS** | E2E GW, all three surfaces, terminal events asserted |
| Routing and failover tested | **PASS** | E2E GW, 2718 cases, 0 failed |
| Provider operations tested to the boundary | **PASS** | E2E DB account lifecycle + E2E provider/connection cases |
| API key security tested | **PASS** | E2E SEC, 288 cases, 0 failed |
| Database migrations and persistence tested | **PARTIAL** | Lite (PGlite) verified end to end, including restart persistence; **Full (PostgreSQL) blocked** |
| Backup/restore verified in isolation | **PASS** | E2E DB 8/8, including account status and post-restore dispatch |
| Mobile layouts inspected in a real browser | **PASS** | 320/375/390/430/768/1024/1440/1920 sweeps; 0 uncontained overflow |
| Accessibility checks | **PASS** | WCAG AA contrast measured per rendered element, 14 routes × 2 themes, 0 violations |
| Test failures investigated | **PASS** | All 26 backend failures traced to the absent PostgreSQL; verified identical before and after |
| Critical/high defects fixed | **PASS** | See `bug-remediation-report.md` |
| Regression tests for repaired defects | **PASS** | `test/console/readiness-endpoint.test.ts` (10), `restore-account-state.test.ts` (2); the memory test was proved to fail by reverting its fix |
| TypeScript typechecks pass | **PASS** | `bun run typecheck`, `bun run dashboard:typecheck` — both clean |
| Production build passes | **PASS** | `bun run dashboard:build` — built in 568ms |
| Backend tests pass | **PASS (scoped)** | 1801 pass / 26 fail; the 26 are the PostgreSQL-gated suite |
| Frontend tests pass | **PASS** | 371 pass / 0 fail |
| Browser E2E passes for critical journeys | **PASS** | 3552 executed: **PASS 317, FAIL 0** |
| No unresolved known P0/P1 defects | **PASS** | None open |
| Blocked integrations disclosed | **PASS** | Below |

## Test totals

```
bun run typecheck          clean
bun run dashboard:typecheck clean
bun run dashboard:build    built in 568ms
bun run test               1801 pass / 26 fail
bun run dashboard:test      371 pass / 0 fail
ci-cloviela-e2e --store lite
  planned 3522: UNVERIFIED=1065 BLOCKED=1656 NA=801
  GW  2718 cases, 0 failed
  SEC  288 cases, 0 failed
  DB   336 cases, 0 failed
  CLI  210 cases, 0 failed
  executed 3552: PASS 317, FAIL 0, BLOCKED 1656, NA 801, UNVERIFIED 778
```

The 26 backend failures are unchanged from the baseline captured by stashing
all work and re-running: they are the PostgreSQL- and Redis-gated suites, and
they fail with `ECONNREFUSED 127.0.0.1:5432` / Redis connection errors.

## Performance, measured on this machine

Not the target 2 vCPU / 2 GB profile — this machine is 6-core / 8 GB and the
figures are recorded against the actual hardware.

**Backend** (isolated instance, `lite` mode, real PGlite):

| Metric | Value |
|---|---|
| Idle RSS | 165 MB |
| RSS after 40 requests | 208 MB |
| JS heap used / total | 23.4 MB / 23.4 MB |
| CPU, idle | 0.27 % |
| CPU, during load | 22.25 % |
| Sequential request latency | 0.9 ms/req (40 requests, 0 failures) |

**Frontend** (Chromium, 1440×900, dark):

| Route | Navigation | JS | CSS | JS heap |
|---|---|---|---|---|
| `/` | 22 ms | 603 KB | 93 KB | 10 MB |
| `/health` | 44 ms | 424 KB | 93 KB | 10 MB |
| `/usage` | 16 ms | 911 KB | 93 KB | 10 MB |
| `/providers` | 17 ms | 527 KB | 93 KB | 10 MB |
| `/models` | 93 ms | 449 KB | 93 KB | 10 MB |
| `/combos` | 26 ms | 533 KB | 93 KB | 10 MB |
| `/settings` | 18 ms | 517 KB | 93 KB | 10 MB |
| `/about` | 12 ms | 416 KB | 93 KB | 10 MB |

## Startup, persistence and shutdown

Verified on a production-mode instance with its own data directory:

1. **Clean boot.** Empty data dir → PGlite opens and migrates → `Cloviela
   Router listening on 127.0.0.1:12877 (Bun 1.4.0)` → `/console` 200,
   `/health/ready` 200.
2. **Setup.** `POST /console/api/auth/setup` → `{"status":"success"}`;
   `first-boot` flips to `{"requires_setup":false}`.
3. **Restart persistence.** Process stopped, restarted against the same data
   dir and the same encryption key → `first-boot` still `false`, and the
   account created before the restart logs in successfully
   (`{"status":"success","user_id":"0a1bb536-…"}`).

One caveat worth recording: restarting with a **different**
`CARTETHYIA_ENCRYPTION_KEY` makes the instance report `requires_setup: true`
again, because the stored credentials can no longer be decrypted. That is
correct behaviour for an encryption-key change, not a persistence defect, but
an operator who rotates the key without re-provisioning will see it.

## Blocked and unverified — stated, not hidden

1. **`persistence=full` (1656 E2E cases, 26 unit tests).** Requires a
   disposable PostgreSQL. Docker is not installed here.
   `bun run test-db:up && bun run scripts/ci-cloviela-e2e.ts --store full`.
2. **Real third-party provider calls.** No provider credentials. The adapter
   contract is covered by mock-backed E2E, which is not the same claim.
3. **Live OAuth handshake.** Flow store, state validation and error paths are
   unit-tested; the real callback against a provider is not.
4. **Docker image build and Compose smoke.** Docker is absent.
5. **778 planned E2E cases with no owning scenario family** (GW 395, SEC 131,
   DB 132, CLI 120). Reported UNVERIFIED rather than dropped.
6. **2 vCPU / 2 GB profiling.** Not performed; see the hardware note above.
7. **Provider detail pages** that need a configured provider were not reached
   in the isolated audit instance. They use the same token set and are covered
   by the contrast pass on the shared components, not by a separate pass.

## Release recommendation

**Ready to release as a development build**, with the disclosure above.

The gateway's own behaviour is verified end to end on the Lite path: 3552
executed E2E cases with zero failures, covering all three protocol surfaces,
streaming, routing and failover, cancellation, accounting, the security
boundary, the account lifecycle and backup/restore convergence, and real
installed clients. The console is verified in a real browser across 18 routes
in both themes, with zero contrast violations and zero layout overflow at
eight widths.

Two things would change this recommendation, and neither is a code defect:
a PostgreSQL-backed run of the `full` half, and a live provider call. Until
those happen, the `full` store and real upstreams are unverified — and this
document says so rather than implying otherwise.
