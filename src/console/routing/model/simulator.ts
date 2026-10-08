// Route simulator: read-only evaluation of the canonical routing pipeline.
//
// This module owns the *projection* only. Every verdict it returns comes from
// `RoutingEngine.simulate`, which reuses the same alias resolver, eligibility
// evaluator, ordering rules, and rotation state the live dispatcher uses — so
// the simulator cannot disagree with production. A second eligibility
// implementation here would be exactly the drift this endpoint exists to
// prevent.
//
// The response shape is the dashboard's frozen contract
// (`dashboard/src/hooks/route-simulator.ts`): camelCase, `readOnly: true`, and
// `selectedIsDeterministic` false whenever a rotation cursor or fusion decides
// the first candidate. The console never presents a winner in that case.
import type { AccessDecision } from "../../../security/access-control";
import type { RouteCandidate, RouteSnapshot, RouteSimulationResult } from "../../../transport/routing/route-model";
import { ConsoleDomainError, requireTenantScope } from "../../shared/errors";
import type { RouteSimulatorConfig, SimulatorQuotaResponse, SimulatorRequestBody, SimulatorResponse } from "./contracts";
import { SIMULATOR_ENDPOINTS, type SimulatorEndpoint } from "../../../transport/routing/router";

/** Reason codes the dashboard renders with a stable tone. */
const REASON_MESSAGE: Readonly<Record<string, string>> = {
  healthy: "Eligible and healthy.",
  cooldown: "Cooling down after a recent failure; ordered behind healthy candidates.",
  cooldown_hard: "Excluded: a hard cooldown is still in effect.",
  model_cooldown: "Excluded: this exact account+model pair is cooling down.",
  credit_floor_reached: "Excluded: remaining balance is at or below the configured floor.",
  quota_exhausted: "Excluded: the account's quota is exhausted.",
  locked: "Excluded: the account is locked.",
  disabled: "Excluded: an operator disabled this account.",
  service_kind_mismatch: "This model is not served on the requested endpoint family.",
};

function reasonMessage(code: string): string {
  return REASON_MESSAGE[code] ?? code;
}

function isSimulatorEndpoint(value: unknown): value is SimulatorEndpoint {
  return typeof value === "string" && (SIMULATOR_ENDPOINTS as readonly string[]).includes(value);
}

/** Reads `{ model, endpoint? }`, rejecting anything the contract does not cover. */
export function parseSimulatorRequest(body: unknown): SimulatorRequestBody {
  if (typeof body !== "object" || body === null)
    throw new ConsoleDomainError("invalid_request", 422, "Request body must be an object");
  const record = body as Record<string, unknown>;
  const model = typeof record.model === "string" ? record.model.trim() : "";
  if (model.length === 0)
    throw new ConsoleDomainError("invalid_request", 422, "model is required");
  if (record.endpoint !== undefined && !isSimulatorEndpoint(record.endpoint))
    throw new ConsoleDomainError(
      "invalid_request",
      422,
      `endpoint must be one of: ${SIMULATOR_ENDPOINTS.join(", ")}`,
    );
  return {
    model,
    endpoint: record.endpoint === undefined ? "chat.completions" : record.endpoint,
  };
}

function projectCandidate(
  entry: RouteSimulationResult["candidates"][number],
  priority: number,
): SimulatorResponse["candidates"][number] {
  const candidate = entry.candidate;
  const reasons = [
    entry.endpoint_supported
      ? { code: entry.reason, message: reasonMessage(entry.reason) }
      : {
          code: "service_kind_mismatch",
          message: `${reasonMessage("service_kind_mismatch")} (this model serves '${candidate.service_kind ?? "llm"}').`,
        },
  ];
  const quota: SimulatorQuotaResponse | undefined =
    candidate.credit_limit_enabled === undefined && candidate.credit_limit === undefined
      ? undefined
      : {
          status:
            candidate.last_remaining_credit === undefined &&
            candidate.last_remaining_percent === undefined
              ? "unknown"
              : entry.reason === "credit_floor_reached"
                ? "below_floor"
                : "ok",
          ...(candidate.credit_limit_enabled === undefined
            ? {}
            : { creditLimitEnabled: candidate.credit_limit_enabled }),
          ...(candidate.credit_limit === undefined ? {} : { creditLimit: candidate.credit_limit }),
          ...(candidate.last_remaining_credit === undefined ||
          candidate.last_remaining_credit === null
            ? {}
            : { lastRemainingCredit: candidate.last_remaining_credit }),
          ...(candidate.last_remaining_percent === undefined
            ? {}
            : { lastRemainingPercent: candidate.last_remaining_percent }),
        };
  const providerRouting =
    entry.provider_routing === undefined
      ? undefined
      : {
          strategy: entry.provider_routing.strategy,
          rotateCount: entry.provider_routing.rotateCount,
          enabled: entry.provider_routing.enabled,
          bypassProxy: entry.provider_routing.bypassProxy,
        };
  return {
    providerId: candidate.provider_id,
    providerLabel: candidate.provider_id,
    modelId: candidate.model_id,
    ...(candidate.provider_account_id === undefined
      ? {}
      : { accountId: candidate.provider_account_id }),
    ...(candidate.provider_account_label === undefined
      ? {}
      : { accountLabel: candidate.provider_account_label }),
    wireFamily: candidate.wire_family,
    serviceKind: candidate.service_kind ?? "llm",
    upstreamEndpoint: candidate.endpoint,
    eligible: entry.eligible,
    reasons,
    priority,
    ...(candidate.cooldown_kind === undefined ? {} : { cooldownKind: candidate.cooldown_kind }),
    ...(candidate.cooldown_until === undefined ? {} : { cooldownUntil: candidate.cooldown_until }),
    ...(candidate.model_cooldown_until === undefined
      ? {}
      : { modelCooldownUntil: candidate.model_cooldown_until }),
    ...(candidate.max_inflight === undefined ? {} : { maxInflight: candidate.max_inflight }),
    ...(quota === undefined ? {} : { quota }),
    ...(providerRouting === undefined ? {} : { providerRouting }),
  };
}

/**
 * Projects the engine's read-only result into the dashboard's contract.
 *
 * `selected` is reported only when the engine says a live request would take
 * that exact candidate; `selectedIsDeterministic` mirrors that guarantee rather
 * than being derived here, so the two can never disagree.
 */
export function projectSimulation(result: RouteSimulationResult): SimulatorResponse {
  const selected = result.selected;
  return {
    model: result.requested_model,
    resolvedModel: result.resolved_model,
    resolutionChain: result.resolution_chain,
    revision: result.revision,
    readOnly: true,
    strategy: result.strategy,
    strategySource: result.strategy_source,
    rotationActive: result.rotation_active,
    outcome: result.outcome,
    candidates: result.candidates.map((entry, index) => projectCandidate(entry, index)),
    selected:
      selected === undefined
        ? null
        : {
            providerId: selected.provider_id,
            modelId: selected.model_id,
            ...(selected.provider_account_id === undefined
              ? {}
              : { accountId: selected.provider_account_id }),
          },
    selectedIsDeterministic: selected !== undefined,
    ...(result.fusion === undefined
      ? {}
      : { fusion: { panel: result.fusion.panel, judge: result.fusion.judge } }),
    unmatchedMembers: result.unmatched_members,
    notes: buildNotes(result),
  };
}

function buildNotes(result: RouteSimulationResult): readonly string[] {
  const notes: string[] = [];
  if (result.rotation_active)
    notes.push(
      "More than one candidate can serve this request; the first is chosen at dispatch time by the rotation cursor.",
    );
  if (result.outcome === "accounts_rate_limited")
    notes.push("Every eligible account is rate limited or cooling down.");
  if (result.outcome === "accounts_unavailable")
    notes.push("No account serving this model is currently usable.");
  if (result.outcome === "service_kind_unsupported")
    notes.push(
      `No candidate serves the '${result.endpoint_service_kind}' service for this model.`,
    );
  if (result.unmatched_members.length > 0)
    notes.push("Some combo members matched no candidate and were not evaluated.");
  notes.push("Nothing was dispatched, reserved, or decrypted to produce this result.");
  return notes;
}

export function createRouteSimulatorOperations(deps: RouteSimulatorConfig) {
  return {
    async simulate(
      access: AccessDecision | undefined,
      body: unknown,
    ): Promise<SimulatorResponse> {
      const authorized = requireTenantScope(access, "dashboard:read");
      const request = parseSimulatorRequest(body);
      const snapshot: RouteSnapshot = await deps.snapshotService.getSnapshot();
      const result = await deps.engine.simulate({
        requestedModel: request.model,
        endpoint: request.endpoint,
        snapshot,
        tenantId: authorized.tenantId,
      });
      return projectSimulation(result);
    },
  };
}

/** Candidate rows the console reads, re-exported so the route file stays thin. */
export type { RouteCandidate };
