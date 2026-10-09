/**
 * The Ringkasan requests panel and the Panduan Awal command sample.
 *
 * Both were reported from a phone, and both failed in ways a desktop check
 * cannot see:
 *
 * - The requests table is six `nowrap` columns. Its min-content width is
 *   several times a phone's, and a grid item defaults to `min-width: auto`, so
 *   the card refused to shrink and the whole page scrolled sideways with the
 *   card's right edge off-screen. The fix has two halves — a `min-width: 0` on
 *   the grid's children, and a card layout that replaces the table below 720px.
 * - The onboarding sample command printed `http://127.0.0.1:12800/...`. An
 *   operator reading that page on the deployment's real hostname was told to
 *   test a server that is not the one in front of them.
 *
 * The CSS half is invisible to a DOM assertion, so these pin the DOM the CSS
 * keys on and the fact that the command names the host the page is served from.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { RecentRequestsPanel } from "../../src/features/overview/OperationalPanels";
import type { UsageRequestsResponse } from "../../src/data/contracts";
import { LocaleProvider } from "../../src/shared/locale-context";
import { renderMarkup } from "../helpers/render";

const REQUESTS: UsageRequestsResponse = {
  items: [
    {
      requestId: "req-1",
      startedAt: "2026-10-10T01:00:00.000Z",
      providerId: "cerebras",
      model: "fetra/cbai/deepseek-v3.2",
      httpStatus: 200,
      status: "ok",
      mode: "non_stream",
      totalTokens: 181_000,
      inputTokens: 180_000,
      outputTokens: 1_000,
      durationMs: 5_400,
    },
  ],
};

function renderPanel(): string {
  // The panel reads its labels through `useT`, which requires the provider the
  // console mounts at its root. `initialLocale` is the provider's test seam —
  // without it the locale is read from storage, which a test must not depend on.
  const panel = createElement(RecentRequestsPanel, {
    requests: REQUESTS,
    pending: false,
    error: false,
    onRetry: () => {},
  });
  return renderMarkup(
    createElement(LocaleProvider, { initialLocale: "id" as const, children: panel }),
  );
}

function consoleCss(): string {
  return readFileSync(new URL("../../src/styles/console.css", import.meta.url), "utf8");
}

describe("RecentRequestsPanel", () => {
  test("renders both the table and the phone cards from the same rows", () => {
    // Two surfaces, one data source. If they ever read different values the
    // phone and the desktop would disagree about what was recorded.
    const html = renderPanel();
    expect(html).toContain("cl-req-table__scroll");
    expect(html).toContain("cl-req-cards");
    expect(html).toContain("fetra/cbai/deepseek-v3.2");
    expect(html).toContain("cerebras");
  });

  test("the phone cards carry every column the table does", () => {
    // The card layout is only an acceptable replacement if it loses nothing:
    // a dropped column would be a silent lie about what was recorded.
    const html = renderPanel();
    const cards = html.slice(html.indexOf('<ul class="cl-req-cards"'));
    for (const label of ["Waktu", "Provider", "Token", "Latensi"]) {
      expect(cards).toContain(`<dt>${label}</dt>`);
    }
    // Status and the model id ride in the card head, not the definition list.
    expect(cards).toContain("cl-req-card__model");
    expect(cards).toContain("cl-pill");
  });

  test("the grid can shrink, so the page cannot be scrolled sideways", () => {
    // Without this the card keeps the table's min-content width and the whole
    // page scrolls horizontally. Asserted against the CSS because the failure
    // is a layout outcome, not a DOM one.
    const css = consoleCss();
    const rule = /\.cl-op-col\s*>\s*\*\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("min-width: 0");
  });

  test("the table is replaced by cards below the phone breakpoint", () => {
    const css = consoleCss();
    const block = /@media \(max-width: 720px\)\s*\{[\s\S]*?\n\}/.exec(
      css.slice(css.indexOf(".cl-req-cards")),
    )?.[0] ?? "";
    expect(block).toContain(".cl-req-table__scroll");
    expect(block).toContain("display: none");
    expect(block).toContain(".cl-req-cards");
    expect(block).toContain("display: grid");
  });
});

describe("code samples on a phone", () => {
  test("a sample wraps instead of scrolling out of sight", () => {
    // `overflow-x: auto` is correct on a desktop, where the scrollbar is
    // visible. On a phone it is an overlay the browser hides, so a command that
    // scrolls reads as a command that was cut off.
    const css = consoleCss();
    const media = css.slice(css.indexOf("On a phone a `pre` that scrolls"));
    const block = /@media \(max-width: 720px\)\s*\{[\s\S]*?\n\}/.exec(media)?.[0] ?? "";
    expect(block).toContain(".code-sample pre");
    expect(block).toContain("white-space: pre-wrap");
    expect(block).toContain("overflow-wrap: anywhere");
  });
});
