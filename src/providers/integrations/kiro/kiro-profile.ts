// The subscription profile an account's requests are scoped to.
//
// Kiro's generation, usage, and model-catalog surfaces are all profile-scoped:
// each refuses a request that omits `profileArn` (`400 profileArn is required
// for this request.` / `400 Invalid profileArn.`), and none of them enumerates
// an account's profiles — `ListAvailableProfiles` rejects a Builder ID outright
// (`403 AWS Builder ID is not supported for this operation.`). The value is
// therefore resolved from two sources, in order: whatever the account's own
// sign-in resolved, then the public default for its sign-in family.
//
// It is shared rather than repeated because the value must be identical on every
// surface: three copies of this rule is how one surface ends up scoping a request
// differently from another.
//
// The account-bound families are the exception and are named as such below: an
// API key is scoped by the key itself, and presenting a profile it does not own
// is refused.

/**
 * Public default CodeWhisperer profile ARNs, keyed by sign-in family.
 *
 * These are the vendor's published defaults, not per-account values, and they are
 * part of the wire contract: a Builder ID account that resolved no profile of its
 * own reaches generation with the builder default and is answered `200`, while
 * the same request with the field omitted is answered `400 profileArn is
 * required`. A social (Google/GitHub) account uses the social default; presenting
 * the builder default under a social token is answered `403 Invalid token`.
 */
const DEFAULT_PROFILE_ARNS = {
  "builder-id": "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
  social: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
} as const;

/** Sign-in families that authenticate with a social identity provider. */
const SOCIAL_AUTH_METHODS: ReadonlySet<string> = new Set(["google", "github"]);

/**
 * Sign-in families that are scoped by their credential rather than a profile.
 *
 * An API key is account-bound: the key itself names the account, and a
 * `profileArn` the key does not own is refused. An enterprise IdP export carries
 * its own ARN and must never be given a default.
 */
const CREDENTIAL_SCOPED_AUTH_METHODS: ReadonlySet<string> = new Set(["api_key", "external_idp"]);

/**
 * The profile ARN a request for this account carries, or `""` when it carries
 * none.
 *
 * An account's own resolved profile always wins; only an account that resolved
 * none falls back to its sign-in family's public default. A credential-scoped
 * family never receives a default — it is refused rather than sent one it does
 * not own.
 */
export function resolveKiroProfileArn(
  authState: Readonly<Record<string, unknown>> | undefined,
): string {
  const own = authState?.["profileArn"];
  if (typeof own === "string" && own.trim().length > 0) return own.trim();
  const authMethod = authState?.["authMethod"];
  if (typeof authMethod !== "string") return "";
  if (CREDENTIAL_SCOPED_AUTH_METHODS.has(authMethod)) return "";
  return SOCIAL_AUTH_METHODS.has(authMethod)
    ? DEFAULT_PROFILE_ARNS.social
    : DEFAULT_PROFILE_ARNS["builder-id"];
}
