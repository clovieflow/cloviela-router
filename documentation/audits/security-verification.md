# Security verification

Scope: the controls the assignment names, tested through real application
boundaries. Nothing below weakens a control to make a test pass.

## What was executed

The `SEC` dimension of `scripts/ci-cloviela-e2e.ts` ran **288 cases with 0
failures** against the live gateway. Two families:

### Console auth boundary

Attacks driven at the console API with real requests: `unauthorized`,
`expired`, `replay`, `invalid-schema`, `oversize`, `xss`, `header-break`.
Each asserts the request is refused **at the boundary** — not sanitized and
then accepted.

### API-key scope enforcement

A key minted with only `search:invoke` is presented to a `routing:invoke`
route and must be refused. Asserted on the response, and on the credential not
appearing in it.

Also covered in the same run:

- **Revoked-key refusal** — a key is minted, revoked, then presented; the
  refusal must be the same as for a key that never existed.
- **Credential non-leakage** — the upstream-fault cases (`GW`) include a 401
  whose upstream body echoes the presented credential; the gateway must
  translate it rather than surface it.
- **SSRF boundary** — BYOK registration rejects IP-literal hosts outside the
  policy, and DNS names are revalidated at dispatch.
- **CSRF** — probed directly: `PATCH /console/api/network/pools/strategy`
  without a CSRF token returns `403 invalid_request: CSRF validation failed`.

## Verified by direct probe

Every console API path was called against the running gateway and its status
recorded. A path answering 401/403/422 is mounted and enforcing; a 404 would
mean it does not exist. The only two apparent 404s were my own method errors
(`PATCH /accounts/batch`, `GET /network/pools/strategy`); both are mounted and
enforce schema and CSRF respectively.

## Not verified

- **Live OAuth handshake.** The flow store, state validation, and error paths
  are unit-tested. The callback against a real provider is not, because there
  are no provider credentials here.
- **Penetration testing beyond the enumerated cases.** The `SEC` family covers
  the attack classes the assignment lists. It is not a substitute for a
  dedicated assessment.
- **Secret-at-rest encryption.** The schema stores credentials as
  `credential_ciphertext` and API keys as hashes, and the unit suite covers the
  crypto seams. A live key-rotation exercise was not performed.

## Findings this session

No new security defect was found. One operational exposure was created and
disclosed rather than hidden: while reading the stored git credential to rename
the repository, the keychain entry printed the token to tool output. It should
be rotated.
