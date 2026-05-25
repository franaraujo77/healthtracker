import { describe, expect, it } from "vitest";

import { createStubLLMAdapter } from "../src/adapters/anthropic.ts";

describe("LLMAdapter.generateBiomarkerSuggestion — stub", () => {
  it("returns a non-empty pt-BR body containing the ANVISA anchor", async () => {
    const adapter = createStubLLMAdapter();
    const result = await adapter.generateBiomarkerSuggestion({
      system: "test",
      userPrompt: "test",
      model: "stub",
      maxTokens: 200,
    });
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.body.toLowerCase()).toContain("pode valer a pena discutir");
    expect(result.model).toBe("stub");
    expect(result.tokensUsed).toBe(0);
  });

  it("never returns content that matches the diagnostic-phrase regex", () => {
    // The fallback is a constant — the test pins it stays clean.
    const adapter = createStubLLMAdapter();
    return adapter
      .generateBiomarkerSuggestion({
        system: "test",
        userPrompt: "test",
        model: "stub",
        maxTokens: 200,
      })
      .then((result) => {
        const diagnosticRegex = /\b(você tem|isso indica|você deve)\b/iu;
        expect(diagnosticRegex.test(result.body)).toBe(false);
      });
  });
});
