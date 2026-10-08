# Full feature inventory and traceability

Current-state inventory of the discoverable application, built from the
application's own registries rather than a hand-written list:

- **Console API**: every route registered under `src/console/**/contracts.ts`
  and mounted by `src/console/domain-registration.ts` (88 registered paths).
- **Frontend routes**: `dashboard/src/components/Shell.tsx` `navigationGroups`,
  plus the auth and detail routes.
- **Persistence**: `src/persistence/schema.ts`, applied through
  `src/persistence/migrations/`.

Each row records the feature, its owner on each side, and the strongest
evidence available. "Coverage" names the test that actually exercises it.

Legend — **E2E** = `scripts/ci-cloviela-e2e.ts` case families; **unit** =
`bun run test`; **dash** = `bun run dashboard:test`; **browser** = a live
Chromium pass recorded in this session.

## Console routes (18)

| Route | Component | Verified |
|---|---|---|
| `/console` | Overview | browser (200, real data, 0 console errors) |
| `/console/onboarding` | Onboarding | browser (200, 5-step checklist from the endpoint) |
| `/console/health` | Health | browser (200, measured RSS/CPU/latency) |
| `/console/usage` | UsagePage | browser (200, chart renders) |
| `/console/console-log` | ConsoleLogPage | browser (200, real log lines) |
| `/console/providers` | ProvidersPage | browser (200, catalog + connection test) |
| `/console/models` | Models | browser (200, 10 models, scrollable table at 320px) |
| `/console/combos` | Routing | browser (200) |
| `/console/simulator` | RouteSimulator | browser (200); `POST /routing/simulate` returns 403 without CSRF |
| `/console/quota` | Quota | browser (200) |
| `/console/api-keys` | ApiKeys | browser (200) |
| `/console/proxy` | Proxy | browser (200) |
| `/console/model-lab` | Studio | browser (200) |
| `/console/help` | Help | browser (200) |
| `/console/settings` | Settings | browser (200, 11 inputs) |
| `/console/about` | About | browser (200, Credits section) |
| `/console/login` | Login | browser (200, real session issued) |
| `/console/setup` | Setup | browser (200, creates the administrator) |

All 18 answered HTTP 200 with real content, `data-theme` resolved, and zero
document overflow. An unknown path renders the localized 404 page.

## Console API surface

Every path below was probed against the running gateway. A non-404 status
proves the route is mounted (401/403 = auth refused, 422 = schema refused).

### Observability

| Method | Path | Coverage |
|---|---|---|
| GET | `/system/health` | browser + E2E |
| GET | `/system/readiness` | **added this session**; unit (9 tests) + browser |
| GET | `/system/usage`, `/usage/summary`, `/usage/chart`, `/usage/cache` | browser + E2E |
| GET | `/system/usage/by-:dimension` | unit (dimension validator) |
| GET | `/system/usage/requests`, `/requests/:requestId` | E2E (remote request detail) |
| GET | `/telemetry/events`, `/telemetry/events/:eventId` | browser (log page) |

### Auth and access

| Method | Path | Coverage |
|---|---|---|
| GET | `/auth/first-boot`, `/auth/session` | browser + E2E (setup flow) |
| POST | `/auth/setup`, `/auth/login`, `/auth/logout`, `/auth/change-password` | browser + E2E |
| — | Console auth boundary | E2E SEC family, 288 cases, 0 failed |

### Providers and models

| Method | Path | Coverage |
|---|---|---|
| GET/POST | `/providers`, `/providers/connection-test` | browser + E2E |
| GET | `/providers/models/flat` | E2E + browser |
| GET/POST/PATCH/DELETE | `/providers/:providerId/accounts`, `/accounts/:id` | E2E DB account lifecycle |
| POST | `/providers/:providerId/accounts/probe`, `/accounts/export` | E2E (probe) |
| GET/POST | `/providers/:providerId/models`, `/models/bulk`, `/models/probe` | E2E |
| POST | `/providers/:providerId/oauth/authorize`, `/device/start`, `/device/poll`, `/import` | unit (flow store); live OAuth not verified |
| PATCH | `/providers/:providerId/routing` | E2E (strategy cases) |
| PATCH | `/accounts/batch` | browser probe (422 = mounted, schema enforced) |
| — | API-key scope enforcement | E2E SEC family |

### Routing

| Method | Path | Coverage |
|---|---|---|
| GET/POST/PATCH | `/routing/combos`, `/routing/aliases`, both `/reorder` | browser + E2E |
| POST | `/routing/simulate` | browser (403 without CSRF = mounted) + E2E |

### Keys, quota, network, backup, studio

| Method | Path | Coverage |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api-keys` | browser + E2E (revoked-key, scope) |
| GET/POST | `/quota/overview`, `/quota/refresh` | browser + E2E |
| GET/PATCH | `/network/pools`, `/network/pools/strategy` | browser probe (403 CSRF = mounted) |
| POST | `/network/pools/test`, `/test-batch`, `/relay/deploy` | browser probe |
| GET | `/live/in-flight`, `/live/pools` | browser probe (200) |
| GET | `/cli-tools/registry` | browser probe (200) |
| GET | `/model-bans` | browser probe (200) |
| GET | `/logs` | browser probe (200) |
| GET/POST | `/backup/export`, `/backup/import`, `/backup/delete-all` | E2E DB family (8/8) |
| GET/POST | `/studio/sessions`, `/studio/key` | browser probe (200) |

## Gateway data plane

| Surface | Coverage |
|---|---|
| `POST /v1/chat/completions` (stream + non-stream) | E2E GW, 2718 cases |
| `POST /v1/responses` | E2E GW |
| `POST /v1/messages` | E2E GW |
| Model listing (`GET /v1/models`) | E2E GW |
| Routing strategies: priority, weighted, health, quota | E2E GW |
| Failover, cooldowns, quota exhaustion, disabled accounts | E2E GW |
| Cancellation propagation | E2E GW |
| Usage accounting after failover | E2E GW |
| Real third-party clients (`omp`, `opencode`, `curl`) | E2E CLI, 210 cases, 0 failed |

## Persistence

| Concern | Coverage |
|---|---|
| Schema and migrations | unit (`bun run test`, DB suites) |
| Lite (PGlite) boot + migrate | browser session + unit |
| Full (PostgreSQL) | **BLOCKED** — no Docker on this machine |
| Backup export/import round trip | E2E DB (8/8), including account status |
| Restore runtime convergence | E2E DB (`post-restore live 200 with 1 upstream call`) |
| Cross-backend portability | unit suite exists; blocked without PostgreSQL |

## Known gaps

1. **`persistence=full` is unverified** (1656 planned cases). Requires a
   disposable PostgreSQL.
2. **Live third-party provider calls are unverified** — no provider
   credentials. The adapter contract is covered by the mock-backed E2E.
3. **OAuth callback against a real provider is unverified.** The flow store,
   state validation, and error paths are unit-tested; the live handshake is not.
4. **778 planned E2E cases have no owning scenario family** and are reported
   UNVERIFIED rather than dropped. Breakdown: GW 395, SEC 131, DB 132, CLI 120.
5. **Docker image build and Compose smoke** are unverified — Docker is absent.
6. **2 vCPU / 2 GB profiling** was not performed; this machine is 6-core /
   8 GB and measurements are recorded against the actual hardware.
