/**
 * Bansos publication.
 *
 * ── What these protect ──────────────────────────────────────────────────────
 * The public page prints working API keys, so the rules about *which* keys
 * appear are the security boundary of the whole feature. Each case below is a
 * way a key could be published that should not be, or hidden when it should
 * not be.
 *
 * ── Why the boundary is `isKeyLive` ─────────────────────────────────────────
 * The page and the admin list both ask the same question — "is this key
 * usable" — and the answer must not differ between them. A second
 * implementation is how a revoked key ends up displayed as live.
 */
import { describe, expect, test } from "bun:test";
import { isKeyLive } from "../../src/console/bansos/publish";

/**
 * Relative to the real clock, not a fixed date: `isKeyLive` compares against
 * `new Date()`, so a hardcoded "future" is in the past the moment the clock
 * passes it and the test starts failing for a reason unrelated to the code.
 */
const NOW = new Date();
const PAST = new Date(NOW.getTime() - 60_000);
const FUTURE = new Date(NOW.getTime() + 60 * 60_000);

describe("isKeyLive", () => {
  test("an enabled, unrevoked, unexpired key is live", () => {
    expect(isKeyLive({ enabled: true, revokedAt: null, expiresAt: null })).toBe(true);
  });

  test("a disabled key is not live", () => {
    expect(isKeyLive({ enabled: false, revokedAt: null, expiresAt: null })).toBe(false);
  });

  test("a revoked key is not live", () => {
    expect(isKeyLive({ enabled: true, revokedAt: NOW, expiresAt: null })).toBe(false);
  });

  test("an expired key is not live", () => {
    expect(isKeyLive({ enabled: true, revokedAt: null, expiresAt: PAST })).toBe(false);
  });

  test("a key expiring in the future is live", () => {
    expect(isKeyLive({ enabled: true, revokedAt: null, expiresAt: FUTURE })).toBe(true);
  });

  test("revocation wins over a future expiry", () => {
    // Both limits are set and only one has fired; the key must still be dead.
    expect(isKeyLive({ enabled: true, revokedAt: NOW, expiresAt: FUTURE })).toBe(false);
  });
});
