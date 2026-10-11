/**
 * The Health page.
 *
 * Two things were reported: it felt incomplete, and it did not feel realtime.
 * Both were true, and both had a specific cause.
 *
 * Realtime: the page polled the process snapshot every 15s and the readiness
 * probe every 20s, making it the slowest-refreshing surface in the console —
 * slower than the usage list (5s) and than Console Log, which streams. It also
 * showed no timestamp at all, so a stale snapshot and a fresh one looked
 * identical. And the one genuinely realtime signal the backend already streams
 * — the in-flight count — was never subscribed to.
 *
 * Incomplete: `memory_limit_bytes` was published by the contract "so the figure
 * is checkable" and never rendered, which left the memory percentage with no
 * visible denominator.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const healthSource = readFileSync(
  new URL("../../src/routes/Health.tsx", import.meta.url),
  "utf8",
);
const systemHooks = readFileSync(
  new URL("../../src/hooks/system.ts", import.meta.url),
  "utf8",
);
const readinessHooks = readFileSync(
  new URL("../../src/hooks/readiness.ts", import.meta.url),
  "utf8",
);
const i18n = readFileSync(new URL("../../src/shared/i18n.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/styles/console.css", import.meta.url), "utf8");

describe("Health page realtime", () => {
  test("the page asks for the fast cadence", () => {
    // The default stays slow for the shell's status dot, which shares the
    // query; the page opts in because it answers "healthy right now".
    expect(healthSource).toContain("useSystemHealth(5_000)");
  });

  test("the health hook's interval is a parameter, defaulting to the old cadence", () => {
    // A hardcoded 5s would have made the always-mounted shell poll four times
    // as often for a dot that does not need it.
    expect(systemHooks).toContain("export function useSystemHealth(intervalMs = 15_000)");
    expect(systemHooks).toContain("refetchInterval: intervalMs");
  });

  test("the readiness probe matches, so the two panels cannot disagree", () => {
    // Both are rendered side by side from the same instant. A probe that lags
    // the figures beside it would show two answers to one question.
    const hook = readinessHooks.slice(readinessHooks.indexOf("export function useReadinessProbe"));
    expect(hook).toContain("refetchInterval: 5_000");
  });

  test("states when the figures were last read", () => {
    // A live number and a frozen one look the same on screen.
    expect(healthSource).toContain("health-freshness");
    expect(healthSource).toContain('t("health.lastChecked"');
    expect(i18n).toContain('"health.lastChecked"');
  });

  test("subscribes to the in-flight stream instead of only polling", () => {
    // The one figure on the page that is a stream. Everything else is a
    // snapshot; this arrives as it changes.
    expect(healthSource).toContain("useInFlight");
    expect(healthSource).toContain("inFlight.count");
    expect(healthSource).toContain("inFlight.uniqueIps");
  });

  test("says whether the stream is connected", () => {
    // A dropped feed and a quiet gateway both show a count that is not moving.
    expect(healthSource).toContain("inFlight.live");
    expect(healthSource).toContain("health-live");
    expect(css).toContain(".health-live.is-live");
  });
});

describe("Health page completeness", () => {
  test("shows the memory ceiling the percentage is measured against", () => {
    // Published by the contract explicitly "so the figure is checkable"; a
    // percentage with no visible denominator cannot be checked.
    expect(healthSource).toContain("health.memory_limit_bytes");
    expect(healthSource).toContain('t("health.memoryLimit")');
  });

  test("every label it renders exists in both locales", () => {
    // A missing key renders the raw key string to the operator.
    for (const key of [
      "health.memoryLimit",
      "health.lastChecked",
      "health.traffic",
      "health.inFlight",
      "health.uniqueIps",
      "health.live",
      "health.connecting",
    ]) {
      const occurrences = i18n.split(`"${key}"`).length - 1;
      expect(occurrences).toBe(2);
    }
  });

  test("the pulsing dot is decoration, not the message", () => {
    // The timestamp and the label carry the same meaning in words, so a
    // reduced-motion user loses nothing.
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(healthSource).toContain('t("health.live")');
  });
});
