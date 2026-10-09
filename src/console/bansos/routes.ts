/**
 * Bansos administrator API.
 *
 * ── Authorization ───────────────────────────────────────────────────────────
 * Every route resolves the caller through the console's own access resolver
 * and requires `dashboard:write` for mutations. A participant's portal session
 * never carries that scope, so the portal cannot reach any of these — the
 * separation is a scope check on the server, not a hidden navigation entry.
 *
 * ── Key issuance ────────────────────────────────────────────────────────────
 * Issuing a Bansos key writes an ordinary `api_keys` row *with the limit
 * columns filled in*. That is the whole enforcement story: the existing
 * `ApiKeyAdmissionService` reads `requests_per_minute`, `daily_token_limit`,
 * `lifetime_token_budget` and `max_concurrent_requests` from the resolved key
 * snapshot and enforces them atomically on the dispatch path. Nothing in this
 * file re-implements quota accounting.
 */
import { Elysia, t } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import { invalidateApiKeyCache } from "../../security/api-key-auth";
import { ConsoleDomainError, errorResponse, requireTenantScope } from "../shared/errors";
import type { ConsoleDomainContext } from "../domain-registration";
import { BansosStore } from "../bansos/store";
import { resolveBansosLimits } from "../bansos/policy";
import { generateBansosKey, redactSecrets } from "../bansos/keys";
import { encryptCredential } from "../../security/crypto";
import { apiKeys } from "../../persistence/schema";

/** A limit field: absent means "leave alone", null means "clear it". */
const limitField = t.Optional(t.Union([t.Number(), t.Null()]));

const programBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  slug: t.String({ minLength: 1, maxLength: 60, pattern: "^[a-z0-9][a-z0-9-]*$" }),
  description: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
  adminNotes: t.Optional(t.Union([t.String({ maxLength: 4000 }), t.Null()])),
  enabled: t.Optional(t.Boolean()),
  enrollmentMode: t.Optional(t.Union([
    t.Literal("closed"), t.Literal("invite"), t.Literal("request"), t.Literal("open"),
  ])),
  autoApprove: t.Optional(t.Boolean()),
  maxParticipants: limitField,
  termsRequired: t.Optional(t.Boolean()),
  termsText: t.Optional(t.Union([t.String({ maxLength: 8000 }), t.Null()])),
  globalRpm: limitField,
  globalConcurrency: limitField,
  globalTokenBudget: limitField,
  dailyTokenBudget: limitField,
  monthlyTokenBudget: limitField,
  maxInputTokens: limitField,
  maxOutputTokens: limitField,
  maxRequestBytes: limitField,
  maxRequestDurationMs: limitField,
  maxStreamDurationMs: limitField,
  maxKeysPerParticipant: limitField,
  defaultTokenAllowance: limitField,
  defaultRpm: limitField,
  defaultConcurrency: limitField,
  startsAt: t.Optional(t.Union([t.String(), t.Null()])),
  endsAt: t.Optional(t.Union([t.String(), t.Null()])),
  providerId: t.Optional(t.Union([t.String({ maxLength: 120 }), t.Null()])),
  providerAccountIds: t.Optional(t.Array(t.String())),
});

/**
 * Rejects a zero or negative ceiling.
 *
 * The brief is explicit that unlimited must be a deliberate `null` and never
 * the accident of a missing or invalid value. A `0` is almost always a form
 * that was submitted before it was filled in, so it fails loudly here rather
 * than silently granting nothing — or, worse, being coerced to `null` and
 * granting everything.
 */
function assertPositiveLimits(body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "number") continue;
    if (!Number.isFinite(value) || value < 1) {
      throw new ConsoleDomainError("invalid_limit", 400, `${key} must be a positive number, or null for unlimited`);
    }
  }
}



export function createBansosRoutes(ctx: ConsoleDomainContext): Elysia<any, any, any, any, any, any, any, any> {
  const store = new BansosStore(ctx.db);

  return new Elysia({ prefix: "/bansos" })

    /* ── Programs ────────────────────────────────────────────────────────── */

    .get("/programs", async ({ request, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:read");
        return { programs: await store.listPrograms(access.tenantId) };
      } catch (error) {
        return errorResponse(error, set, "Could not list programs");
      }
    })

    .post("/programs", { body: programBody }, async ({ request, body, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
        assertPositiveLimits(body as Record<string, unknown>);
        const program = await store.createProgram({
          tenantId: access.tenantId,
          name: body.name,
          slug: body.slug,
          description: body.description ?? null,
          adminNotes: body.adminNotes ?? null,
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
          ...(body.enrollmentMode === undefined ? {} : { enrollmentMode: body.enrollmentMode }),
          ...(body.autoApprove === undefined ? {} : { autoApprove: body.autoApprove }),
          maxParticipants: body.maxParticipants ?? null,
          ...(body.termsRequired === undefined ? {} : { termsRequired: body.termsRequired }),
          termsText: body.termsText ?? null,
          globalRpm: body.globalRpm ?? null,
          globalConcurrency: body.globalConcurrency ?? null,
          globalTokenBudget: body.globalTokenBudget ?? null,
          dailyTokenBudget: body.dailyTokenBudget ?? null,
          monthlyTokenBudget: body.monthlyTokenBudget ?? null,
          maxInputTokens: body.maxInputTokens ?? null,
          maxOutputTokens: body.maxOutputTokens ?? null,
          maxRequestBytes: body.maxRequestBytes ?? null,
          maxRequestDurationMs: body.maxRequestDurationMs ?? null,
          maxStreamDurationMs: body.maxStreamDurationMs ?? null,
          ...(body.maxKeysPerParticipant == null ? {} : { maxKeysPerParticipant: body.maxKeysPerParticipant }),
          defaultTokenAllowance: body.defaultTokenAllowance ?? null,
          defaultRpm: body.defaultRpm ?? null,
          defaultConcurrency: body.defaultConcurrency ?? null,
          ...(body.startsAt === undefined || body.startsAt === null ? {} : { startsAt: new Date(body.startsAt) }),
          ...(body.endsAt === undefined || body.endsAt === null ? {} : { endsAt: new Date(body.endsAt) }),
          providerId: body.providerId ?? null,
          ...(body.providerAccountIds === undefined ? {} : { providerAccountIds: body.providerAccountIds }),
        });
        await store.recordAudit({
          tenantId: access.tenantId,
          programId: program.id,
          actorKind: "admin",
          actorId: access.id,
          action: "program.create",
          targetKind: "program",
          targetId: program.id,
          detail: redactSecrets({ name: program.name, slug: program.slug }) as Record<string, unknown>,
        });
        return program;
      } catch (error) {
        return errorResponse(error, set, "Could not create the program");
      }
    })

    .get("/programs/:programId", async ({ request, params, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:read");
        const program = await store.findProgram(access.tenantId, params.programId);
        if (program === undefined) throw new ConsoleDomainError("not_found", 404, "Program not found");
        const [participants, models] = await Promise.all([
          store.listParticipants(access.tenantId, program.id),
          store.listModels(program.id),
        ]);
        return {
          program,
          counts: {
            participants: participants.length,
            active: participants.filter((p) => p.status === "active").length,
            suspended: participants.filter((p) => p.status === "suspended").length,
            models: models.length,
            enabledModels: models.filter((m) => m.enabled).length,
          },
        };
      } catch (error) {
        return errorResponse(error, set, "Could not read the program");
      }
    })

    .patch("/programs/:programId", { body: t.Partial(programBody) }, async ({ request, params, body, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
        assertPositiveLimits(body as Record<string, unknown>);
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
          if (value === undefined) continue;
          if (key === "startsAt" || key === "endsAt") {
            patch[key] = value === null ? null : new Date(value as string);
            continue;
          }
          patch[key] = value;
        }
        const updated = await store.updateProgram(access.tenantId, params.programId, patch);
        if (updated === undefined) throw new ConsoleDomainError("not_found", 404, "Program not found");
        await store.recordAudit({
          tenantId: access.tenantId,
          programId: updated.id,
          actorKind: "admin",
          actorId: access.id,
          action: "program.update",
          targetKind: "program",
          targetId: updated.id,
          detail: redactSecrets(Object.keys(patch)) as Record<string, unknown>,
        });
        return updated;
      } catch (error) {
        return errorResponse(error, set, "Could not update the program");
      }
    })

    .delete("/programs/:programId", async ({ request, params, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
        const removed = await store.deleteProgram(access.tenantId, params.programId);
        if (!removed) throw new ConsoleDomainError("not_found", 404, "Program not found");
        return { success: true };
      } catch (error) {
        return errorResponse(error, set, "Could not delete the program");
      }
    })

    /* ── Participants ────────────────────────────────────────────────────── */

    .get("/programs/:programId/participants", async ({ request, params, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:read");
        return { participants: await store.listParticipants(access.tenantId, params.programId) };
      } catch (error) {
        return errorResponse(error, set, "Could not list participants");
      }
    })

    .post(
      "/programs/:programId/participants",
      {
        body: t.Object({
          displayName: t.String({ minLength: 1, maxLength: 120 }),
          email: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
          externalRef: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
          status: t.Optional(t.Union([
            t.Literal("pending"), t.Literal("active"), t.Literal("suspended"), t.Literal("revoked"),
          ])),
          adminNotes: t.Optional(t.Union([t.String({ maxLength: 4000 }), t.Null()])),
          tokenAllowance: limitField,
          rpm: limitField,
          concurrency: limitField,
          modelAllowlist: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
          expiresAt: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      },
      async ({ request, params, body, set }) => {
        try {
          const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
          assertPositiveLimits(body as Record<string, unknown>);
          const program = await store.findProgram(access.tenantId, params.programId);
          if (program === undefined) throw new ConsoleDomainError("not_found", 404, "Program not found");

          // The program's own ceiling is checked before the row is written, so
          // an over-subscribed program refuses the participant rather than
          // admitting one it will later have to evict.
          if (program.maxParticipants !== null) {
            const current = await store.countActiveParticipants(program.id);
            if (current >= program.maxParticipants) {
              throw new ConsoleDomainError("program_full", 409, "This program has reached its participant limit");
            }
          }

          const status = body.status ?? (program.autoApprove ? "active" : "pending");
          const participant = await store.createParticipant({
            programId: program.id,
            tenantId: access.tenantId,
            displayName: body.displayName,
            email: body.email ?? null,
            externalRef: body.externalRef ?? null,
            status,
            adminNotes: body.adminNotes ?? null,
            tokenAllowance: body.tokenAllowance ?? program.defaultTokenAllowance ?? null,
            rpm: body.rpm ?? program.defaultRpm ?? null,
            concurrency: body.concurrency ?? program.defaultConcurrency ?? null,
            modelAllowlist: body.modelAllowlist ?? null,
            approvedAt: status === "active" ? new Date() : null,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          });
          await store.recordAudit({
            tenantId: access.tenantId,
            programId: program.id,
            actorKind: "admin",
            actorId: access.id,
            action: "participant.create",
            targetKind: "participant",
            targetId: participant.id,
            detail: redactSecrets({ displayName: participant.displayName, status }) as Record<string, unknown>,
          });
          return participant;
        } catch (error) {
          return errorResponse(error, set, "Could not create the participant");
        }
      },
    )

    .patch(
      "/participants/:participantId",
      {
        body: t.Object({
          displayName: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
          email: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
          status: t.Optional(t.Union([
            t.Literal("pending"), t.Literal("active"), t.Literal("suspended"), t.Literal("revoked"),
          ])),
          adminNotes: t.Optional(t.Union([t.String({ maxLength: 4000 }), t.Null()])),
          tokenAllowance: limitField,
          rpm: limitField,
          concurrency: limitField,
          modelAllowlist: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
          expiresAt: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      },
      async ({ request, params, body, set }) => {
        try {
          const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
          assertPositiveLimits(body as Record<string, unknown>);
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(body)) {
            if (value === undefined) continue;
            if (key === "expiresAt") {
              patch[key] = value === null ? null : new Date(value as string);
              continue;
            }
            if (key === "status" && value === "active") patch.approvedAt = new Date();
            patch[key] = value;
          }
          const updated = await store.updateParticipant(access.tenantId, params.participantId, patch);
          if (updated === undefined) throw new ConsoleDomainError("not_found", 404, "Participant not found");
          await store.recordAudit({
            tenantId: access.tenantId,
            programId: updated.programId,
            actorKind: "admin",
            actorId: access.id,
            action: "participant.update",
            targetKind: "participant",
            targetId: updated.id,
            detail: redactSecrets(Object.keys(patch)) as Record<string, unknown>,
          });
          // A status change must take effect for keys already issued, not only
          // for the next one: the auth snapshot is cached for a few seconds, so
          // a suspension would otherwise leave a live credential working.
          invalidateApiKeyCache();
          return updated;
        } catch (error) {
          return errorResponse(error, set, "Could not update the participant");
        }
      },
    )

    /* ── Subsidized models ───────────────────────────────────────────────── */

    .get("/programs/:programId/models", async ({ request, params, set }) => {
      try {
        requireTenantScope(ctx.accessResolver(request), "dashboard:read");
        return { models: await store.listModels(params.programId) };
      } catch (error) {
        return errorResponse(error, set, "Could not list subsidized models");
      }
    })

    .post(
      "/programs/:programId/models",
      {
        body: t.Object({
          upstreamModelId: t.String({ minLength: 1, maxLength: 200 }),
          publicModelId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
          displayName: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
          enabled: t.Optional(t.Boolean()),
          maxInputTokens: limitField,
          maxOutputTokens: limitField,
          dailyTokenBudget: limitField,
        }),
      },
      async ({ request, params, body, set }) => {
        try {
          const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
          assertPositiveLimits(body as Record<string, unknown>);
          const program = await store.findProgram(access.tenantId, params.programId);
          if (program === undefined) throw new ConsoleDomainError("not_found", 404, "Program not found");
          const model = await store.addModel({
            programId: program.id,
            upstreamModelId: body.upstreamModelId,
            publicModelId: body.publicModelId ?? body.upstreamModelId,
            displayName: body.displayName ?? null,
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            maxInputTokens: body.maxInputTokens ?? null,
            maxOutputTokens: body.maxOutputTokens ?? null,
            dailyTokenBudget: body.dailyTokenBudget ?? null,
          });
          await store.recordAudit({
            tenantId: access.tenantId,
            programId: program.id,
            actorKind: "admin",
            actorId: access.id,
            action: "model.add",
            targetKind: "model",
            targetId: model.id,
            detail: redactSecrets({ upstreamModelId: model.upstreamModelId }) as Record<string, unknown>,
          });
          return model;
        } catch (error) {
          return errorResponse(error, set, "Could not add the model");
        }
      },
    )

    .patch(
      "/models/:modelId",
      {
        body: t.Object({
          publicModelId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
          displayName: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
          enabled: t.Optional(t.Boolean()),
          maxInputTokens: limitField,
          maxOutputTokens: limitField,
          dailyTokenBudget: limitField,
        }),
      },
      async ({ request, params, body, set }) => {
        try {
          const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
          assertPositiveLimits(body as Record<string, unknown>);
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(body)) if (value !== undefined) patch[key] = value;
          // The program id is needed to scope the update; read it from the
          // caller's programs rather than trusting a body field.
          const programs = await store.listPrograms(access.tenantId);
          let updated;
          for (const program of programs) {
            updated = await store.updateModel(program.id, params.modelId, patch);
            if (updated !== undefined) break;
          }
          if (updated === undefined) throw new ConsoleDomainError("not_found", 404, "Model not found");
          return updated;
        } catch (error) {
          return errorResponse(error, set, "Could not update the model");
        }
      },
    )

    .delete("/programs/:programId/models/:modelId", async ({ request, params, set }) => {
      try {
        requireTenantScope(ctx.accessResolver(request), "dashboard:write");
        const removed = await store.removeModel(params.programId, params.modelId);
        if (!removed) throw new ConsoleDomainError("not_found", 404, "Model not found");
        return { success: true };
      } catch (error) {
        return errorResponse(error, set, "Could not remove the model");
      }
    })

    /* ── Bansos keys ─────────────────────────────────────────────────────── */

    .get("/participants/:participantId/keys", async ({ request, params, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:read");
        const participant = await store.findParticipant(access.tenantId, params.participantId);
        if (participant === undefined) throw new ConsoleDomainError("not_found", 404, "Participant not found");
        const rows = await ctx.db
          .select({
            id: apiKeys.id,
            label: apiKeys.label,
            keyPrefix: apiKeys.keyPrefix,
            enabled: apiKeys.enabled,
            revokedAt: apiKeys.revokedAt,
            createdAt: apiKeys.createdAt,
            requestsPerMinute: apiKeys.requestsPerMinute,
            dailyTokenLimit: apiKeys.dailyTokenLimit,
            lifetimeTokenBudget: apiKeys.lifetimeTokenBudget,
            lifetimeTokensConsumed: apiKeys.lifetimeTokensConsumed,
            maxConcurrentRequests: apiKeys.maxConcurrentRequests,
            expiresAt: apiKeys.expiresAt,
          })
          .from(apiKeys)
          .where(eq(apiKeys.bansosParticipantId, participant.id));
        // The stored prefix is not the secret; it is what the operator sees.
        return { keys: rows };
      } catch (error) {
        return errorResponse(error, set, "Could not list keys");
      }
    })

    .post(
      "/participants/:participantId/keys",
      {
        body: t.Object({
          label: t.Optional(t.String({ maxLength: 120 })),
          expiresAt: t.Optional(t.Union([t.String(), t.Null()])),
          rpm: limitField,
          dailyTokenLimit: limitField,
          monthlyTokenLimit: limitField,
          lifetimeTokenBudget: limitField,
          maxConcurrentRequests: limitField,
        }),
      },
      async ({ request, params, body, set }) => {
        try {
          const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
          assertPositiveLimits(body as Record<string, unknown>);
          const participant = await store.findParticipant(access.tenantId, params.participantId);
          if (participant === undefined) throw new ConsoleDomainError("not_found", 404, "Participant not found");
          const program = await store.findProgram(access.tenantId, participant.programId);
          if (program === undefined) throw new ConsoleDomainError("not_found", 404, "Program not found");

          // Only live keys count against the ceiling. A revoked key is spent —
          // counting it would mean an operator who revokes and reissues
          // eventually locks the participant out of ever having a key again,
          // which is the opposite of what revocation is for.
          const existing = await ctx.db
            .select({ id: apiKeys.id })
            .from(apiKeys)
            .where(
              and(
                eq(apiKeys.bansosParticipantId, participant.id),
                eq(apiKeys.enabled, true),
                isNull(apiKeys.revokedAt),
              ),
            );
          if (existing.length >= program.maxKeysPerParticipant) {
            throw new ConsoleDomainError(
              "key_limit_reached",
              409,
              `This participant may hold at most ${program.maxKeysPerParticipant} keys`,
            );
          }

          // The key's own allowlist is filled from the program's subsidized
          // models. Without it `model_access_mode = 'whitelist'` with an empty
          // list allows *every* model on the gateway — the exact opposite of
          // the intent. The Bansos check in the preparer narrows this further
          // to the program's upstream ids; this list is what the existing
          // model-access rule, `/v1/models` and the strike hint all read.
          const subsidized = await store.listEnabledModels(program.id);
          if (subsidized.length === 0) {
            throw new ConsoleDomainError(
              "no_models",
              409,
              "Add at least one subsidized model before issuing a key",
            );
          }
          const allowedNames = subsidized.flatMap((m) =>
            m.publicModelId === m.upstreamModelId
              ? [m.publicModelId]
              : [m.publicModelId, m.upstreamModelId],
          );

          const generated = generateBansosKey();
          // Every limit column is filled from the resolved policy, because
          // these columns ARE the enforcement: admission reads them from the
          // key snapshot on the dispatch path.
          const limits = resolveBansosLimits({
            program,
            participant,
            key: { rpm: body.rpm ?? null, concurrency: body.maxConcurrentRequests ?? null },
          });

          const row = {
            tenantId: access.tenantId,
            label: body.label?.trim() || `Bansos key — ${participant.displayName}`,
            keyHash: generated.hash,
            keyMode: "bansos" as const,
            keyPrefix: generated.display,
            // An encrypted copy, so the operator who created this key can read
            // it back on the Bansos page. Authentication still uses the hash —
            // this is display only, and no participant-facing endpoint returns
            // it. Without it, a key the operator loses is a key they must
            // revoke and reissue, which is the workflow this feature exists to
            // avoid.
            keyEncrypted: encryptCredential(generated.secret),
            scopes: ["routing:invoke"] as const,
            bansosParticipantId: participant.id,
            // Participant's grant becomes the key's lifetime budget: the key is
            // the thing that actually spends.
            lifetimeTokenBudget: body.lifetimeTokenBudget ?? limits.tokenBudget,
            requestsPerMinute: body.rpm ?? limits.rpm,
            dailyTokenLimit: body.dailyTokenLimit ?? program.dailyTokenBudget,
            monthlyTokenLimit: body.monthlyTokenLimit ?? program.monthlyTokenBudget,
            maxConcurrentRequests: body.maxConcurrentRequests ?? limits.concurrency,
            // Written, not merely accepted. The column did not exist before, so
            // this value was silently dropped and the key never expired.
            ...(body.expiresAt === undefined || body.expiresAt === null
              ? {}
              : { expiresAt: new Date(body.expiresAt) }),
            modelAccessMode: "whitelist" as const,
            modelList: allowedNames,
            enabled: true,
          };
          const inserted = await ctx.db.insert(apiKeys).values(row).returning({ id: apiKeys.id });
          const keyId = inserted[0]?.id;
          if (keyId === undefined) throw new ConsoleDomainError("internal_error", 500, "Key insert returned no row");

          await store.recordAudit({
            tenantId: access.tenantId,
            programId: program.id,
            actorKind: "admin",
            actorId: access.id,
            action: "key.issue",
            targetKind: "key",
            targetId: keyId,
            // The label and the non-secret prefix only. The secret is returned
            // to the caller once and never written anywhere.
            detail: redactSecrets({ label: row.label, prefix: generated.display }) as Record<string, unknown>,
          });

          // Returned exactly once. There is no endpoint that reads it back.
          return { id: keyId, secret: generated.secret, display: generated.display };
        } catch (error) {
          return errorResponse(error, set, "Could not issue the key");
        }
      },
    )

    .post("/keys/:keyId/revoke", async ({ request, params, set }) => {
      try {
        const authorized = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
        const rows = await ctx.db
          .update(apiKeys)
          .set({ enabled: false, revokedAt: new Date() })
          .where(and(eq(apiKeys.id, params.keyId), eq(apiKeys.tenantId, authorized.tenantId)))
          .returning({ id: apiKeys.id });
        if (rows.length === 0) throw new ConsoleDomainError("not_found", 404, "Key not found");
        // Revocation must apply to requests already in flight on another
        // worker, so the auth cache is cleared rather than left to expire.
        invalidateApiKeyCache(params.keyId);
        return { success: true };
      } catch (error) {
        return errorResponse(error, set, "Could not revoke the key");
      }
    })

    // Deleting a participant destroys their keys. The FK cascades, but the
    // store deletes them explicitly first so their auth-cache entries can be
    // dropped — a cascaded row disappears while its cached authorization
    // survives, and the key keeps working until the cache expires.
    .delete("/participants/:participantId", async ({ request, params, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:write");
        // Read the program id *before* the row is gone: the audit entry has to
        // name which program lost a participant, and after the delete there is
        // nothing left to read it from.
        const participant = await store.findParticipant(access.tenantId, params.participantId);
        if (participant === undefined) throw new ConsoleDomainError("not_found", 404, "Participant not found");
        const result = await store.deleteParticipant(access.tenantId, params.participantId);
        if (!result.deleted) throw new ConsoleDomainError("not_found", 404, "Participant not found");
        await store.recordAudit({
          tenantId: access.tenantId,
          programId: participant.programId,
          actorKind: "admin",
          actorId: access.id,
          action: "participant.delete",
          targetKind: "participant",
          targetId: params.participantId,
          detail: { keysDestroyed: result.keys },
        });
        return { success: true, keysDestroyed: result.keys };
      } catch (error) {
        return errorResponse(error, set, "Could not delete the participant");
      }
    })

    /* ── Usage ───────────────────────────────────────────────────────────── */

    // Per-participant consumption, aggregated from the keys they hold.
    //
    // The numbers are read from `api_keys` rather than summed from a request
    // log: `lifetime_tokens_consumed` is the same counter the quota check
    // reads, so a report that disagreed with enforcement would be worse than
    // no report. `requests` is not tracked per key, so it is not claimed here
    // rather than being estimated.
    .get("/programs/:programId/usage", async ({ request, params, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:read");
        const program = await store.findProgram(access.tenantId, params.programId);
        if (program === undefined) throw new ConsoleDomainError("not_found", 404, "Program not found");
        const participants = await store.listParticipants(access.tenantId, program.id);
        const rows = await ctx.db
          .select({
            participantId: apiKeys.bansosParticipantId,
            keyId: apiKeys.id,
            enabled: apiKeys.enabled,
            revokedAt: apiKeys.revokedAt,
            budget: apiKeys.lifetimeTokenBudget,
            consumed: apiKeys.lifetimeTokensConsumed,
          })
          .from(apiKeys)
          .where(eq(apiKeys.tenantId, access.tenantId));

        const byParticipant = new Map<string, { budget: number; consumed: number; liveKeys: number; revokedKeys: number }>();
        for (const row of rows) {
          if (row.participantId === null) continue;
          const entry = byParticipant.get(row.participantId) ?? { budget: 0, consumed: 0, liveKeys: 0, revokedKeys: 0 };
          // Budgets are per key and each key is separately capped, so the
          // participant's ceiling is their sum — not the largest one.
          entry.budget += row.budget ?? 0;
          entry.consumed += row.consumed ?? 0;
          if (row.revokedAt === null && row.enabled) entry.liveKeys += 1;
          else entry.revokedKeys += 1;
          byParticipant.set(row.participantId, entry);
        }

        const usage = participants.map((participant) => {
          const entry = byParticipant.get(participant.id) ?? { budget: 0, consumed: 0, liveKeys: 0, revokedKeys: 0 };
          return {
            participantId: participant.id,
            displayName: participant.displayName,
            status: participant.status,
            tokenBudget: entry.budget,
            tokensConsumed: entry.consumed,
            // `null` when no ceiling was ever configured, so the UI can say
            // "unlimited" instead of rendering 100% used.
            remaining: entry.budget === 0 ? null : Math.max(0, entry.budget - entry.consumed),
            liveKeys: entry.liveKeys,
            revokedKeys: entry.revokedKeys,
          };
        });
        const totals = usage.reduce(
          (acc, u) => ({ budget: acc.budget + u.tokenBudget, consumed: acc.consumed + u.tokensConsumed }),
          { budget: 0, consumed: 0 },
        );
        return { programId: program.id, usage, totals };
      } catch (error) {
        return errorResponse(error, set, "Could not read program usage");
      }
    })

    /* ── Audit ───────────────────────────────────────────────────────────── */

    .get("/programs/:programId/audit", async ({ request, params, set }) => {
      try {
        const access = requireTenantScope(ctx.accessResolver(request), "dashboard:read");
        return { events: await store.listAudit(access.tenantId, params.programId) };
      } catch (error) {
        return errorResponse(error, set, "Could not read the audit log");
      }
    });
}
