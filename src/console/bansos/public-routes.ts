/**
 * Public Bansos endpoint.
 *
 * ── Why it is unauthenticated ───────────────────────────────────────────────
 * The operator creates every key and hands them out. The recipients are not
 * accounts on this gateway and have no session to present, so requiring one
 * would mean inventing a second credential per recipient — more to distribute,
 * more to leak, and no additional check on who may read a page the operator is
 * already sending them the link to.
 *
 * ── What that means for what may be returned ────────────────────────────────
 * Only what the operator is publishing to their recipients, and only for one
 * program at a time, addressed by slug:
 *
 * - the program's name, description and limits;
 * - the models it subsidizes, under their public names;
 * - the live keys, with their secrets, so recipients can copy one;
 * - consumption totals.
 *
 * It never returns `adminNotes`, a provider name, an upstream model id, a
 * participant's email or anything from another program or tenant. A slug is not
 * a secret — the page is meant to be shared — so the endpoint is written as if
 * the slug is public, because it is.
 *
 * ── Why the keys are reached through participants ───────────────────────────
 * A Bansos key carries `bansos_participant_id`, and a participant belongs to
 * exactly one program. Filtering keys by tenant instead would publish every
 * other program's keys on this page, which is the one mistake this endpoint
 * cannot afford: the whole point of scoping by slug is that a program's page
 * shows that program.
 *
 * ── Why a disabled program returns 404 rather than an empty page ────────────
 * A program that is switched off should not keep advertising its keys. The
 * page goes away with it.
 */
import { Elysia } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import type { ClovielaDatabase } from "../../persistence/postgres";
import { apiKeys, bansosModels, bansosParticipants, bansosPrograms } from "../../persistence/schema";
import { decryptCredentialToString } from "../../security/crypto";
import { errorResponse } from "../shared/errors";

/**
 * The base URL a recipient should point their client at.
 *
 * Built from the request when no origin is configured, so the page is correct
 * behind a reverse proxy without the operator editing anything: whatever host
 * served the page is the host their clients will reach.
 */
function baseUrl(request: Request, configuredOrigin: string | undefined): string {
  const origin = configuredOrigin?.trim();
  if (origin !== undefined && origin.length > 0) return origin.replace(/\/+$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function createBansosPublicRoutes(deps: {
  db: ClovielaDatabase;
  /** `CLOVIELA_PUBLIC_ORIGIN`, when the operator set one. */
  publicOrigin?: string | undefined;
}): Elysia<any, any, any, any, any, any, any, any> {
  return new Elysia({ prefix: "/bansos/public" }).get(
    "/:slug",
    async ({ request, params, set }) => {
      try {
        const programRows = await deps.db
          .select()
          .from(bansosPrograms)
          .where(eq(bansosPrograms.slug, params.slug))
          .limit(1);
        const program = programRows[0];
        // A disabled program is indistinguishable from one that does not
        // exist: neither should advertise anything.
        if (program === undefined || !program.enabled) {
          set.status = 404;
          return { error: "not_found", message: "No such program." };
        }

        const models = await deps.db
          .select({
            publicModelId: bansosModels.publicModelId,
            displayName: bansosModels.displayName,
            maxInputTokens: bansosModels.maxInputTokens,
            maxOutputTokens: bansosModels.maxOutputTokens,
          })
          .from(bansosModels)
          .where(and(eq(bansosModels.programId, program.id), eq(bansosModels.enabled, true)));

        // Scoped to this program by joining through its participants, so a
        // second program in the same tenant cannot appear on this page.
        const keyRows = await deps.db
          .select({
            label: apiKeys.label,
            keyPrefix: apiKeys.keyPrefix,
            keyEncrypted: apiKeys.keyEncrypted,
            enabled: apiKeys.enabled,
            revokedAt: apiKeys.revokedAt,
            lifetimeTokenBudget: apiKeys.lifetimeTokenBudget,
            lifetimeTokensConsumed: apiKeys.lifetimeTokensConsumed,
            expiresAt: apiKeys.expiresAt,
            requestsPerMinute: apiKeys.requestsPerMinute,
            maxConcurrentRequests: apiKeys.maxConcurrentRequests,
          })
          .from(apiKeys)
          .innerJoin(
            bansosParticipants,
            eq(apiKeys.bansosParticipantId, bansosParticipants.id),
          )
          .where(and(eq(bansosParticipants.programId, program.id), isNull(apiKeys.revokedAt)));

        let consumed = 0;
        let budget = 0;
        let liveKeys = 0;
        const keys = keyRows.map((key) => {
          const live = key.enabled && key.revokedAt === null;
          if (live) liveKeys += 1;
          consumed += key.lifetimeTokensConsumed ?? 0;
          budget += key.lifetimeTokenBudget ?? 0;

          let secret: string | null = null;
          if (live && key.keyEncrypted !== null) {
            // A decryption failure means the encryption key changed since this
            // key was issued. The key still authenticates; it just cannot be
            // displayed, and showing a wrong secret would be worse than none.
            try {
              secret = decryptCredentialToString(key.keyEncrypted);
            } catch {
              secret = null;
            }
          }
          return {
            label: key.label,
            keyPrefix: key.keyPrefix,
            secret,
            live,
            tokensConsumed: key.lifetimeTokensConsumed ?? 0,
            tokenBudget: key.lifetimeTokenBudget,
            // A recipient watching their own quota needs the same numbers the
            // gateway enforces, including when the key stops working.
            expiresAt: key.expiresAt?.toISOString() ?? null,
            requestsPerMinute: key.requestsPerMinute,
            maxConcurrentRequests: key.maxConcurrentRequests,
          };
        });

        return {
          program: {
            name: program.name,
            description: program.description,
            baseUrl: baseUrl(request, deps.publicOrigin),
            globalRpm: program.globalRpm,
            globalConcurrency: program.globalConcurrency,
            // The window is published because a recipient needs to know when
            // their access ends; it is not operator-only information.
            startsAt: program.startsAt?.toISOString() ?? null,
            endsAt: program.endsAt?.toISOString() ?? null,
            // Per-request ceilings, so a recipient can size their requests
            // instead of discovering the limit by hitting it.
            maxInputTokens: program.maxInputTokens,
            maxOutputTokens: program.maxOutputTokens,
            maxRequestBytes: program.maxRequestBytes,
            maxRequestDurationMs: program.maxRequestDurationMs,
            maxStreamDurationMs: program.maxStreamDurationMs,
            // Terms are shown when the operator requires them. `termsText` is
            // published deliberately: it is written to be read by recipients.
            termsRequired: program.termsRequired,
            termsText: program.termsRequired ? program.termsText : null,
          },
          keys,
          models,
          totals: {
            tokensConsumed: consumed,
            // `null` when no ceiling was ever configured, so the page can say
            // "unlimited" instead of rendering a budget of zero.
            tokenBudget: budget === 0 ? null : budget,
            liveKeys,
          },
        };
      } catch (error) {
        return errorResponse(error, set, "Could not read the program");
      }
    },
  );
}
