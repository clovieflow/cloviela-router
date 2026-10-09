# Cloviela Router documentation

Start here if you are installing or running Cloviela Router:

- [Getting started](getting-started.md) — requirements, setup, OS guidance, Docker,
  commands, migrations, and verification.
- [Connecting clients](clients.md) — tested snippets for SDKs, curl, and CLI tools.
- [Bansos](bansos.md) — subsidized access programs: programs, participants,
  keys, the participant portal, and where each limit is enforced.
- [Architecture](architecture.md) — the request lifecycle and module ownership.
- [Security](security.md) — trust boundaries and credential handling.
- [Release](release.md) — gates, evidence, and known limitations.
- [Release evidence](release-evidence.md) — every gate result with the command
  that produced it, including the defects found by exercising real boundaries.
- [Release gate status](release-gates.md) — the R-01…R-32 table.
- [Final report](final-report.md) — delivered, blocked, and unverified.
- [Performance](performance.md) — measured numbers and the hardware they came from.

The [`audits/`](audits/) folder holds the working evidence behind those pages:
the feature inventory, the E2E coverage matrix, the theme and performance
audits, the bug-remediation report, and the screenshots taken from the running
console.

For the product overview and supported clients, see
[`README.md`](../README.md).
