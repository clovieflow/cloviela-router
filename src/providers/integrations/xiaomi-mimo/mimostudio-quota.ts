import type { FetchLike, ProviderQuotaResult } from "../../quota/quota-contracts";
import { parseMimoUsageWindows } from "./mimo-quota-shared";
import {
  buildMimoStudioCookieHeader,
  parseMimoStudioCredential,
  MIMO_STUDIO_UA,
} from "./mimostudio-auth";

export const MIMO_STUDIO_USAGE_URL = "https://aistudio.xiaomimimo.com/open-apis/v1/user/usage" as const;

const MIMOSTUDIO_PLAN = "MiMo Studio";

/** Parses MiMo Studio usage into its weekly window. */
export function parseMimoStudioQuota(payload: unknown): ProviderQuotaResult {
  return parseMimoUsageWindows(payload, { source: "mimostudio", plan: MIMOSTUDIO_PLAN });
}

export async function fetchMimoStudioQuota(
  credential: string,
  fetcher: FetchLike = fetch,
): Promise<ProviderQuotaResult> {
  const creds = parseMimoStudioCredential(credential);
  try {
    const cookie = buildMimoStudioCookieHeader(creds);
    const res = await fetcher(MIMO_STUDIO_USAGE_URL, {
      method: "GET",
      headers: {
        "User-Agent": MIMO_STUDIO_UA,
        Cookie: cookie,
        Origin: "https://aistudio.xiaomimimo.com",
        Referer: "https://aistudio.xiaomimimo.com/",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return {
        source: "mimostudio",
        plan: MIMOSTUDIO_PLAN,
        windows: [],
        error: `MiMo Studio usage returned HTTP ${res.status}`,
      };
    }

    const json = (await res.json()) as unknown;
    return parseMimoStudioQuota(json);
  } catch (error) {
    return {
      source: "mimostudio",
      plan: MIMOSTUDIO_PLAN,
      windows: [],
      error: error instanceof Error ? error.message : "Failed to fetch MiMo Studio quota",
    };
  }
}
