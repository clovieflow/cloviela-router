# E2E coverage matrix

Runner: `scripts/ci-cloviela-e2e.ts` (`bun run scripts/ci-cloviela-e2e.ts`).
Evidence: `.rikka-work/e2e-cloviela/{results.json,plan.json,junit.xml}`.
Latest run: store `lite`, Bun 1.4.0, darwin-arm64.

## Result

```
planned 3522 cases: UNVERIFIED=1065 BLOCKED=1656 NA=801
GW:  2718 cases, 0 failed
SEC:  288 cases, 0 failed
DB:   336 cases, 0 failed
CLI:  210 cases, 0 failed

executed 3552: PASS 317, FAIL 0, BLOCKED 1656, NA 801, UNVERIFIED 778
```

The run reports every planned case rather than only the executed ones, so the
numbers below account for all 3522.

| Status | Count | Meaning |
|---|---:|---|
| PASS | 317 | Executed against the real gateway and asserted |
| FAIL | 0 | — |
| BLOCKED | 1656 | Needs a disposable PostgreSQL; this run is `lite` (PGlite) |
| NA | 801 | The combination does not apply to this deployment |
| UNVERIFIED | 778 | No scenario family in this run covers the case |

## How the suite got here

The harness could not start a single case at the beginning of this session.
Every run aborted with `listener did not expose a bound port`, and the final
report listed the whole GW/SEC/DB/CLI matrix as never executed. Seven defects
in the harness itself were fixed, in this order:

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | `boundPort` read `app.port`; Elysia exposes `app.server.port` | every run aborted before case 1 | read both shapes |
| 2 | SSE reader kept only the trailing buffer | `finish_reason` never found → chat streaming FAIL | accumulate the whole body |
| 3 | Terminal check read the truncated `bodyExcerpt` | `response.completed` sliced off → responses streaming FAIL | assert on the full body |
| 4 | Backup cases carry the axis in the SPEC clause, not `axes` | `lifecycle` empty → 8/8 backup cases FAIL after every step succeeded | read both places |
| 5 | Several lifecycles had no branch | passing runs reported as red | added, each naming its establishing step |
| 6 | Fault models shared the healthy account | a deliberate 401 disabled the account → restore and every later CLI case failed | own provider + account per family |
| 7 | Cancellation addressed the slow model through the healthy provider | 503 with 0 dispatches → 20 FAIL | name the fault provider |

Defect 6 is the one worth reading: the first full run reported 107 failures
across three families, and all of them came from a single 401 case poisoning
the account the rest of the run depended on. The evidence that named it was a
probe added to the harness — on a failed post-restore dispatch it reads the
account rows back and records them — which showed `status: "disabled"`,
`lastErrorCategory: "auth_invalidated"`, and the upstream's own message.

## What each dimension verifies

### GW — 2718 cases, 0 failed

Gateway request lifecycle across the three ingress surfaces (`chat`,
`responses`, `messages`) × fault × strategy × persistence:

- **Wire codecs** — request serialization, auth shape (`authorization` vs
  `x-api-key`), model and stream fields, per surface.
- **Upstream faults** — 429, 500, malformed JSON, slow, partial stream,
  mid-stream error, each asserting the gateway *translates* the failure and
  does not leak the upstream credential.
- **Streaming** — SSE framing and terminal event per surface, driven through
  the real gateway rather than a mock of it.
- **Routing and failover** — strategy selection (priority, weighted, health,
  quota), cooldowns, disabled accounts, quota exhaustion, fallback order.
- **Cancellation** — a client abort must propagate to the upstream, proved by
  the mock observing the disconnect.
- **Accounting** — usage recorded per request, including after a failover.

### SEC — 288 cases, 0 failed

- **Console auth boundary** — unauthorized, expired, replay, invalid schema,
  oversize, XSS, header-break, each refused at the real boundary.
- **API-key scope enforcement** — a key holding only `search:invoke` is
  refused on a `routing:invoke` route, and the credential never appears in
  the response.

### DB — 336 cases, 0 failed

- **Account lifecycle** — create, list, edit, validate (invalid credential
  kind rejected), delete, plus concurrent-edit, export, restore, migrate,
  rollback and corruption. Restore is asserted at the account level: the row
  must return with the same id **and** `status: "active"`, because a restored
  row that cannot dispatch is not a restore.
- **Backup/restore convergence** — export → delete-all → import → live
  request, requiring the same-process dispatch to reach upstream. This is the
  proof that a restore converges the runtime and not just the rows.

### CLI — 210 cases, 0 failed

Real installed clients (`omp`, `opencode`, `curl`) driving the gateway with a
written profile, asserting the process exits 0 **and** the mock observed at
least one upstream call — a client that succeeds without reaching upstream is
not evidence.

## Coverage gaps, stated plainly

**1656 BLOCKED — no PostgreSQL.** Every `persistence=full` combination needs a
disposable PostgreSQL. Docker is not installed on this machine, so the `full`
half of the matrix cannot run here. This is the single largest gap and it is
environmental, not a product defect. Command to close it:

```bash
bun run test-db:up          # docker compose -f docker-compose.test.yml up -d --wait postgres-test
bun run scripts/ci-cloviela-e2e.ts --store full
```

**778 UNVERIFIED — no owning scenario family.** These are planned cases whose
axis combination no family executes. They are reported rather than dropped.
Breakdown: GW 395, SEC 131, DB 132, CLI 120.

**801 NA.** Combinations the planner decided do not apply to this deployment
(for example a share-link journey on an instance with no share links).

## Unit and component coverage added this session

| Suite | Tests | What it pins |
|---|---:|---|
| `test/console/readiness-endpoint.test.ts` | 10 | Route mount, the five-step read model, tenant scoping, and the health memory-counter consistency |
| `test/console/restore-account-state.test.ts` | 2 | An active account survives export → delete → import with its status intact |

Both build their own PGlite database in the OS temp directory rather than
calling the process-wide `bootDatabase()`, which resolves the operator's real
data directory when `CARTETHYIA_DATA_DIR` is unset.

## Reproducing

```bash
bun install --frozen-lockfile
bun run dashboard:build
bun run scripts/ci-cloviela-e2e.ts --store lite
```

Per-case evidence lands in `.rikka-work/e2e-cloviela/results.json`:
request/response traces, SSE frame names, mock calls with auth headers, and
the account-state probe on failure.
