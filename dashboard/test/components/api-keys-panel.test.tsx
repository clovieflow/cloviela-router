/**
 * The API credentials list, as a phone sees it.
 *
 * The row is one flex line: identity on the left, its controls on the right.
 * On a narrow screen that layout failed in a way a desktop check never showed —
 * the controls are `flexShrink: 0`, so they kept their full width and squeezed
 * the identity block to nothing, drawing the key's name under the enable toggle
 * and cutting the trailing control off past the card edge.
 *
 * The fix is CSS (a container query on `.api-key-credentials`), which is
 * invisible to a DOM assertion — so these tests pin what the CSS keys on and
 * the one thing the collapse could silently break: the buttons lose their
 * visible text, so their accessible name must come from `aria-label` or a
 * screen reader announces four unnamed buttons.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { ApiKeysPanel } from "../../src/components/ApiKeysPanel";
import type { ApiKeyResponse } from "../../src/data/contracts";
import { renderMarkup } from "../helpers/render";

const KEY: ApiKeyResponse = {
  id: "11111111-2222-3333-4444-555555555555",
  label: "Kevra",
  enabled: true,
  keyMode: "personal",
  scopes: [],
  keyPrefix: "Rk_test",
  requestsPerMinute: undefined,
  dailyTokenLimit: undefined,
  monthlyTokenLimit: undefined,
  lifetimeTokenBudget: undefined,
  modelAccessMode: "whitelist",
  modelList: ["a"],
  maxConcurrentRequests: undefined,
  createdAt: "2026-10-10T00:00:00.000Z",
  tokensConsumed: 0,
};

function renderPanel(key: ApiKeyResponse = KEY): string {
  return renderMarkup(createElement(ApiKeysPanel), {
    seed: [
      { key: ["console", "api-keys"], data: [key] },
      { key: ["console", "session"], data: null },
    ],
  });
}

describe("ApiKeysPanel credential rows", () => {
  test("emits the row structure the responsive CSS targets", () => {
    // Each of these classes is a hook the container query relies on. Renaming
    // one would not fail any other test — it would just quietly restore the
    // broken phone layout. Matched as whole class attributes because
    // `api-key-credential` is a prefix of its own children's class names.
    const html = renderPanel();
    expect(html).toContain("api-key-credentials");
    expect(html).toContain('class="api-key-credential"');
    expect(html).toContain('class="api-key-credential-identity"');
    expect(html).toContain('class="api-key-credential-actions"');
    expect(html).toContain('class="api-key-credential-meta"');
  });

  test("keeps the identity block from being squeezed by the controls", () => {
    // `flex: 1 1 260px` with `min-width: 0` is what makes the controls wrap to
    // their own line instead of compressing this block to zero width. Without
    // it the name and the toggle overlap again.
    const css = readFileSync(
      new URL("../../src/styles/console.css", import.meta.url),
      "utf8",
    );
    const rule = /\.api-key-credential-identity\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("flex: 1 1 260px");
    expect(rule).toContain("min-width: 0");
  });

  test("stacks the row and wraps the limits once the row is narrow", () => {
    const css = readFileSync(
      new URL("../../src/styles/console.css", import.meta.url),
      "utf8",
    );
    // The container query itself: without it nothing collapses on a phone.
    expect(css).toContain("@container api-key-credentials (max-width: 560px)");
    // Two columns instead of eight stacked lines, which is what made one card
    // several screens tall.
    const meta = /@container api-key-credentials[\s\S]*?\.api-key-credential-meta\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(meta).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  test("every action button keeps an accessible name once its text is hidden", () => {
    // The collapse hides `.btn-label` and leaves the icon. The accessible name
    // must survive that, or a screen reader hears four unnamed buttons.
    const html = renderPanel();
    for (const name of [
      "Edit Kevra",
      "Share Kevra",
      "Rotate Kevra",
      "Revoke Kevra",
    ]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    // And the enable toggle, which has no visible text at all.
    expect(html).toContain('aria-label="Disable Kevra"');
  });

  test("action buttons are the collapse-capable variant, not fixed-size ones", () => {
    // `btn-labeled` + a `.btn-label` span is the pair the `@container` rule
    // hides. A `btn-sm` button would keep its text and overflow the row.
    // Scoped to the credential row: the card header's "Create Key" is a
    // deliberately fixed-size button and is not part of this. The header
    // renders before the row, so slicing from the row's opening tag leaves
    // exactly the row's own buttons.
    const html = renderPanel();
    const row = html.slice(html.indexOf('<div class="api-key-credential"'));
    expect(row.length).toBeGreaterThan(0);
    expect(row).toContain("btn-labeled");
    expect(row).toContain('<span class="btn-label">Edit</span>');
    const rowButtons = [...row.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) =>
      (m[1] ?? "").split(/\s+/),
    );
    expect(rowButtons.length).toBeGreaterThan(0);
    for (const tokens of rowButtons) expect(tokens).not.toContain("btn-sm");
  });

  test("a share template swaps Share for Recipients without losing its name", () => {
    const html = renderPanel({ ...KEY, keyMode: "share" });
    expect(html).toContain('<span class="btn-label">Recipients</span>');
    expect(html).toContain('aria-label="Recipients for Kevra"');
    // Rotate is personal-only: a share template has no credential of its own.
    expect(html).not.toContain("Rotate Kevra");
  });

  test("a revoked key offers no controls that would act on a dead credential", () => {
    const html = renderPanel({ ...KEY, revokedAt: "2026-10-10T01:00:00.000Z" });
    expect(html).not.toContain("Rotate Kevra");
    expect(html).not.toContain("Share Kevra");
    // Revoke stays, disabled, so the row keeps its shape and the button does
    // not vanish out from under a pointer.
    expect(html).toContain("Revoke Kevra");
    expect(html).toContain("disabled");
  });
});
