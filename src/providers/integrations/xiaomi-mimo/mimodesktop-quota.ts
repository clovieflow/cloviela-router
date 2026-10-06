import type { FetchLike, ProviderQuotaResult } from "../../quota/quota-contracts";
import { parseMimoUsageWindows } from "./mimo-quota-shared";
import { acquireMimoServiceSession, MIMO_API_UA } from "./mimodesktop-sso";
import { parseMimoCredential } from "./mimodesktop-oauth";
import { MIMODESKTOP_BASE_URL } from "./mimodesktop";

export const MIMODESKTOP_USAGE_ENDPOINT = `${MIMODESKTOP_BASE_URL}/api/user/usage` as const;

const MIMODESKTOP_PLAN = "Xiaomi MiMo Desktop";

/** Parses Xiaomi MiMo Desktop usage into its weekly window. */
export function parseMimoDesktopQuota(payload: unknown): ProviderQuotaResult {
  return parseMimoUsageWindows(payload, { source: "mimodesktop", plan: MIMODESKTOP_PLAN });
}

export async function fetchMimoDesktopQuota(
  credential: string,
  fetcher: FetchLike = fetch,
): Promise<ProviderQuotaResult> {
  const parsed = parseMimoCredential(credential);
  if (!parsed.passToken) {
    return {
      source: "mimodesktop",
      plan: MIMODESKTOP_PLAN,
      windows: [],
      error: "MiMo Desktop passToken is missing",
    };
  }

  try {
    const sessionCookie = await acquireMimoServiceSession(
      {
        passToken: parsed.passToken,
        ...(parsed.userId ? { userId: parsed.userId } : {}),
        apiBase: MIMODESKTOP_BASE_URL,
      },
      fetcher as typeof fetch,
    );

    const res = await fetcher(MIMODESKTOP_USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        "User-Agent": MIMO_API_UA,
        Cookie: sessionCookie,
        "X-Mimo-Source": "mimocode-cli-free",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return {
        source: "mimodesktop",
        plan: MIMODESKTOP_PLAN,
        windows: [],
        error: `Usage API returned HTTP ${res.status}`,
      };
    }

    const json = (await res.json()) as unknown;
    return parseMimoDesktopQuota(json);
  } catch (error) {
    return {
      source: "mimodesktop",
      plan: MIMODESKTOP_PLAN,
      windows: [],
      error: error instanceof Error ? error.message : "Failed to fetch MiMo quota",
    };
  }
}
