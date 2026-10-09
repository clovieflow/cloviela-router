/**
 * The Bansos policy resolver and key issuance.
 *
 * ── Why the resolver is tested this hard ────────────────────────────────────
 * It is the one place where "a restrictive policy must not be bypassed by a
 * less restrictive one" either holds or does not. Every limit an operator
 * configures passes through `strictest`, so a bug here is not a display bug —
 * it is a participant spending more than the program granted.
 */
import { describe, expect, test } from "bun:test";
import { isParticipantUsable, isProgramInWindow, resolveBansosLimits, strictest } from "../../src/console/bansos/policy";
import { BANSOS_KEY_PREFIX, generateBansosKey, maskBansosKey, redactSecrets } from "../../src/console/bansos/keys";

describe("strictest", () => {
  test("returns null when nothing states a limit", () => {
    expect(strictest(null, undefined)).toBeNull();
    expect(strictest()).toBeNull();
  });

  test("returns the only stated value", () => {
    expect(strictest(null, 500, undefined)).toBe(500);
  });

  test("returns the minimum of several", () => {
    expect(strictest(1000, 250, 700)).toBe(250);
  });

  test("ignores a non-finite value rather than treating it as zero", () => {
    // A NaN reaching this point would otherwise make every limit zero.
    expect(strictest(Number.NaN, 400)).toBe(400);
    expect(strictest(Number.POSITIVE_INFINITY, 400)).toBe(400);
  });
});

describe("resolveBansosLimits", () => {
  const program = {
    globalRpm: 600,
    globalConcurrency: 40,
    maxInputTokens: 200_000,
    maxOutputTokens: 8_000,
    defaultTokenAllowance: 1_000_000,
  };

  test("a participant override tightens the program default", () => {
    const r = resolveBansosLimits({
      program,
      participant: { rpm: 60, concurrency: 3, tokenAllowance: 100_000 },
    });
    expect(r.rpm).toBe(60);
    expect(r.concurrency).toBe(3);
    expect(r.tokenBudget).toBe(100_000);
  });

  test("a participant cannot widen what the program allows", () => {
    // The participant asks for more than the program grants at every level.
    const r = resolveBansosLimits({
      program,
      participant: { rpm: 10_000, concurrency: 500, tokenAllowance: 99_000_000 },
    });
    expect(r.rpm).toBe(600);
    expect(r.concurrency).toBe(40);
    // The allowance is the participant's own grant, not a program ceiling, so
    // it is not capped by `defaultTokenAllowance` — the program budget is a
    // separate counter. What matters is that a key-level limit cannot widen it.
    expect(r.tokenBudget).toBe(99_000_000);
  });

  test("a key-level limit tightens both program and participant", () => {
    const r = resolveBansosLimits({
      program,
      participant: { rpm: 60, concurrency: 3, tokenAllowance: 100_000 },
      key: { rpm: 20, concurrency: 1 },
    });
    expect(r.rpm).toBe(20);
    expect(r.concurrency).toBe(1);
  });

  test("a model ceiling tightens the per-request token limits", () => {
    const r = resolveBansosLimits({
      program,
      participant: { rpm: null, concurrency: null, tokenAllowance: null },
      model: { maxInputTokens: 32_000, maxOutputTokens: 1_024 },
    });
    expect(r.maxInputTokens).toBe(32_000);
    expect(r.maxOutputTokens).toBe(1_024);
  });

  test("silence at every level means unlimited, not zero", () => {
    const r = resolveBansosLimits({
      program: { globalRpm: null, globalConcurrency: null, maxInputTokens: null, maxOutputTokens: null, defaultTokenAllowance: null },
      participant: { rpm: null, concurrency: null, tokenAllowance: null },
    });
    expect(r.rpm).toBeNull();
    expect(r.concurrency).toBeNull();
    expect(r.tokenBudget).toBeNull();
    expect(r.maxInputTokens).toBeNull();
  });
});

describe("program window and participant state", () => {
  test("an unset window is always open", () => {
    expect(isProgramInWindow({ startsAt: null, endsAt: null })).toBe(true);
  });

  test("a future start is not yet open", () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(isProgramInWindow({ startsAt: future, endsAt: null })).toBe(false);
  });

  test("a past end is closed", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(isProgramInWindow({ startsAt: null, endsAt: past })).toBe(false);
  });

  test("only an active participant may transact", () => {
    expect(isParticipantUsable({ status: "active", expiresAt: null }).ok).toBe(true);
    for (const status of ["pending", "suspended", "revoked"] as const) {
      expect(isParticipantUsable({ status, expiresAt: null }).ok).toBe(false);
    }
  });

  test("an expired participant is refused even while active", () => {
    const past = new Date(Date.now() - 1000);
    const result = isParticipantUsable({ status: "active", expiresAt: past });
    expect(result.ok).toBe(false);
  });
});

describe("Bansos key issuance", () => {
  test("the secret carries the Bansos prefix", () => {
    expect(generateBansosKey().secret.startsWith(BANSOS_KEY_PREFIX)).toBe(true);
  });

  test("two keys never collide", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateBansosKey().secret));
    expect(seen.size).toBe(200);
  });

  test("the stored hash is not the secret", () => {
    const { secret, hash } = generateBansosKey();
    expect(hash).not.toBe(secret);
    expect(hash).not.toContain(secret);
  });

  test("the display value reveals only a prefix", () => {
    const { secret, display } = generateBansosKey();
    expect(display.endsWith("…")).toBe(true);
    // It must not be possible to reconstruct the secret from what is stored.
    expect(display.length).toBeLessThan(secret.length);
    expect(secret.startsWith(display.slice(0, -1))).toBe(true);
  });

  test("masking a missing prefix yields a placeholder, not a crash", () => {
    expect(maskBansosKey(null)).toBe("—");
    expect(maskBansosKey("")).toBe("—");
  });
});

describe("audit redaction", () => {
  test("a Bansos secret inside a longer string is redacted", () => {
    const line = `issued key bs_abcdefghijklmnop to participant`;
    expect(String(redactSecrets(line))).not.toContain("bs_abcdefghijklmnop");
  });

  test("a field named like a secret is dropped whatever it holds", () => {
    const out = redactSecrets({ apiKey: "anything", token: "anything", safe: 1 }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.safe).toBe(1);
  });

  test("nested structures are redacted too", () => {
    const out = redactSecrets({ a: { b: { secret: "x", ok: true } } }) as Record<string, unknown>;
    const nested = (out.a as Record<string, unknown>).b as Record<string, unknown>;
    expect(nested.secret).toBe("[redacted]");
    expect(nested.ok).toBe(true);
  });
});
