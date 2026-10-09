/**
 * Bansos enforcement on the gateway request path.
 *
 * ── Where this sits ─────────────────────────────────────────────────────────
 * `gateway-guards.ts` already resolves the key, checks its scope and applies
 * the client-router denylist before anything else runs. This runs in the same
 * `beforeHandle`, after that resolution and before routing, so a Bansos request
 * is refused before a route is planned or an upstream is touched.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 * It does not enforce token quota, rate limit or concurrency. Those are the
 * `api_keys` columns the `ApiKeyAdmissionService` already reads on the dispatch
 * path, and a Bansos key is an ordinary key row — so the existing admission
 * machinery applies to it unchanged. Re-implementing any of it here would
 * create a second accounting path and a second place for the two to disagree.
 *
 * What is genuinely Bansos-specific, and therefore lives here:
 *   1. the participant must be active and unexpired,
 *   2. the program must be enabled and inside its window,
 *   3. the requested model must be on the program's allowlist,
 *   4. the request must be attributed to the program's provider.
 */
import { eq } from "drizzle-orm";
import type { ClovielaDatabase } from "../../persistence/postgres";
import { apiKeys, bansosModels, bansosParticipants, bansosPrograms } from "../../persistence/schema";
import { isParticipantUsable, isProgramInWindow } from "./policy";

export interface BansosContext {
  readonly programId: string;
  readonly participantId: string;
  readonly programSlug: string;
  /** The upstream provider this program may spend. */
  readonly providerId: string | null;
  /** Upstream model ids the program subsidizes. */
  readonly allowedUpstreamModels: readonly string[];
  /** Public id → upstream id, for translating what a client asked for. */
  readonly modelMap: ReadonlyMap<string, string>;
}

export type BansosRejection =
  | { readonly kind: "not_bansos" }
  | { readonly kind: "program_disabled" }
  | { readonly kind: "program_closed" }
  | { readonly kind: "participant_inactive"; readonly reason: string }
  | { readonly kind: "model_not_subsidized"; readonly model: string }
  | { readonly kind: "lookup_failed" };

/**
 * Resolves the Bansos context for a key, or reports why it does not apply.
 *
 * A key that is not a Bansos key returns `not_bansos` and the caller does
 * nothing further — this must be free for the overwhelming majority of
 * requests, which are ordinary personal keys.
 */
export async function resolveBansosContext(
  db: ClovielaDatabase,
  apiKeyId: string,
): Promise<{ context: BansosContext } | { rejection: BansosRejection }> {
  // One indexed read on the key row. `bansos_participant_id` is NULL for every
  // other key mode, so the join below is skipped entirely for them.
  const keyRows = await db
    .select({ participantId: apiKeys.bansosParticipantId, mode: apiKeys.keyMode })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1);
  const key = keyRows[0];
  if (key === undefined) return { rejection: { kind: "lookup_failed" } };
  if (key.mode !== "bansos" || key.participantId === null) {
    return { rejection: { kind: "not_bansos" } };
  }

  const participantRows = await db
    .select()
    .from(bansosParticipants)
    .where(eq(bansosParticipants.id, key.participantId))
    .limit(1);
  const participant = participantRows[0];
  if (participant === undefined) {
    // The row cascades with the participant, so this means the key outlived it
    // — treat as revoked rather than falling through to a normal key.
    return { rejection: { kind: "participant_inactive", reason: "participant no longer exists" } };
  }

  const usable = isParticipantUsable(participant);
  if (!usable.ok) {
    return { rejection: { kind: "participant_inactive", reason: usable.reason } };
  }

  const programRows = await db
    .select()
    .from(bansosPrograms)
    .where(eq(bansosPrograms.id, participant.programId))
    .limit(1);
  const program = programRows[0];
  if (program === undefined) {
    return { rejection: { kind: "participant_inactive", reason: "program no longer exists" } };
  }
  if (!program.enabled) return { rejection: { kind: "program_disabled" } };
  if (!isProgramInWindow(program)) return { rejection: { kind: "program_closed" } };

  const modelRows = await db
    .select()
    .from(bansosModels)
    .where(eq(bansosModels.programId, program.id));
  const enabled = modelRows.filter((row) => row.enabled);

  // A participant may be narrowed further than the program, never widened.
  const participantAllow = participant.modelAllowlist;
  const permitted =
    participantAllow === null || participantAllow === undefined
      ? enabled
      : enabled.filter(
          (row) =>
            participantAllow.includes(row.publicModelId) ||
            participantAllow.includes(row.upstreamModelId),
        );

  const modelMap = new Map<string, string>();
  for (const row of permitted) {
    modelMap.set(row.publicModelId, row.upstreamModelId);
    // The upstream id resolves too, so a client that kept the original name
    // keeps working.
    modelMap.set(row.upstreamModelId, row.upstreamModelId);
  }

  return {
    context: {
      programId: program.id,
      participantId: participant.id,
      programSlug: program.slug,
      providerId: program.providerId,
      allowedUpstreamModels: permitted.map((row) => row.upstreamModelId),
      modelMap,
    },
  };
}

/**
 * Whether a requested model is one this program subsidizes.
 *
 * Compared against the upstream id, because by the time a route is planned the
 * alias has already been resolved. A client asking for the public id reaches
 * here after `modelMap` translated it.
 */
export function isModelSubsidized(context: BansosContext, resolvedModel: string): boolean {
  return context.allowedUpstreamModels.includes(resolvedModel);
}

/** The refusal a Bansos policy violation produces, shaped like the gateway's own errors. */
export function bansosRejectionMessage(rejection: BansosRejection): {
  readonly code: string;
  readonly status: number;
  readonly message: string;
} | null {
  switch (rejection.kind) {
    case "not_bansos":
    case "lookup_failed":
      return null;
    case "program_disabled":
      return { code: "program_disabled", status: 403, message: "This program is not currently active." };
    case "program_closed":
      return { code: "program_closed", status: 403, message: "This program is outside its active window." };
    case "participant_inactive":
      return { code: "account_inactive", status: 403, message: "This account is not active." };
    case "model_not_subsidized":
      return {
        code: "model_not_allowed",
        status: 404,
        message: `The model '${rejection.model}' is not available on this program.`,
      };
  }
}
