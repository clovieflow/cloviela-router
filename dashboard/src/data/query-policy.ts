/**
 * Shared server-state policy for dashboard queries and mutations.
 *
 * Keeping these defaults in one module prevents a hook from silently drifting
 * from the application-wide cache behavior. Sensitive data remains opt-in at
 * each hook and is never prefetched by this policy.
 */
export const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 10_000,
  gcTime: 120_000,
  retry: false,
  refetchOnWindowFocus: false,
} as const;

export const DASHBOARD_MUTATION_OPTIONS = {
  retry: 0,
} as const;
