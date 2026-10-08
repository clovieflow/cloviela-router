/**
 * Matrix planner for the Rikka E2E harness.
 *
 * Reads the shipped case index (all GW/SEC/DB/CLI identifiers with their
 * original clause text) and decides, per identifier, whether this harness can
 * execute it, must report it BLOCKED on an unavailable dependency, or must
 * record it NA with exact source applicability evidence.
 *
 * The planner is deliberately conservative in one direction only: it never
 * upgrades an identifier. Every case starts UNVERIFIED, and only an executed
 * scenario with a matching assertion can move it. Unsupported combinations are
 * proven unsupported from source, not assumed.
 *
 * Applicability rules cite the owning source file so a reader can check the
 * claim. Each rule is a fact about the current tree, not a permanent truth —
 * when the owning source changes, the rule must change with it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One decoded case: its identifier plus every clause from the master spec. */
export interface CaseClauses {
  readonly id: string;
  readonly spec: string;
  readonly clauses: Readonly<Record<string, string>>;
  /** Parsed `key=value` pairs from the SPEC clause. */
  readonly axes: Readonly<Record<string, string>>;
}

interface CaseIndexFile {
  readonly dimensions: Record<
    string,
    {
      readonly clauseOrder: readonly string[];
      readonly clauses: Record<string, readonly string[]>;
      readonly cases: readonly (Record<string, string | number> & { id: string })[];
    }
  >;
}

/** Dimensions this harness owns. The ART and UI appendices are other owners. */
export const HARNESS_DIMENSIONS = ["GW", "SEC", "DB", "CLI"] as const;
export type HarnessDimension = (typeof HARNESS_DIMENSIONS)[number];

/** Where a case's execution stands. `UNVERIFIED` is the only pre-run state. */
export type CaseStatus = "UNVERIFIED" | "PASS" | "FAIL" | "BLOCKED" | "NA";

export interface PlannedCase {
  readonly id: string;
  readonly dimension: HarnessDimension;
  readonly clauses: Readonly<Record<string, string>>;
  readonly axes: Readonly<Record<string, string>>;
  /** Status before any execution. Always UNVERIFIED. */
  readonly status: CaseStatus;
  /**
   * Why this case cannot be executed, or why it is not applicable. Present
   * only when the planner has already decided the case away from execution.
   */
  readonly disposition?: {
    readonly status: "BLOCKED" | "NA";
    readonly reason: string;
    /** Exact source file that establishes the disposition. */
    readonly owner: string;
    /** The combination that made the case inapplicable, when it is NA. */
    readonly combination?: string;
  };
  /**
   * Scenario family this case is grouped into. Cases in one family share one
   * execution and one assertion, which is how an equivalent parameterization
   * keeps the run cheap without weakening any single claim.
   */
  readonly family?: string;
}

function parseAxes(spec: string): Record<string, string> {
  const axes: Record<string, string> = {};
  for (const part of spec.split("; ")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    axes[part.slice(0, separator).trim()] = part.slice(separator + 1).trim().replace(/\.$/, "");
  }
  return axes;
}

/** Loads and decodes one dimension from the shipped case index. */
export function loadDimension(indexPath: string, dimension: HarnessDimension): readonly CaseClauses[] {
  const raw = JSON.parse(readFileSync(indexPath, "utf8")) as CaseIndexFile;
  const entry = raw.dimensions[dimension];
  if (entry === undefined) {
    throw new Error(
      `case index at ${indexPath} has no dimension ${dimension}; regenerate it from the master spec appendices`,
    );
  }
  return entry.cases.map((row) => {
    const clauses: Record<string, string> = {};
    for (const key of entry.clauseOrder) {
      const ref = row[key];
      if (typeof ref !== "number") continue;
      const text = entry.clauses[key]?.[ref];
      if (text !== undefined) clauses[key] = text;
    }
    const spec = clauses["SPEC"] ?? "";
    return { id: row.id, spec, clauses, axes: parseAxes(spec) };
  });
}

export function defaultIndexPath(): string {
  return join(import.meta.dir, "fixtures", "cloviela-case-index.json");
}

/**
 * Gateway faults this tree cannot produce, with the source that proves it.
 *
 * Each entry removes an entire fault axis rather than a single case, which is
 * what keeps the rule honest: if the capability later exists, every removed
 * case returns to the executable set at once.
 */
const UNSUPPORTED_GATEWAY_FAULTS: Readonly<
  Record<string, { readonly reason: string; readonly owner: string }>
> = {
  "expired-key": {
    reason:
      "gateway API keys carry no expiry column; the only time-bounded credentials are console sessions, share links and OAuth state, so an expired-key fixture has no field to set",
    owner: "src/persistence/schema.ts api_keys (no expires_at column)",
  },
};

/**
 * Protocol surfaces whose native routes need a capability the fixture cannot
 * fabricate. Each gate names what would have to exist for the case to run.
 */
const NATIVE_SURFACE_GATES: Readonly<
  Record<string, { readonly reason: string; readonly owner: string }>
> = {
  compact: {
    reason:
      "responses/compact requires provider id `codex` AND an account whose credential_kind is exactly `oauth`; a BYOK api_key fixture is rejected before dispatch",
    owner: "src/transport/dispatch/responses-compact.ts (route) + src/transport/request/preparer.ts (oauth filter)",
  },
  systemone: {
    reason:
      "System One needs a model row with service_kind=systemone and an adapter exposing systemone(); the generic BYOK compatible adapter does not implement it",
    owner: "src/transport/request/preparer.ts prepareNativeService + src/providers/compatible-adapter.ts",
  },
  search: {
    reason:
      "native search needs a service_kind=websearch model served by a search adapter (exa/gemini/codex) plus the search:invoke scope; the generic BYOK adapter implements no websearch()",
    owner: "src/transport/dispatch/websearch.ts + src/providers/search/search-provider.ts",
  },
};

/** Routing strategies the runtime actually implements. */
const UNSUPPORTED_GATEWAY_STRATEGIES: Readonly<
  Record<string, { readonly reason: string; readonly owner: string }>
> = {
  weighted: {
    reason:
      "runtime provider strategy is fallback|round_robin only; weighted capacity exists for network POOLS, not provider/account selection, so a weighted provider case has no knob to exercise",
    owner: "src/transport/routing/route-model.ts ROUTING_STRATEGIES",
  },
};

/** SEC boundaries whose attack input has no reachable surface in this tree. */
const SEC_BOUNDARY_GATES: Readonly<
  Record<string, { readonly reason: string; readonly owner: string }>
> = {
  health: {
    reason:
      "the public health surface answers fixed constants and takes no request input; there is no payload, path or credential to attack, so only unauthorized/oversize are applicable",
    owner: "src/app.ts /health, /health/ready (no input parameters)",
  },
};

/** DB entities whose lifecycle cannot be driven through a real store. */
const DB_ENTITY_GATES: Readonly<Record<string, { readonly reason: string; readonly owner: string }>> = {
  theme: {
    reason:
      "theme is browser-local storage in the dashboard, not a SQL entity; the database has no theme table to run a lifecycle against",
    owner: "dashboard/src/shared/theme.ts (client storage) — no matching schema table",
  },
};

/** CLI clients whose binary is required for a real request. */
const CLI_CLIENT_BINARIES: Readonly<Record<string, string>> = {
  omp: "omp",
  opencode: "opencode",
  curl: "curl",
};

/**
 * Decides whether a case can run, and if not, records the exact reason.
 *
 * `available` carries the capabilities the current invocation actually has
 * (which clients are installed, whether PostgreSQL and Redis are reachable).
 * A case gated on an absent capability becomes BLOCKED — never NA — because
 * the capability may exist on another machine.
 */
export function planCase(
  dimension: HarnessDimension,
  entry: CaseClauses,
  available: {
    readonly clients: ReadonlySet<string>;
    readonly hasFullStore: boolean;
    readonly hasRedis: boolean;
  },
): PlannedCase {
  const base: PlannedCase = {
    id: entry.id,
    dimension,
    clauses: entry.clauses,
    axes: entry.axes,
    status: "UNVERIFIED",
  };
  if (dimension === "GW") return planGatewayCase(base, available);
  if (dimension === "SEC") return planSecurityCase(base, available);
  if (dimension === "DB") return planDatabaseCase(base, available);
  return planClientCase(base, available);
}

function planGatewayCase(
  base: PlannedCase,
  available: { readonly hasFullStore: boolean; readonly hasRedis: boolean },
): PlannedCase {
  const { protocol, fault, strategy, persistence } = base.axes;
  if (protocol === undefined || fault === undefined || strategy === undefined || persistence === undefined) {
    return base;
  }
  if (persistence === "full" && !available.hasFullStore) {
    return {
      ...base,
      disposition: {
        status: "BLOCKED",
        reason:
          "the full store requires a disposable PostgreSQL database; this run was started without --database-url",
        owner: "src/persistence/postgres.ts bootDatabase (full branch)",
        combination: `persistence=${persistence}`,
      },
    };
  }
  const faultGate = UNSUPPORTED_GATEWAY_FAULTS[fault];
  if (faultGate !== undefined) {
    return {
      ...base,
      disposition: {
        status: "NA",
        reason: faultGate.reason,
        owner: faultGate.owner,
        combination: `fault=${fault}`,
      },
    };
  }
  const strategyGate = UNSUPPORTED_GATEWAY_STRATEGIES[strategy];
  if (strategyGate !== undefined) {
    return {
      ...base,
      disposition: {
        status: "NA",
        reason: strategyGate.reason,
        owner: strategyGate.owner,
        combination: `strategy=${strategy}`,
      },
    };
  }
  const nativeGate = NATIVE_SURFACE_GATES[protocol];
  if (nativeGate !== undefined) {
    return {
      ...base,
      disposition: {
        status: "NA",
        reason: nativeGate.reason,
        owner: nativeGate.owner,
        combination: `protocol=${protocol}`,
      },
    };
  }
  // `models` is an authenticated local catalog read: it never dispatches
  // upstream, so every upstream-behavior fault is inapplicable to it rather
  // than failed. Sending a chat body and reading the 404 would not be evidence.
  if (protocol === "models" && fault !== "valid-single" && fault !== "bad-key" && fault !== "revoked-key" && fault !== "disallowed-model" && fault !== "missing-model") {
    return {
      ...base,
      disposition: {
        status: "NA",
        reason:
          "/v1/models reads the local catalog and performs no provider dispatch, so upstream-fault, retry, tool-boundary and stream-boundary behaviors have no boundary to exercise",
        owner: "src/app.ts handleModelsList (database-only, no adapter call)",
        combination: `protocol=models; fault=${fault}`,
      },
    };
  }
  return base;
}

function planSecurityCase(base: PlannedCase, available: { readonly hasFullStore: boolean }): PlannedCase {
  const { "trust-boundary": boundary, attack, storage } = base.axes;
  if (boundary === undefined || attack === undefined || storage === undefined) return base;
  if (storage === "full" && !available.hasFullStore) {
    return {
      ...base,
      disposition: {
        status: "BLOCKED",
        reason: "the full store requires a disposable PostgreSQL database; start the run with --database-url",
        owner: "src/persistence/postgres.ts bootDatabase (full branch)",
        combination: `storage=${storage}`,
      },
    };
  }
  const boundaryGate = SEC_BOUNDARY_GATES[boundary];
  if (boundaryGate !== undefined && attack !== "unauthorized" && attack !== "oversize") {
    return {
      ...base,
      disposition: {
        status: "NA",
        reason: boundaryGate.reason,
        owner: boundaryGate.owner,
        combination: `trust-boundary=${boundary}; attack=${attack}`,
      },
    };
  }
  return base;
}

function planDatabaseCase(base: PlannedCase, available: { readonly hasFullStore: boolean }): PlannedCase {
  const { entity, lifecycle, store } = base.axes;
  if (entity === undefined || lifecycle === undefined || store === undefined) return base;
  if (store === "full" && !available.hasFullStore) {
    return {
      ...base,
      disposition: {
        status: "BLOCKED",
        reason: "the full store requires a disposable PostgreSQL database; start the run with --database-url",
        owner: "src/persistence/postgres.ts bootDatabase (full branch)",
        combination: `store=${store}`,
      },
    };
  }
  const entityGate = DB_ENTITY_GATES[entity];
  if (entityGate !== undefined) {
    return {
      ...base,
      disposition: {
        status: "NA",
        reason: entityGate.reason,
        owner: entityGate.owner,
        combination: `entity=${entity}`,
      },
    };
  }
  return base;
}

function planClientCase(base: PlannedCase, available: { readonly clients: ReadonlySet<string> }): PlannedCase {
  const { client, journey, "route-profile": profile } = base.axes;
  if (client === undefined || journey === undefined || profile === undefined) return base;
  const binary = CLI_CLIENT_BINARIES[client];
  if (binary !== undefined && !available.clients.has(binary)) {
    return {
      ...base,
      disposition: {
        status: "BLOCKED",
        reason: `client binary \`${binary}\` is not installed on this host; install it to execute this case`,
        owner: "host PATH",
        combination: `client=${client}`,
      },
    };
  }
  return base;
}

/** Aggregate counts the planner produces, published as a named contract. */
export interface PlanSummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly byDimension: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly dispositions: readonly {
    readonly id: string;
    readonly status: string;
    readonly reason: string;
    readonly owner: string;
    readonly combination?: string;
  }[];
}

/** Groups planned cases into executable families and summarizes the plan. */
export function summarizePlan(cases: readonly PlannedCase[]): PlanSummary {
  const byStatus: Record<string, number> = {};
  const byDimension: Record<string, Record<string, number>> = {};
  const dispositions: {
    id: string;
    status: string;
    reason: string;
    owner: string;
    combination?: string;
  }[] = [];
  for (const item of cases) {
    const status = item.disposition?.status ?? item.status;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const dimensionCounts = (byDimension[item.dimension] ??= {});
    dimensionCounts[status] = (dimensionCounts[status] ?? 0) + 1;
    if (item.disposition !== undefined) {
      dispositions.push({
        id: item.id,
        status: item.disposition.status,
        reason: item.disposition.reason,
        owner: item.disposition.owner,
        ...(item.disposition.combination === undefined
          ? {}
          : { combination: item.disposition.combination }),
      });
    }
  }
  return { total: cases.length, byStatus, byDimension, dispositions };
}
