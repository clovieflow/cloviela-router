/**
 * Client-IP presentation masking.
 *
 * Storage keeps the raw address so an operator can still investigate, and the
 * read path drops the last label so a support screenshot does not publish a
 * customer's IP.
 *
 */
import { describe, expect, test } from "bun:test";
import { maskClientIp, redactTelemetryValue } from "../../src/observability/redaction";

describe("maskClientIp", () => {
  test("keeps the first three IPv4 octets", () => {
    expect(maskClientIp("203.0.113.7")).toBe("203.0.113.xxx");
  });

  test("masks the embedded IPv4 tail of a mapped IPv6 address", () => {
    // The common localhost/proxied shape; masking the whole thing would lose
    // the fact that it is a mapped address.
    expect(maskClientIp("::ffff:203.0.113.7")).toBe("::ffff:203.0.113.xxx");
  });

  test("keeps the first four IPv6 hextets", () => {
    expect(maskClientIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3:xxxx");
  });

  test("fully masks an IPv6 address too short to keep four hextets", () => {
    expect(maskClientIp("::1")).toBe("xxxx");
  });

  test("returns null for null or undefined", () => {
    // Distinguishing "no address" from "an address" matters: a null means the
    // gateway never resolved one, which is a different report than a masked one.
    expect(maskClientIp(null)).toBeNull();
    expect(maskClientIp(undefined)).toBeNull();
  });

  test("returns an empty string for an empty address", () => {
    expect(maskClientIp("")).toBe("");
    expect(maskClientIp("   ")).toBe("");
  });

  test("fully masks input it cannot parse", () => {
    // Fail closed: an unrecognised shape is not partially published.
    expect(maskClientIp("not-an-ip")).toBe("***");
    expect(maskClientIp("1.2.3")).toBe("***");
    expect(maskClientIp("1.2.3.4.5")).toBe("***");
  });

  test("tolerates surrounding whitespace", () => {
    expect(maskClientIp("  203.0.113.7  ")).toBe("203.0.113.xxx");
  });

  test("the masked form ends in the placeholder, never the original final octet", () => {
    // Stated as a shape rather than a substring test: `10.0.0.1` masked to
    // `10.0.0.xxx` legitimately still *contains* the character "1" in an earlier
    // octet, so a naive `not.toContain(lastOctet)` is not the property. The
    // property is that the final label is the placeholder.
    for (const address of ["203.0.113.7", "10.0.0.1", "255.255.255.255"]) {
      const masked = maskClientIp(address);
      expect(masked.endsWith(".xxx")).toBe(true);
      expect(masked).toBe(`${address.split(".").slice(0, 3).join(".")}.xxx`);
    }
  });
});

describe("diagnostic credential boundaries", () => {
  test("scrubs nested opaque credentials without altering the upstream request", () => {
    const original = {
      headers: { Authorization: "Bearer EXAMPLE-private", Cookie: "session=EXAMPLE-cookie" },
      api_key: "EXAMPLE-opaque-key",
      authState: { access_token: "EXAMPLE-access", refreshToken: "EXAMPLE-refresh" },
      message: "Provider rejected sk-ant-EXAMPLE-not-a-real-key; request req-123",
      usage: { input_tokens: 100, output_tokens: 20 },
    };
    const before = JSON.stringify(original);
    const safe = redactTelemetryValue(original);
    const encoded = JSON.stringify(safe);
    for (const secret of ["EXAMPLE-private", "EXAMPLE-cookie", "EXAMPLE-opaque-key", "EXAMPLE-access", "EXAMPLE-refresh", "sk-ant-EXAMPLE-not-a-real-key"])
      expect(encoded).not.toContain(secret);
    expect(encoded).toContain("req-123");
    expect(encoded).toContain('"input_tokens":100');
    expect(encoded).toContain('"output_tokens":20');
    expect(JSON.stringify(original)).toBe(before);
  });

  test("retains repeated references while safely bounding an actual cycle", () => {
    const shared = { status: 429 };
    const cyclic: Record<string, unknown> = { left: shared, right: shared };
    cyclic.self = cyclic;
    const safe = redactTelemetryValue(cyclic);
    expect(safe).toMatchObject({ left: { status: 429 }, right: { status: 429 } });
    expect(JSON.stringify(safe)).not.toContain("undefined");
    expect(JSON.stringify(safe)).toContain("circular");
  });
});
