/**
 * Payload-size bounds for a pool speed test, in bytes.
 *
 * Lives in its own module, free of imports, because the dashboard re-exports
 * these as *values* to render the size picker. `contracts.ts` imports Elysia
 * and reaches `node:crypto` through its error path, so a value re-export from
 * there would drag a Node builtin into the browser bundle.
 *
 * A bigger payload washes out the TLS handshake and TCP slow-start, which
 * otherwise dominate a short transfer and make the number depend on the moment
 * it ran. The floor keeps a measurement from being pure ramp-up; the ceiling
 * bounds both the operator's wait and the bytes their proxy plan gets billed.
 */
export const SPEED_TEST_MIN_BYTES = 1_000_000;
export const SPEED_TEST_MAX_BYTES = 100_000_000;
export const SPEED_TEST_DEFAULT_BYTES = 5_000_000;
