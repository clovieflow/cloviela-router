# Cloviela Router release evidence

Recorded during the implementation session. Each entry names the command or
boundary that produced it. `PASS` here means the stated command ran and
produced the stated result in this session — nothing is inferred.

## Baseline (upstream `dev` @ `382cf2308f4a09aeac0b5e2b1adf8fa7ace9319f`)

| Check | Result |
|---|---|
| `bun install` | 329 packages installed |
| `bun run typecheck` | exit 0 |
| `bun run dashboard:typecheck` | exit 0 |
| `bun run dashboard:build` | success |
| `bun run dashboard:test` | 375 pass / 0 fail |
| `bun run test:backend` (Lite, no services) | 1756 pass / 38 fail — every failure a missing PostgreSQL/Redis connection |
| `bun run test:backend` (Full, real PostgreSQL 18.4 + Redis) | 1971 pass / 8 fail |

The 8 remaining baseline failures were: 4 Codex-injector tests writing into the
real home directory (see below), 2 attachment tests depending on a private
`C:\Users\Aria\Desktop\awok..txt` fixture that does not exist on this machine,
and 2 Redis-backed suites.

## Incidents found and handled

1. **Real user configuration was modified by the test suite.** The CLI-tool
   lifecycle suite redirected `process.env.HOME`, but `os.homedir()` is cached
   by the runtime, so injector writes went to the operator's real `~/.codex`,
   `~/.claude`, `~/.config/opencode`, `~/.cline`, `~/.factory`, `~/.hermes`,
   `~/.grok`, `~/.deepseek`, `~/.jcode`, `~/.openclaw`, VS Code settings, and
   the Kilo/Cowork data directories.
   - All 19 affected paths were inventoried and copied to a permission-
     restricted recovery directory before any further action.
   - Fifteen of them were *first created* by the test run (birth times match the
     run); those were quarantined after verifying their content hash still
     matched the inventory.
   - `~/.hermes/config.yaml` was restored from a pre-incident backup whose
     content matched the damaged file byte-for-byte outside the model block.
   - `~/.codex/auth.json` original OAuth fields were preserved; the injected
     fixture field was removed. The original `~/.codex/config.toml` body could
     not be recovered from local snapshots and is **BLOCKED** pending the
     operator's backup.
   - Fixes: `homeDir()` resolves the environment lazily; the test runner starts
     every worker with a disposable home/temp/XDG sandbox; `fs-ops.ts` refuses
     writes outside it.
2. **Dependency incompatibility that only a real listener exposed.** With
   `typebox@1.3.27`, `bun run src/main.ts` bound the port and then died
   compiling `POST /console/api/auth/login`
   (`this.tb.buildResult.external` undefined). Pinned `typebox` to `1.3.23`
   (last release with the compiler shape Elysia `2.0.0-beta.16` reads) and
   removed the AOT string-patch that had hidden this in the bundled path.

## Sandbox guard — reproduction and fix

`bun run .rikka-work/smoke-home.ts`:

| Assertion | Before fix | After fix |
|---|---|---|
| home redirect honored | PASS | PASS |
| write inside sandbox | PASS | PASS |
| write outside sandbox denied | PASS | PASS |
| symlink-to-directory escape denied | PASS | PASS |
| **dangling-symlink escape denied** | **FAIL (file created outside)** | PASS |
| write with no sandbox in test mode denied | PASS | PASS |

## Privacy boundary — reproduction and fix

`bun run .rikka-work/smoke-redaction.ts`, with a fixture credential:

| Boundary | Before | After |
|---|---|---|
| public error envelope | leaked | clean |
| payload capture | leaked | clean |
| console log ring | leaked | clean |
| upstream request body unchanged | true | true |

## Live gateway wire verification (real HTTP + mock upstream)

`bun run .rikka-work/smoke-wire.ts` against the running isolated Lite gateway,
with a local mock upstream and a tenant BYOK provider registered through the
real console API:

| Path | Result |
|---|---|
| Console login / session | 200 / `authenticated` |
| `POST /console/api/providers/` | 201, provider registered |
| `POST .../accounts` | 201, account created |
| `POST /console/api/api-keys` | 201, `rk_` secret issued |
| `POST /v1/chat/completions` (JSON) | 200, upstream "pong" relayed |
| `POST /v1/chat/completions` (SSE) | 200, delta + exactly **1** `[DONE]` terminal |
| `POST /v1/messages` (SSE) | 200, text delta + `message_stop` |
| `POST /v1/responses` (SSE) | 200, `response.output_text.delta` + `response.completed` |
| `GET /v1/models` | 200, 14 entries |
| Invalid API key | 401, **zero** upstream dispatches |
| Upstream 401 echoing the credential | 401, echoed key **not** present in the client envelope |

Upstream observation: 5 calls, all to `/v1/chat/completions` (the BYOK adapter's
declared path), every one carrying `Authorization: Bearer <the stored upstream
secret>` — the provider credential the gateway was configured with, not the
client's key.

## P0 defects found by live verification and fixed

Three real defects only a live, non-`app.handle` run exposed:

1. **Lite database deadlock (permanent).** `createAccount` ran
   `accountsWithUsage(...)` inside an open transaction. That helper read through
   the outer handle, and Lite is a single-connection embedded PGlite — so the
   nested read waited forever on the connection the transaction already held.
   The process then reported `db: disconnected`, readiness stalled for 5 s per
   call, and every DB-touching request hung until restart. Full mode masked it
   because a second pool connection served the nested read. Fix: the usage
   enrichment and the account-listing path take the transaction executor, and
   the runtime in-flight gauge (which is not transaction state) is skipped
   inside a transaction. Verified: the same script that previously wedged the
   gateway now completes in 0.3 s and the instance stays `ready`.
2. **Account creation against an unknown provider returned 500.** The
   `provider_accounts.provider_id` foreign key raised a constraint violation
   that surfaced as a generic `internal_error`. Fixed by validating the provider
   before the insert; reproduced 500 → verified 404 `provider_not_found`.
3. **Non-private listener default.** Covered in the security section above.



| Check | Result |
|---|---|
| `bun run src/main.ts` with sandboxed `HOME`/data dir | listener up on `127.0.0.1:12980` |
| `lsof -iTCP:12980 -sTCP:LISTEN` | bound to `127.0.0.1`, not `0.0.0.0` |
| `GET /health/ready` | `{"status":"ready","db":"connected"}` |
| `bun doctor` against the running instance | "All systems operational" |
| first-boot setup via browser | completed; admin created |
| login with wrong password | rejected, "Autentikasi gagal" |
| login with correct password | session established, console rendered |

## Browser verification (real Chromium, axe-core 4.13.0)

17 console routes audited in Rikka Day and the key routes re-audited in Rikka
Night. After the fixes below: **0 violations** on every route in both themes
(629 passing checks in the Day sweep).

| Finding | Measured | Fix |
|---|---|---|
| Disabled button | 4.31:1 | explicit disabled tokens |
| Day status success | 4.23:1 | `#1e7a4b` (5.28:1) |
| Day status warning | 3.95:1 | `#96590a` (5.58:1) |
| Console log info/warn on its fixed dark surface | 2.6:1 / 3.6:1 | fixed `--terminal-*` tokens (10.2:1 / 11.0:1) |
| Onboarding progressbar | no accessible name | `aria-label` added |
| Backup "Delete all" password | no label | `id` + `label` associated |
| Empty/error state panels | heading level skipped | `h2` |

Responsive: no horizontal overflow at 320, 390, 768, 1024, 1440, 1920 px.
Reduced motion: with `prefers-reduced-motion: reduce` emulated, transition and
animation durations collapse to `1e-05s`.

## Truthfulness corrections

| Claim in the UI | Before | After |
|---|---|---|
| Gateway Endpoint port | hardcoded `PORT 12800` | derived from the live origin |
| Help sample commands | hardcoded `127.0.0.1:12800` | derived from the live origin |
| Release label | `v2.0 (Shorekeeper)` | `v2.0.0-rikka.1` |

## Artwork

Four original images generated with `openai-codex/gpt-image-2` through OMP and
visually inspected: a canonical square portrait, a night scene, a day scene,
and a 4×4 sheet of sixteen distinct vignettes. Optimized into **30 WebP
assets** (1,007,644 bytes total) with dimensions, hashes, prompts, and intended
placements recorded in `assets/manifest.json`.

## Release binary (compiled artifact)

Two real defects were found by actually executing `dist/cloviela-router`:

1. **macOS killed it silently on launch** — `SIGKILL (Code Signature Invalid)`.
   `bun build --compile` rewrites the file after the linker ad-hoc signs it, so
   the signature no longer matched. There was no stderr, no log, just exit 137.
   `scripts/build/binary.ts` now re-signs ad-hoc on darwin after compiling.
2. **Lite mode crashed at boot** — `ENOENT: open '/$bunfs/root/pglite.data'`.
   PGlite loads its WASM and data files through `new URL("pglite.data",
   import.meta.url)`, which a standalone executable cannot resolve. The assets
   are now embedded (`compile.assets`), which also required placing the option
   inside the `compile` object rather than at the build root — the first
   attempt was silently ignored.

Verified after the fix (Lite, compiled binary, isolated data dir):

| Check | Result |
|---|---|
| Binary size | 85,700,688 bytes (was 68,874,288 without assets) |
| `codesign --verify` | valid |
| `/health/ready` | 200 `{"status":"ready","db":"connected"}` in 4 ms |
| `/console` | 200 (built dashboard served from the binary's cwd) |
| `/rikka/night.webp` | 200 (artwork served) |
| Full mode | also verified earlier: ready in 10 ms against disposable PostgreSQL |

## Test-runner deadlock found and fixed

Running the full backend suite repeatedly exposed an intermittent failure
(roughly one run in three), always on a different test. PostgreSQL's log named
the cause exactly:

```
ERROR:  deadlock detected
Process 92870: delete from tenants where id = $1
Process 92886: ALTER TABLE "provider_accounts" ADD COLUMN IF NOT EXISTS "min_credit_balance" integer
```

Four migration suites run `ALTER TABLE` against the shared test database, which
takes an `AccessExclusiveLock`; any concurrently running suite that deletes a
tenant takes a `RowExclusiveLock` on the same table through `ON DELETE CASCADE`.
Opposite lock orders deadlock, and PostgreSQL aborts whichever lost.

The runner now executes those four DDL suites serially after the parallel batch,
removing the interleaving. Verified with five consecutive full runs:
`2022 pass / 0 fail` plus `10 pass / 0 fail` (migrations), every time.

## Final gate results

All commands run against the integrated tree, in this session:

| Command | Result |
|---|---|
| `bun run typecheck` | **exit 0**, no errors |
| `bun run dashboard:typecheck` | **exit 0**, no errors |
| `bun run test:backend` | **2104 pass / 0 fail** (2094 parallel across 81 files + 10 serial DDL across 4 files) |
| `bun run dashboard:test` | **371 pass / 0 fail** (9 files) |
| `bun run build` | dashboard → AOT → binary, all succeeded |
| `dist/cloviela-router` | 85,700,688 bytes, `codesign --verify` valid, boots Lite and Full |
| `bun doctor` (against a running instance) | "All systems operational" |
| axe-core, 17 console routes × 2 themes | **0 violations** (629 passing checks in the Day sweep) |
| Responsive 320/390/768/1024/1440/1920 | no horizontal overflow on any width |
| Reduced motion | transitions/animations collapse to 1e-05s |

Baseline for comparison, same machine, upstream `dev` before changes:
1756 pass / 38 fail without services, 1971 pass / 8 fail with services.

## Bansos: subsidized access programs

Every case below was executed against a running gateway — first the source run,
then the compiled binary on a fresh state directory — and each found defect is
named with the check that caught it.

| Case | Command (abbreviated) | Result |
|---|---|---|
| Subsidized model reaches upstream | `POST /v1/chat/completions` with a Bansos key naming the public model | **200**, forwarded |
| Unsubsidized model refused | same key, naming a model the program does not fund | **404** `model_not_allowed` |
| `/v1/models` shows only the subsidy | `GET /v1/models` with the Bansos key | one entry, the program's model |
| Published name translated | request names `bansos-model`; router plans `opencodeft/big-pickle` | reached upstream, no 404 |
| Upstream id never leaked | `GET /console/api/bansos/portal/me` | `big-pickle` absent (grep, 0 hits) |
| Token quota enforced | allowance 500; two calls at 252 tokens each | third call **429** `lifetime token budget exceeded` |
| Rate limit enforced | participant `rpm = 2`; five rapid calls | calls 1–2 **200**, 3–5 **429** `rpm limit exceeded` |
| Concurrency enforced | participant `concurrency = 1`; six parallel calls | one **200**, five **429** `capacity_exhausted` |
| Suspension is immediate | set participant `suspended`, reuse an issued key | **403** |
| Reactivation restores access | set participant `active`, reuse the same key | **200** |
| Revocation is immediate | revoke key, reuse it | **401** |
| Deleted key stops working | delete participant holding a live key | key **401** (was 200) |
| `revoked` status is terminal | set participant `revoked` | gateway **403**, portal sign-in **401** |
| Key ceiling enforced | `maxKeysPerParticipant = 2`, issue a third | **409** `key_limit_reached` |
| Revoked keys free the ceiling | revoke one, issue again | **200** |
| Provider scope enforced | pin program to a provider that does not serve the model | **404** |
| Correct provider passes | pin to the serving provider | **200** |
| Account allowlist enforced | name a foreign account id | **404** |
| Portal session opens | `POST /bansos/portal/session` with a live key | **200**, token returned |
| Portal session refuses a bad key | same, with a wrong key | **401** |
| Portal session dies with its key | revoke the key, reuse the session | **401** |
| Portal cannot reach the admin API | session token against `/bansos/programs`, `/api-keys` | **401** both |
| `adminNotes` not exposed to participants | `GET /portal/me` | absent (grep, 0 hits) |
| Admin console drives the whole flow | Chromium: sign in → Bansos → program → 3 tabs → revoke → issue | key created and spent: `/v1/models` 200, chat **200** |
| Portal renders real data | Chromium: sign in at `/console/portal` | program, 2,162 tokens, live keys, public model name |
| Production binary serves Bansos | fresh state dir, `CLOVIELA_DB_MODE=lite ./dist/cloviela-router` | migrations applied; program → participant → model → key → portal sign-in **200**; gateway **200**, unsubsidized **404** |

Defects found by these runs, all fixed:

1. A key issued with an empty `modelList` under `whitelist` mode permitted
   **every** model on the gateway — the opposite of a subsidy.
2. The program's published model names were compared against upstream ids and
   never translated, so a correct request was refused.
3. Revoked keys still counted against `maxKeysPerParticipant`, locking a
   participant out permanently after a revoke-and-reissue.
4. A subsidized key was subject to the model-abuse strike ban, which would cut
   off every participant behind a shared IP after ten typo'd model names.
5. `provider_id` and `provider_account_ids` were stored and documented as "the
   provider this program may spend", then never read.
6. A deleted key kept authenticating from the auth cache, because the cascade
   removes the row without telling the cache.
7. The portal's sign-in was refused with a CSRF error whenever the browser was
   also signed into the console — the case an operator hits first.
8. The dashboard's participant status type invented `expired` and omitted the
   real `revoked`, so the terminal state had no label.

Tests written for these invariants: `test/console/bansos-enforcement.test.ts`
(17 cases) and `test/console/bansos-policy.test.ts`.

## Not verified in this environment

- Docker image build and Compose smoke (Docker unavailable).
- Real third-party provider calls (no provider credentials).
- Full-mode verification on a 2 vCPU / 2 GB profile (this machine is 6-core /
  8 GB; measurements are recorded with that hardware profile, not the target).
- `POST /console/api/routing/simulate` and `GET /console/api/system/readiness`
  while their implementing agent's work was still in flight.
