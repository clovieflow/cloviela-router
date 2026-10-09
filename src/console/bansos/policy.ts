/**
 * Bansos policy resolution.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * A limit is only ever as permissive as the strictest level that states one.
 * Program, participant, model and key each may be silent (`null`) or may state
 * a number; the effective limit is the minimum of everything that speaks. A
 * participant override therefore cannot widen what the program allows, and a
 * per-key limit cannot widen what the participant was granted — which is the
 * property the brief calls "a restrictive applicable policy must never be
 * bypassed because another policy is less restrictive".
 *
 * `null` at every level means unlimited, and that is deliberate: an operator
 * who never configured a ceiling has not asked for one. It is never the result
 * of a missing or malformed value, because the API layer rejects a `0` and
 * rejects a negative at every level before it reaches here.
 */
import type { BansosModel, BansosParticipant, BansosProgram } from "../../persistence/schema";

/** A ceiling that may be absent at any level. `null` = not configured. */
export type MaybeLimit = number | null | undefined;

export interface ResolvedBansosLimits {
  /** Tokens this key may consume over its lifetime. */
  readonly tokenBudget: number | null;
  readonly rpm: number | null;
  readonly concurrency: number | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
}

/**
 * The smallest configured value, or `null` when nothing configured one.
 *
 * Exported because the admin UI shows an operator the effective limit next to
 * the value they are editing, and that display has to be computed the same way
 * the enforcement is — a second implementation would drift.
 */
export function strictest(...values: readonly MaybeLimit[]): number | null {
  const stated = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return stated.length === 0 ? null : Math.min(...stated);
}

/**
 * Limits for one request.
 *
 * Key-level limits are passed in rather than read from a row: they live on the
 * `api_keys` columns the admission service already uses, and duplicating them
 * here would create two sources of truth for the same number.
 */
export function resolveBansosLimits(input: {
  readonly program: Pick<
    BansosProgram,
    "globalRpm" | "globalConcurrency" | "maxInputTokens" | "maxOutputTokens" | "defaultTokenAllowance"
  >;
  readonly participant: Pick<
    BansosParticipant,
    "rpm" | "concurrency" | "tokenAllowance"
  >;
  readonly model?: Pick<BansosModel, "maxInputTokens" | "maxOutputTokens"> | undefined;
  readonly key?: { readonly rpm: MaybeLimit; readonly concurrency: MaybeLimit } | undefined;
}): ResolvedBansosLimits {
  const { program, participant, model, key } = input;
  return {
    // `defaultTokenAllowance` is what a NEW participant is granted, not a
    // ceiling on what an existing one may hold. Folding it into the minimum
    // meant an administrator could never raise a participant above the
    // program default — the grant would be silently clipped on every request.
    // The program's own budget is enforced as a separate counter instead.
    tokenBudget: participant.tokenAllowance ?? null,
    rpm: strictest(program.globalRpm, participant.rpm, key?.rpm),
    concurrency: strictest(program.globalConcurrency, participant.concurrency, key?.concurrency),
    maxInputTokens: strictest(program.maxInputTokens, model?.maxInputTokens),
    maxOutputTokens: strictest(program.maxOutputTokens, model?.maxOutputTokens),
  };
}

/**
 * Whether the program is inside its own configured window.
 *
 * An unset bound is not a restriction. An end before the start is rejected by
 * the database constraint, so it cannot reach here.
 */
export function isProgramInWindow(
  program: Pick<BansosProgram, "startsAt" | "endsAt">,
  now: Date = new Date(),
): boolean {
  if (program.startsAt !== null && now < program.startsAt) return false;
  if (program.endsAt !== null && now > program.endsAt) return false;
  return true;
}

/** Whether a participant may transact right now. */
export function isParticipantUsable(
  participant: Pick<BansosParticipant, "status" | "expiresAt">,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (participant.status !== "active") {
    return { ok: false, reason: `participant is ${participant.status}` };
  }
  if (participant.expiresAt !== null && now > participant.expiresAt) {
    return { ok: false, reason: "participant access has expired" };
  }
  return { ok: true };
}
