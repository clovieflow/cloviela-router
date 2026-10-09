/**
 * Bansos hooks.
 *
 * ── Why this is small ───────────────────────────────────────────────────────
 * Publishing a key is one boolean on a row the API-key hooks already own, so
 * there is nothing to fetch: the list comes from `useApiKeys`, and the only
 * mutation is a patch to that key. A dedicated query here would be a second
 * copy of the same rows, free to disagree with the first.
 *
 * The public page reads its own endpoint and needs no hooks at all.
 */
import { consoleRequest } from "../data/api";
import type { ApiErrorShape } from "../data/api";
import { queryKeys } from "../data/query-keys";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/** Everything a published key needs, written to the key's own columns. */
export interface BansosKeySettings {
  /** Publish or unpublish. */
  bansosEnabled?: boolean;
  /** `whitelist` restricts the key to `modelList`; `blacklist` blocks it. */
  modelAccessMode?: "whitelist" | "blacklist";
  modelList?: string[];
  requestsPerMinute?: number | null;
  maxConcurrentRequests?: number | null;
  dailyTokenLimit?: number | null;
  monthlyTokenLimit?: number | null;
  lifetimeTokenBudget?: number | null;
  expiresAt?: string | null;
}

/**
 * Writes Bansos settings onto an existing key.
 *
 * This goes through the ordinary API-key update route rather than a Bansos one,
 * because these are ordinary key columns. A dedicated endpoint would be a
 * second writer of the same fields, and the two would drift.
 */
export function useUpdateBansosKey() {
  const queryClient = useQueryClient();
  return useMutation<
    unknown,
    ApiErrorShape,
    { keyId: string; settings: BansosKeySettings }
  >({
    mutationFn: async ({ keyId, settings }) =>
      await consoleRequest<unknown>(`/api-keys/${encodeURIComponent(keyId)}`, {
        method: "PATCH",
        body: JSON.stringify(settings),
      }),
    onSuccess: async () => {
      // The key list carries the published flag and the limits, so it is what
      // has to refresh; nothing else caches these rows.
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
    },
  });
}
