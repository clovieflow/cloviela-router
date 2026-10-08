/**
 * Route simulator: read-only evaluation contract.
 *
 * The simulator exists so an operator can ask "what would this request do"
 * without doing it. Two properties make it trustworthy, and both are asserted
 * here against the real engine rather than a stub:
 *
 * 1. **It cannot change routing.** A preview must not advance a round-robin
 *    cursor, create one, or reserve admission — otherwise asking the question
 *    changes the answer to the next real request.
 * 2. **It agrees with the dispatcher.** Every verdict comes from the same
 *    `EligibilityEvaluator` and the same ordering rules `plan()` uses, so a
 *    refusal is explained with the same reason a live request would produce.
 *
 * The endpoint-family layer is the one thing the simulator adds, and it is
 * asserted separately: a model that is healthy but cannot serve the requested
 * family must not read as dispatchable.
 */
import { describe, expect, test } from "bun:test";
import { RoutingEngine } from "../../src/transport/routing/router";
import type { RouteCandidate, RouteSnapshot } from "../../src/transport/routing/route-model";

/** A minimal candidate; only the fields the evaluator and projection read. */
function candidate(overrides: Record<string, unknown> = {}): RouteCandidate {
  return {
    provider_id: "p",
    model_id: "m",
    wire_family: "chat",
    endpoint: "/v1/chat/completions",
    capability_profile: {},
    ...overrides,
  } as RouteCandidate;
}

function snapshot(candidates: readonly RouteCandidate[], extra: Partial<RouteSnapshot> = {}): RouteSnapshot {
  return {
    revision: 7,
    candidates,
    aliases: {},
    combos: {},
    created_at: Date.now(),
    ...extra,
  } as RouteSnapshot;
}

const ONE_MODEL = "p/m";

describe("RoutingEngine.simulate — outcome mapping", () => {
  test("a single healthy candidate is dispatchable and deterministic", async () => {
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot([candidate()]),
      tenantId: null,
    });
    expect(result.outcome).toBe("dispatchable");
    expect(result.selected?.provider_id).toBe("p");
    expect(result.rotation_active).toBe(false);
    expect(result.candidates[0]?.eligible).toBe(true);
    expect(result.candidates[0]?.reason).toBe("healthy");
  });

  test("more than one candidate is dispatchable but NOT deterministic", async () => {
    // The dashboard renders a winner only when `selected` is present; claiming
    // determinism here would promise which account a live request dials, and
    // the rotation cursor decides that at dispatch time.
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot([
        candidate({ provider_account_id: "a1" }),
        candidate({ provider_account_id: "a2" }),
      ]),
      tenantId: null,
    });
    expect(result.outcome).toBe("dispatchable");
    expect(result.rotation_active).toBe(true);
    expect(result.selected).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });

  test("every account hard-cooling reports rate-limited, not unavailable", async () => {
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot([
        candidate({ health_status: "cooldown", cooldown_kind: "hard" }),
      ]),
      tenantId: null,
    });
    expect(result.outcome).toBe("accounts_rate_limited");
    expect(result.selected).toBeUndefined();
    expect(result.candidates[0]?.eligible).toBe(false);
    expect(result.candidates[0]?.reason).toBe("cooldown_hard");
  });

  test("a soft-cooling-only pool reports rate-limited too", async () => {
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot([candidate({ health_status: "cooldown", cooldown_kind: "soft" })]),
      tenantId: null,
    });
    expect(result.outcome).toBe("accounts_rate_limited");
  });

  test("a disabled account reports accounts-unavailable and names the cause", async () => {
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot([candidate({ health_status: "disabled" })]),
      tenantId: null,
    });
    expect(result.outcome).toBe("accounts_unavailable");
    expect(result.candidates[0]?.reason).toBe("disabled");
  });

  test("a healthy model that cannot serve the family is service-kind-unsupported", async () => {
    // System One models are healthy but are not served on a chat wire. Without
    // the family layer this would read as a perfectly dispatchable route.
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot([candidate({ service_kind: "systemone" })]),
      tenantId: null,
    });
    expect(result.outcome).toBe("service_kind_unsupported");
    expect(result.candidates[0]?.eligible).toBe(false);
    expect(result.candidates[0]?.endpoint_supported).toBe(false);
    expect(result.selected).toBeUndefined();
  });

  test("the same model IS dispatchable for the family it serves", async () => {
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "systemone",
      snapshot: snapshot([candidate({ service_kind: "systemone" })]),
      tenantId: null,
    });
    expect(result.outcome).toBe("dispatchable");
    expect(result.endpoint_service_kind).toBe("systemone");
  });

  test("an unknown model is rejected rather than reported as unavailable", async () => {
    // "This model does not exist" and "this model has no usable account" are
    // different operator problems; conflating them sends the wrong fix.
    const engine = new RoutingEngine();
    await expect(
      engine.simulate({
        requestedModel: "nope/nope",
        endpoint: "chat.completions",
        snapshot: snapshot([candidate()]),
        tenantId: null,
      }),
    ).rejects.toMatchObject({ code: "model_not_found" });
  });
});

describe("RoutingEngine.simulate — read-only guarantees", () => {
  test("simulating does not create a rotation cursor", async () => {
    const engine = new RoutingEngine();
    const twoAccounts = [
      candidate({ provider_account_id: "a1" }),
      candidate({ provider_account_id: "a2" }),
    ];
    expect(engine.roundRobinEntries().provider).toBe(0);
    await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot(twoAccounts, {
        providerRouting: { __global__: { p: { strategy: "round_robin", rotateCount: 1, maxInflight: null, enabled: true, bypassProxy: false } } },
      } as Partial<RouteSnapshot>),
      tenantId: null,
    });
    // A preview of a provider that has never dispatched must not leave state
    // behind that changes the first real dispatch.
    expect(engine.roundRobinEntries().provider).toBe(0);
  });

  test("repeated simulations return the identical order", async () => {
    const engine = new RoutingEngine();
    const snapshotValue = snapshot(
      [
        candidate({ provider_account_id: "a1" }),
        candidate({ provider_account_id: "a2" }),
        candidate({ provider_account_id: "a3" }),
      ],
      {
        providerRouting: { __global__: { p: { strategy: "round_robin", rotateCount: 1, maxInflight: null, enabled: true, bypassProxy: false } } },
      } as Partial<RouteSnapshot>,
    );
    const order = async () =>
      (
        await engine.simulate({
          requestedModel: ONE_MODEL,
          endpoint: "chat.completions",
          snapshot: snapshotValue,
          tenantId: null,
        })
      ).candidates.map((entry) => entry.candidate.provider_account_id);
    const first = await order();
    const second = await order();
    const third = await order();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test("a live plan still advances the cursor after a simulation", async () => {
    // The complement of the peek rule: peeking must not freeze rotation either.
    const engine = new RoutingEngine();
    const snapshotValue = snapshot(
      [
        candidate({ provider_account_id: "a1" }),
        candidate({ provider_account_id: "a2" }),
      ],
      {
        providerRouting: { __global__: { p: { strategy: "round_robin", rotateCount: 1, maxInflight: null, enabled: true, bypassProxy: false } } },
      } as Partial<RouteSnapshot>,
    );
    await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshotValue,
      tenantId: null,
    });
    const planA = await engine.plan(ONE_MODEL, snapshotValue, null);
    const planB = await engine.plan(ONE_MODEL, snapshotValue, null);
    expect(planA.candidates[0]?.provider_account_id).toBe("a1");
    expect(planB.candidates[0]?.provider_account_id).toBe("a2");
  });
});

describe("RoutingEngine.simulate — ordering parity with plan()", () => {
  test("cooling candidates are ordered behind healthy ones in both", async () => {
    const engine = new RoutingEngine();
    const snapshotValue = snapshot([
      candidate({ provider_account_id: "cooling", health_status: "cooldown", cooldown_kind: "soft" }),
      candidate({ provider_account_id: "healthy" }),
    ]);
    const simulated = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshotValue,
      tenantId: null,
    });
    const planned = await engine.plan(ONE_MODEL, snapshotValue, null);
    expect(simulated.candidates.map((entry) => entry.candidate.provider_account_id)).toEqual([
      "healthy",
      "cooling",
    ]);
    expect(planned.candidates.map((entry) => entry.provider_account_id)).toEqual([
      "healthy",
      "cooling",
    ]);
    expect(simulated.candidates[0]?.reason).toBe("healthy");
    expect(simulated.candidates[1]?.reason).toBe("cooldown");
  });

  test("a cooling candidate is reported, not hidden", async () => {
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: ONE_MODEL,
      endpoint: "chat.completions",
      snapshot: snapshot([
        candidate({ provider_account_id: "cooling", health_status: "cooldown", cooldown_kind: "soft" }),
        candidate({ provider_account_id: "healthy" }),
      ]),
      tenantId: null,
    });
    const cooling = result.candidates.find(
      (entry) => entry.candidate.provider_account_id === "cooling",
    );
    expect(cooling?.eligible).toBe(true);
    expect(cooling?.reason).toBe("cooldown");
  });
});

describe("RoutingEngine.simulate — alias resolution", () => {
  test("an alias resolves and reports the chain it walked", async () => {
    const engine = new RoutingEngine();
    const result = await engine.simulate({
      requestedModel: "fast",
      endpoint: "chat.completions",
      snapshot: snapshot([candidate()], {
        aliases: { t1: { fast: ONE_MODEL } },
      } as Partial<RouteSnapshot>),
      tenantId: "t1",
    });
    expect(result.resolved_model).toBe(ONE_MODEL);
    expect(result.resolution_chain).toEqual(["fast"]);
    expect(result.requested_model).toBe("fast");
  });

  test("tenant isolation: another tenant's alias does not resolve", async () => {
    const engine = new RoutingEngine();
    await expect(
      engine.simulate({
        requestedModel: "fast",
        endpoint: "chat.completions",
        snapshot: snapshot([candidate()], {
          aliases: { t1: { fast: ONE_MODEL } },
        } as Partial<RouteSnapshot>),
        tenantId: "other",
      }),
    ).rejects.toMatchObject({ code: "model_not_found" });
  });
});
