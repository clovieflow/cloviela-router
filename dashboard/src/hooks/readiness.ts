/**
 * Readiness data for the onboarding journey and the Overview readiness panel.
 *
 * ── One owner, with a bounded transition fallback ──────────────────────────
 * `GET /console/api/system/readiness` is the canonical owner of the five-step
 * checklist and returns exactly:
 *   { ready, generatedAt, checks: [{ id, ok, detail, remediation? }] }
 * with ids `admin_created | provider_connected | model_available |
 * api_key_issued | first_request_seen`, in that order.
 *
 * This hook calls it first. The client-side composition from `/providers`,
 * `/providers/models/flat`, `/api-keys` and `/system/usage/summary` is kept
 * ONLY as a transition fallback, and only for a 404/405 — the honest signal
 * that this gateway predates the endpoint. Any other failure (500, network,
 * malformed body) is a real error and surfaces as one, because a broken
 * readiness route must not look like an unimplemented one.
 *
 * The fallback is deleted once the route is confirmed mounted everywhere; it
 * exists so the onboarding screen is usable during rollout, not as a second
 * permanent owner of the same five facts.
 *
 * Every count is measured. Nothing is hardcoded, and an unreachable source
 * reports `unknown` for its step rather than guessing zero — an endpoint that
 * failed must not render as "you have no providers".
 */
import { useQuery } from "@tanstack/react-query";
import { consoleRequest, isRecord } from "../data/api";
import type { ApiErrorShape } from "../data/api";
import { queryKeys } from "../data/query-keys";
import { DASHBOARD_QUERY_OPTIONS } from "../data/query-policy";
import {
  assertApiKeys,
  assertFlatModelCatalog,
  assertProviders,
  assertUsageSummary,
  querySignal,
} from "./common";
import type { MessageKey } from "../shared/i18n";

export type ReadinessState = "done" | "todo" | "unknown";

export type ReadinessStepId =
  | "admin_created"
  | "provider_connected"
  | "model_available"
  | "api_key_issued"
  | "first_request_seen";

/** Canonical order; the endpoint sends these ids in exactly this sequence. */
const READINESS_STEP_ORDER: readonly ReadinessStepId[] = [
  "admin_created",
  "provider_connected",
  "model_available",
  "api_key_issued",
  "first_request_seen",
];

const STEP_TITLE_KEYS: Readonly<Record<ReadinessStepId, MessageKey>> = {
  admin_created: "onboarding.step.admin",
  provider_connected: "onboarding.step.provider",
  model_available: "onboarding.step.model",
  api_key_issued: "onboarding.step.key",
  first_request_seen: "onboarding.step.request",
};

const STEP_ROUTES: Readonly<Record<ReadinessStepId, string>> = {
  admin_created: "/settings",
  provider_connected: "/providers",
  model_available: "/models",
  api_key_issued: "/api-keys",
  first_request_seen: "/usage",
};

/**
 * Steps that gate usability. `first_request_seen` is not one: a gateway with a
 * key issued is usable, and whether a client has called it yet is the
 * operator's next action rather than a setup requirement.
 */
const STEP_REQUIRED: Readonly<Record<ReadinessStepId, boolean>> = {
  admin_created: true,
  provider_connected: true,
  model_available: true,
  api_key_issued: true,
  first_request_seen: false,
};

export interface ReadinessStep {
  readonly id: ReadinessStepId;
  readonly titleKey: MessageKey;
  /** Backend-owned detail string; rendered verbatim (see the module note). */
  readonly detail?: string;
  /** Backend-owned remediation string, present only when the check failed. */
  readonly remediation?: string;
  readonly state: ReadinessState;
  /** Where the operator goes to satisfy this step. */
  readonly route: string;
  readonly required: boolean;
}

export interface ReadinessReport {
  readonly steps: readonly ReadinessStep[];
  readonly completedRequired: number;
  readonly totalRequired: number;
  readonly allRequiredDone: boolean;
  readonly ready: boolean;
  readonly generatedAt?: string;
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** True when the report came from the fallback composition, not the endpoint. */
  readonly usingFallback: boolean;
  readonly refresh: () => void;
  readonly isRefreshing: boolean;
}

interface ReadinessCheck {
  readonly id: ReadinessStepId;
  readonly ok: boolean;
  readonly detail?: string;
  readonly remediation?: string;
}

interface ReadinessResponse {
  readonly ready: boolean;
  readonly generatedAt?: string;
  readonly checks: readonly ReadinessCheck[];
}

/** 404/405 means the route is not mounted; anything else is a real failure. */
function isRouteMissing(error: unknown): boolean {
  if (!isRecord(error) || !("status" in error)) return false;
  return error.status === 404 || error.status === 405;
}

function parseReadiness(value: unknown): ReadinessResponse {
  if (!isRecord(value) || !Array.isArray(value.checks)) {
    throw {
      status: 502,
      code: "invalid_response",
      message: "The readiness endpoint returned an unexpected shape.",
    } satisfies ApiErrorShape;
  }
  const checks: ReadinessCheck[] = [];
  for (const entry of value.checks) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.ok !== "boolean") continue;
    if (!READINESS_STEP_ORDER.includes(entry.id as ReadinessStepId)) continue;
    checks.push({
      id: entry.id as ReadinessStepId,
      ok: entry.ok,
      ...(typeof entry.detail === "string" ? { detail: entry.detail } : {}),
      ...(typeof entry.remediation === "string" ? { remediation: entry.remediation } : {}),
    });
  }
  // The order is part of the contract; sort defensively so a reordered
  // response cannot silently reorder the operator's checklist.
  checks.sort(
    (left, right) => READINESS_STEP_ORDER.indexOf(left.id) - READINESS_STEP_ORDER.indexOf(right.id),
  );
  return {
    ready: value.ready === true,
    ...(typeof value.generatedAt === "string" ? { generatedAt: value.generatedAt } : {}),
    checks,
  };
}

/**
 * Transition fallback: composes the same five facts from endpoints that
 * already exist. Used only when `/system/readiness` answers 404/405.
 */
function useComposedReadiness(enabled: boolean) {
  const providersQuery = useQuery({
    queryKey: queryKeys.providers.all,
    queryFn: (context) =>
      consoleRequest<unknown>("/providers", { signal: querySignal(context) }).then(assertProviders),
    ...DASHBOARD_QUERY_OPTIONS,
    staleTime: 30_000,
    enabled,
  });
  const modelsQuery = useQuery({
    queryKey: queryKeys.providers.flatAll,
    queryFn: (context) =>
      consoleRequest<unknown>("/providers/models/flat", { signal: querySignal(context) }).then(
        assertFlatModelCatalog,
      ),
    ...DASHBOARD_QUERY_OPTIONS,
    staleTime: 30_000,
    enabled,
  });
  const keysQuery = useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: (context) =>
      consoleRequest<unknown>("/api-keys", { signal: querySignal(context) }).then(assertApiKeys),
    ...DASHBOARD_QUERY_OPTIONS,
    staleTime: 30_000,
    enabled,
  });
  // The 24h window is the honest "has this gateway served anything recently"
  // signal; an all-time total would stay non-zero forever after one test.
  const usageQuery = useQuery({
    queryKey: queryKeys.usageAnalytics.summary("24h"),
    queryFn: (context) =>
      consoleRequest<unknown>("/system/usage/summary?period=24h", {
        signal: querySignal(context),
      }).then(assertUsageSummary),
    ...DASHBOARD_QUERY_OPTIONS,
    staleTime: 30_000,
    enabled,
  });

  const queries = [providersQuery, modelsQuery, keysQuery, usageQuery];
  const providerCount = providersQuery.data
    ? providersQuery.data.filter(
        (provider) => provider.enabled && (provider.configured === true || !provider.requiresAccount),
      ).length
    : undefined;
  const modelCount = modelsQuery.data?.length;
  const keyCount = keysQuery.data?.filter((key) => key.enabled).length;
  const requestCount = usageQuery.data?.totals.requests;

  const checks: ReadinessCheck[] = [
    // Reaching this hook at all means the session guard resolved an
    // administrator, so the step is satisfied by construction.
    { id: "admin_created", ok: true },
    {
      id: "provider_connected",
      ok: (providerCount ?? 0) > 0,
      ...(providerCount === undefined ? {} : { detail: `${providerCount} provider(s) connected` }),
    },
    {
      id: "model_available",
      ok: (modelCount ?? 0) > 0,
      ...(modelCount === undefined ? {} : { detail: `${modelCount} routable model(s)` }),
    },
    {
      id: "api_key_issued",
      ok: (keyCount ?? 0) > 0,
      ...(keyCount === undefined ? {} : { detail: `${keyCount} active key(s)` }),
    },
    {
      id: "first_request_seen",
      ok: (requestCount ?? 0) > 0,
      ...(requestCount === undefined ? {} : { detail: `${requestCount} request(s) in 24h` }),
    },
  ];

  return {
    checks,
    isLoading: queries.some((query) => query.isPending),
    isError: queries.some((query) => query.isError),
    isRefreshing: queries.some((query) => query.isFetching && !query.isPending),
    refresh: () => {
      for (const query of queries) void query.refetch();
    },
  };
}

export function useReadiness(options?: { readonly enabled?: boolean }): ReadinessReport {
  const enabled = options?.enabled ?? true;

  const readinessQuery = useQuery({
    queryKey: queryKeys.system.readiness,
    queryFn: (context) =>
      consoleRequest<unknown>("/system/readiness", { signal: querySignal(context) }).then(
        parseReadiness,
      ),
    ...DASHBOARD_QUERY_OPTIONS,
    staleTime: 20_000,
    // A missing route is a stable condition, not a transient failure: retrying
    // it would hammer a 404 on every mount.
    retry: false,
    enabled,
  });

  const endpointMissing = readinessQuery.isError && isRouteMissing(readinessQuery.error);
  const fallback = useComposedReadiness(enabled && endpointMissing);

  const checks = endpointMissing ? fallback.checks : (readinessQuery.data?.checks ?? []);

  const steps: readonly ReadinessStep[] = READINESS_STEP_ORDER.map((id) => {
    const check = checks.find((candidate) => candidate.id === id);
    const state: ReadinessState =
      check === undefined ? "unknown" : check.ok ? "done" : "todo";
    return {
      id,
      titleKey: STEP_TITLE_KEYS[id],
      ...(check?.detail ? { detail: check.detail } : {}),
      ...(check?.remediation ? { remediation: check.remediation } : {}),
      state,
      route: STEP_ROUTES[id],
      required: STEP_REQUIRED[id],
    };
  });

  const required = steps.filter((step) => step.required);
  const completedRequired = required.filter((step) => step.state === "done").length;
  const isLoading = endpointMissing ? fallback.isLoading : readinessQuery.isPending;
  const isError = endpointMissing ? fallback.isError : readinessQuery.isError && !endpointMissing;

  return {
    steps,
    completedRequired,
    totalRequired: required.length,
    allRequiredDone: completedRequired === required.length,
    ready: endpointMissing
      ? completedRequired === required.length
      : (readinessQuery.data?.ready ?? false),
    ...(readinessQuery.data?.generatedAt ? { generatedAt: readinessQuery.data.generatedAt } : {}),
    isLoading,
    isError,
    usingFallback: endpointMissing,
    isRefreshing: endpointMissing
      ? fallback.isRefreshing
      : readinessQuery.isFetching && !readinessQuery.isPending,
    refresh: () => {
      if (endpointMissing) {
        fallback.refresh();
        return;
      }
      void readinessQuery.refetch();
    },
  };
}

/**
 * Public readiness probe (`/health/ready`).
 *
 * Kept separate from `/console/api/system/health` because it answers a
 * different question: the console snapshot says how the process is doing, this
 * says whether the process is willing to accept traffic. It is unauthenticated
 * on the gateway, which is exactly what makes it useful on the Health screen —
 * an operator can see it fail while the console session is still broken.
 */
export interface ReadinessProbe {
  readonly ready: boolean;
  readonly reason?: string;
  readonly db?: "connected" | "disconnected";
  readonly redis?: "connected" | "disconnected";
  readonly migrations?: "applied" | "pending";
  readonly status?: string;
}

export function useReadinessProbe() {
  return useQuery<ReadinessProbe, ApiErrorShape>({
    queryKey: queryKeys.system.readinessProbe,
    queryFn: async (context) => {
      const response = await fetch("/health/ready", {
        signal: querySignal(context),
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const payload: unknown = await response.json().catch(() => ({}));
      const record = isRecord(payload) ? payload : {};
      const status = typeof record.status === "string" ? record.status : undefined;
      return {
        ready: response.ok && status === "ready",
        ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
        ...(record.db === "connected" || record.db === "disconnected" ? { db: record.db } : {}),
        ...(record.redis === "connected" || record.redis === "disconnected"
          ? { redis: record.redis }
          : {}),
        ...(record.migrations === "applied" || record.migrations === "pending"
          ? { migrations: record.migrations }
          : {}),
        ...(status ? { status } : {}),
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
    refetchInterval: 20_000,
  });
}
