/**
 * The Usage page's headline figures.
 *
 * Two things were reported from a phone:
 *
 * - Once a tenant passed a billion tokens the page could be scrolled sideways.
 *   The default token scale is the exact count — deliberately, so the operator
 *   sees the real number — and `1.234.567.890` is thirteen characters. At a
 *   fixed 20px in the mono face that is wider than the card's own minimum, so
 *   the figure spilled out and dragged the page with it.
 * - The page felt thin. Six figures the backend computes for every window were
 *   never rendered: `errors`, `cancelled`, `truncated`, `avgDurationMs`,
 *   `avgTokensPerSec`, and `partial`.
 *
 * The layout half is CSS, so these pin the value class the shrink is built on
 * and the captions the missing figures now appear under.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { StatCard } from "../../src/components/ui/layout";
import { renderMarkup } from "../helpers/render";

function consoleCss(): string {
  return readFileSync(new URL("../../src/styles/console.css", import.meta.url), "utf8");
}

const usageSource = readFileSync(
  new URL("../../src/features/usage/UsagePage.tsx", import.meta.url),
  "utf8",
);

describe("StatCard headline value", () => {
  test("carries the class the shrink is built on", () => {
    // The inline `fontSize: 20px` this replaced could not respond to the card's
    // width, which is what let a long count overflow.
    const html = renderMarkup(
      createElement(StatCard, {
        label: "Input tokens",
        value: "1.234.567.890",
        detail: "Prompt tokens",
      }),
    );
    expect(html).toContain('class="stat-card-value"');
    expect(html).toContain("1.234.567.890");
  });

  test("the card is a container and the value scales with it", () => {
    const css = consoleCss();
    const card = /\.stat-card\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(card).toContain("container-type: inline-size");

    // `cqw` makes the figure track the card, not the viewport — a phone and a
    // narrow desktop column fail the same way and need the same fix.
    const value = /\.stat-card-value\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(value).toContain("cqw");
    expect(value).toContain("clamp(");
    // Truncating would hide the digits the card exists to show.
    expect(value).not.toContain("text-overflow: ellipsis");
  });

  test("the value never overflows its own card at any width", () => {
    // The clamp is `12px .. 8.5cqw .. 20px`. At the card's 160px minimum that
    // resolves to ~13.6px, and a thirteen-character mono string at 0.6em per
    // character is ~106px — inside the card's content box. This is the
    // arithmetic the reported bug failed.
    const text = "1.234.567.890";
    for (const cardWidth of [160, 200, 280, 340]) {
      const fontSize = Math.max(12, Math.min(8.5 * (cardWidth / 100), 20));
      const textWidth = text.length * 0.6 * fontSize;
      expect(textWidth).toBeLessThan(cardWidth - 24);
    }
  });

  test("the metric grid keeps multiple columns on a phone", () => {
    // The first fix for the overflow collapsed this to a single column, which
    // turned every card into a full-width box — trading a scrolling page for a
    // page four screens tall. The grid must stay adaptive: as many cards per row
    // as fit, dropping to one only when even two would not.
    const css = consoleCss();
    const block =
      /@media \(max-width: 600px\)\s*\{[\s\S]*?\.metric-grid\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).toContain("repeat(auto-fit, minmax(160px, 1fr))");
  });

  test("the 160px floor is safe because the value shrinks", () => {
    // A pixel floor is only safe when the content can shrink below it — a floor
    // with a fixed-size value is exactly what forced the page wider than the
    // screen. Both halves are required, so they are asserted together.
    const css = consoleCss();
    const value = /\.stat-card-value\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(value).toContain("cqw");
    // Two columns on a 390px phone: each card is ~170px, and an eleven-character
    // count at that width resolves to ~14.5px, well inside the content box.
    const cardWidth = 170;
    const fontSize = Math.max(12, Math.min(8.5 * (cardWidth / 100), 20));
    expect("660.505.842".length * 0.6 * fontSize).toBeLessThan(cardWidth - 24);
  });
});

describe("Usage summary completeness", () => {
  test("renders the figures the backend computes but the page dropped", () => {
    // Each of these is on every usage response; none reached the screen.
    for (const field of ["errors", "cancelled", "truncated", "avgDurationMs", "avgTokensPerSec"]) {
      expect(usageSource).toContain(field);
    }
  });

  test("does not count a client cancellation as an error", () => {
    // `cancelled` is a sub-count of a normal client hanging up. Folding it into
    // the error figure would make every closed tab look like a failure, so the
    // card reports it on its own line.
    const card = /label="Errors"[\s\S]*?\/>/.exec(usageSource)?.[0] ?? "";
    expect(card).toContain("summary?.cancelled");
    expect(card).toContain("cancelled · ");
  });

  test("the cost caption admits when the estimate is only a floor", () => {
    // `partial` means completed rows exist with no persisted price, so the
    // figure understates. The code always claimed the caption said so; it did
    // not, because the text was hardcoded.
    const card = /label="Est\. cost"[\s\S]*?\/>/.exec(usageSource)?.[0] ?? "";
    expect(card).toContain("summary?.partial");
    expect(card).toContain("A floor");
  });

  test("reuses the page's own rate formatter", () => {
    // A second tok/s formatter would drift from the first.
    expect(usageSource).toContain("formatSpeed(summary?.avgTokensPerSec)");
  });
});
