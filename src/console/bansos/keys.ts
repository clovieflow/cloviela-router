/**
 * Bansos API key issuance.
 *
 * ── Why a distinct prefix ───────────────────────────────────────────────────
 * A Bansos key is an ordinary `api_keys` row and authenticates through the
 * same hash lookup as every other key, so the prefix is not a security
 * boundary — it is an operator aid. `bs_` makes a leaked credential
 * identifiable at a glance in a log or a bug report, which is the difference
 * between "revoke that one" and "audit every key we have".
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 * The hash, never the secret. `keyEncrypted` is deliberately not written: the
 * existing personal-key flow keeps an encrypted copy so Studio can hand it
 * back to its owner, and a subsidized credential issued to a third party has
 * no equivalent need. The secret is returned once, at creation, and is
 * unrecoverable afterwards.
 */
import { randomBytes } from "node:crypto";
import { hashSecret } from "../../security/crypto";

/** Identifies a Bansos credential without revealing anything about it. */
export const BANSOS_KEY_PREFIX = "bs_";

/** Prefix length kept in the clear for display, e.g. `bs_a1b2c3d4…`. */
const VISIBLE_PREFIX_CHARS = BANSOS_KEY_PREFIX.length + 8;

export interface GeneratedBansosKey {
  /** Returned to the creator exactly once. */
  readonly secret: string;
  readonly hash: string;
  /** Safe to store and display: the leading characters only. */
  readonly display: string;
}

/**
 * 32 bytes of CSPRNG output, base64url — the same strength and encoding the
 * existing key generator uses, so nothing about entropy or alphabet differs
 * between a personal key and a Bansos one.
 */
export function generateBansosKey(): GeneratedBansosKey {
  const secret = `${BANSOS_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    secret,
    hash: hashSecret(secret),
    display: `${secret.slice(0, VISIBLE_PREFIX_CHARS)}…`,
  };
}

/**
 * Masks a stored key for display.
 *
 * Only ever called with the value persisted in `api_keys.key_prefix`, which is
 * already a non-secret fragment. If a caller passes something longer — a raw
 * secret by mistake — this truncates rather than echoing it.
 */
export function maskBansosKey(prefix: string | null | undefined): string {
  if (prefix === null || prefix === undefined || prefix.length === 0) return "—";
  const visible = prefix.slice(0, VISIBLE_PREFIX_CHARS);
  return `${visible}…`;
}

/**
 * Removes anything credential-shaped from a value bound for an audit row.
 *
 * Audit detail is written by the API layer from request bodies, and a careless
 * `detail: body` would persist a freshly minted secret into a table the
 * console reads back. This runs on every audit write rather than relying on
 * each call site to remember.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") {
    // A key this app issued, wherever it appears in a longer string.
    return value.replace(/\bbs_[A-Za-z0-9_-]{8,}/g, "bs_[redacted]").replace(/\brk_[A-Za-z0-9_-]{8,}/g, "rk_[redacted]");
  }
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Named like a secret: drop the value entirely rather than trying to
      // pattern-match it.
      if (/secret|password|token|apikey|api_key|credential/i.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redactSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}
