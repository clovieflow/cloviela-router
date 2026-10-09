# Bansos: subsidized access programs

Bansos groups API keys under a *program* and attaches a participant identity to
them, so an operator can hand out subsidized access to a specific group with a
ceiling they control. It is a policy layer over the machinery the gateway
already has — not a second gateway.

The name is Indonesian for *social assistance*, which is what the feature is:
an administrator funds access, participants receive it, and the program decides
how much each may spend.

## What it reuses, and what it adds

Nothing about quota accounting, rate limiting, concurrency or routing is
re-implemented. A Bansos key is an ordinary `api_keys` row with
`key_mode = 'bansos'`, so it authenticates, caches, revokes and reports through
the same paths as every other key.

What the program adds is:

- **A ceiling that cannot be widened.** Program, participant and key may each
  state a limit; the effective one is the strictest of everything that speaks.
  A participant override cannot raise the program's cap, and a key cannot raise
  the participant's grant.
- **A model allowlist with translation.** The program publishes its own model
  names (`bansos-sonnet`) and maps each to one upstream id
  (`ag/claude-sonnet-4`). Participants send the published name; the gateway
  sends the upstream one and never reveals it.
- **A provider scope.** The program may name the provider — and the specific
  accounts — it is willing to pay. A request that would draw on any other
  provider is refused even when that provider serves the same model id.
- **A participant portal.** Participants sign in with their own Bansos key to
  read their quota, keys and available models. They cannot reach the operator
  console, and the console cannot be reached with a portal session.

## Operating it

### 1. Create a program

Console → **Bansos** → **Program baru**.

| Field | Meaning |
|---|---|
| Slug | Stable identifier, used in URLs. Read-only after creation. |
| Enrollment mode | How participants are expected to arrive. Recorded, not enforced by itself. |
| Max keys per participant | Hard ceiling on live keys. Revoked keys do not count. |
| RPM / concurrency | Program-wide ceilings. The strictest level wins. |
| Default token allowance | What a *new* participant is granted. Not a cap on an existing grant. |

### 2. Add the models the program pays for

Bansos → the program → **Model tersubsidi**.

Each row is `upstreamModelId → publicModelId`. The upstream id must already
exist in the router's catalog; the program cannot invent one. The public id is
what participants send.

> A program with no models cannot issue keys. That is deliberate: a key issued
> with an empty allowlist under `whitelist` mode would permit **every** model on
> the gateway, which is the opposite of a subsidy. The issue route refuses with
> `no_models` instead.

### 3. Add participants

Bansos → the program → **Peserta** → **Peserta baru**.

| Status | Effect |
|---|---|
| `pending` | Refused. |
| `active` | May transact. |
| `suspended` | Refused immediately, **including keys already issued**. |
| `revoked` | Refused permanently. |

Suspension and revocation take effect server-side on the next request; no key
rotation is needed. This is verified in the release evidence.

### 4. Issue keys

Bansos → the program → the participant's **Kunci** → **Terbitkan kunci**.

The secret is shown **once**, in the dialog that issues it. Only a hash is
stored, so there is nothing to show later — copy it at that moment.

A Bansos key carries the `bs_` prefix, which makes a leaked credential
identifiable at a glance in a log without being a security boundary.

### 5. Watch usage

**Pemakaian** reports tokens consumed per participant, read from the same
counter the quota check enforces against — so a report can never disagree with
a refusal. **Jejak audit** records every program, participant, model and key
change.

## The participant's view

Participants open `/console/portal` and sign in with their Bansos key. The key
is exchanged once for a session token kept in `sessionStorage`; it never
becomes a cookie.

They see: their program, their consumed and remaining allowance, their live
keys, and the models they may call — under the published names only. They do
not see `adminNotes`, the upstream model ids, other participants, or anything
belonging to another tenant.

**Revoking a key ends its portal sessions and its gateway access together.**
The session is bound to the key that opened it and the key is re-checked on
every request, so there is no window in which one is live and the other is not.

## Where enforcement happens

| Concern | Enforced by | Column |
|---|---|---|
| Token budget | `ApiKeyAdmissionService` | `api_keys.lifetime_token_budget` |
| Rate limit | `ApiKeyAdmissionService` | `api_keys.requests_per_minute` |
| Concurrency | `ApiKeyAdmissionService` | `api_keys.max_concurrent_requests` |
| Model allowlist | Model access rule | `api_keys.model_list` |
| Program/participant state | Bansos policy | `bansos_programs`, `bansos_participants` |
| Model translation | Request preparer | `bansos_models` |
| Provider scope | Request preparer | `bansos_programs.provider_id` |

A Bansos key is exempt from the model-abuse strike ban. That system exists to
stop a private key enumerating its reach; a participant is already limited to a
published allowlist, and banning their IP would cut off every other participant
behind the same address.

## Migrations

| File | Adds |
|---|---|
| `0041_bansos_program.sql` | Programs, participants, models, audit, and the `bansos` key mode |
| `0042_bansos_portal_session.sql` | Portal sessions |

Both run automatically on start in both Lite and full PostgreSQL modes.

## Limits and honest caveats

- **Enrollment is recorded, not self-service.** `enrollmentMode` and
  `autoApprove` describe the intended policy; there is no public sign-up
  endpoint, so a participant is added by an operator. A program cannot
  currently admit someone on its own.
- **Terms acceptance is stored, not presented.** `termsRequired` and
  `termsText` exist on the program; no screen currently asks a participant to
  accept them.
- **Usage is per key, not per request.** Requests are not counted individually
  on the Bansos tables; token consumption is, from the counter the gateway
  already maintains.
