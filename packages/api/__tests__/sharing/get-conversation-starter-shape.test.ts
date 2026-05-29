/**
 * Story 6.2 R1-H2 / T8.3 — schema-shape contract for
 * `sharingRouter.getConversationStarter` + sibling `markStarterViewed`.
 *
 * The end-to-end DB branch table (ready / queued / failed + audit
 * row emission semantics) lives in
 * `packages/db/__tests__/integration/get-conversation-starter.integration.test.ts`
 * because the `@healthtracker/db` package owns the testcontainer
 * harness and the api package cannot import it without a cycle
 * (Story 6.1 R1-H2 fix-up established this split).
 *
 * What stays here:
 *   - the input-Zod-schema boundary contract (drift guard),
 *   - the `SHARE_TOKEN_READ_PHASE_POST_AUTH` constant pin,
 *   - shape-of-output validator.
 */
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_STARTER_FAILED_PT_BR,
  CONVERSATION_STARTER_PATIENT_FIRSTNAME_FALLBACK_PT_BR,
  conversationStarterPayloadSchema,
  getConversationStarterInputSchema,
  getConversationStarterOutputSchema,
  SHARE_TOKEN_READ_PHASE_POST_AUTH,
} from "@healthtracker/validators";

describe("getConversationStarter — schema-shape (Story 6.2 R1-H2)", () => {
  it("input schema accepts a valid uuid + hmac", () => {
    expect(
      getConversationStarterInputSchema.safeParse({
        shareTokenId: "00000000-0000-4000-8000-000000000000",
        tokenHmac: "any-string",
      }).success,
    ).toBe(true);
  });

  it("input schema rejects empty HMAC", () => {
    expect(
      getConversationStarterInputSchema.safeParse({
        shareTokenId: "00000000-0000-4000-8000-000000000000",
        tokenHmac: "",
      }).success,
    ).toBe(false);
  });

  it("output schema accepts the `ready` shape with payload", () => {
    const out = getConversationStarterOutputSchema.safeParse({
      cacheStatus: "ready",
      payload: {
        prompts: [{ text: "x" }],
        biomarkerCards: [],
      },
      patientFirstName: "Ana",
      sharedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      failureReason: null,
    });
    expect(out.success).toBe(true);
  });

  it("output schema accepts the `failed` shape with mapped pt-BR string", () => {
    const out = getConversationStarterOutputSchema.safeParse({
      cacheStatus: "failed",
      payload: null,
      patientFirstName: CONVERSATION_STARTER_PATIENT_FIRSTNAME_FALLBACK_PT_BR,
      sharedAt: new Date(),
      expiresAt: null,
      failureReason: CONVERSATION_STARTER_FAILED_PT_BR,
    });
    expect(out.success).toBe(true);
  });

  it("payload schema enforces 1..6 prompts", () => {
    expect(
      conversationStarterPayloadSchema.safeParse({
        prompts: [],
        biomarkerCards: [],
      }).success,
    ).toBe(false);
    expect(
      conversationStarterPayloadSchema.safeParse({
        prompts: Array.from({ length: 7 }, () => ({ text: "x" })),
        biomarkerCards: [],
      }).success,
    ).toBe(false);
    expect(
      conversationStarterPayloadSchema.safeParse({
        prompts: [{ text: "x" }],
        biomarkerCards: [],
      }).success,
    ).toBe(true);
  });

  it("post-auth phase constant equals 'post-auth'", () => {
    expect(SHARE_TOKEN_READ_PHASE_POST_AUTH).toBe("post-auth");
  });
});
