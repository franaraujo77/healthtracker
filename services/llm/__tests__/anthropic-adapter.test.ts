import { describe, expect, it } from "vitest";

import { createStubLLMAdapter } from "../src/adapters/anthropic.ts";

describe("stub LLM adapter", () => {
  it("streams tokens and reports first-token latency + final body", async () => {
    const adapter = createStubLLMAdapter();
    const tokens: string[] = [];
    let done: {
      body: string;
      model: string;
      tokensUsed: number;
      firstTokenMs: number | null;
    } | null = null;
    await adapter.streamLetter({
      system: "test",
      userPrompt: "test",
      model: "stub",
      maxTokens: 64,
      callbacks: {
        onToken: (t) => tokens.push(t),
        onDone: (result) => {
          done = result;
        },
        onError: () => {
          /* ignore */
        },
      },
    });
    expect(tokens.length).toBeGreaterThan(0);
    expect(done).not.toBeNull();
    expect(done!.body).toContain("pode valer a pena discutir");
    expect(done!.firstTokenMs).not.toBeNull();
    expect(done!.firstTokenMs!).toBeGreaterThanOrEqual(0);
  });
});
