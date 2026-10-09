<img src="assets/sources/banner.webp" alt="Cloviela — rose and lace masthead with the Cloviela wordmark" width="100%">

# Cloviela Router

**A private-first, self-hosted multi-provider AI gateway with an original anime console — unofficial Rikka Takarada (SSSS.GRIDMAN) fan theme.**

Cloviela Router gives your AI clients one stable, OpenAI- and Anthropic-compatible endpoint while the gateway does the operational work behind it: provider-aware translation, account selection, health-aware failover, quota and cooldown enforcement, usage accounting, telemetry, and optional proxy pools. The dashboard is an original Rikka-themed console with its own artwork, Indonesian-first copy with full English support, and Rikka Noir / Rikka Day / Follow-system themes.

> **This is an unofficial personal fan theme.** The anime character identity belongs to its respective rightsholders; nothing here implies endorsement or grants commercial character rights. The source code is licensed **GPL-3.0-only** — see [License and credits](#license-and-credits).

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

## Install

You need **[Bun](https://bun.sh) 1.4 or newer** and a terminal. Nothing else —
no database server, no Docker, no Node.

```bash
# 1. Install Bun, if you do not have it
curl -fsSL https://bun.sh/install | bash

# 2. Get Cloviela
git clone https://github.com/clovieflow/cloviela-router.git
cd cloviela-router

# 3. Install the `cloviela` command
bun link
```

`bun link` puts `cloviela` on your PATH. If you would rather not link it, run
`bun run scripts/cli.ts` in place of `cloviela` anywhere below.

### Windows

Bun runs natively on Windows. Use **Git Bash** or **PowerShell** for the
commands above; `bun link` works the same way. If `bun` is not recognised
afterwards, add `%USERPROFILE%\.bun\bin` to your PATH.

## Run it

```bash
cloviela up
```

That one command does everything the first time: installs dependencies,
generates `.env` with a fresh encryption key, builds the standalone binary,
starts the gateway, waits until it is actually answering, and opens the
console at <http://127.0.0.1:12800/console>.

The first run takes a few minutes because it compiles. Every run after that
starts in about a second.

### Everyday commands

| Command | What it does |
|---|---|
| `cloviela up` | Start it (and open the console). Safe to run when already running — it just opens the console. |
| `cloviela down` | Stop it. In-flight requests are drained first, not cut off. |
| `cloviela restart` | Stop, then start again. |
| `cloviela status` | Say whether it is running, and where. |
| `cloviela logs` | Show recent output. `--follow` keeps watching. |
| `cloviela update` | Pull the newest version, reinstall, rebuild, and restart if it was running. |
| `cloviela doctor` | Check configuration and readiness. |
| `cloviela help` | List everything. |

On a server with no browser, use `cloviela up --no-open`.

### Where things live

| | |
|---|---|
| Console | <http://127.0.0.1:12800/console> |
| Data | `~/Library/Application Support/Cloviela` (macOS) · `~/.local/share/Cloviela` (Linux) · `%APPDATA%\Cloviela` (Windows) |
| Log | `cloviela.log` inside that data directory |
| Config | `.env` in the repository |

Your database, keys and configuration all live in the data directory. Backing
up that one folder backs up the installation.

## Configure

Everything is environment-driven; every knob is documented in
[`.env.example`](.env.example) and
[`documentation/getting-started.md`](documentation/getting-started.md). The
ones that matter:

```dotenv
CLOVIELA_DB_MODE=lite          # lite | full
PORT=12800
CLOVIELA_BIND_HOST=127.0.0.1   # private-first; set 0.0.0.0 only inside a container/reverse proxy
CLOVIELA_ENCRYPTION_KEY=       # generated by `cloviela up`; encrypts provider credentials
```

`cloviela up` writes this file for you on first run. Edit it, then
`cloviela restart` to apply.

### Lite or Full?

Lite is the default and needs nothing else. Switch to Full when you want
PostgreSQL, Redis and multiple processes — see
[`documentation/getting-started.md`](documentation/getting-started.md) for the
Docker route.

## Developing

```bash
bun install
bun run dev        # backend + dashboard with hot reload, and CTRL+R to restart in place
bun run test       # backend + dashboard suites
bun run typecheck  # both typechecks
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

## License and credits

Cloviela Router is free software under the **GNU General Public License v3.0
only** — see [`LICENSE`](LICENSE). You may use, study, modify, and redistribute
it under the same terms. If you distribute it or a modified version, keep the
license notices, provide the corresponding source, and license covered work
under GPLv3.

### Artwork

The character illustrations in `assets/` and `dashboard/public/rikka/` were
generated for this project with OpenAI GPT-Image-2 through OMP. They are
original derivative illustrations of the Rikka Takarada character design;
prompts, dimensions, and hashes are recorded in
[`assets/manifest.json`](assets/manifest.json).

The character identity is **not** covered by the GPL and remains the property
of its rightsholders. This is an unofficial personal fan theme: it is not
affiliated with, sponsored by, or endorsed by any rightsholder, and claims no
commercial rights to the character.

This software is provided **without warranty**, as stated in the GPLv3.
