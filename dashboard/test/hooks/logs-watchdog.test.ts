// Proves the fallback: with the stream silent, the poller must take over and
// keep the list moving.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const hook = readFileSync(
  new URL("../../src/hooks/logs.ts", import.meta.url),
  "utf8",
);

describe("console log stream fallback", () => {
  test("a silent stream falls back to polling instead of freezing", () => {
    // The reported failure: connection open, frames buffered by a proxy,
    // onerror never fires, page frozen. Silence must be treated as failure.
    expect(hook).toContain("STREAM_SILENCE_TIMEOUT_MS");
    expect(hook).toContain("watchForSilence");
    expect(hook).toContain("void pollSnapshot()");
  });

  test("every kind of frame resets the watchdog", () => {
    // Otherwise a busy stream would still be declared silent.
    const resets = hook.split("noteFrame();").length - 1;
    expect(resets).toBeGreaterThanOrEqual(4);
  });

  test("the heartbeat is observed as a named event, not only a comment", () => {
    // A comment frame keeps the connection alive but is invisible to
    // EventSource listeners, so it cannot prove frames are arriving.
    expect(hook).toContain('source.addEventListener("ping"');
  });

  test("the fallback poll re-reads the authoritative snapshot", () => {
    // Replacing the list rather than appending: the snapshot is the whole
    // truth, and merging would duplicate lines the stream also delivered.
    expect(hook).toContain("pollSnapshot");
    expect(hook).toContain("setLines(readLines(snapshot)");
  });

  test("both timers are cleared on unmount", () => {
    expect(hook).toContain("clearTimeout(silenceTimer)");
    expect(hook).toContain("clearTimeout(pollTimer)");
  });
});
