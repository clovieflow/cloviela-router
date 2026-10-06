import { QueryClient } from "@tanstack/react-query";
import { DASHBOARD_MUTATION_OPTIONS, DASHBOARD_QUERY_OPTIONS } from "./query-policy";

/** One application-wide server-state cache for the dashboard. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: DASHBOARD_QUERY_OPTIONS,
    mutations: DASHBOARD_MUTATION_OPTIONS,
  },
});
