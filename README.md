# Rikka Router

**A private-first, self-hosted multi-provider AI gateway — an unofficial Rikka Takarada (SSSS.GRIDMAN) fan theme built on the Cartethyia routing core.**

Rikka Router gives your AI clients one stable, OpenAI- and Anthropic-compatible endpoint while the gateway does the operational work behind it: provider-aware translation, account selection, health-aware failover, quota and cooldown enforcement, usage accounting, telemetry, and optional proxy pools. The dashboard is an original Rikka-themed console with its own artwork, Indonesian-first copy with full English support, and Rikka Night / Rikka Day / Follow-system themes.

> **This is an unofficial personal fan theme.** The anime character identity belongs to its respective rightsholders; nothing here implies endorsement or grants commercial character rights. The **source code** is a derivative of Cartethyia and remains licensed **GPL-3.0-only** — see [License and attribution](#license-and-attribution).

> [!WARNING]
> **Development version.** APIs, configuration, database behavior, and provider integrations may change without notice. Verify against the current source before depending on a detail.

## What it is for

One installation, several devices and tools, one gateway:

| Capability | Operational value |
|---|---|
| **Protocol normalization** | Point OpenAI- and Anthropic-compatible clients at one endpoint without teaching each client every provider. |
| **Health-aware routing** | Select by model, alias, capability, account state, cooldown, quota, balance, and provider availability. |
| **Failover with accounting** | Retry viable candidates while preserving admission, usage, quota, and telemetry invariants. |
| **Provider-aware dispatch** | Keep authentication, headers, endpoint behavior, quota semantics, and streaming rules specific to each provider. |
| **Four-stage visibility** | Inspect Client Request → Provider Request → Provider Response → Client Response with bounded, credential-redacted capture. |
| **Private by default** | The listener binds `127.0.0.1` unless you explicitly opt into `0.0.0.0`; container and reverse-proxy exposure is a deliberate step. |
| **Deployment flexibility** | Run self-contained with embedded PGlite (Lite), use external PostgreSQL (Full), and add Redis only when coordination must be shared. |

This is a **personal installation**, not a SaaS: there are no plans, subscriptions, or checkout, and no fabricated usage statistics anywhere in the UI.

## Supported client routes

| Route | What it is for |
|---|---|
| `/v1/chat/completions` | OpenAI-style chat requests |
| `/v1/responses` | Responses API requests, including Codex-style tools and reasoning |
| `/v1/responses/compact` | Responses compaction |
| `/v1/messages` | Anthropic Messages requests, including Claude Code |
| `/v1/completions` | Legacy text completions |
| `/v1/models` | List available models |
| `/v1/search` | Web search |
| `/v1/systemone` | System One decision requests |
| `/health`, `/health/ready`, `/metrics` | Process liveness, readiness, and Prometheus metrics |

The client protocol belongs to the connection, not to the route you configure. Once a request is normalized, the same routing, admission, retry, accounting, and telemetry rules apply across the supported surfaces.

## Choose your setup

Both modes expose the same application features; only the persistence backend and deployment profile change.

| | Lite | Full |
|---|---|---|
| Database | Embedded PGlite | External PostgreSQL |
| Best for | Personal use, one local process | VPS, sustained or higher-concurrency use |
| Extra services | None; Redis optional | PostgreSQL required; Redis optional |

Lite is the default in `.env.example`. To move to Full later, export a JSON backup from Lite and import it into the Full instance — the configuration does not need to be rebuilt.

## Install and run

Requirements: **Bun 1.4.0+**, a terminal, and a writable data directory.

```bash
bun install
bun setup --non-interactive     # creates .env, generates the encryption key, prepares Lite
bun doctor                      # configuration + readiness check
bun run dev                     # backend + dashboard dev servers
```

Production build and start:

```bash
bun run build                   # dashboard → AOT → standalone binary (dist/rikka-router)
bun start                       # runs the compiled binary
```

Configuration is environment-driven; every supported knob is documented in
[`.env.example`](.env.example) and
[`documentation/getting-started.md`](documentation/getting-started.md). The
important defaults:

```dotenv
CARTETHYIA_DB_MODE=lite          # lite | full
PORT=12800
CARTETHYIA_BIND_HOST=127.0.0.1   # private-first; set 0.0.0.0 only inside a container/reverse proxy
CARTETHYIA_ENCRYPTION_KEY=       # required; encrypts provider credentials and API keys
```

## Documentation

- [`documentation/getting-started.md`](documentation/getting-started.md) — requirements, setup, OS guidance, Docker, commands, migrations.
- [`documentation/clients.md`](documentation/clients.md) — connecting real clients (SDKs, curl, CLI tools) with tested snippets.
- [`documentation/architecture.md`](documentation/architecture.md) — the request lifecycle and where each behavior is owned.
- [`documentation/security.md`](documentation/security.md) — trust boundaries, credential handling, and what is redacted where.
- [`documentation/release.md`](documentation/release.md) — release gates, evidence, and known limitations.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution rules.

## Verification

```bash
bun run typecheck           # backend types
bun run dashboard:typecheck # dashboard types
bun run test:backend        # backend suites
bun run dashboard:test      # dashboard suites
bun run build               # full release build
```

The backend suites run against an isolated test database described by
`.env.test`. The test runner also redirects `HOME`, `TMPDIR`, and the
platform config directories into a disposable sandbox, and the CLI-tool
injectors refuse any write outside it — a regression guard, because these
helpers edit real client configuration files in normal operation.

## License and attribution

Rikka Router is a derivative work of **[Cartethyia](https://github.com/risunCode/Cartethyia)**
(branch `dev`, commit `382cf2308f4a09aeac0b5e2b1adf8fa7ace9319f`), licensed
**GNU General Public License v3.0 only**. This fork keeps that license:
see [`LICENSE`](LICENSE). If you distribute this software or a modified
version, keep the license and copyright notices, provide the corresponding
source, and license covered work under GPLv3.

Character artwork in `assets/` and `dashboard/public/rikka/` was generated for
this fork with OpenAI GPT-Image-2 through OMP and is an original derivative
illustration of the Rikka Takarada character design; provenance, prompts, and
hashes are recorded in [`assets/manifest.json`](assets/manifest.json). The
character identity itself is not licensed by the GPL and remains the property
of its rightsholders. The project is an unofficial personal fan theme and does
not claim endorsement by or affiliation with the character's rightsholders.

This software is provided **without warranty**, as stated in the GPLv3.
