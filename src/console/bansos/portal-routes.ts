/**
 * Participant portal API.
 *
 * ── Why this is a separate file with its own resolver ───────────────────────
 * The administrator API authorizes through `requireTenantScope`, which reads
 * the console session cookie. A participant has no console session and never
 * should — they are not an operator, and the two audiences must not share an
 * authentication path. This file resolves its caller from a portal session
 * token instead, and no route here can be reached with an operator cookie or
 * vice versa.
 *
 * ── What a participant may read ─────────────────────────────────────────────
 * Their own program, their own keys, their own consumption, and the models
 * they may call. Never another participant, never `adminNotes`, never the
 * provider behind a public model name: which upstream serves a model is
 * gateway topology, and the portal translates names so a participant never
 * needs it.
 *
 * ── What a participant may write ────────────────────────────────────────────
 * Nothing. Every route is a read. Issuing, revoking and suspending are
 * operator actions, and a portal that could issue its own keys would make the
 * program's ceiling a suggestion.
 */
import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import type { ClovielaDatabase } from "../../persistence/postgres";
import { apiKeys, bansosModels } from "../../persistence/schema";
import { hashSecret } from "../../security/crypto";
import { BansosPortalStore } from "./portal-store";
import { errorResponse } from "../shared/errors";

/** Reads the bearer token from an `Authorization: Bearer …` header. */
function bearerToken(header: string | null | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export function createBansosPortalRoutes(deps: {
  db: ClovielaDatabase;
}): Elysia<any, any, any, any, any, any, any, any> {
  const store = new BansosPortalStore(deps.db);

  return new Elysia({ prefix: "/bansos/portal" })
    /**
     * Exchanges a Bansos key for a session token.
     *
     * The key is hashed and looked up exactly as the gateway does it, so a key
     * that cannot spend cannot sign in either.
     */
    .post(
      "/session",
      { body: t.Object({ key: t.String({ minLength: 8, maxLength: 200 }) }) },
      async ({ body, request, set }) => {
        try {
          const issued = await store.openSession({
            keyHash: hashSecret(body.key.trim()),
            ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
            userAgent: request.headers.get("user-agent") ?? undefined,
          });
          // One message for every failure: which of "unknown", "revoked" or
          // "suspended" applies is not something a sign-in form should reveal.
          if (issued === undefined) {
            set.status = 401;
            return { error: "invalid_key", message: "That key is not valid for any active program." };
          }
          return {
            token: issued.token,
            expiresAt: issued.expiresAt.toISOString(),
            participant: {
              id: issued.participant.id,
              displayName: issued.participant.displayName,
            },
            program: {
              name: issued.program.name,
              slug: issued.program.slug,
            },
          };
        } catch (error) {
          return errorResponse(error, set, "Could not open a session");
        }
      },
    )

    /** What the portal shows after sign-in: who you are, what you may call. */
    .get("/me", async ({ request, set }) => {
      try {
        const token = bearerToken(request.headers.get("authorization"));
        if (token === undefined) {
          set.status = 401;
          return { error: "unauthorized", message: "Sign in first." };
        }
        const session = await store.resolveSession(token);
        if (session === undefined) {
          set.status = 401;
          return { error: "unauthorized", message: "This session is no longer valid." };
        }

        const models = await deps.db
          .select({
            publicModelId: bansosModels.publicModelId,
            displayName: bansosModels.displayName,
            maxInputTokens: bansosModels.maxInputTokens,
            maxOutputTokens: bansosModels.maxOutputTokens,
          })
          .from(bansosModels)
          .where(
            and(eq(bansosModels.programId, session.program.id), eq(bansosModels.enabled, true)),
          );

        const keys = await deps.db
          .select({
            id: apiKeys.id,
            label: apiKeys.label,
            keyPrefix: apiKeys.keyPrefix,
            createdAt: apiKeys.createdAt,
            revokedAt: apiKeys.revokedAt,
            enabled: apiKeys.enabled,
            requestsPerMinute: apiKeys.requestsPerMinute,
            lifetimeTokenBudget: apiKeys.lifetimeTokenBudget,
            lifetimeTokensConsumed: apiKeys.lifetimeTokensConsumed,
            maxConcurrentRequests: apiKeys.maxConcurrentRequests,
          })
          .from(apiKeys)
          .where(eq(apiKeys.bansosParticipantId, session.participant.id));

        return {
          participant: {
            id: session.participant.id,
            displayName: session.participant.displayName,
            status: session.participant.status,
            expiresAt: session.participant.expiresAt?.toISOString() ?? null,
          },
          program: {
            name: session.program.name,
            slug: session.program.slug,
            // The program's published limits, which a participant needs in
            // order to stay inside them.
            globalRpm: session.program.globalRpm,
            globalConcurrency: session.program.globalConcurrency,
          },
          // Consumption is reported per key and never as a single number: a
          // participant holding two keys needs to know which one is exhausted.
          keys: keys.map((key) => ({
            ...key,
            createdAt: key.createdAt.toISOString(),
            revokedAt: key.revokedAt?.toISOString() ?? null,
            live: key.enabled && key.revokedAt === null,
          })),
          models,
          allowance: {
            tokenAllowance: session.participant.tokenAllowance,
            tokensConsumed: session.participant.tokensConsumed,
          },
        };
      } catch (error) {
        return errorResponse(error, set, "Could not read the portal");
      }
    })

    /** Sign-out. Idempotent: closing a session twice is not an error. */
    .post("/sign-out", async ({ request, set }) => {
      try {
        const token = bearerToken(request.headers.get("authorization"));
        if (token !== undefined) await store.closeSession(token);
        return { success: true };
      } catch (error) {
        return errorResponse(error, set, "Could not sign out");
      }
    })

    /**
     * The live models this session's key may call, in the shape `/v1/models`
     * uses. Lets the portal show exactly what the gateway will accept instead
     * of a list that might drift from the key's own allowlist.
     */
    .get("/models", async ({ request, set }) => {
      try {
        const token = bearerToken(request.headers.get("authorization"));
        if (token === undefined) {
          set.status = 401;
          return { error: "unauthorized", message: "Sign in first." };
        }
        const session = await store.resolveSession(token);
        if (session === undefined) {
          set.status = 401;
          return { error: "unauthorized", message: "This session is no longer valid." };
        }
        const rows = await deps.db
          .select({
            publicModelId: bansosModels.publicModelId,
            displayName: bansosModels.displayName,
          })
          .from(bansosModels)
          .where(
            and(eq(bansosModels.programId, session.program.id), eq(bansosModels.enabled, true)),
          );
        return { data: rows.map((row) => ({ id: row.publicModelId, displayName: row.displayName })) };
      } catch (error) {
        return errorResponse(error, set, "Could not list models");
      }
    });
}
