// Credential redaction at publication/storage boundaries, never on provider wire.

const REDACTED = "[redacted]";
const SECRET_FIELD =
  /^(?:authorization|proxyauthorization|cookie|setcookie|xapikey|apikey|secret|clientsecret|password|passwd|credential|accesstoken|refreshtoken|idtoken|bearer|token|keyencrypted)$/i;

/** Preserve diagnostic text while removing credential-bearing substrings. */
export function redactTelemetryText(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk-|rk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/(\bhttps?:\/\/)[^\/?@\s]+@/gi, "$1[redacted]@")
    .replace(
      /(\b(?:api[-_ ]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|secret)\b["']?\s*[:=]\s*["']?)[^\s"',;}&]+/gi,
      "$1[redacted]",
    )
    .replace(/(\b(?:set-)?cookie:\s*)[^\r\n]+/gi, "$1[redacted]");
}

/** Copy only diagnostic data; sensitive fields and cycles cannot cross the boundary. */
export function redactTelemetryValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (typeof value === "string") return redactTelemetryText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 16) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Headers) {
    const headers: Record<string, unknown> = {};
    value.forEach((entry, key) => { headers[key] = entry; });
    return redactTelemetryValue(headers, seen, depth);
  }
  seen.add(value);
  try {
    if (Array.isArray(value))
      return value.map((entry) => redactTelemetryValue(entry, seen, depth + 1));
    const record: Record<string, unknown> = Object.create(null);
    if (value instanceof Error) {
      record.name = value.name;
      record.message = redactTelemetryText(value.message);
      if (value.stack) record.stack = redactTelemetryText(value.stack);
    }
    for (const [key, entry] of Object.entries(value)) {
      record[key] = SECRET_FIELD.test(key.replace(/[-_ ]/g, ""))
        ? REDACTED
        : redactTelemetryValue(entry, seen, depth + 1);
    }
    return record;
  } finally {
    seen.delete(value);
  }
}

/**
 * Masks a client IP for presentation: IPv4 keeps the first three octets
 * (`203.0.113.xxx`), IPv6 the first four hextets. Empty input stays empty;
 * unparseable input is fully masked. Mirrors the 21.beta privacy contract:
 * storage keeps raw values, only the read path masks.
 */
export function maskClientIp(value: string): string;
export function maskClientIp(value: null | undefined): null;
export function maskClientIp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const ip = value.trim();
  if (ip.length === 0) return ip;
  // IPv4-mapped IPv6 (`::ffff:203.0.113.7`): mask the embedded IPv4 tail so
  // the most common localhost/proxied shape stays readable.
  const lastColon = ip.lastIndexOf(":");
  const tail = lastColon === -1 ? "" : ip.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".");
    if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
      return `${ip.slice(0, lastColon + 1)}${octets.slice(0, 3).join(".")}.xxx`;
    }
    return "***";
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.length >= 4 ? `${parts.slice(0, 4).join(":")}:xxxx` : "xxxx";
  }
  const octets = ip.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
    return `${octets.slice(0, 3).join(".")}.xxx`;
  }
  return "***";
}
