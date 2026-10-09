/**
 * The onboarding sample command.
 *
 * It printed a hardcoded `http://127.0.0.1:12800/v1/chat/completions`, and a
 * hardcoded `{model}` placeholder that was never substituted. Both were wrong
 * in the same way: the panel is read by an operator on the deployment's real
 * hostname, and the sample told them to test a server that is not the one in
 * front of them — it fails for anyone not sitting on the box, which is almost
 * everyone. The model placeholder made the one line they were meant to paste
 * un-pasteable.
 *
 * The page's own origin is the only correct host, and the catalog is the only
 * correct model id, so both are asserted here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(
  new URL("../../src/routes/Onboarding.tsx", import.meta.url),
  "utf8",
);

describe("Onboarding sample command", () => {
  test("names the host the page is served from, never a literal", () => {
    // A literal host is the bug. `window.location.origin` is the fix.
    expect(SOURCE).not.toContain("127.0.0.1:12800");
    expect(SOURCE).toContain("window.location.origin");
    expect(SOURCE).toContain("curl -sS ${origin}/v1/chat/completions");
  });

  test("substitutes a real model id from the catalog", () => {
    // `{model}` reached the operator unsubstituted; the catalog supplies a
    // qualified id when one exists, and the placeholder is only the fallback
    // for an install with no models yet.
    expect(SOURCE).toContain("useAllModelsCatalog");
    expect(SOURCE).toContain('return real?.qualified ?? "{model}"');
    expect(SOURCE).toContain("${sampleModel}");
  });

  test("keeps the key a placeholder, because it is not known at render time", () => {
    // The gateway key is shown once, when it is created. The sample cannot
    // invent it, and a plausible-looking value would be worse than a marker.
    expect(SOURCE).toContain("Bearer {key}");
  });
});
