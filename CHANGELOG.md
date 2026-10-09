## 2.2.0-rikka.3

- **Bansos: subsidized access programs.** An operator groups API keys under a
  program, attaches a participant identity, and sets a ceiling that cannot be
  widened — the strictest limit across program, participant and key always
  wins. A program publishes its own model names and maps each to one upstream
  id, so participants send `bansos-sonnet` while the gateway sends
  `ag/claude-sonnet-4` and never reveals which upstream serves them. A program
  may also pin the provider and accounts it is willing to pay, because the same
  model id served by two providers is the ordinary case rather than a contrived
  one.

  Nothing about quota, rate limiting, concurrency or routing is re-implemented:
  a Bansos key is an ordinary `api_keys` row, so it inherits the existing
  admission, caching, revocation and telemetry paths unchanged.

- **A participant portal.** Participants sign in at `/console/portal` with the
  Bansos key they already hold, exchanged once for a session token kept in
  `sessionStorage`. The key never becomes a cookie. Revoking a key ends its
  portal sessions and its gateway access together — the session is bound to the
  key and the key is re-checked on every request, so there is no window in
  which one is live and the other is not.

- **An administrator console for Bansos.** Programs, participants, subsidized
  models, key issuance and revocation, per-participant usage and the audit
  trail, built from the components the rest of the console uses so it inherits
  the glass, the tokens and the responsive behaviour.

- **A suspension is immediate.** Setting a participant to `suspended` or
  `revoked` refuses every request on the next one, including keys already
  issued, with no key rotation.

Eight defects were found by exercising real boundaries rather than by reading
the code, and every one is fixed: a key issued with an empty model allowlist
permitted *every* model on the gateway; the program's published model names
were never translated; revoked keys still counted against the participant's
key ceiling; a subsidized key was subject to the model-abuse strike ban (which
would cut off every participant behind a shared IP); `provider_id` and
`provider_account_ids` were stored, documented as enforced, and never read; a
deleted key kept authenticating from the auth cache; the portal's sign-in was
refused with a CSRF error whenever the browser was also signed into the
console; and the dashboard's participant status type invented `expired` while
omitting the real `revoked`.

## 2.1.0-rikka.2

- **Liquid Glass across the console.** The sidebar, topbar, every card and the
  metric row are translucent panels over an atmospheric background. The
  default card material is glass in the dark theme, so a new card is correct
  by construction rather than by remembering to opt in. Light theme keeps its
  opaque paper surfaces, and a browser without `backdrop-filter` falls back to
  them.
- **The product rename is complete.** Backups write `app: "cloviela"` and
  still accept the pre-rename value; the container account, its environment
  variables and the lockfile workspace all carry the current name. Readiness
  reads the same migration ledger the runner writes, so an installation whose
  history predates the rename no longer reports itself un-migrated.
- **Artwork fits its frames.** The story plates, the console hero and the
  onboarding strip all took their sizes from rules that cropped the subject.
  Each frame now follows its artwork's ratio: measured at 390, 768, 1440,
  1920 and 2302px, nothing is cropped in either axis.
- **`bun setup` creates `.env.test`.** The documentation had said so for
  three releases while the template named a variable no suite reads.

## 2.0.0-rikka.1

- Initial tagged release.

## Cloviela Router

- **Readiness read a different ledger than the runner wrote.** The migration
  runner resolves which table holds a database's history, because an
  installation that predates the rename keeps it in
  `cartethyia_schema_migrations`. The readiness check queried the current table
  directly, so a gateway that booted and served traffic reported
  `migrations: "pending"` and refused itself. Both paths now resolve the same
  ledger; the regression test reproduces the layout that triggers it — legacy
  table populated, current table present and empty — which a freshly created
  database cannot.
- **Backups carried the pre-rename product name.** `BACKUP_APP` was left at
  `cartethyia` when the product was renamed, while the validator's own error
  text already said "expected a Cloviela backup". Exports now write `cloviela`,
  and the importer accepts both spellings: changing the constant alone would
  have refused every backup an operator already holds. A genuinely foreign file
  is still refused by name.
- **The container named itself after the previous product.** The image created
  a `cartethyia` service account, exported `CARTETHYIA_*` variables and kept the
  pre-rename workspace name in the lockfile. The account, its `--chown` flags
  and the entrypoint's messages now say `cloviela`, and the environment exports
  the current names, which the compatibility layer resolves with the previous
  spelling still honoured as a fallback.
- **An exported variable could not override the checked-in test defaults.**
  `.env.test` was spread after `process.env`, so pointing the suite at a
  different database appeared to work while every test still connected to the
  one named in the file. The file now supplies the defaults and the environment
  wins.
- **The repository has a masthead.** A wide lockup sits above the README title,
  registered in the asset manifest beside the other artwork as
  operator-supplied rather than generated.

- **A long stream could grow the retained transcript without bound.** The
  canonical event history appended every event for the whole stream regardless
  of the capture policy, independent of the cap applied later, and the client
  transcript accumulated up to 512 KiB even with capture off. Retention is now
  resolved once per stream from the existing capture policy: `none`/`metadata`
  keeps nothing, `full` keeps a prefix bounded by the configured capture depth.
  A truncated transcript is stored as the retained prefix plus an explicit
  `{_truncated, _retained_bytes, _dropped_events}` trailer, so a partial trace
  can never be read as a complete one. The client SSE path, backpressure, and
  abort behaviour are unchanged, and terminal/usage frames are always retained.
- **The cancellation test proved nothing.** The test harness built its own
  `ProxyRequestStateStore` that the application never saw — the app constructs
  its own — so asserting on it read zeroes from an orphan object. The harness now
  exposes the owners the app actually uses, and the rewritten test asserts a
  held stream through the authenticated in-flight endpoint, the pool selector,
  and the admission counter, then asserts all three release and that the
  upstream abort signal fired.
- **Route simulator (`POST /console/api/routing/simulate`).** The dashboard's
  simulator screen had no backend, so it honestly showed "not available". It now
  answers from the same `RoutingEngine` the dispatcher uses — same alias
  resolver, same `EligibilityEvaluator`, same ordering rules — so an explanation
  cannot drift from what a real request does. Read-only is enforced rather than
  documented: rotation cursors are *peeked* instead of advanced, no admission
  slot is reserved, nothing is dispatched, and no credential is decrypted, which
  is why `selected` appears only when a single candidate makes the choice
  certain. Fifteen regression tests cover outcome mapping, ordering parity with
  `plan()`, alias chains, tenant isolation, and the cursor guarantees.
- **The compiled release binary could not run.** Two independent defects, both
  found by executing `dist/cloviela-router` rather than trusting the build's exit
  code. macOS killed it on launch with `SIGKILL (Code Signature Invalid)` and no
  output, because `bun build --compile` rewrites the file after the linker signs
  it; the build now re-signs ad-hoc on darwin. And Lite mode died with
  `ENOENT: open '/$bunfs/root/pglite.data'`, because PGlite resolves its WASM and
  data files through `import.meta.url` and a standalone executable has no
  directory to resolve them from; the assets are now embedded, which also
  required moving the option inside `compile` (Bun ignores a root-level
  `assets` key without reporting it).
- **P0: Lite mode deadlocked permanently when a provider account was created.**
  `createAccount` enriched its response through `accountsWithUsage(...)` while
  its own transaction was still open, and that helper read through the outer
  handle. Lite is a single-connection embedded PGlite, so the nested read
  waited forever on the connection the transaction already held: the process
  reported `db: disconnected`, readiness stalled for its full 5 s timeout on
  every call, and every database-touching request hung until a restart. Full
  mode hid it because a second pool connection served the nested read. The
  enrichment and listing paths now take the transaction executor, and the
  runtime in-flight gauge — which is not transaction state — is skipped inside
  a transaction. Found by driving the real HTTP boundary, not by unit tests.
- **Account creation for an unknown provider returned 500.** The
  `provider_accounts.provider_id` foreign key raised a constraint violation
  that surfaced as a generic `internal_error`. The provider is now validated
  before the insert, so the caller gets `404 provider_not_found`.
- **Privacy: upstream credentials can no longer reach a gateway caller or a
  log.** `publicGatewayErrorDetails` published allowlisted diagnostic strings
  verbatim, and `raw` is attacker-controlled text — a provider that echoes the
  API key it rejected (common on 401) published that key to the caller. The
  same class of leak existed in the console log ring and in payload capture.
  `src/observability/redaction.ts` now owns a credential redactor applied at
  every publication/storage boundary; provider requests remain unmodified.
  Reproduced before the fix (`publicErrorLeaks:true`), verified after
  (`false`, `upstreamInputUnchanged:true`).
- **Private-first listener.** The HTTP server bound every interface implicitly.
  `CLOVIELA_BIND_HOST` now defaults to `127.0.0.1`; Docker sets `0.0.0.0`
  explicitly and publishes to the host as `127.0.0.1` only.
- **Dependency: Elysia and TypeBox pinned together.** TypeBox `1.3.24` removed
  the `Validator.buildResult` shape that Elysia `2.0.0-beta.16` reads, so a
  fresh install crashed with `this.tb.buildResult.external` undefined the
  moment a real listener started compiling `/console/api/auth/login`. Pinned
  `typebox` to `1.3.23` and removed the AOT build's string-patching bridge that
  had been masking the mismatch in the bundled path only.
- **CLI-tool tests can no longer damage real client configuration.** The
  lifecycle suite redirected `HOME`, but `os.homedir()` was already cached, so
  injector writes landed in the operator's real `~/.codex`, `~/.claude`,
  `~/.config/opencode`, and others. `homeDir()` now resolves the environment
  lazily, the runner launches workers with a disposable home/temp/XDG sandbox,
  and `fs-ops.ts` refuses any write outside it — including through a symlink or
  a dangling symlink (both reproduced).
- **`bun doctor` honors the active environment.** `.env` values overrode an
  explicitly exported `PORT`/`DATABASE_URL`/`REDIS_URL`, so readiness was
  probed on the wrong port. Precedence is now process environment first, and
  the lockout reset boots the database through the same authority the app uses.
- **Accessibility fixes measured with axe-core, not assumed.** Disabled buttons
  composited to 4.31:1; Day success/warning status text measured 4.23:1 and
  3.95:1; the console log's theme-following colors measured 2.6:1 on its fixed
  dark surface; a progressbar had no accessible name; a password field had no
  label; state panels skipped a heading level. All 17 console routes now report
  zero axe-core violations in both themes.
- **Rikka identity.** Rikka Night / Rikka Day / Follow-system palettes designed
  independently, original GPT-Image-2 artwork throughout (30 optimized assets
  with a provenance manifest), Indonesian-first copy with English support, and
  a new onboarding, health, models, API-keys, simulator, help, about,
  not-found, and system-error screen.
- **Truthfulness fixes in the UI.** The Gateway Endpoint card printed a
  hardcoded `PORT 12800` and the Help samples hardcoded `127.0.0.1:12800`;
  both now derive from the live origin. The release label no longer names an
  upstream codename.

## Unreleased

- A buddy-family channel rejection (`400 · 11128`, "Illegal API invocation
  from an unapproved channel") now parks the account for 6 h instead of
  leaving it in rotation. It is account-wide and repeats on every invocation,
  but it used to classify as `unknown` with `mutates=false`, so the account
  kept failing and — every account failing the same way — the whole pool
  looked dead with nothing ever parked, so routing never moved to the next
  account. A suspended account ("Request illegal: Account Suspended.") is
  matched the same way.
- Reverted: the buddy family keeps its variant's fixed leading system prompt.
  Replacing it with the caller's system text made CodeBuddy (`cb`) reject every
  request with `400 · 11128 — Illegal API invocation from an unapproved
  channel`: the upstream validates the leading system prompt as the calling
  channel, so a foreign prompt reads as an unapproved client. Because every
  account failed, the whole pool was marked unhealthy. The fixed prompt is
  sent again and caller `system`/`developer` turns are dropped as before.
- Custom providers render in their own section again. The service-aware
  provider tabs (`01cfbeb4`) left a "Custom Providers" entry in the built-in
  section list while the dedicated section above it had its cards suppressed,
  so a custom provider only appeared once, in the last section at the bottom.
  The duplicate list entry is removed and the dedicated section renders its
  cards again.
- `search:invoke` is now revocable. Unchecking it on an API key used to be
  undone on the next read: `createAccessDecision` re-granted the scope to any
  key holding `routing:invoke`, so no key could ever hold routing without
  search. Migration `0040` writes the grant onto the rows that were receiving
  it implicitly, and the implicit grant is removed.
- A tenant API key can read its own request telemetry for remote debugging: a
  key holding `dashboard:read` reaches `GET /console/api/system/usage/requests`
  and `GET /console/api/telemetry/events` with `Authorization: Bearer <key>`.
  This worked before but was untested, so a change to console auth could have
  removed it silently; it is now pinned by regression tests.
- Web-search requests from chat clients (Claude Code, Codex CLI) now route
  through the selected model first: a route whose *provider* serves hosted
  search keeps its native tool, and a route that cannot serve it runs the
  query on an operator-configured search provider (exa → gemini → codex →
  tavily → brave) and continues on the selected route with the results
  injected as a user context turn. The direct `POST /v1/search` API is
  unchanged.
- Web-search capability is now a property of the provider, not the model row:
  `models.web_search` is dropped (migration `0039`), and native search is
  decided by `providerSupportsWebSearch`. Discovery previously wrote `false`
  for models it had no metadata for, which filtered capable routes out of
  native search on a metadata gap.
- Hosted search tools are translated per wire instead of being forwarded
  verbatim: Codex receives `{"type":"web_search"}` (it rejects both the raw
  Anthropic payload and `web_search_preview`), and an [OI]-compatible wire
  receives `web_search_preview`. A bare `{"type":"web_search"}` declaration
  on `/v1/chat/completions` is now recognized and no longer dropped.
- The provider-detail "Test search" control now shows the probe's latency,
  result count, and the normalized hits (or the upstream error) instead of a
  bare pass/fail line.
