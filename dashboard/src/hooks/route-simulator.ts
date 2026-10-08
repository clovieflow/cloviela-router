/**
 * Route simulator client.
 *
 * ── What this calls, and what it refuses to do ─────────────────────────────
 * It calls the gateway's read-only evaluation endpoint and renders the answer.
 * It deliberately does NOT re-implement routing in the browser: a second
 * eligibility algorithm here would be a copy that drifts from the one that
 * actually dispatches, and a simulator that disagrees with production is worse
 * than no simulator. If the endpoint is absent, the page says so and shows the
 * path it called — it never fabricates a plausible-looking plan.
 *
 * ── Contract (frozen by the backend owner; names will not change) ──────────
 *   POST /console/api/routing/simulate   (dashboard:read; CSRF handled by
 *   `consoleRequest` when a session cookie is present)
 *   { model: string, endpoint?: EndpointFamily }
 *   → SimulatorResult (see below)
 *
 * The parser validates rather than casts. Two rules are load-bearing:
 *   - a candidate without `eligible:true` is NOT eligible (assuming eligible
 *     would turn a malformed response into a reassuring green list);
 *   - a missing `selectedIsDeterministic` means "not guaranteed", so the page
 *     shows the rotation caveat instead of promising a dispatch.
 */
import { useMutation } from "@tanstack/react-query";
import { consoleRequest, isRecord, type ApiErrorShape } from "../data/api";

/** Endpoint families the gateway routes; sent verbatim. */
export const SIMULATOR_ENDPOINTS = [
  "chat.completions",
  "responses",
  "messages",
  "completions",
  "search",
  "systemone",
] as const;

export type SimulatorEndpoint = (typeof SIMULATOR_ENDPOINTS)[number];

/**
 * Canonical eligibility verdict codes.
 *
 * Kept as a closed union so the page can attach a stable tone to each cause
 * without string-matching backend prose. `service_kind_mismatch` is the
 * simulator's own added layer — a candidate that cannot serve this endpoint
 * family.
 */
export const SIMULATOR_REASON_CODES = [
  "healthy",
  "cooldown",
  "cooldown_hard",
  "model_cooldown",
  "credit_floor_reached",
  "locked",
  "disabled",
  "service_kind_mismatch",
] as const;

export type SimulatorReasonCode = (typeof SIMULATOR_REASON_CODES)[number];

/** Why the gateway cannot dispatch at all right now. */
export const SIMULATOR_OUTCOMES = [
  "dispatchable",
  "accounts_unavailable",
  "accounts_rate_limited",
  "service_kind_unsupported",
] as const;

export type SimulatorOutcome = (typeof SIMULATOR_OUTCOMES)[number];

export type SimulatorStrategy = "fallback" | "round_robin" | "fusion";

export interface SimulatorReason {
  /** Canonical code; unknown values are preserved as-is for forward compat. */
  readonly code: string;
  /** Backend-owned message, rendered verbatim (see the hook's locale note). */
  readonly message: string;
}

export interface SimulatorQuota {
  readonly status: "ok" | "below_floor" | "unknown" | "disabled" | string;
  readonly creditLimitEnabled?: boolean;
  readonly creditLimit?: number;
  readonly lastRemainingCredit?: number;
  readonly lastRemainingPercent?: number | null;
}

export interface SimulatorProviderRouting {
  readonly strategy?: string;
  readonly rotateCount?: number;
  readonly enabled?: boolean;
  readonly bypassProxy?: boolean;
}

export interface SimulatorCandidate {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly modelId: string;
  /** Absent for credential-less routes. */
  readonly accountId?: string;
  /** Operator-facing account label; never a credential. */
  readonly accountLabel?: string;
  readonly wireFamily?: string;
  readonly serviceKind?: string;
  readonly upstreamEndpoint?: string;
  readonly eligible: boolean;
  readonly reasons: readonly SimulatorReason[];
  /** 0-based position in the canonical (healthy-before-cooling) order. */
  readonly priority: number;
  readonly cooldownKind?: string;
  readonly cooldownUntil?: string;
  readonly modelCooldownUntil?: string;
  readonly maxInflight?: number;
  readonly quota?: SimulatorQuota;
  readonly providerRouting?: SimulatorProviderRouting;
}

export interface SimulatorSelected {
  readonly providerId: string;
  readonly modelId?: string;
  readonly accountId?: string;
}

export interface SimulatorResult {
  readonly model: string;
  readonly resolvedModel?: string;
  readonly resolutionChain: readonly string[];
  readonly endpoint?: string;
  readonly surface?: string;
  readonly revision?: number;
  readonly readOnly: boolean;
  readonly strategy?: SimulatorStrategy;
  readonly strategySource?: "combo" | "provider" | "default" | string;
  /** True when a rotation cursor decides the FIRST candidate at dispatch time. */
  readonly rotationActive: boolean;
  readonly outcome?: SimulatorOutcome;
  readonly candidates: readonly SimulatorCandidate[];
  readonly selected: SimulatorSelected | null;
  /**
   * False under rotation or fusion. The page must not present a winner when
   * this is false — a highlighted row would read as a promise.
   */
  readonly selectedIsDeterministic: boolean;
  readonly fusion?: { readonly panel: readonly string[]; readonly judge?: string };
  /** Combo members that produced no candidate row; a warning when non-empty. */
  readonly unmatchedMembers: readonly string[];
  readonly notes: readonly string[];
}

export interface SimulatorRequest {
  readonly model: string;
  readonly endpoint?: string;
}

const SIMULATOR_PATH = "/routing/simulate";

function parseReasons(value: unknown): readonly SimulatorReason[] {
  if (!Array.isArray(value)) return [];
  const reasons: SimulatorReason[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      reasons.push({ code: entry, message: entry });
      continue;
    }
    if (!isRecord(entry)) continue;
    const code = typeof entry.code === "string" ? entry.code : undefined;
    const message = typeof entry.message === "string" ? entry.message : undefined;
    if (code === undefined && message === undefined) continue;
    reasons.push({ code: code ?? message ?? "", message: message ?? code ?? "" });
  }
  return reasons;
}

function parseQuota(value: unknown): SimulatorQuota | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.status !== "string") return undefined;
  return {
    status: value.status,
    ...(typeof value.creditLimitEnabled === "boolean"
      ? { creditLimitEnabled: value.creditLimitEnabled }
      : {}),
    ...(typeof value.creditLimit === "number" ? { creditLimit: value.creditLimit } : {}),
    ...(typeof value.lastRemainingCredit === "number"
      ? { lastRemainingCredit: value.lastRemainingCredit }
      : {}),
    ...(value.lastRemainingPercent === null || typeof value.lastRemainingPercent === "number"
      ? { lastRemainingPercent: value.lastRemainingPercent as number | null }
      : {}),
  };
}

function parseProviderRouting(value: unknown): SimulatorProviderRouting | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.strategy === "string" ? { strategy: value.strategy } : {}),
    ...(typeof value.rotateCount === "number" ? { rotateCount: value.rotateCount } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(typeof value.bypassProxy === "boolean" ? { bypassProxy: value.bypassProxy } : {}),
  };
}

function parseCandidate(value: unknown, index: number): SimulatorCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = typeof value.providerId === "string" ? value.providerId : undefined;
  if (providerId === undefined) return undefined;
  const quota = parseQuota(value.quota);
  const providerRouting = parseProviderRouting(value.providerRouting);
  return {
    providerId,
    providerLabel: typeof value.providerLabel === "string" ? value.providerLabel : providerId,
    modelId: typeof value.modelId === "string" ? value.modelId : "—",
    ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    ...(typeof value.accountLabel === "string" ? { accountLabel: value.accountLabel } : {}),
    ...(typeof value.wireFamily === "string" ? { wireFamily: value.wireFamily } : {}),
    ...(typeof value.serviceKind === "string" ? { serviceKind: value.serviceKind } : {}),
    ...(typeof value.upstreamEndpoint === "string"
      ? { upstreamEndpoint: value.upstreamEndpoint }
      : {}),
    // Absent means NOT eligible. See the module header.
    eligible: value.eligible === true,
    reasons: parseReasons(value.reasons),
    // The backend sends a 0-based priority; fall back to array position so a
    // missing field still renders a stable order instead of collapsing to 0.
    priority: typeof value.priority === "number" ? value.priority : index,
    ...(typeof value.cooldownKind === "string" ? { cooldownKind: value.cooldownKind } : {}),
    ...(typeof value.cooldownUntil === "string" ? { cooldownUntil: value.cooldownUntil } : {}),
    ...(typeof value.modelCooldownUntil === "string"
      ? { modelCooldownUntil: value.modelCooldownUntil }
      : {}),
    ...(typeof value.maxInflight === "number" ? { maxInflight: value.maxInflight } : {}),
    ...(quota ? { quota } : {}),
    ...(providerRouting ? { providerRouting } : {}),
  };
}

function parseSelected(value: unknown): SimulatorSelected | null {
  if (!isRecord(value)) return null;
  const providerId = typeof value.providerId === "string" ? value.providerId : undefined;
  if (providerId === undefined) return null;
  return {
    providerId,
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
  };
}

function parseSimulatorResult(value: unknown): SimulatorResult {
  if (!isRecord(value)) {
    throw {
      status: 502,
      code: "invalid_response",
      message: "The simulator returned a response that is not an object.",
    } satisfies ApiErrorShape;
  }
  const model = typeof value.model === "string" ? value.model : undefined;
  if (model === undefined) {
    throw {
      status: 502,
      code: "invalid_response",
      message: "The simulator response is missing the model it evaluated.",
    } satisfies ApiErrorShape;
  }
  const candidates = Array.isArray(value.candidates)
    ? value.candidates
        .map((row, index) => parseCandidate(row, index))
        .filter((row): row is SimulatorCandidate => row !== undefined)
    : [];
  const rotationActive = value.rotationActive === true;
  const strategy = value.strategy;
  return {
    model,
    ...(typeof value.resolvedModel === "string" ? { resolvedModel: value.resolvedModel } : {}),
    resolutionChain: Array.isArray(value.resolutionChain)
      ? value.resolutionChain.filter((step): step is string => typeof step === "string")
      : [],
    ...(typeof value.endpoint === "string" ? { endpoint: value.endpoint } : {}),
    ...(typeof value.surface === "string" ? { surface: value.surface } : {}),
    ...(typeof value.revision === "number" ? { revision: value.revision } : {}),
    readOnly: value.readOnly === true,
    ...(strategy === "fallback" || strategy === "round_robin" || strategy === "fusion"
      ? { strategy }
      : {}),
    ...(typeof value.strategySource === "string" ? { strategySource: value.strategySource } : {}),
    rotationActive,
    ...(typeof value.outcome === "string" ? { outcome: value.outcome as SimulatorOutcome } : {}),
    candidates,
    selected: parseSelected(value.selected),
    // Absent or false => not guaranteed. The page then shows the rotation
    // caveat rather than a winner.
    selectedIsDeterministic: value.selectedIsDeterministic === true,
    ...(isRecord(value.fusion)
      ? {
          fusion: {
            panel: Array.isArray(value.fusion.panel)
              ? value.fusion.panel.filter((entry): entry is string => typeof entry === "string")
              : [],
            ...(typeof value.fusion.judge === "string" ? { judge: value.fusion.judge } : {}),
          },
        }
      : {}),
    unmatchedMembers: Array.isArray(value.unmatchedMembers)
      ? value.unmatchedMembers.filter((entry): entry is string => typeof entry === "string")
      : [],
    notes: Array.isArray(value.notes)
      ? value.notes.filter((note): note is string => typeof note === "string")
      : [],
  };
}

/**
 * True when the gateway has no simulator mounted.
 *
 * A 404 or 405 is the honest signal that the endpoint is not part of this
 * build. Any other failure (500, network, malformed body) is a real error and
 * must not be presented as "feature missing", or a broken route would look
 * like an unimplemented one.
 */
export function isSimulatorUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const { status } = error;
  return status === 404 || status === 405;
}

export function useRouteSimulation() {
  return useMutation<SimulatorResult, ApiErrorShape, SimulatorRequest>({
    mutationFn: async (request) =>
      parseSimulatorResult(
        await consoleRequest<unknown>(SIMULATOR_PATH, {
          method: "POST",
          body: JSON.stringify({
            model: request.model,
            ...(request.endpoint ? { endpoint: request.endpoint } : {}),
          }),
        }),
      ),
  });
}

/** The path the UI calls, surfaced to the operator when it is missing. */
export const SIMULATOR_ENDPOINT_PATH = `/console/api${SIMULATOR_PATH}`;
