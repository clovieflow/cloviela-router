/**
 * Bansos persistence.
 *
 * Every read and write is scoped to the caller's tenant. The participant
 * lookups used by the *portal* are additionally scoped by participant id, so a
 * participant cannot reach another's row even if an id leaks: the query carries
 * the id, it is not merely compared afterwards.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ClovielaDatabase } from "../../persistence/postgres";
import {
  bansosAuditEvents,
  bansosModels,
  bansosParticipants,
  bansosPrograms,
  type BansosModel,
  type BansosParticipant,
  type BansosProgram,
} from "../../persistence/schema";

export interface BansosAuditInput {
  readonly tenantId: string;
  readonly programId?: string | null;
  readonly actorKind: "admin" | "participant" | "system";
  readonly actorId?: string | null;
  readonly action: string;
  readonly targetKind?: string | null;
  readonly targetId?: string | null;
  /** Metadata only. Callers must not pass a key secret. */
  readonly detail?: Record<string, unknown> | null;
}

export class BansosStore {
  constructor(private readonly db: ClovielaDatabase) {}

  /* ── Programs ─────────────────────────────────────────────────────────── */

  async listPrograms(tenantId: string): Promise<BansosProgram[]> {
    return this.db
      .select()
      .from(bansosPrograms)
      .where(eq(bansosPrograms.tenantId, tenantId))
      .orderBy(desc(bansosPrograms.createdAt));
  }

  async findProgram(tenantId: string, programId: string): Promise<BansosProgram | undefined> {
    const rows = await this.db
      .select()
      .from(bansosPrograms)
      .where(and(eq(bansosPrograms.tenantId, tenantId), eq(bansosPrograms.id, programId)))
      .limit(1);
    return rows[0];
  }

  /** Resolves by slug, which is what a public portal URL carries. */
  async findProgramBySlug(tenantId: string, slug: string): Promise<BansosProgram | undefined> {
    const rows = await this.db
      .select()
      .from(bansosPrograms)
      .where(and(eq(bansosPrograms.tenantId, tenantId), eq(bansosPrograms.slug, slug)))
      .limit(1);
    return rows[0];
  }

  async createProgram(values: typeof bansosPrograms.$inferInsert): Promise<BansosProgram> {
    const rows = await this.db.insert(bansosPrograms).values(values).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("program insert returned no row");
    return row;
  }

  async updateProgram(
    tenantId: string,
    programId: string,
    patch: Partial<typeof bansosPrograms.$inferInsert>,
  ): Promise<BansosProgram | undefined> {
    const rows = await this.db
      .update(bansosPrograms)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(bansosPrograms.tenantId, tenantId), eq(bansosPrograms.id, programId)))
      .returning();
    return rows[0];
  }

  async deleteProgram(tenantId: string, programId: string): Promise<boolean> {
    const rows = await this.db
      .delete(bansosPrograms)
      .where(and(eq(bansosPrograms.tenantId, tenantId), eq(bansosPrograms.id, programId)))
      .returning({ id: bansosPrograms.id });
    return rows.length > 0;
  }

  /* ── Participants ─────────────────────────────────────────────────────── */

  async listParticipants(
    tenantId: string,
    programId: string,
  ): Promise<BansosParticipant[]> {
    return this.db
      .select()
      .from(bansosParticipants)
      .where(
        and(
          eq(bansosParticipants.tenantId, tenantId),
          eq(bansosParticipants.programId, programId),
        ),
      )
      .orderBy(desc(bansosParticipants.createdAt));
  }

  async findParticipant(
    tenantId: string,
    participantId: string,
  ): Promise<BansosParticipant | undefined> {
    const rows = await this.db
      .select()
      .from(bansosParticipants)
      .where(
        and(
          eq(bansosParticipants.tenantId, tenantId),
          eq(bansosParticipants.id, participantId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The portal's own lookup. Scoped by participant id *and* tenant, so an id
   * that leaks across tenants still resolves to nothing.
   */
  async findParticipantForPortal(
    tenantId: string,
    participantId: string,
  ): Promise<BansosParticipant | undefined> {
    return this.findParticipant(tenantId, participantId);
  }

  async createParticipant(
    values: typeof bansosParticipants.$inferInsert,
  ): Promise<BansosParticipant> {
    const rows = await this.db.insert(bansosParticipants).values(values).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("participant insert returned no row");
    return row;
  }

  async updateParticipant(
    tenantId: string,
    participantId: string,
    patch: Partial<typeof bansosParticipants.$inferInsert>,
  ): Promise<BansosParticipant | undefined> {
    const rows = await this.db
      .update(bansosParticipants)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(bansosParticipants.tenantId, tenantId),
          eq(bansosParticipants.id, participantId),
        ),
      )
      .returning();
    return rows[0];
  }

  async countParticipants(programId: string): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(bansosParticipants)
      .where(eq(bansosParticipants.programId, programId));
    return rows[0]?.n ?? 0;
  }

  /** Active participants, for the program's max-participants ceiling. */
  async countActiveParticipants(programId: string): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(bansosParticipants)
      .where(
        and(
          eq(bansosParticipants.programId, programId),
          inArray(bansosParticipants.status, ["active", "pending"]),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  /* ── Subsidized models ────────────────────────────────────────────────── */

  async listModels(programId: string): Promise<BansosModel[]> {
    return this.db
      .select()
      .from(bansosModels)
      .where(eq(bansosModels.programId, programId))
      .orderBy(bansosModels.publicModelId);
  }

  async listEnabledModels(programId: string): Promise<BansosModel[]> {
    return this.db
      .select()
      .from(bansosModels)
      .where(and(eq(bansosModels.programId, programId), eq(bansosModels.enabled, true)))
      .orderBy(bansosModels.publicModelId);
  }

  /**
   * Resolves what a client asked for to what the program subsidizes.
   *
   * Both the public id and the upstream id are accepted, so a client that uses
   * either name reaches the same row — and nothing outside this table resolves
   * at all.
   */
  async findModelByAnyId(
    programId: string,
    modelId: string,
  ): Promise<BansosModel | undefined> {
    const rows = await this.db
      .select()
      .from(bansosModels)
      .where(
        and(
          eq(bansosModels.programId, programId),
          sql`(${bansosModels.publicModelId} = ${modelId} OR ${bansosModels.upstreamModelId} = ${modelId})`,
        ),
      )
      .limit(1);
    return rows[0];
  }

  async addModel(values: typeof bansosModels.$inferInsert): Promise<BansosModel> {
    const rows = await this.db.insert(bansosModels).values(values).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("model insert returned no row");
    return row;
  }

  async updateModel(
    programId: string,
    modelId: string,
    patch: Partial<typeof bansosModels.$inferInsert>,
  ): Promise<BansosModel | undefined> {
    const rows = await this.db
      .update(bansosModels)
      .set(patch)
      .where(and(eq(bansosModels.programId, programId), eq(bansosModels.id, modelId)))
      .returning();
    return rows[0];
  }

  async removeModel(programId: string, modelId: string): Promise<boolean> {
    const rows = await this.db
      .delete(bansosModels)
      .where(and(eq(bansosModels.programId, programId), eq(bansosModels.id, modelId)))
      .returning({ id: bansosModels.id });
    return rows.length > 0;
  }

  /* ── Audit ────────────────────────────────────────────────────────────── */

  async recordAudit(input: BansosAuditInput): Promise<void> {
    await this.db.insert(bansosAuditEvents).values({
      tenantId: input.tenantId,
      programId: input.programId ?? null,
      actorKind: input.actorKind,
      actorId: input.actorId ?? null,
      action: input.action,
      targetKind: input.targetKind ?? null,
      targetId: input.targetId ?? null,
      detail: input.detail ?? null,
    });
  }

  async listAudit(tenantId: string, programId: string, limit = 100): Promise<unknown[]> {
    return this.db
      .select()
      .from(bansosAuditEvents)
      .where(
        and(
          eq(bansosAuditEvents.tenantId, tenantId),
          eq(bansosAuditEvents.programId, programId),
        ),
      )
      .orderBy(desc(bansosAuditEvents.createdAt))
      .limit(Math.min(limit, 500));
  }
}
