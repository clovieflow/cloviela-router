import { CLOVIELA_VERSION } from "../../transport/version";

/**
 * Gateway identity stamped on outbound upstream traffic.
 *
 * `Cloviela/<version>` rides the dispatch path only for providers that
 * explicitly opt in (`gatewayUserAgent: true` on their spec/registration).
 * Providers with their own first-party identity — Codex (`codex_cli_rs`),
 * Claude Code (`claude-cli`), and any adapter stamping bespoke headers —
 * are never touched: cloaking those would break the identity the upstream
 * expects. BYOK custom providers keep their official CLI cloaking unless
 * the operator explicitly provisions the gateway agent instead.
 */
export const GATEWAY_USER_AGENT = `Cloviela/${CLOVIELA_VERSION}` as const;

