# Connecting clients

Tested integration notes for pointing real clients at Cloviela Router. Replace
`{origin}` with the gateway origin you actually run (the dashboard's Help page
shows it, and the `Gateway Endpoint` card on Overview copies it) and `{key}`
with a tenant API key from **Kunci API**.

Everything here is a real gateway route. The gateway does not proxy
arbitrary upstream hosts, so a client's own base-URL setting is the only
integration point needed.

## Prerequisite

1. Create a provider account (**Provider → add account**) and register at least
   one model.
2. Issue an API key (**Kunci API → Create Key**) with the `routing:invoke`
   scope. Copy it — it is shown once.
3. Confirm readiness on **Panduan Awal** (or `GET /health/ready`).

## OpenAI-compatible clients

Base URL: `{origin}/v1` · Header: `Authorization: Bearer {key}`

### curl — non-streaming

```bash
curl -sS {origin}/v1/chat/completions \
  -H "Authorization: Bearer {key}" \
  -H "Content-Type: application/json" \
  -d '{"model":"{model}","messages":[{"role":"user","content":"ping"}]}'
```

### curl — streaming

```bash
curl -N -sS {origin}/v1/chat/completions \
  -H "Authorization: Bearer {key}" \
  -H "Content-Type: application/json" \
  -d '{"model":"{model}","stream":true,"messages":[{"role":"user","content":"ping"}]}'
```

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(base_url="{origin}/v1", api_key="{key}")
stream = client.chat.completions.create(
    model="{model}",
    messages=[{"role": "user", "content": "ping"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### Responses API

`POST {origin}/v1/responses` accepts the OpenAI Responses envelope (including
tool and reasoning fields). `POST {origin}/v1/responses/compact` compacts a
context. Both are validated against the route's capability set: a model that
cannot serve the requested capability is rejected with
`capability_unsupported` rather than silently degraded.

## Anthropic-compatible clients

Base URL: `{origin}` · Header: `x-api-key: {key}` ·
`anthropic-version: 2023-06-01`

### curl — streaming Messages

```bash
curl -N -sS {origin}/v1/messages \
  -H "x-api-key: {key}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"{model}","max_tokens":64,"stream":true,
       "messages":[{"role":"user","content":"ping"}]}'
```

### Anthropic SDK (Python)

```python
from anthropic import Anthropic

client = Anthropic(base_url="{origin}", api_key="{key}")
message = client.messages.create(
    model="{model}",
    max_tokens=64,
    messages=[{"role": "user", "content": "ping"}],
)
print(message.content[0].text)
```

## CLI tools and agents

The **CLI Tools** screen writes the correct configuration for supported tools
directly into their config files (Codex, Claude Code, OpenCode, Cline, Droid,
Hermes, Grok, Copilot, DeepSeek TUI, jcode, Kilo, OpenClaw, Cowork) or produces
a downloadable snippet for guide-only tools.

Two things are worth knowing before you press Apply:

- The injector edits **real client configuration files** under your home
  directory. It preserves unrelated keys and can be reset from the same screen.
- Every write goes through a single guarded filesystem module; in tests that
  module additionally refuses any path outside the test sandbox.

Manual configuration for any other OpenAI- or Anthropic-compatible tool is the
same two values: base URL and API key.

## Model discovery

```bash
curl -sS {origin}/v1/models -H "Authorization: Bearer {key}"
```

Returns only the models the presenting key is allowed to reach, with their
qualified ids. The qualified id (`provider/model`) is what routing resolves
unambiguously; a bare id works only when it resolves to exactly one target.

## Errors

Errors use one envelope across every surface:

```json
{"error":{"origin":"cartethyia|upstream|network","code":"...","message":"...","details":{}}}
```

Useful codes: `authentication_failed`, `model_not_found`, `ambiguous_model`,
`capability_unsupported`, `accounts_unavailable`, `quota_exceeded`,
`deadline_exceeded`, `invalid_request`, `request_too_large`. Diagnostic strings
in `details` are credential-redacted before they reach you.

## Cancellation

Closing the connection (Ctrl-C on a stream, `AbortController` in an SDK)
propagates upstream: the gateway aborts the provider request and releases the
account's concurrency slot. A committed stream is never replayed onto another
account after the client has already received output.
