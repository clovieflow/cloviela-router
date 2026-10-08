# Performance verification

Measured 2026-10-09 against the running gateway on this machine.

## Hardware actually used

6-core Apple Silicon, 8 GB RAM, macOS (darwin-arm64), Bun 1.4.0.

**This is not the 2 vCPU / 2 GB target profile.** The figures below are real
measurements of the real hardware; they are not adjusted toward a profile that
was never applied. No claim is made about behaviour under 2 vCPU / 2 GB.

## Backend

Isolated instance, `lite` mode (embedded PGlite), `NODE_ENV=development`.
Read from the gateway's own `/console/api/system/health`, which reports
measured RSS, process CPU, and latency percentiles — not host load.

| Metric | Idle | After 40 sequential requests |
|---|---:|---:|
| RSS | 165.2 MB | 208.3 MB |
| JS heap used | 23.4 MB | — |
| JS heap total | 23.4 MB | — |
| CPU | 0.27 % | 22.25 % |
| Memory percent of limit | 2.02 % | — |

Load: 40 sequential `GET /console/api/system/health`, **0.9 ms/request**,
0 failures.

### A defect this measurement exposed

The first run reported `heap used 417.4 MB / total 24.5 MB` — impossible for a
process, and the dashboard rendered 819 MB of memory for a 162 MB process with
"Bun runtime 0.0 MB".

Reproduced directly: after PGlite (a WebAssembly module) loads, Bun reports
`rss 264.7 MB, heapUsed 1599.2 MB, heapTotal 89.1 MB, external 1591.6 MB`.
`heapUsed > heapTotal` and `heapUsed + external > rss` are both impossible, and
the Overview breakdown subtracts both from RSS to derive the runtime slice, so
it went negative.

Fixed in `src/console/observability/store.ts` (counters clamped so no field can
exceed the RSS it is part of) and guarded in
`dashboard/src/routes/Overview.tsx`. Verified after the fix: heap used 23.4 MB
/ total 23.4 MB, RSS 165.2 MB — a breakdown that adds up.

## Frontend

Chromium, 1440×900, dark theme, against the built dashboard.

| Route | Navigation | JS transferred | CSS | JS heap |
|---|---:|---:|---:|---:|
| `/` | 22 ms | 603 KB | 93 KB | 10 MB |
| `/health` | 44 ms | 424 KB | 93 KB | 10 MB |
| `/usage` | 16 ms | 911 KB | 93 KB | 10 MB |
| `/providers` | 17 ms | 527 KB | 93 KB | 10 MB |
| `/models` | 93 ms | 449 KB | 93 KB | 10 MB |
| `/combos` | 26 ms | 533 KB | 93 KB | 10 MB |
| `/settings` | 18 ms | 517 KB | 93 KB | 10 MB |
| `/about` | 12 ms | 416 KB | 93 KB | 10 MB |

`/usage` carries the heaviest chunk (recharts); `/models` has the highest
navigation time on a cold context. Both are well inside interactive.

## What was not measured

- **2 vCPU / 2 GB behaviour.** Hardware unavailable.
- **Sustained or concurrent load.** The load test above is sequential and
  bounded; it establishes per-request cost, not throughput under contention.
- **Memory growth over a long streaming session.** Streaming correctness is
  covered by E2E; long-run memory drift was not profiled.
- **Database performance under the `full` store.** Blocked without PostgreSQL.
- **Graceful shutdown under load.** Shutdown is exercised by the E2E harness,
  which drains on SIGTERM, but not under concurrent traffic.

These are stated as gaps rather than estimated.
