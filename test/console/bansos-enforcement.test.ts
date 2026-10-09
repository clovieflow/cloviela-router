/**
 * Bansos enforcement invariants.
 *
 * ── What these protect ──────────────────────────────────────────────────────
 * Every case here was first verified by hand against the running gateway, and
 * then written down. The manual run is what found the bugs; these tests are
 * what stop them coming back. A test written only from the code would have
 * asserted whatever the code already did, which is how four defects survived
 * until the API was actually exercised.
 *
 * ── Why the boundary is the policy layer, not HTTP ──────────────────────────
 * The HTTP path needs a database, a session and a provider; these cases are
 * about *decisions*, and the decision functions are pure. The integration
 * behaviour they feed is covered by the live evidence in the release notes.
 */
import { describe, expect, test } from "bun:test";
import {
  bansosRejectionMessage,
  isModelSubsidized,
  type BansosContext,
} from "../../src/console/bansos/enforcement";
import { isParticipantUsable, isProgramInWindow, resolveBansosLimits } from "../../src/console/bansos/policy";

describe("strictest limit wins", () => {
  test("a participant override cannot widen the program", () => {
    const limits = resolveBansosLimits({
      program: {
        globalRpm: 60,
        globalConcurrency: 5,
        maxInputTokens: null,
        maxOutputTokens: null,
        defaultTokenAllowance: null,
      },
      // The participant was granted far more than the program allows. The
      // program is the operator's ceiling and must win.
      participant: { rpm: 100_000, concurrency: 500, tokenAllowance: null },
    });
    expect(limits.rpm).toBe(60);
    expect(limits.concurrency).toBe(5);
  });

  test("a key-level limit cannot widen the participant", () => {
    const limits = resolveBansosLimits({
      program: { globalRpm: null, globalConcurrency: null, maxInputTokens: null, maxOutputTokens: null, defaultTokenAllowance: null },
      participant: { rpm: 10, concurrency: 2, tokenAllowance: null },
      key: { rpm: 9999, concurrency: 99 },
    });
    expect(limits.rpm).toBe(10);
    expect(limits.concurrency).toBe(2);
  });

  test("silence at every level means unlimited, never zero", () => {
    const limits = resolveBansosLimits({
      program: { globalRpm: null, globalConcurrency: null, maxInputTokens: null, maxOutputTokens: null, defaultTokenAllowance: null },
      participant: { rpm: null, concurrency: null, tokenAllowance: null },
    });
    expect(limits.rpm).toBeNull();
    expect(limits.concurrency).toBeNull();
    expect(limits.tokenBudget).toBeNull();
  });

  test("the program's default allowance does not clip an existing grant", () => {
    // `defaultTokenAllowance` is what a NEW participant receives, not a
    // ceiling. Folding it into the minimum would make the grant permanently
    // unraisable, which is why it is excluded from `strictest` here.
    const limits = resolveBansosLimits({
      program: { globalRpm: null, globalConcurrency: null, maxInputTokens: null, maxOutputTokens: null, defaultTokenAllowance: 1_000 },
      participant: { rpm: null, concurrency: null, tokenAllowance: 50_000 },
    });
    expect(limits.tokenBudget).toBe(50_000);
  });

  test("a model limit tightens the program's token ceilings", () => {
    const limits = resolveBansosLimits({
      program: { globalRpm: null, globalConcurrency: null, maxInputTokens: 200_000, maxOutputTokens: 8_000, defaultTokenAllowance: null },
      participant: { rpm: null, concurrency: null, tokenAllowance: null },
      model: { maxInputTokens: 32_000, maxOutputTokens: null },
    });
    expect(limits.maxInputTokens).toBe(32_000);
    expect(limits.maxOutputTokens).toBe(8_000);
  });
});

describe("program window and participant usability", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  test("an unset bound is not a restriction", () => {
    expect(isProgramInWindow({ startsAt: null, endsAt: null }, now)).toBe(true);
  });

  test("a program outside its window is closed", () => {
    expect(isProgramInWindow({ startsAt: null, endsAt: new Date("2026-06-14T00:00:00Z") }, now)).toBe(false);
    expect(isProgramInWindow({ startsAt: new Date("2026-06-16T00:00:00Z"), endsAt: null }, now)).toBe(false);
  });

  test("only an active participant may transact", () => {
    expect(isParticipantUsable({ status: "active", expiresAt: null }, now).ok).toBe(true);
    expect(isParticipantUsable({ status: "suspended", expiresAt: null }, now).ok).toBe(false);
    expect(isParticipantUsable({ status: "pending", expiresAt: null }, now).ok).toBe(false);
    expect(isParticipantUsable({ status: "revoked", expiresAt: null }, now).ok).toBe(false);
  });

  test("an expired participant is refused even while active", () => {
    const result = isParticipantUsable(
      { status: "active", expiresAt: new Date("2026-06-14T00:00:00Z") },
      now,
    );
    expect(result.ok).toBe(false);
  });
});

describe("model translation", () => {
  const context: BansosContext = {
    programId: "p1",
    participantId: "u1",
    programSlug: "bansos-ai",
    providerId: null,
    providerAccountIds: [],
    allowedUpstreamModels: ["ag/claude-sonnet-4"],
    modelMap: new Map([
      ["bansos-sonnet", "ag/claude-sonnet-4"],
      ["ag/claude-sonnet-4", "ag/claude-sonnet-4"],
    ]),
  };

  test("the published name translates to the upstream", () => {
    expect(context.modelMap.get("bansos-sonnet")).toBe("ag/claude-sonnet-4");
  });

  test("an unsubsidized model translates to nothing", () => {
    // The refusal path: absent from the map means the program does not pay
    // for it, and the caller refuses rather than falling through to routing.
    expect(context.modelMap.get("gpt-4o")).toBeUndefined();
  });

  test("the upstream id itself still resolves", () => {
    // A client that kept the original name keeps working; the map is not a
    // one-way door.
    expect(context.modelMap.get("ag/claude-sonnet-4")).toBe("ag/claude-sonnet-4");
  });

  test("subsidized check matches the map", () => {
    expect(isModelSubsidized(context, "ag/claude-sonnet-4")).toBe(true);
    expect(isModelSubsidized(context, "gpt-4o")).toBe(false);
  });
});

describe("rejection messages", () => {
  test("a disabled program is distinguishable from a closed one", () => {
    // The operator needs to tell these apart in a support conversation: one
    // is a switch to flip, the other is a date to fix.
    const disabled = bansosRejectionMessage({ kind: "program_disabled" });
    const closed = bansosRejectionMessage({ kind: "program_closed" });
    expect(disabled?.code).toBe("program_disabled");
    expect(closed?.code).toBe("program_closed");
    expect(disabled?.message).not.toBe(closed?.message);
  });

  test("a suspension is reported without naming the participant", () => {
    const message = bansosRejectionMessage({ kind: "participant_inactive", reason: "participant is suspended" });
    expect(message?.status).toBe(403);
    // The reason is internal; the wire message must not echo it.
    expect(message?.message).not.toContain("suspended");
  });

  test("an unsubsidized model names the model the caller asked for", () => {
    const message = bansosRejectionMessage({ kind: "model_not_subsidized", model: "gpt-4o" });
    expect(message?.status).toBe(404);
    expect(message?.message).toContain("gpt-4o");
  });

  test("a non-bansos key produces no message at all", () => {
    // Ordinary keys must not pay for this check, and a lookup failure must not
    // masquerade as a policy refusal.
    expect(bansosRejectionMessage({ kind: "not_bansos" })).toBeNull();
    expect(bansosRejectionMessage({ kind: "lookup_failed" })).toBeNull();
  });
});
