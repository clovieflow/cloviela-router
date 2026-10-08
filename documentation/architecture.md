# Architecture

How one request flows through Rikka Router, and which module owns each step.
The gateway core is inherited from Cartethyia; this document describes the
shipped behavior, not an aspiration.

## Composition roots

| Layer | Owner |
|---|---|
| HTTP application | `src/app.ts` — route table, public endpoints, console mount |
| Process start | `src/main.ts` — listener, bind host, signals, drain |
| Production wiring | `src/runtime/dependencies.ts`, `src/runtime/lifecycle.ts` |
| Environment contract | `src/config.ts` (`CONFIG_SPEC`) + `.env.example` (drift-tested) |
| Browser application | `dashboard/src/App.tsx`, `dashboard/src/apps/*/entry.tsx` |

`src/main.ts` resolves the listener from `PORT` and `CARTETHYIA_BIND_HOST`
(default `127.0.0.1`). Nothing else may open a socket on behalf of the gateway.

## Request lifecycle

A `/v1/*` request passes through these owners in order. Each step has one
canonical implementation; a second copy of any of these rules is a defect.

1. **Ingress and identity** — `src/transport/middleware/*` resolves the peer
   address (honoring `TRUSTED_PROXY_CIDRS` only), applies IP abuse policy, and
   enforces the body-size and idle-timeout limits.
2. **Readiness gate** — `src/runtime/*` refuses new work while draining.
3. **Authentication** — `src/security/api-key-auth.ts` validates the presented
   key, resolves its scopes, and consults admission (`src/security/admission/*`).
   An invalid key is rejected before any provider is contacted.
4. **Surface decode** — `src/transport/surface/*` recognizes the client
   protocol (`chat.completions`, `responses`, `messages`, `completions`,
   `search`, `systemone`) and decodes it into the canonical model in
   `src/transport/canonical-model.ts`.
5. **Model resolution and authorization** — `src/transport/routing/router.ts`
   resolves the requested name through aliases and combos, filters by
   capability and endpoint family, and applies per-key model access.
6. **Candidate selection** — the same router ranks eligible accounts by health,
   quota, cooldown, balance, weight, priority, and sticky affinity, then
   reserves capacity through admission.
7. **Dispatch** — `src/transport/dispatch/attempt-loop.ts` owns the retry and
   failover budget, per-attempt accounting, and OAuth refresh policy;
   `src/transport/dispatch/streaming-attempt.ts` owns streaming primitives,
   cancellation, and terminal frames.
8. **Wire encoding** — `src/protocol/*` serializes the canonical request into
   the provider's wire format and parses the response back. Provider-specific
   headers and identity are preserved by the adapter, not rewritten centrally.
9. **Accounting and telemetry** — usage, quota, cooldown, and health updates are
   written once per committed attempt; telemetry is batched by
   `src/observability/telemetry-buffer.ts`.
10. **Response** — the client receives the contract it asked for: JSON, SSE, or
    a typed error envelope.

## Route simulation

`POST /console/api/routing/simulate` answers "what would this request do"
without doing it. It calls `RoutingEngine.simulate`, which reuses the same alias
resolver, `EligibilityEvaluator`, ordering rules, and rotation state `plan()`
uses — so the explanation cannot drift from what actually dispatches. The one
added layer is the endpoint family: a model that is healthy but cannot serve the
requested family is reported as such instead of reading as dispatchable.

Read-only is enforced, not documented: rotation cursors are *peeked* rather than
advanced, no admission slot is reserved, nothing is dispatched, and no
credential is decrypted. `selected` is therefore present only when a single
candidate makes the choice certain; under rotation or fusion the response says
the choice is non-deterministic and the console presents no winner.

## Routing state

`src/transport/routing/route-catalog.ts` projects database rows (providers,
accounts, models, aliases, combos, pools, cooldowns) into an immutable
snapshot. `src/transport/routing/route-model.ts` caches that snapshot per
process and invalidates it when the control plane mutates routing state. The
resolver never reads the database directly on the hot path.

## Console and dashboard

`src/console/console-router.ts` mounts `/console/api` with two credential
paths: a browser session cookie (with double-submit CSRF on mutations) and a
scoped tenant API key sent as a bearer token. Both resolve to the same
`AccessDecision` type, so scope checks are identical regardless of how the
caller authenticated.

The dashboard is a single Vite build served at `/console`, `/share`, and `/`.
`src/console/dashboard-assets.ts` serves the built documents and injects
route-specific social metadata, because crawlers do not execute the bundle.

## Persistence

| Mode | Owner |
|---|---|
| Lite | `src/persistence/db-pglite.ts` — embedded PGlite under `<CARTETHYIA_DATA_DIR>/pglite` |
| Full | `src/persistence/postgres.ts` — external PostgreSQL via `DATABASE_URL` |
| Migrations | `migrations/*.sql`, applied under an advisory lock at boot |
| Coordination | `src/persistence/redis.ts` when `REDIS_URL` is set, in-process otherwise |

`src/persistence/db-mode.ts` is the single authority for the mode and the data
directory. Both modes expose the same application features.

## Security boundaries

- Provider credentials are encrypted at rest with `CARTETHYIA_ENCRYPTION_KEY`
  and are decrypted only inside the dispatch path.
- Dashboard code never receives a provider credential. The API returns masked
  prefixes (`keyPrefix`) and booleans.
- Upstream error bodies reach the client through an allowlisted envelope whose
  diagnostic strings are credential-redacted
  (`src/observability/redaction.ts`).
- Payload capture is opt-in per scope, bounded, and redacted before storage.
- The CLI-tool injectors edit real client configuration files; every write goes
  through `src/console/cli-tools/fs-ops.ts`, which refuses paths outside the
  configured home and, in tests, outside the runner's sandbox.

## Extension points

- **Provider** — `src/providers/*` (registry entry, adapter, auth, quota,
  discovery). See `.skills/cartethyia-engineering/references/provider-lifecycle.md`.
- **Protocol surface** — `src/transport/surface/*` plus `src/protocol/*`.
- **Console domain** — `src/console/domains/*` or a domain folder under
  `src/console/`, registered in `src/console/domain-registration.ts`.
