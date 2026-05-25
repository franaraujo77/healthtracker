import { describe, expect, it } from "vitest";

import { buildBiomarkerSuggestionPrompt } from "../src/prompts/biomarker-suggestion-prompt.ts";

describe("buildBiomarkerSuggestionPrompt", () => {
  it("includes the biomarker name + value + unit verbatim", () => {
    const prompt = buildBiomarkerSuggestionPrompt({
      biomarkerName: "Ferritina",
      value: 47,
      unitUcum: "ng/mL",
    });
    expect(prompt).toContain("Ferritina");
    expect(prompt).toContain("47");
    expect(prompt).toContain("ng/mL");
  });

  it("instructs Claude to return a single question terminating in '?'", () => {
    const prompt = buildBiomarkerSuggestionPrompt({
      biomarkerName: "Ferritina",
      value: 47,
      unitUcum: "ng/mL",
    });
    expect(prompt).toMatch(/exatamente uma pergunta/);
    expect(prompt).toContain("?");
  });

  it("carries the 'pode valer a pena discutir' anchor", () => {
    const prompt = buildBiomarkerSuggestionPrompt({
      biomarkerName: "Ferritina",
      value: 47,
      unitUcum: "ng/mL",
    });
    expect(prompt).toContain("pode valer a pena discutir");
  });

  // Anti-pattern guard: never include LOINC or confidence in the
  // user prompt (architecture enforcement rule 6). The builder
  // signature does not accept LOINC, so this test pins the
  // type-level invariant: trying to pass loincCode is a TypeError.
  it("does not accept a loincCode field (compile-time guard)", () => {
    // @ts-expect-error — loincCode is intentionally absent from
    // the builder args; this assertion fails at compile time if the
    // shape is ever broadened.
    buildBiomarkerSuggestionPrompt({
      biomarkerName: "x",
      value: 1,
      unitUcum: "u",
      loincCode: "should-not-be-here",
    });
  });
});
