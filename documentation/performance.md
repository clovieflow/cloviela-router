# Performance measurements

Hardware profile: **Apple Mac17,5 (arm64), 6 CPU cores, 8 GB RAM**, macOS,
Bun **1.4.0**, Lite mode (embedded PGlite), source run (`bun run src/main.ts`),
`LOG_LEVEL=warn`. Measured in this session.

These numbers are **not** a 2 vCPU / 2 GB VPS profile. The deployment target in
the contract is smaller than this machine, so treat the figures as an upper
bound on what the same build does on the target, not a substitute for
measuring there.

| Measurement | Value | How |
|---|---|---|
| Cold start to `/health/ready` 200, fresh data dir | **5.2 s** | timed loop polling readiness every 200 ms after launch |
| Steady RSS, long-running instance (~1 h uptime) | **56 MB** | `ps -o rss` |
| Steady RSS, freshly started instance | **38 MB** | `ps -o rss` after first ready |
| `/health` latency, warm | **0.5–1.1 ms** (first call 6.6 ms) | 5 sequential `curl -w %{time_total}` |
| `/health/ready` latency, warm | **0.5–0.7 ms** (first call 9.6 ms) | 3 sequential calls |
| `/metrics` scrape | < 50 ms, ~40 series | single `curl` |

## Notes

- The 5.2 s cold start is dominated by opening and migrating the embedded
  PGlite database on a brand-new data directory. A restart against an existing
  data dir is faster because migrations are already recorded.
- RSS grows from ~38 MB to ~56 MB across an hour of an idle instance; this is
  Bun's JIT heap and buffers settling, not a leak in the gateway. The console
  Overview reports RSS and heap separately for exactly this reason.
- No load or concurrency benchmark was run. Throughput, p95 under parallel
  streams, and memory under sustained streaming remain **unverified**.

## Reproducing

```bash
# cold start
CARTETHYIA_DB_MODE=lite CARTETHYIA_DATA_DIR=$(mktemp -d) PORT=12999 \
  bun run src/main.ts &
until curl -sf http://127.0.0.1:12999/health/ready; do sleep 0.2; done

# latency
for i in 1 2 3 4 5; do curl -sS -o /dev/null -w "%{time_total}\n" http://127.0.0.1:12999/health; done

# memory
ps -o rss= -p <pid>
```
