/**
 * Story 5.2 T8.5 — Conversation Starter stub-adapter coverage.
 *
 * The full consumer integration test (DB writes + audit row) requires
 * a Postgres testcontainer + pg-boss + the schema applied; we keep it
 * out of the per-process unit suite here and rely on the integration
 * runner in CI. This file pins the stub-adapter contract — 3 prompts,
 * one card per visible biomarker, deterministic shape — that the
 * doctor surface (Story 6.2) consumes.
 *
 * Story 6.2 R1 fix-up: the real Anthropic adapter is now implemented.
 * Its argument-shape / JSON-parse / Anthropic.APIError-rethrow contract
 * is covered by `adapters/anthropic-conversation-starter.test.ts`
 * (vi.mock'd Anthropic SDK). The old "throws Not implemented" assertion
 * was removed as obsolete.
 */
import { describe, expect, it } from "vitest";

import { createStubLLMAdapter } from "../src/adapters/anthropic.ts";

describe("conversation starter — stub LLM adapter", () => {
  it("returns 3 prompts + one card per visible biomarker", async () => {
    const adapter = createStubLLMAdapter();
    const payload = await adapter.generateConversationStarter({
      shareTokenId: "share-1",
      patientId: "patient-1",
      visibleBiomarkers: [{ category: "ferritin" }, { category: "hemoglobin" }],
    });
    expect(payload.prompts).toHaveLength(3);
    expect(payload.prompts[0]?.text.length).toBeGreaterThan(0);
    expect(payload.biomarkerCards).toHaveLength(2);
    expect(payload.biomarkerCards[0]?.category).toBe("ferritin");
    expect(payload.biomarkerCards[1]?.category).toBe("hemoglobin");
  });

  it("returns zero biomarker cards when no biomarker is visible", async () => {
    const adapter = createStubLLMAdapter();
    const payload = await adapter.generateConversationStarter({
      shareTokenId: "share-2",
      patientId: "patient-2",
      visibleBiomarkers: [],
    });
    expect(payload.biomarkerCards).toHaveLength(0);
    expect(payload.prompts).toHaveLength(3);
  });

  it("emits deterministic output across calls (idempotent under retries)", async () => {
    const adapter = createStubLLMAdapter();
    const a = await adapter.generateConversationStarter({
      shareTokenId: "x",
      patientId: "y",
      visibleBiomarkers: [{ category: "ferritin" }],
    });
    const b = await adapter.generateConversationStarter({
      shareTokenId: "x",
      patientId: "y",
      visibleBiomarkers: [{ category: "ferritin" }],
    });
    expect(a).toEqual(b);
  });
});
