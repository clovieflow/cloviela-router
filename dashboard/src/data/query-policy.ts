/**
 * Shared server-state policy for dashboard queries and mutations.
 *
 * Keeping these defaults in one module prevents a hook from silently drifting
 * from the application-wide cache behavior. Sensitive data remains opt-in at
 * each hook and is never prefetched by this policy.
 *
 * ── Why the two refetch defaults are set the way they are ───────────────────
 * A polling hook stops when the tab is not focused unless
 * `refetchIntervalInBackground` is true, and a returning tab does not refresh
 * unless `refetchOnWindowFocus` is true. Both defaults were off, which is fine
 * for a settings page and wrong for a live one: the operator switches apps for
 * a moment, the poll stops, they come back to the same frozen numbers, and the
 * page looks stuck. That is the exact report the live pages kept getting, and
 * it is the behavior a phone makes easy to hit — a screen that dims or an app
 * switch is enough to blur the tab.
 *
 * Polling in the background costs one request per interval per open page, and
 * the pages that carry a poll are the ones that exist to be watched. A page
 * that must not poll while hidden sets `refetchIntervalInBackground: false`
 * for itself, which several already do.
 */
export const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 10_000,
  gcTime: 120_000,
  retry: false,
  refetchOnWindowFocus: true,
  refetchIntervalInBackground: true,
} as const;

export const DASHBOARD_MUTATION_OPTIONS = {
  retry: 0,
} as const;
