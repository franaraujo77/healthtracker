import { describe, expect, it } from "vitest";

import { LETTER_DIAGNOSTIC_PHRASE_REGEX } from "@healthtracker/validators";

import { DIAGNOSTIC_PHRASE_REGEX as ROUTE_REGEX } from "../src/routes/biomarker-suggestion-regex.ts";

/**
 * Code-review F3 (Story 4.3) — snapshot-sync test pinning the
 * diagnostic-phrase regex literal across the package boundary.
 *
 * `services/llm` cannot import `@healthtracker/validators` from
 * production code (no runtime dep — adding one would leak prompt-
 * shaping concerns into the LLM service). The validators package is
 * a **devDependency only**, used here so the test can read the
 * authoritative constant and assert the in-route duplicate matches
 * exactly. Mirrors `services/extraction/__tests__/snapshot-sync.test.ts`
 * (Story 2.3 R1-P110 + R2-P129) which solves the same drift
 * problem for the upload state machine.
 *
 * If a future contributor edits `LETTER_DIAGNOSTIC_PHRASE_REGEX` in
 * validators without updating the route's duplicate, this test fails
 * loudly. A common edit shape would be adding a new diagnostic
 * phrasing (e.g. `'você precisa'`) — without the test, the biomarker
 * suggestion path would keep emitting the new phrasing while Letter
 * generation correctly stripped it.
 */
describe("Story 4.3 F3 — diagnostic-phrase regex sync", () => {
  it("route literal exactly equals the validators canonical regex", () => {
    expect(ROUTE_REGEX.source).toBe(LETTER_DIAGNOSTIC_PHRASE_REGEX.source);
    expect(ROUTE_REGEX.flags).toBe(LETTER_DIAGNOSTIC_PHRASE_REGEX.flags);
  });

  it("both regexes match the same set of diagnostic phrases", () => {
    const cases = [
      "você tem diabetes",
      "isso indica anemia",
      "você deve tomar este remédio",
      "Você Tem Algo", // case-insensitive flag check
    ];
    for (const phrase of cases) {
      expect(ROUTE_REGEX.test(phrase)).toBe(true);
      expect(LETTER_DIAGNOSTIC_PHRASE_REGEX.test(phrase)).toBe(true);
    }
  });

  it("neither regex matches the ANVISA-compliant 'pode valer a pena discutir' framing", () => {
    const ok = "Pode valer a pena discutir esse resultado com seu médico.";
    expect(ROUTE_REGEX.test(ok)).toBe(false);
    expect(LETTER_DIAGNOSTIC_PHRASE_REGEX.test(ok)).toBe(false);
  });
});
