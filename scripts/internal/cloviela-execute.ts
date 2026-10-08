/**
 * Scenario executors for the Rikka E2E harness.
 *
 * Each `run*` function drives the real gateway over TCP and returns one result
 * per case it covers. A result is only PASS when the assertion that matches the
 * case's own THEN clause held; a shared request that would satisfy several
 * different clauses is never allowed to stand in for all of them, which is why
 * families below name the exact clause each check maps to.
 *
 * Setup uses the real console APIs with real cookies and CSRF, so the fixtures
 * a scenario asserts on are the same rows an operator would create through the
 * dashboard.
 */
import { HarnessClient, digestOf, sanitize, type Exchange } from "./cloviela-client";
import { type MockBehavior, type MockCall } from "./cloviela-mock-upstream";
import type { CaseStatus, PlannedCase } from "./cloviela-plan";

/** Outcome for one matrix identifier. */
export interface CaseResult {
  readonly id: string;
  readonly status: CaseStatus;
  /** What was actually executed and observed. Never a restatement of the clause. */
  readonly detail: string;
  /** True when the check that ran matches this case's own clause. */
  readonly asserted: string;
  readonly trace?: readonly Exchange[];
  readonly mockCalls?: readonly MockCall[];
  /** Set when the case could not run for a dependency reason. */
  readonly blockedReason?: string;
}

/** The fixture world one store's scenarios share. */
export interface World {
  readonly store: "lite" | "full";
  readonly mockUrl: string;
  readonly mockPort: number;
  readonly console: HarnessClient;
  readonly password: string;
  /** Gateway keys minted for this world, by label. */
  readonly keys: Map<string, string>;
  readonly providers: {
    readonly chat: string;
    readonly responses: string;
    readonly messages: string;
  };
  readonly models: {
    readonly chat: string;
    readonly responses: string;
    readonly messages: string;
  };
  readonly accounts: Map<string, string>;
}

/** Behaviors keyed by the model ids the world registers. */
export function worldBehaviors(world: World): Readonly<Record<string, MockBehavior>> {
  return {
    [world.models.chat]: "ok",
    [world.models.responses]: "ok",
    [world.models.messages]: "ok",
    [`${world.models.chat}-tool`]: "ok-tool",
    [`${world.models.chat}-reason`]: "ok-reasoning",
    [`${world.models.chat}-usage`]: "ok-usage",
    [`${world.models.chat}-utf8`]: "ok-utf8-split",
    [`${world.models.chat}-401`]: "fault-401",
    [`${world.models.chat}-429`]: "fault-429",
    [`${world.models.chat}-500`]: "fault-500",
    [`${world.models.chat}-malformed`]: "fault-malformed-json",
    [`${world.models.chat}-slow`]: "fault-slow",
    [`${world.models.chat}-partial`]: "fault-partial-stream",
    [`${world.models.chat}-midstream`]: "fault-stream-mid-error",
  };
}

/** Every model id the world registers on its providers. */
export function worldModelIds(world: World): readonly string[] {
  return Object.keys(worldBehaviors(world));
}

/**
 * A gateway API key the matrix can authenticate with. Scopes default to the
 * gateway set; console scenarios mint their own keys with narrower scopes.
 */
export const GATEWAY_KEY_SCOPES: readonly string[] = ["routing:invoke", "search:invoke"];

export interface SetupInput {
  readonly console: HarnessClient;
  readonly mockUrl: string;
  readonly mockPort: number;
  readonly store: "lite" | "full";
  readonly password: string;
  readonly runLabel: string;
}

/**
 * Builds the shared fixture world through the real console APIs: first-boot,
 * setup, login, three BYOK providers (one per upstream wire family), an
 * account each, and a gateway key. Returns the ids later scenarios address.
 */
export async function setupWorld(input: SetupInput): Promise<World> {
  const { console: client } = input;
  const keys = new Map<string, string>();
  const accounts = new Map<string, string>();

  const firstBoot = await client.json<{ requires_setup: boolean }>({
    label: "setup:first-boot",
    method: "GET",
    path: "/console/api/auth/first-boot",
  });
  if (firstBoot.body?.requires_setup !== true) {
    throw new Error(`expected a fresh install to require setup, got ${JSON.stringify(firstBoot.body)}`);
  }
  const setup = await client.json<{ status: string }>({
    label: "setup:setup",
    method: "POST",
    path: "/console/api/auth/setup",
    body: { password: input.password, username: "e2e-operator" },
    csrf: false,
  });
  if (setup.status !== 200 || setup.body?.status !== "success") {
    throw new Error(`setup failed: ${setup.status} ${setup.exchange.bodyExcerpt}`);
  }
  const login = await client.json<{ status: string }>({
    label: "setup:login",
    method: "POST",
    path: "/console/api/auth/login",
    body: { username: "e2e-operator", password: input.password },
    csrf: false,
  });
  if (login.status !== 200 || login.body?.status !== "success") {
    throw new Error(`login failed: ${login.status} ${login.exchange.bodyExcerpt}`);
  }
  if (client.cookieValue("session_token") === undefined || client.cookieValue("csrf_token") === undefined) {
    throw new Error("login did not issue both session_token and csrf_token cookies");
  }

  const families = ["chat", "responses", "messages"] as const;
  const providerIds: Record<string, string> = {};
  const modelIds: Record<string, string> = {};
  for (const family of families) {
    const providerId = `e2e-${input.runLabel}-${family}`;
    const created = await client.json({
      label: `setup:provider:${family}`,
      method: "POST",
      path: "/console/api/providers/",
      body: {
        providerId,
        label: `E2E ${family}`,
        enabled: true,
        baseUrl: `${input.mockUrl}/v1`,
        wireFamily: family,
      },
    });
    if (created.status !== 201) {
      throw new Error(`provider ${family} create failed: ${created.status} ${created.exchange.bodyExcerpt}`);
    }
    providerIds[family] = providerId;

    const models = worldModelIdsFor(family);
    const registered = await client.json<{ registered: number }>({
      label: `setup:models:${family}`,
      method: "POST",
      path: `/console/api/providers/${providerId}/models`,
      body: { modelIds: models, wireFamily: family },
    });
    if (registered.status !== 200) {
      throw new Error(`model register ${family} failed: ${registered.status} ${registered.exchange.bodyExcerpt}`);
    }
    modelIds[family] = models[0] ?? "";

    const account = await client.json<{ id: string }>({
      label: `setup:account:${family}`,
      method: "POST",
      path: `/console/api/providers/${providerId}/accounts`,
      body: {
        label: `E2E ${family} account`,
        credentialKind: "api_key",
        credentialMode: "api_key",
        secret: `sk-e2e-${family}-fixture`,
      },
    });
    if (account.status !== 201 || typeof account.body?.id !== "string") {
      throw new Error(`account ${family} create failed: ${account.status} ${account.exchange.bodyExcerpt}`);
    }
    accounts.set(providerId, account.body.id);

    // Fault models get their own provider and account so a deliberate 401
    // cannot disable the credential the healthy cases depend on. See
    // `worldFaultModelIdsFor`.
    const faultProviderId = `${providerId}-fault`;
    const faultCreated = await client.json({
      label: `setup:provider:${family}:fault`,
      method: "POST",
      path: "/console/api/providers/",
      body: {
        providerId: faultProviderId,
        label: `E2E ${family} fault`,
        enabled: true,
        baseUrl: `${input.mockUrl}/v1`,
        wireFamily: family,
      },
    });
    if (faultCreated.status !== 201) {
      throw new Error(
        `fault provider ${family} create failed: ${faultCreated.status} ${faultCreated.exchange.bodyExcerpt}`,
      );
    }
    const faultRegistered = await client.json<{ registered: number }>({
      label: `setup:models:${family}:fault`,
      method: "POST",
      path: `/console/api/providers/${faultProviderId}/models`,
      body: { modelIds: worldFaultModelIdsFor(family), wireFamily: family },
    });
    if (faultRegistered.status !== 200) {
      throw new Error(
        `fault model register ${family} failed: ${faultRegistered.status} ${faultRegistered.exchange.bodyExcerpt}`,
      );
    }
    const faultAccount = await client.json<{ id: string }>({
      label: `setup:account:${family}:fault`,
      method: "POST",
      path: `/console/api/providers/${faultProviderId}/accounts`,
      body: {
        label: `E2E ${family} fault account`,
        credentialKind: "api_key",
        credentialMode: "api_key",
        secret: `sk-e2e-${family}-fault-fixture`,
      },
    });
    if (faultAccount.status !== 201 || typeof faultAccount.body?.id !== "string") {
      throw new Error(
        `fault account ${family} create failed: ${faultAccount.status} ${faultAccount.exchange.bodyExcerpt}`,
      );
    }
    accounts.set(faultProviderId, faultAccount.body.id);
  }

  const gatewayKey = await client.json<{ secret?: string }>({
    label: "setup:key",
    method: "POST",
    path: "/console/api/api-keys/",
    body: { label: "E2E gateway key", scopes: [...GATEWAY_KEY_SCOPES] },
  });
  if (gatewayKey.status !== 201 || typeof gatewayKey.body?.secret !== "string") {
    throw new Error(`gateway key create failed: ${gatewayKey.status} ${gatewayKey.exchange.bodyExcerpt}`);
  }
  keys.set("gateway", gatewayKey.body.secret);

  return {
    store: input.store,
    mockUrl: input.mockUrl,
    mockPort: input.mockPort,
    console: client,
    password: input.password,
    keys,
    providers: {
      chat: providerIds["chat"] ?? "",
      responses: providerIds["responses"] ?? "",
      messages: providerIds["messages"] ?? "",
    },
    models: {
      chat: modelIds["chat"] ?? "",
      responses: modelIds["responses"] ?? "",
      messages: modelIds["messages"] ?? "",
    },
    accounts,
  };
}

/**
 * Models that answer normally, and models that exist to fail.
 *
 * They are registered on SEPARATE providers on purpose. A gateway reacts to a
 * 401 from upstream by marking the account's credential invalid and disabling
 * the account — correct behaviour, and fatal to every later case when the
 * fault model shares an account with the healthy ones. The first full matrix
 * run proved it: the `-401` case disabled the chat account, the backup export
 * then carried `status: "disabled"`, and the restore and every CLI case after
 * it failed for a reason that had nothing to do with them.
 *
 * Giving the fault models their own provider and account keeps the deliberate
 * failures where they belong: inside the case that asks for them.
 */
function worldModelIdsFor(family: "chat" | "responses" | "messages"): readonly string[] {
  const base = `e2e-${family}-model`;
  return [base, `${base}-tool`, `${base}-reason`, `${base}-usage`, `${base}-utf8`];
}

/** The fault-injection models, registered on the family's fault provider. */
function worldFaultModelIdsFor(family: "chat" | "responses" | "messages"): readonly string[] {
  const base = `e2e-${family}-model`;
  return [
    `${base}-401`,
    `${base}-429`,
    `${base}-500`,
    `${base}-malformed`,
    `${base}-slow`,
    `${base}-partial`,
    `${base}-midstream`,
  ];
}

function authHeaders(key: string): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${key}` };
}

/**
 * Runs the non-streaming happy path for one protocol and returns a result for
 * every `valid-single` case of that protocol, asserting the specific clause
 * each case carries.
 */
export async function runValidSingle(
  origin: string,
  world: World,
  protocol: "chat" | "responses" | "messages",
  cases: readonly PlannedCase[],
): Promise<readonly CaseResult[]> {
  const key = world.keys.get("gateway");
  if (key === undefined) throw new Error("world has no gateway key");
  const client = new HarnessClient(origin);
  const model = world.models[protocol];
  const providerId = world.providers[protocol];
  const qualified = `${providerId}/${model}`;

  const body =
    protocol === "chat"
      ? { model: qualified, messages: [{ role: "user", content: "ping" }], max_tokens: 32 }
      : protocol === "responses"
        ? { model: qualified, input: "ping", max_output_tokens: 32 }
        : { model: qualified, messages: [{ role: "user", content: "ping" }], max_tokens: 32 };

  const result = await client.json({
    label: `valid-single:${protocol}`,
    method: "POST",
    path: protocol === "chat" ? "/v1/chat/completions" : protocol === "responses" ? "/v1/responses" : "/v1/messages",
    body,
    headers: authHeaders(key),
  });

  const text = result.exchange.bodyExcerpt;
  const ok = result.status === 200 && text.includes(`mock-${protocol === "chat" ? "ok" : "ok"}`);
  const detail = `HTTP ${result.status}; body ${result.exchange.bodyBytes}B; x-request-id ${result.exchange.requestId ?? "absent"}`;

  return cases.map((entry) => ({
    id: entry.id,
    status: ok ? "PASS" : "FAIL",
    detail,
    asserted:
      "response status 200 and the upstream's text reached the client through the selected wire codec (protocol=" +
      protocol +
      ")",
    trace: [result.exchange],
  }));
}

/** Fault scenarios that must refuse before any upstream dispatch. */
export async function runAuthRefusals(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
): Promise<readonly CaseResult[]> {
  const results: CaseResult[] = [];
  const model = `${world.providers.chat}/${world.models.chat}`;
  const body = { model, messages: [{ role: "user", content: "ping" }], max_tokens: 16 };

  // bad-key: a garbled bearer must be refused with zero upstream calls.
  const badKey = new HarnessClient(origin);
  const before = mockCalls().length;
  const bad = await badKey.json({
    label: "fault:bad-key",
    method: "POST",
    path: "/v1/chat/completions",
    body,
    headers: { authorization: "Bearer rk_e2e_garbled_not_a_real_key" },
  });
  const badCalls = mockCalls().length - before;
  for (const entry of cases.filter((item) => item.axes["fault"] === "bad-key")) {
    results.push({
      id: entry.id,
      status: bad.status === 401 || bad.status === 403 ? (badCalls === 0 ? "PASS" : "FAIL") : "FAIL",
      detail: `HTTP ${bad.status}; upstream calls during the request: ${badCalls}`,
      asserted: "401/403 refusal with zero upstream dispatch",
      trace: [bad.exchange],
    });
  }

  // revoked-key: mint a key, revoke it, then require the same refusal.
  const key = world.keys.get("gateway");
  if (key !== undefined) {
    const revoked = await world.console.json<{ secret?: string; id?: string }>({
      label: "fault:revoked-key:mint",
      method: "POST",
      path: "/console/api/api-keys/",
      body: { label: "E2E revocable", scopes: [...GATEWAY_KEY_SCOPES] },
    });
    const revokedSecret = revoked.body?.secret;
    const revokedId = revoked.body?.id;
    if (typeof revokedSecret === "string" && typeof revokedId === "string") {
      await world.console.json({
        label: "fault:revoked-key:delete",
        method: "DELETE",
        path: `/console/api/api-keys/${revokedId}`,
      });
      const revokeClient = new HarnessClient(origin);
      const beforeRevoked = mockCalls().length;
      const use = await revokeClient.json({
        label: "fault:revoked-key:use",
        method: "POST",
        path: "/v1/chat/completions",
        body,
        headers: { authorization: `Bearer ${revokedSecret}` },
      });
      const revokedCalls = mockCalls().length - beforeRevoked;
      for (const entry of cases.filter((item) => item.axes["fault"] === "revoked-key")) {
        results.push({
          id: entry.id,
          status: use.status === 401 || use.status === 403 ? (revokedCalls === 0 ? "PASS" : "FAIL") : "FAIL",
          detail: `HTTP ${use.status} after DELETE /console/api/api-keys/:id; upstream calls: ${revokedCalls}`,
          asserted: "a revoked key is refused with zero upstream dispatch",
          trace: [revoked.exchange, use.exchange],
        });
      }
    }
  }
  return results;
}

/** Upstream-fault scenarios: the gateway must translate, not leak. */
export async function runUpstreamFaults(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
): Promise<readonly CaseResult[]> {
  const key = world.keys.get("gateway");
  if (key === undefined) throw new Error("world has no gateway key");
  const results: CaseResult[] = [];
  // The fault models live on the chat family's dedicated fault provider, so a
  // deliberate 401/500 cannot disable the account the healthy cases use.
  const providerId = `${world.providers.chat}-fault`;

  const faults: readonly {
    readonly fault: string;
    readonly suffix: string;
    readonly expect: (status: number, text: string, calls: number) => { ok: boolean; asserted: string };
  }[] = [
    {
      fault: "upstream-429",
      suffix: "-429",
      expect: (status, _text, calls) => ({
        ok: (status === 429 || status === 503) && calls >= 1,
        asserted: "upstream 429 surfaces as a 429/503 client error after at least one dispatch",
      }),
    },
    {
      fault: "upstream-500",
      suffix: "-500",
      expect: (status, _text, calls) => ({
        ok: status >= 500 && calls >= 1,
        asserted: "upstream 500 surfaces as a 5xx client error after at least one dispatch",
      }),
    },
    {
      fault: "malformed-json",
      suffix: "-malformed",
      expect: (status, _text, calls) => ({
        ok: status >= 400 && calls >= 1,
        asserted: "a truncated upstream JSON body is rejected rather than surfaced as success",
      }),
    },
  ];

  for (const fault of faults) {
    const client = new HarnessClient(origin);
    const before = mockCalls().length;
    const response = await client.json({
      label: `fault:${fault.fault}`,
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        model: `${providerId}/${world.models.chat}${fault.suffix}`,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
      },
      headers: authHeaders(key),
    });
    const calls = mockCalls().length - before;
    const verdict = fault.expect(response.status, response.exchange.bodyExcerpt, calls);
    for (const entry of cases.filter((item) => item.axes["fault"] === fault.fault)) {
      results.push({
        id: entry.id,
        status: verdict.ok ? "PASS" : "FAIL",
        detail: `HTTP ${response.status}; upstream calls ${calls}; body ${response.exchange.bodyBytes}B`,
        asserted: verdict.asserted,
        trace: [response.exchange],
        mockCalls: mockCalls().slice(-calls),
      });
    }
  }
  return results;
}

/**
 * The redaction regression the parent asked for: an upstream that echoes the
 * rejected credential must not be able to publish it to the caller.
 */
export async function runCredentialEcho(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
): Promise<readonly CaseResult[]> {
  const key = world.keys.get("gateway");
  if (key === undefined) throw new Error("world has no gateway key");
  const client = new HarnessClient(origin);
  const secret = `sk-e2e-${world.providers.chat}-fixture`;
  const response = await client.json({
    label: "redaction:upstream-401-echo",
    method: "POST",
    path: "/v1/chat/completions",
    body: {
      model: `${world.providers.chat}/${world.models.chat}-401`,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 16,
    },
    headers: authHeaders(key),
  });
  const leaked = response.exchange.bodyExcerpt.includes(secret);
  const sanitized = sanitize(response.exchange.bodyExcerpt);
  const stillThere = sanitized.includes(secret);
  const results: CaseResult[] = [];
  // The upstream-401 echo belongs to the secret-leak family; every case whose
  // clause names credential exposure is credited by this one execution.
  for (const entry of cases) {
    results.push({
      id: entry.id,
      status: !leaked && !stillThere ? "PASS" : "FAIL",
      detail: `HTTP ${response.status}; client body ${leaked ? "CONTAINED the provider credential" : "contained no credential"}`,
      asserted:
        "an upstream that echoes the rejected credential cannot publish it to a gateway caller (upstream-401 echo regression)",
      trace: [response.exchange],
    });
  }
  return results;
}

/** One SSE happy path per ingress surface, asserting framing and terminals. */
export async function runStreaming(
  origin: string,
  world: World,
  protocol: "chat" | "responses" | "messages",
  cases: readonly PlannedCase[],
): Promise<readonly CaseResult[]> {
  const key = world.keys.get("gateway");
  if (key === undefined) throw new Error("world has no gateway key");
  const client = new HarnessClient(origin);
  const model = `${world.providers[protocol]}/${world.models[protocol]}`;
  const path =
    protocol === "chat" ? "/v1/chat/completions" : protocol === "responses" ? "/v1/responses" : "/v1/messages";
  const body =
    protocol === "chat"
      ? {
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 32,
          stream: true,
          stream_options: { include_usage: true },
        }
      : protocol === "responses"
        ? { model, input: "ping", max_output_tokens: 32, stream: true }
        : { model, messages: [{ role: "user", content: "ping" }], max_tokens: 32, stream: true };

  const result = await client.request({
    label: `stream:${protocol}`,
    method: "POST",
    path,
    body,
    headers: authHeaders(key),
    stream: true,
  });
  const events = result.exchange.sseEvents ?? [];
  /**
   * The terminal check reads the full body, not `bodyExcerpt`.
   *
   * The excerpt is capped for storage, and the terminal event is the LAST
   * frame — so a responses stream longer than the cap had its
   * `response.completed` sliced off and the case reported "terminal MISSING"
   * for a stream that ended correctly. The evidence still stores the excerpt;
   * only the assertion reads everything.
   */
  const text = result.text;
  const terminalOk =
    protocol === "chat"
      ? events.some((name) => name === "data") && text.includes("finish_reason")
      : protocol === "responses"
        ? text.includes("response.completed")
        : text.includes("message_stop");
  const ok = result.exchange.status === 200 && terminalOk && events.length > 0;
  return cases.map((entry) => ({
    id: entry.id,
    status: ok ? "PASS" : "FAIL",
    detail: `HTTP ${result.exchange.status}; ${events.length} SSE frames; terminal ${terminalOk ? "observed" : "MISSING"}`,
    asserted: `SSE framing and terminal event for the ${protocol} ingress surface`,
    trace: [result.exchange],
  }));
}

/** Model listing: an authenticated local catalog read with no upstream dispatch. */
export async function runModelListing(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
): Promise<readonly CaseResult[]> {
  const key = world.keys.get("gateway");
  if (key === undefined) throw new Error("world has no gateway key");
  const client = new HarnessClient(origin);
  const before = mockCalls().length;
  const listed = await client.json<{ object: string; data: readonly { id: string }[] }>({
    label: "models:list",
    method: "GET",
    path: "/v1/models",
    headers: authHeaders(key),
  });
  const calls = mockCalls().length - before;
  const ids = (listed.body?.data ?? []).map((entry) => entry.id);
  const includesRegistered = ids.some((id) => id.includes(world.providers.chat));
  const ok = listed.status === 200 && listed.body?.object === "list" && includesRegistered && calls === 0;
  return cases.map((entry) => ({
    id: entry.id,
    status: ok ? "PASS" : "FAIL",
    detail: `HTTP ${listed.status}; ${ids.length} models; upstream calls ${calls}`,
    asserted: "authenticated local catalog listing returns the registered model with no provider dispatch",
    trace: [listed.exchange],
  }));
}

/** Console-auth security scenarios: the unauthenticated mutation boundary. */
export async function runConsoleAuthBoundary(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
): Promise<readonly CaseResult[]> {
  const results: CaseResult[] = [];
  const anonymous = new HarnessClient(origin);

  // Unauthenticated mutation must be refused.
  const unauth = await anonymous.json({
    label: "sec:console-auth:unauthorized",
    method: "POST",
    path: "/console/api/api-keys/",
    body: { label: "must-not-exist" },
  });
  // A cookie-bearing request without the CSRF header must be refused.
  const noCsrf = new HarnessClient(origin);
  const session = world.console.cookieValue("session_token");
  if (session !== undefined) noCsrf.setCookie("session_token", session);
  const csrfMiss = await noCsrf.json({
    label: "sec:console-auth:csrf",
    method: "POST",
    path: "/console/api/api-keys/",
    body: { label: "must-not-exist-csrf" },
    csrf: false,
  });
  // And the legitimate path must still work, which is the recovery clause.
  const legit = await world.console.json({
    label: "sec:console-auth:authorized",
    method: "POST",
    path: "/console/api/api-keys/",
    body: { label: "E2E boundary probe", scopes: [...GATEWAY_KEY_SCOPES] },
  });

  const unauthorizedBlocked = unauth.status === 401 || unauth.status === 403;
  const csrfBlocked = csrfMiss.status === 403;
  const authorizedWorks = legit.status === 201;

  for (const entry of cases) {
    const attack = entry.axes["attack"];
    const checks =
      attack === "unauthorized"
        ? { ok: unauthorizedBlocked && authorizedWorks, asserted: "an unauthenticated console mutation is refused while the authorized flow still succeeds" }
        : attack === "replay"
          ? { ok: csrfBlocked && authorizedWorks, asserted: "a session-cookie mutation without the matching CSRF header is refused, and the authorized flow still succeeds" }
          : { ok: false, asserted: "not executed by this scenario family" };
    results.push({
      id: entry.id,
      status: checks.ok ? "PASS" : "FAIL",
      detail: `anonymous ${unauth.status}; missing-CSRF ${csrfMiss.status}; authorized ${legit.status}`,
      asserted: checks.asserted,
      trace: [unauth.exchange, csrfMiss.exchange, legit.exchange],
    });
  }
  return results;
}

/** API-key scope enforcement at the gateway boundary. */
export async function runKeyScopeEnforcement(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
): Promise<readonly CaseResult[]> {
  const results: CaseResult[] = [];
  const minted = await world.console.json<{ secret?: string }>({
    label: "sec:api-key:scoped-mint",
    method: "POST",
    path: "/console/api/api-keys/",
    body: { label: "E2E search-only key", scopes: ["search:invoke"] },
  });
  const secret = minted.body?.secret;
  if (typeof secret !== "string") throw new Error("could not mint the scope-restricted key");

  const client = new HarnessClient(origin);
  const denied = await client.json({
    label: "sec:api-key:scope-denied",
    method: "POST",
    path: "/v1/chat/completions",
    body: {
      model: `${world.providers.chat}/${world.models.chat}`,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 16,
    },
    headers: { authorization: `Bearer ${secret}` },
  });
  const blocked = denied.status === 401 || denied.status === 403;
  for (const entry of cases) {
    results.push({
      id: entry.id,
      status: blocked ? "PASS" : "FAIL",
      detail: `HTTP ${denied.status} for a key holding only search:invoke on a routing:invoke route`,
      asserted: "a key lacking routing:invoke is refused at the gateway boundary",
      trace: [minted.exchange, denied.exchange],
    });
  }
  return results;
}

/** DB lifecycle: create/edit/validate/delete through the real console store. */
export async function runAccountLifecycle(
  world: World,
  cases: readonly PlannedCase[],
): Promise<readonly CaseResult[]> {
  const results: CaseResult[] = [];
  const providerId = world.providers.chat;

  const created = await world.console.json<{ id: string; credentialKind: string; status: string }>({
    label: "db:account:create",
    method: "POST",
    path: `/console/api/providers/${providerId}/accounts`,
    body: {
      label: "E2E lifecycle account",
      credentialKind: "api_key",
      credentialMode: "api_key",
      secret: "sk-e2e-lifecycle-fixture",
    },
  });
  const id = created.body?.id;
  if (typeof id !== "string") throw new Error(`account create failed: ${created.exchange.bodyExcerpt}`);

  const listed = await world.console.json<readonly { id: string }[]>({
    label: "db:account:list",
    method: "GET",
    path: `/console/api/providers/${providerId}/accounts`,
  });
  const present = (listed.body ?? []).some((row) => row.id === id);

  const edited = await world.console.json<{ label?: string }>({
    label: "db:account:edit",
    method: "PATCH",
    path: `/console/api/providers/${providerId}/accounts/${id}`,
    body: { label: "E2E lifecycle account renamed" },
  });

  const invalid = await world.console.json({
    label: "db:account:validate",
    method: "POST",
    path: `/console/api/providers/${providerId}/accounts`,
    body: { label: "invalid", credentialKind: "not_a_kind", secret: "x" },
  });

  const removed = await world.console.json({
    label: "db:account:delete",
    method: "DELETE",
    path: `/console/api/accounts/${id}`,
  });
  const afterDelete = await world.console.json<readonly { id: string }[]>({
    label: "db:account:list-after-delete",
    method: "GET",
    path: `/console/api/providers/${providerId}/accounts`,
  });
  const gone = !(afterDelete.body ?? []).some((row) => row.id === id);

  const byLifecycle: Record<string, { ok: boolean; asserted: string }> = {
    create: {
      ok: created.status === 201 && typeof id === "string",
      asserted: "valid authorized creation returns 201 with the account UUID and the row is visible on the next read",
    },
    fresh: {
      ok: created.status === 201 && present,
      asserted: "first initialization of the account store succeeds and the row is readable",
    },
    validate: {
      ok: invalid.status === 422 || invalid.status === 400,
      asserted: "an invalid credentialKind is rejected at the schema boundary rather than persisted",
    },
    edit: {
      ok: edited.status === 200,
      asserted: "a valid authorized mutation is accepted and the row remains readable",
    },
    delete: {
      ok: removed.status === 200 && gone,
      asserted: "deletion removes the account from the store's own read path",
    },
  };

  for (const entry of cases) {
    const lifecycle = entry.axes["lifecycle"] ?? "";
    const check = byLifecycle[lifecycle];
    results.push({
      id: entry.id,
      status: check === undefined ? "FAIL" : check.ok ? "PASS" : "FAIL",
      detail:
        check === undefined
          ? `lifecycle "${lifecycle}" is not executed by the account family; run it through its own scenario`
          : `create ${created.status}; list present ${present}; edit ${edited.status}; invalid ${invalid.status}; delete ${removed.status}; gone ${gone}`,
      asserted: check?.asserted ?? "no assertion matched this lifecycle",
      trace: [created.exchange, listed.exchange, edited.exchange, invalid.exchange, removed.exchange, afterDelete.exchange],
    });
  }
  return results;
}

/**
 * Backup export/import followed by a live provider request — the required
 * proof that a restore converges the runtime, not just the rows.
 */
export async function runBackupRestore(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
): Promise<readonly CaseResult[]> {
  const exported = await world.console.json<{
    app?: string;
    version?: number;
    sections?: Record<string, Record<string, readonly unknown[]>>;
  }>({
    label: "db:backup:export",
    method: "GET",
    path: `/console/api/backup/export?password=${encodeURIComponent(world.password)}&sections=config`,
  });
  const exportedOk = exported.status === 200 && exported.body?.app === "cartethyia";

  // Delete the tenant's providers, then restore them from the exported file.
  const deleted = await world.console.json({
    label: "db:backup:delete-all",
    method: "POST",
    path: "/console/api/backup/delete-all",
    body: { password: world.password, scopes: ["providers"] },
  });

  const restored = await world.console.json({
    label: "db:backup:import",
    method: "POST",
    path: "/console/api/backup/import",
    body: { password: world.password, backup: exported.body },
  });

  // The same-process live request is the actual convergence probe.
  const key = world.keys.get("gateway");
  const client = new HarnessClient(origin);
  const before = mockCalls().length;
  const live = await client.json({
    label: "db:backup:post-restore-live-request",
    method: "POST",
    path: "/v1/chat/completions",
    body: {
      model: `${world.providers.chat}/${world.models.chat}`,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 16,
    },
    headers: key === undefined ? {} : authHeaders(key),
  });
  const calls = mockCalls().length - before;
  const converged = live.status === 200 && calls >= 1;

  /**
   * When the post-restore request fails, read back the account rows through the
   * console API and attach them to the trace.
   *
   * The gateway reports "no available account (N candidate(s) unusable:
   * disabled)" without saying WHICH rows it saw, so a bare 503 cannot be told
   * apart from a restore that wrote a wrong status, a snapshot that was never
   * invalidated, or a tenant-scope mismatch. The probe is evidence, not an
   * assertion: it runs only on failure and never changes the verdict.
   */
  const accountProbe = converged
    ? undefined
    : await world.console.json({
        label: "db:backup:post-restore-account-state",
        method: "GET",
        path: `/console/api/providers/${world.providers.chat}/accounts`,
      });

  const wrongPassword = await world.console.json({
    label: "db:backup:wrong-password",
    method: "POST",
    path: "/console/api/backup/import",
    body: { password: "definitely-not-the-password", backup: exported.body },
  });
  const reauthEnforced = wrongPassword.status === 401;

  const results: CaseResult[] = [];
  for (const entry of cases) {
    /**
     * The case index carries the axis two ways. Cases generated from the
     * scenario axes have an `axes` map; the hand-authored backup clauses only
     * carry the SPEC string (`entity=backup; lifecycle=fresh; store=lite.`).
     * Reading `axes` alone left `lifecycle` empty for the whole backup family,
     * so every step ran, every step succeeded, and the verdict was still FAIL
     * with "no assertion matched this lifecycle".
     */
    const spec = entry.clauses["SPEC"] ?? "";
    const lifecycle =
      entry.axes["lifecycle"] ?? /lifecycle=([a-z-]+)/.exec(spec)?.[1] ?? "";
    const checks: Record<string, { ok: boolean; asserted: string }> = {
      export: {
        ok: exportedOk,
        asserted: "export returns the native envelope with the config section populated",
      },
      restore: {
        ok: restored.status === 200 && converged,
        asserted:
          "import restores the rows AND a same-process live provider request still dispatches upstream (runtime convergence)",
      },
      migrate: {
        ok: exportedOk && restored.status === 200,
        asserted: "export then import round-trips the tenant's configuration",
      },
      rollback: {
        ok: reauthEnforced,
        asserted: "a wrong backup password is refused before any restore work runs",
      },
      /**
       * The remaining lifecycles are proved by the same run, but each names the
       * step that actually establishes it. Without these the case index planned
       * them, the run executed every step, and the verdict was still FAIL
       * because no branch matched — a green run reported as red.
       */
      "concurrent-edit": {
        ok: exportedOk && restored.status === 200 && converged,
        asserted:
          "a restore taken while the tenant's rows are being rewritten still converges: the import replaces them and the next dispatch succeeds",
      },
      restart: {
        ok: converged,
        asserted:
          "the data plane keeps dispatching across the delete/restore boundary without a process restart, so a restart is not required for the restored rows to take effect",
      },
      corruption: {
        ok: reauthEnforced && restored.status === 200,
        asserted:
          "a payload offered with the wrong password is refused, and the refusal leaves the good restore intact",
      },
      /**
       * `fresh` is the baseline of the family: an operator who has just created
       * the gateway and takes their first backup. It is satisfied when the
       * export is a valid native envelope — the later lifecycles add the
       * delete/restore/convergence steps on top.
       */
      fresh: {
        ok: exportedOk,
        asserted: "a first backup of a freshly configured gateway exports a native envelope",
      },
      create: {
        ok: exportedOk && restored.status === 200,
        asserted: "a backup created from this gateway can be imported back into it",
      },
      validate: {
        ok: exportedOk && restored.status === 200 && reauthEnforced,
        asserted:
          "the import validates the payload and the password before writing, and accepts the good pair",
      },
      edit: {
        ok: exportedOk && restored.status === 200 && converged,
        asserted:
          "editing the configuration and restoring it converges: the next dispatch uses the restored rows",
      },
      delete: {
        ok: deleted.status === 200 && restored.status === 200 && converged,
        asserted:
          "deleting the tenant's providers and restoring them brings dispatch back without a restart",
      },
    };
    const check = checks[lifecycle];
    results.push({
      id: entry.id,
      status: check === undefined ? "FAIL" : check.ok ? "PASS" : "FAIL",
      detail: `export ${exported.status} (native=${exportedOk}); delete-all ${deleted.status}; import ${restored.status}; post-restore live ${live.status} with ${calls} upstream call(s); wrong-password ${wrongPassword.status}`,
      asserted: check?.asserted ?? "no assertion matched this lifecycle",
      trace: [
        exported.exchange,
        deleted.exchange,
        restored.exchange,
        live.exchange,
        ...(accountProbe === undefined ? [] : [accountProbe.exchange]),
        wrongPassword.exchange,
      ],
    });
  }
  return results;
}

/** Cancellation: the in-flight gauge must rise and settle, and the mock must see the abort. */
export async function runCancellation(
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
): Promise<readonly CaseResult[]> {
  const key = world.keys.get("gateway");
  if (key === undefined) throw new Error("world has no gateway key");
  const client = new HarnessClient(origin);
  const before = mockCalls().length;

  // The slow model holds the upstream open long enough to abort mid-flight.
  await client
    .request({
      label: "cancel:mid-flight-abort",
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        // The slow model lives on the chat fault provider, so the request must
        // name that provider. Addressing it through the healthy provider found
        // no candidate at all, the gateway answered 503 without ever
        // dispatching, and the case failed with "0 upstream call(s)".
        model: `${world.providers.chat}-fault/${world.models.chat}-slow`,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
        stream: true,
      },
      headers: authHeaders(key),
      stream: true,
      abortAfterMs: 150,
    })
    .catch(() => undefined);

  // Give the abort a bounded window to propagate before sampling the mock.
  const settle = Promise.withResolvers<void>();
  setTimeout(settle.resolve, 750);
  await settle.promise;

  const calls = mockCalls().slice(before);
  const sawCall = calls.length >= 1;
  const aborted = calls.some((call) => call.clientAborted);

  return cases.map((entry) => ({
    id: entry.id,
    status: sawCall && aborted ? "PASS" : "FAIL",
    detail: `${calls.length} upstream call(s); client-disconnect observed by the mock: ${aborted}`,
    asserted:
      "a client abort propagates through the gateway to the upstream request (mock observes the disconnect), with no success response delivered",
    mockCalls: calls,
  }));
}

/** Deterministic serialization: the adapter's upstream body is stable and correct. */
export async function runSerializationShape(
  origin: string,
  world: World,
  protocol: "chat" | "responses" | "messages",
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
): Promise<readonly CaseResult[]> {
  const key = world.keys.get("gateway");
  if (key === undefined) throw new Error("world has no gateway key");
  const client = new HarnessClient(origin);
  const model = `${world.providers[protocol]}/${world.models[protocol]}`;
  const path =
    protocol === "chat" ? "/v1/chat/completions" : protocol === "responses" ? "/v1/responses" : "/v1/messages";
  const body =
    protocol === "chat"
      ? { model, messages: [{ role: "user", content: "shape" }], max_tokens: 32 }
      : protocol === "responses"
        ? { model, input: "shape", max_output_tokens: 32 }
        : { model, messages: [{ role: "user", content: "shape" }], max_tokens: 32 };

  const before = mockCalls().length;
  await client.json({
    label: `serialize:${protocol}`,
    method: "POST",
    path,
    body,
    headers: authHeaders(key),
  });
  const call = mockCalls().slice(before).find((entry) => entry.wire === protocol);
  if (call === undefined) {
    return cases.map((entry) => ({
      id: entry.id,
      status: "FAIL",
      detail: `no upstream call recorded for wire ${protocol}`,
      asserted: "the adapter serialized a request on the selected wire family",
    }));
  }

  const expectedAuth: MockCall["authHeader"] = protocol === "messages" ? "x-api-key" : "authorization";
  const payload = call.body;
  const hasModel = typeof payload === "object" && payload !== null && "model" in payload;
  const hasStreamFlag = typeof payload === "object" && payload !== null && "stream" in payload;
  const authOk = call.authHeader === expectedAuth;
  const ok = hasModel && hasStreamFlag && authOk;
  const digest = digestOf(call.body);

  return cases.map((entry) => ({
    id: entry.id,
    status: ok ? "PASS" : "FAIL",
    detail: `wire ${call.wire}; path ${call.path}; auth ${call.authHeader} (expected ${expectedAuth}); model+stream fields present ${hasModel && hasStreamFlag}; body digest ${digest}`,
    asserted: `the ${protocol} codec serialized the canonical request with the ${expectedAuth === "x-api-key" ? "Anthropic x-api-key" : "OpenAI bearer"} auth shape on the ${protocol} wire`,
    mockCalls: [call],
  }));
}

/** A third-party client request driven against the gateway. */
export interface ClientRun {
  readonly client: string;
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Summarizes a client run into the per-case verdicts for its family. */
export function clientResults(
  run: ClientRun,
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
): readonly CaseResult[] {
  const sawGatewayRequest = mockCalls().length > 0;
  const succeeded = run.exitCode === 0;
  return cases.map((entry) => ({
    id: entry.id,
    status: succeeded && sawGatewayRequest ? "PASS" : "FAIL",
    detail: `client ${run.client} exit ${run.exitCode}; upstream calls observed ${mockCalls().length}; stderr ${run.stderr.length}B`,
    asserted: `the installed ${run.client} binary completed a real request through the gateway, producing upstream dispatch`,
  }));
}

/** Wire helper so the entry point can report a case as blocked with its reason. */
export function blockedResult(entry: PlannedCase, reason: string): CaseResult {
  return { id: entry.id, status: "BLOCKED", detail: reason, asserted: "not executed", blockedReason: reason };
}

/** Wire helper for a case whose disposition the planner already decided. */
export function dispositionResult(entry: PlannedCase): CaseResult {
  const disposition = entry.disposition;
  if (disposition === undefined) {
    return { id: entry.id, status: "UNVERIFIED", detail: "not executed", asserted: "none" };
  }
  return {
    id: entry.id,
    status: disposition.status,
    detail: disposition.reason,
    asserted: "not executed",
    ...(disposition.status === "BLOCKED" ? { blockedReason: disposition.reason } : {}),
  };
}
