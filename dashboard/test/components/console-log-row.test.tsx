/**
 * One console-log row.
 *
 * The row is where the structured fields become text, so it is the only place
 * a dropped field is observable. Four of them were being dropped: the network
 * pool, the calling client, and the full request id were carried all the way
 * from the gateway and then never rendered, and on a phone the row's
 * `nowrap` + `overflow: hidden` cut the model id down to `fetra/c…` with no way
 * to see the rest.
 *
 * The layout half is CSS and invisible here, so the tests pin the fields the
 * row must emit and the fact that nothing is truncated in the markup itself.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { LogRow } from "../../src/features/logs/ConsoleLogPage";
import type { ConsoleLogEntry } from "../../src/hooks/logs";
import { renderMarkup } from "../helpers/render";

const REQUEST_ID = "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

const LINE: ConsoleLogEntry = {
  id: "line-1",
  ts: "2026-10-11T03:26:23.000Z",
  level: "info",
  msg: "request complete",
  event: "request_complete",
  requestId: REQUEST_ID,
  endpoint: "/v1/chat/completions",
  method: "POST",
  model: "fetra/cbai/deepseek-v3.2",
  routedModel: "deepseek-v3.2",
  providerId: "cerebras",
  accountLabel: "cerebras-1",
  accountId: "acct-1",
  networkPoolId: "pool-jkt",
  clientIp: "103.10.20.30",
  userAgent: "openai-node/4.77.0",
  status: 200,
  durationMs: 5_400,
  details: { inputTokens: 180_000, outputTokens: 1_000 },
};

function renderRow(line: ConsoleLogEntry = LINE): string {
  return renderMarkup(createElement(LogRow, { line, isNew: false }));
}

describe("LogRow", () => {
  test("renders the fields the gateway recorded", () => {
    const html = renderRow();
    for (const value of [
      "/v1/chat/completions",
      "200",
      "cerebras",
      "cerebras-1",
      "103.10.20.30",
      "5.4 s",
    ]) {
      expect(html).toContain(value);
    }
  });

  test("renders the network pool, which used to be dropped", () => {
    // The pool is the first thing to check when one address in it starts
    // failing, and it never reached the row.
    expect(renderRow()).toContain("pool-jkt");
  });

  test("names the calling client, with the full agent in the title", () => {
    // A short name is readable at a glance; the raw string stays recoverable
    // so nothing is actually lost.
    const html = renderRow();
    expect(html).toContain("openai-node/4.77.0");
    expect(html).toContain('title="openai-node/4.77.0"');
  });

  test("keeps the full request id, not just a prefix", () => {
    // The prefix is a display convenience; the whole id is what you paste into
    // a trace search. It was truncated to eight characters and the remainder
    // was not rendered anywhere.
    const html = renderRow();
    expect(html).toContain(REQUEST_ID);
  });

  test("shows the routed model and what the client asked for when they differ", () => {
    // An alias resolving to a different model is the answer to "why did I get
    // this model", and the row has to say both halves.
    const html = renderRow();
    expect(html).toContain("deepseek-v3.2");
    expect(html).toContain("fetra/cbai/deepseek-v3.2");
  });

  test("a plain server line keeps its message and gains no request fields", () => {
    const html = renderMarkup(
      createElement(LogRow, {
        line: {
          id: "line-2",
          ts: "2026-10-11T03:26:23.000Z",
          level: "warn",
          msg: "provider pool exhausted",
        },
        isNew: false,
      }),
    );
    expect(html).toContain("provider pool exhausted");
    expect(html).not.toContain("console-log-pool");
    expect(html).not.toContain("console-log-request-id");
  });

  test("a failing row carries its error code and message", () => {
    const html = renderRow({
      ...LINE,
      status: 502,
      errorCode: "upstream_unavailable",
      msg: "upstream returned 502",
    });
    expect(html).toContain("502");
    expect(html).toContain("upstream_unavailable");
    expect(html).toContain("upstream returned 502");
  });

  test("the row wraps on a phone instead of hiding its tail", () => {
    // `nowrap` + `overflow: hidden` is what truncated the model id. The mobile
    // rule has to lift both, and let the message wrap — it is prose, and
    // truncating it made errors unreadable.
    const css = readFileSync(
      new URL("../../src/styles/console.css", import.meta.url),
      "utf8",
    );
    const media = css.slice(css.indexOf("Narrow screens: wrap the row"));
    const block = /@media \(max-width: 720px\)\s*\{[\s\S]*?\n\}/.exec(media)?.[0] ?? "";
    expect(block).toContain(".console-log-row");
    expect(block).toContain("flex-wrap: wrap");
    expect(block).toContain("white-space: normal");
    expect(block).toContain("overflow-wrap: anywhere");
  });

  test("the row stays a log line, not a card", () => {
    // Reported explicitly: the detail belongs in the line, not in stacked
    // boxes. A card layout would also defeat the point of a log — scanning an
    // aligned column.
    const html = renderRow();
    expect(html).not.toContain("cl-req-card");
    expect(html).not.toContain("api-key-credential");
  });
});
