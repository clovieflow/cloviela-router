/**
 * The live console-log tail.
 *
 * Reported: the log sat frozen for minutes while the gateway was serving
 * requests. Two causes, both real.
 *
 * The first was fatal and silent. `snapshotThenStream` fetched a snapshot and
 * only then opened the SSE stream — but if the snapshot failed it returned from
 * the `catch` without opening the stream and without scheduling a retry. The
 * hook was dead from that moment until the page was reloaded: no stream, no
 * polling, nothing to recover it. An expired session, one dropped request, or a
 * gateway restarting mid-load was enough. From the operator's side a dead hook
 * and a quiet gateway look identical, which is why it read as "stuck".
 *
 * The second was that the hook's own `status` was never rendered, so even a
 * hook that knew it was reconnecting said nothing.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("../../src/hooks/logs.ts", import.meta.url), "utf8");
const page = readFileSync(
  new URL("../../src/features/logs/ConsoleLogPage.tsx", import.meta.url),
  "utf8",
);
const i18n = readFileSync(new URL("../../src/shared/i18n.ts", import.meta.url), "utf8");

describe("console log stream recovery", () => {
  test("a failed snapshot reschedules instead of ending the hook", () => {
    // The catch block must not be a dead end. `retryTimer` plus a recursive
    // call is what turns a transient failure into a reconnect.
    // Slice from the function so the regex cannot land on an earlier catch.
    const fn = hook.slice(hook.indexOf("const snapshotThenStream"));
    const catchBlock = /catch \{[\s\S]*?\n {6}\}/.exec(fn)?.[0] ?? "";
    expect(catchBlock).toContain("retryTimer = setTimeout");
    expect(catchBlock).toContain("snapshotThenStream()");
    expect(catchBlock).toContain('setStatus("reconnecting")');
  });

  test("the retry honours the unmount guard", () => {
    // A page navigated away from must not keep retrying against a dead tree.
    const fn = hook.slice(hook.indexOf("const snapshotThenStream"));
    const catchBlock = /catch \{[\s\S]*?\n {6}\}/.exec(fn)?.[0] ?? "";
    expect(catchBlock).toContain("stopped");
    expect(catchBlock).toContain("runId === attempt.current");
  });

  test("the reconnect delay is short enough not to lose a burst", () => {
    // At 5s a burst of requests could pass entirely between retries.
    expect(hook).toContain("const STREAM_RETRY_MS = 1_000;");
  });

  test("the snapshot asks for the whole ring", () => {
    // The ring holds 500 lines; asking for 200 opened every visit with a third
    // of the buffer missing, which reads as lost lines.
    expect(hook).toContain("/logs?limit=${MAX_LINES}");
    expect(hook).toContain("const MAX_LINES = 500;");
  });
});

describe("console log stream status", () => {
  test("the panel renders the status the hook already tracked", () => {
    // `status` existed since the stream was written and was never shown.
    expect(page).toContain("status } = useConsoleLogStream()");
    expect(page).toContain("health-live");
    expect(page).toContain('t("health.live")');
    expect(page).toContain('t("health.connecting")');
  });

  test("an idle stream has a label in both locales", () => {
    // A missing key renders the raw key to the operator.
    const occurrences = i18n.split('"logs.idle"').length - 1;
    expect(occurrences).toBe(2);
  });
});
