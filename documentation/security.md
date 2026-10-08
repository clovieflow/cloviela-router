# Security

Trust boundaries, credential handling, and what this build deliberately does.
Everything below describes shipped behavior in `src/`.

## Network exposure

The listener binds `CARTETHYIA_BIND_HOST`, default `127.0.0.1`. Nothing is
reachable from another machine until an operator explicitly sets `0.0.0.0` (the
Docker image does this for the container's own interface, and the Compose file
publishes it to the host as `127.0.0.1` only).

Before exposing the gateway to a network:

1. Set a real admin password during first-boot setup. The setup route is
   unauthenticated by design — it creates the *first* admin — so it must not be
   reachable by an untrusted party before you complete it.
2. Put a TLS-terminating reverse proxy in front and set
   `CARTETHYIA_PUBLIC_ORIGIN` to the public URL. Session cookies upgrade to
   `Secure` when the request arrives over TLS or through a trusted proxy that
   asserts `x-forwarded-proto: https`.
3. Configure `TRUSTED_PROXY_CIDRS` to the proxy's ranges only. Forwarded client
   IPs are honored exclusively from inside that boundary.
4. Consider restricting `CARTETHYIA_ALLOWED_NETWORKS`; private upstream
   addresses require an explicit opt-in.

## Authentication

Two credential kinds reach the console API, and both resolve to the same
`AccessDecision`, so a scope check cannot behave differently depending on how
the caller authenticated:

- **Browser session** — an opaque token in an httpOnly cookie, stored hashed,
  with a double-submit CSRF token required on mutations. Passwords are hashed
  with argon2id (64 MiB, t=3).
- **Tenant API key** — `Authorization: Bearer <key>`, resolved through the same
  path `/v1` uses, so revocation and scopes behave identically.

Gateway traffic (`/v1/*`) always requires a valid API key. An invalid or
revoked key is rejected before any provider is contacted, and revocation takes
effect without depending on a stale cache.

## Credential handling

| Where | Rule |
|---|---|
| At rest | Provider credentials are encrypted with `CARTETHYIA_ENCRYPTION_KEY` (AES-GCM). |
| Dashboard | Never receives a provider credential; only a masked `keyPrefix` and booleans. |
| API keys | Stored hashed for verification and encrypted for authorized re-display; the plaintext is shown once at creation. |
| Logs | Argument values pass through the credential redactor before reaching the terminal or the console log ring. |
| Error envelopes | Diagnostic strings and allowlisted detail fields are redacted; structure, codes, and causal metadata survive. |
| Payload capture | Opt-in per scope, bounded, and redacted **before** storage. |
| Upstream requests | Sent unmodified. The gateway does not rewrite provider wire bytes or identity headers. |

Redaction targets credential *shapes* (`Authorization`/`Cookie` headers,
`sk-`/`rk-`/`ghp_` style keys, JWTs, `api_key=`/`token=` assignments) rather
than entire messages, so a provider's rejection reason remains readable.

## What is intentionally not protected

- **A captured payload is still sensitive.** Redaction removes credential
  shapes; a prompt body is not a credential and is stored as sent. Treat a
  backup or a capture export like a password.
- **Lite mode is single-process.** Embedded PGlite has no network boundary of
  its own; anyone who can read the data directory can read the database.
- **The gateway does not sandbox providers.** A provider account you add can
  receive whatever the client sends to the routes it serves.

## Abuse controls

- IP-based admission limits and per-key rate limits (`requestsPerMinute`,
  daily/monthly token limits, lifetime budget, concurrency caps).
- Graduated model-abuse strikes with operator-visible bans.
- Request body cap (`CARTETHYIA_SERVER_MAX_BODY_BYTES`, default 8 MiB) and idle
  socket timeout, so a slow or oversized client cannot pin resources.
- Corrupt inline media (a truncated or CRC-mismatched image) is dropped from a
  request with an explicit log entry instead of being forwarded to a provider
  that would reject the whole call.

## Dependency and supply-chain notes

- Dependencies are pinned in `bun.lock`; the release build is reproducible from
  source plus that lockfile.
- `elysia` and `typebox` are pinned to exact compatible versions. TypeBox
  `1.3.24` removed a compiler return shape Elysia `2.0.0-beta.16` depends on,
  and the resulting crash only appeared when a real listener started — so these
  two must move together and be re-verified with a live `.listen()`.

## Reporting

This is a personal installation, not a hosted service. If you find a security
issue in the inherited gateway core, report it to the upstream project as well
as here; the fix belongs in the shared routing code.
