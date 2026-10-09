/**
 * Wire contracts for the Bansos administrator surface.
 *
 * ── Why these are hand-written ──────────────────────────────────────────────
 * The console asserts at the boundary rather than trusting a cast, so each
 * shape here is paired with a guard in `hooks/bansos.ts`. A field the server
 * adds later is simply not read; a field it stops sending is a guard failure
 * rather than `undefined` flowing into a component as if it were a number.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No secret ever appears in a list response. `secret` exists only on the
 * one-time issue response, and it is the only place a credential is readable.
 */

/** The participant lifecycle the gateway enforces. */
export type BansosParticipantStatus = "active" | "suspended" | "expired" | "pending";

/** How a participant may join a program. */
export type BansosEnrollmentMode = "closed" | "invite" | "request" | "open";

export interface BansosProgram {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly adminNotes: string | null;
  readonly enabled: boolean;
  readonly enrollmentMode: BansosEnrollmentMode;
  readonly autoApprove: boolean;
  readonly maxParticipants: number | null;
  readonly termsRequired: boolean;
  readonly termsText: string | null;
  readonly globalRpm: number | null;
  readonly globalConcurrency: number | null;
  readonly globalTokenBudget: number | null;
  readonly dailyTokenBudget: number | null;
  readonly monthlyTokenBudget: number | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly maxRequestBytes: number | null;
  readonly maxRequestDurationMs: number | null;
  readonly maxStreamDurationMs: number | null;
  readonly maxKeysPerParticipant: number;
  readonly defaultTokenAllowance: number | null;
  readonly defaultRpm: number | null;
  readonly defaultConcurrency: number | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly providerId: string | null;
  readonly providerAccountIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BansosParticipant {
  readonly id: string;
  readonly programId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly externalRef: string | null;
  readonly status: BansosParticipantStatus;
  readonly adminNotes: string | null;
  readonly tokenAllowance: number | null;
  readonly rpm: number | null;
  readonly concurrency: number | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BansosModel {
  readonly id: string;
  readonly programId: string;
  readonly upstreamModelId: string;
  readonly publicModelId: string;
  readonly enabled: boolean;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A key as the administrator sees it.
 *
 * `keyPrefix` is the non-secret fragment stored at issue time. The secret
 * itself is not recoverable, which is why there is no `secret` field here.
 */
export interface BansosKey {
  readonly id: string;
  readonly label: string;
  readonly keyPrefix: string | null;
  readonly enabled: boolean;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly requestsPerMinute: number | null;
  readonly dailyTokenLimit: number | null;
  readonly lifetimeTokenBudget: number | null;
  readonly lifetimeTokensConsumed: number | null;
  readonly maxConcurrentRequests: number | null;
}

/** One-time response from issuing a key. The secret is never sent again. */
export interface BansosIssuedKey {
  readonly id: string;
  readonly label: string;
  readonly display: string;
  readonly secret: string;
}

export interface BansosParticipantUsage {
  readonly participantId: string;
  readonly displayName: string;
  readonly status: BansosParticipantStatus;
  readonly tokenBudget: number;
  readonly tokensConsumed: number;
  /** `null` when no ceiling was configured, so the UI can say "unlimited". */
  readonly remaining: number | null;
  readonly liveKeys: number;
  readonly revokedKeys: number;
}

export interface BansosProgramUsage {
  readonly programId: string;
  readonly usage: readonly BansosParticipantUsage[];
  readonly totals: { readonly budget: number; readonly consumed: number };
}

export interface BansosAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly programId: string | null;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly detail: unknown;
  readonly createdAt: string;
}

/** Writable fields when creating a program. */
export interface BansosProgramInput {
  name: string;
  slug: string;
  description?: string | null;
  /**
   * Takes the whole program offline. A disabled program refuses every
   * participant at the policy check, before any model or quota logic runs, so
   * this is the switch an operator reaches for during an incident.
   */
  enabled?: boolean;
  enrollmentMode?: BansosEnrollmentMode;
  autoApprove?: boolean;
  maxParticipants?: number | null;
  termsRequired?: boolean;
  termsText?: string | null;
  globalRpm?: number | null;
  globalConcurrency?: number | null;
  globalTokenBudget?: number | null;
  dailyTokenBudget?: number | null;
  monthlyTokenBudget?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  maxRequestBytes?: number | null;
  maxRequestDurationMs?: number | null;
  maxStreamDurationMs?: number | null;
  maxKeysPerParticipant?: number | null;
  defaultTokenAllowance?: number | null;
  defaultRpm?: number | null;
  defaultConcurrency?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  providerId?: string | null;
  providerAccountIds?: string[];
}

export interface BansosParticipantInput {
  displayName: string;
  email?: string | null;
  externalRef?: string | null;
  status?: BansosParticipantStatus;
  adminNotes?: string | null;
  tokenAllowance?: number | null;
  rpm?: number | null;
  concurrency?: number | null;
  expiresAt?: string | null;
}

export interface BansosModelInput {
  upstreamModelId: string;
  publicModelId: string;
  enabled?: boolean;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  notes?: string | null;
}

export interface BansosKeyInput {
  label?: string;
  expiresAt?: string | null;
  rpm?: number | null;
  dailyTokenLimit?: number | null;
  monthlyTokenLimit?: number | null;
  lifetimeTokenBudget?: number | null;
  maxConcurrentRequests?: number | null;
}
