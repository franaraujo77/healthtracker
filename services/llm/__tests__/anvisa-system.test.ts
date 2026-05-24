import { describe, expect, it } from "vitest";

import { ANVISA_SYSTEM_PROMPT } from "../src/prompts/anvisa-system.ts";

describe("ANVISA system prompt", () => {
  it("contains the pode-valer-discutir framing", () => {
    expect(ANVISA_SYSTEM_PROMPT).toContain("pode valer a pena discutir");
  });

  it("forbids stating or implying a diagnosis", () => {
    expect(ANVISA_SYSTEM_PROMPT.toLowerCase()).toContain("diagnosis");
    expect(ANVISA_SYSTEM_PROMPT).toMatch(
      /never state, imply, or suggest a diagnosis/i,
    );
  });

  it("forbids specific medication or dose recommendations", () => {
    expect(ANVISA_SYSTEM_PROMPT).toMatch(
      /never recommend specific medications, doses, or treatments/i,
    );
  });
});
