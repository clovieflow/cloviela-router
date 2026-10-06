
/**
 * Cooldown presentation shared by every view that reports account health.
 *
 * The Accounts tab, the Quota page, and the provider list all show account
 * health, and all need the same answer: *when* can this be retried? A
 * model-scoped throttle (a 429 for a single model) writes `modelCooldowns` and
 * deliberately leaves `cooldownUntil` and `status` untouched, because the
 * account stays routable for every other model. A view that reads only
 * `cooldownUntil` therefore shows a 429 reason with no time, and a view that
 * reads only `status === "cooldown"` shows nothing at all. The logic lives here
 * rather than in each route so the views cannot drift.
 */

/** The `modelCooldowns` field every account projection carries. */
export interface ModelCooldownSource {
  readonly modelCooldowns?: Readonly<Record<string, string>> | undefined;
}

/** Per-model backoffs still in force: how many, which ends soonest, and when. */
export function activeModelCooldowns(
  account: ModelCooldownSource,
): { count: number; modelId: string; until: string } | undefined {
  const entries = Object.entries(account.modelCooldowns ?? {}).filter(
    ([, at]) => Number.isFinite(new Date(at).getTime()) && new Date(at).getTime() > Date.now(),
  );
  let soonest: [string, string] | undefined;
  for (const entry of entries) {
    if (soonest === undefined || new Date(entry[1]).getTime() < new Date(soonest[1]).getTime()) {
      soonest = entry;
    }
  }
  return soonest === undefined
    ? undefined
    : { count: entries.length, modelId: soonest[0], until: soonest[1] };
}

/**
 * The instant the last per-model backoff expires, or null when none is in force.
 *
 * This is the countdown target: the timer must run until the *longest* backoff
 * expires, since stopping at the soonest would freeze the remaining badges
 * mid-count.
 */
export function lastModelCooldownAt(account: ModelCooldownSource): number | null {
  const times = Object.values(account.modelCooldowns ?? {})
    .map((at) => new Date(at).getTime())
    .filter((time) => Number.isFinite(time));
  return times.length === 0 ? null : Math.max(...times);
}

/**
 * How many of these accounts have at least one live per-model backoff.
 *
 * A list-level summary has to count the *accounts*, not the backoffs: one
 * account cooling five models is one row the operator should see, and the badge
 * beside it already says how many models that is. Counting raw entries would
 * report a provider with a single account as five separate problems.
 */
export function modelCoolingCount(accounts: readonly ModelCooldownSource[]): number {
  return accounts.filter((account) => activeModelCooldowns(account) !== undefined).length;
}

