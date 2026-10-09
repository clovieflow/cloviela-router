/**
 * Participant portal sessions.
 *
 * ── The exchange ────────────────────────────────────────────────────────────
 * A participant presents their Bansos key once and receives a session token.
 * The key never becomes a cookie: it spends money, and a portal page is a
 * place credentials end up in history, in a referrer header and in a shared
 * screenshot. Only the session token travels afterwards.
 *
 * ── Why the key is re-checked on every request ──────────────────────────────
 * A session row outlives nothing on its own — if an operator revokes the key,
 * the session must stop working immediately. The lookup joins the key and
 * refuses unless it is still enabled and unrevoked, so revocation needs no
 * session sweep and a deleted key takes its sessions with it by cascade.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { ClovielaDatabase } from "../../persistence/postgres";
import {
  apiKeys,
  bansosParticipants,
  bansosPortalSessions,
  bansosPrograms,
  type BansosParticipant,
  type BansosProgram,
} from "../../persistence/schema";
import { hashSecret } from "../../security/crypto";

/** How long a portal session lives. Long enough for a working day. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface IssuedPortalSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly participant: BansosParticipant;
  readonly program: BansosProgram;
}

export class BansosPortalStore {
  constructor(private readonly db: ClovielaDatabase) {}

  /**
   * Exchanges a live Bansos key for a session.
   *
   * Returns `undefined` for every failure — unknown key, revoked key,
   * suspended participant, disabled program — so the caller cannot use the
   * response to learn which of those it was. A sign-in form that distinguishes
   * "wrong key" from "your account is suspended" tells an attacker holding a
   * stolen prefix which of the two they have.
   */
  async openSession(input: {
    readonly keyHash: string;
    readonly ipAddress?: string | undefined;
    readonly userAgent?: string | undefined;
  }): Promise<IssuedPortalSession | undefined> {
    const rows = await this.db
      .select({
        keyId: apiKeys.id,
        participant: bansosParticipants,
        program: bansosPrograms,
      })
      .from(apiKeys)
      .innerJoin(bansosParticipants, eq(apiKeys.bansosParticipantId, bansosParticipants.id))
      .innerJoin(bansosPrograms, eq(bansosParticipants.programId, bansosPrograms.id))
      .where(
        and(
          eq(apiKeys.keyHash, input.keyHash),
          eq(apiKeys.enabled, true),
          isNull(apiKeys.revokedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return undefined;
    if (row.program.enabled !== true) return undefined;
    if (row.participant.status !== "active") return undefined;
    if (row.participant.expiresAt !== null && row.participant.expiresAt < new Date()) return undefined;

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(bansosPortalSessions).values({
      participantId: row.participant.id,
      keyId: row.keyId,
      tenantId: row.participant.tenantId,
      sessionTokenHash: hashSecret(token),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    });

    return { token, expiresAt, participant: row.participant, program: row.program };
  }

  /**
   * Resolves a session token, re-checking the key and the participant.
   *
   * Every condition is in the query rather than applied afterwards so a
   * session that should be dead costs one indexed lookup and no branches.
   */
  async resolveSession(token: string): Promise<
    | {
        readonly participant: BansosParticipant;
        readonly program: BansosProgram;
        readonly keyId: string;
      }
    | undefined
  > {
    const rows = await this.db
      .select({
        keyId: apiKeys.id,
        participant: bansosParticipants,
        program: bansosPrograms,
      })
      .from(bansosPortalSessions)
      .innerJoin(apiKeys, eq(bansosPortalSessions.keyId, apiKeys.id))
      .innerJoin(
        bansosParticipants,
        eq(bansosPortalSessions.participantId, bansosParticipants.id),
      )
      .innerJoin(bansosPrograms, eq(bansosParticipants.programId, bansosPrograms.id))
      .where(
        and(
          eq(bansosPortalSessions.sessionTokenHash, hashSecret(token)),
          gt(bansosPortalSessions.expiresAt, new Date()),
          eq(apiKeys.enabled, true),
          isNull(apiKeys.revokedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return undefined;
    if (row.program.enabled !== true) return undefined;
    if (row.participant.status !== "active") return undefined;
    if (row.participant.expiresAt !== null && row.participant.expiresAt < new Date()) return undefined;

    return { participant: row.participant, program: row.program, keyId: row.keyId };
  }

  /** Ends one session. Used by sign-out. */
  async closeSession(token: string): Promise<void> {
    await this.db
      .delete(bansosPortalSessions)
      .where(eq(bansosPortalSessions.sessionTokenHash, hashSecret(token)));
  }

  /**
   * Ends every session a participant holds.
   *
   * Not called on the revocation path — that path re-checks the key on every
   * request, which is stronger. This exists for an operator who wants the rows
   * gone, and for tests that assert the sweep.
   */
  async closeParticipantSessions(participantId: string): Promise<number> {
    const removed = await this.db
      .delete(bansosPortalSessions)
      .where(eq(bansosPortalSessions.participantId, participantId))
      .returning({ id: bansosPortalSessions.id });
    return removed.length;
  }
}
