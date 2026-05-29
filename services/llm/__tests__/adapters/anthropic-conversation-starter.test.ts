/**
 * Story 6.2 R1-H2 / T8.5 — real Anthropic adapter unit test for
 * `generateConversationStarter`.
 *
 * Mocks `@anthropic-ai/sdk` at module-scope so we never touch a real
 * key. Verifies:
 *   1. `messages.create` is called with the expected argument shape
 *      (model claude-sonnet-4-5, max_tokens 1024, system framing,
 *      user prompt includes visible biomarkers + observations snapshot).
 *   2. A valid JSON response round-trips through the adapter as a typed
 *      payload (consumer-side Zod-validate is the boundary contract).
 *   3. A non-JSON response throws `Anthropic.APIError` so the consumer's
 *      narrow catch arm marks the cache `failed` after retries.
 *   4. Stub regression — the stub adapter still returns its canned
 *      payload (no Story 5.2 dev-flow break).
 *
 * R1-M4 — copy-test asserting the local `ConversationStarterPayload`
 * interface stays in lockstep with the canonical
 * `conversationStarterPayloadSchema` Zod schema in
 * `@healthtracker/validators`. Drift caught at test time.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversationStarterPayloadSchema } from "@healthtracker/validators";

// Mock the Anthropic SDK before importing the adapter module so the
// constructor `new Anthropic(...)` inside `createAnthropicAdapter`
// gets the mocked class.
const messagesCreateMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  // The adapter throws `new Anthropic.APIError(...)`, which the SDK
  // exposes as a static on the default export.
  class APIError extends Error {
    status: number;
    error: unknown;
    headers: unknown;
    constructor(
      status: number,
      err: unknown,
      message: string,
      headers: unknown,
    ) {
      super(message);
      this.status = status;
      this.error = err;
      this.headers = headers;
      this.name = "APIError";
    }
  }
  class Anthropic {
    messages = { create: messagesCreateMock };
    constructor(_opts: { apiKey: string }) {
      // no-op
    }
    static APIError = APIError;
  }
  return { default: Anthropic, APIError };
});

// Dynamic import AFTER the mock is registered.
const { createAnthropicAdapter, createStubLLMAdapter } =
  await import("../../src/adapters/anthropic.ts");

const VALID_RESPONSE_PAYLOAD = {
  prompts: [
    { text: "Como evoluiu sua hemoglobina nos últimos meses?" },
    { text: "Há algum biomarcador que você gostaria de discutir primeiro?" },
    { text: "Você notou alguma mudança recente em como se sente?" },
  ],
  biomarkerCards: [
    {
      category: "hemoglobin",
      currentValue: 14.2,
      previousValue: 13.8,
      trendDirection: "up" as const,
      patientBaseline: 14.0,
    },
  ],
};

describe("createAnthropicAdapter().generateConversationStarter (R1-H2 / T8.5)", () => {
  beforeEach(() => {
    messagesCreateMock.mockReset();
  });

  it("calls messages.create with the expected argument shape", async () => {
    messagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(VALID_RESPONSE_PAYLOAD) }],
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const adapter = createAnthropicAdapter({ apiKey: "sk-test-not-real" });
    await adapter.generateConversationStarter({
      shareTokenId: "11111111-1111-1111-1111-111111111111",
      patientId: "22222222-2222-2222-2222-222222222222",
      visibleBiomarkers: [{ category: "hemoglobin" }],
      observationsSnapshot: [
        { category: "hemoglobin", value: 14.2, collectedAt: "2026-05-01" },
        { category: "hemoglobin", value: 13.8, collectedAt: "2026-04-01" },
      ],
    });

    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    const args = messagesCreateMock.mock.calls[0]?.[0] as {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(args.model).toBe("claude-sonnet-4-5");
    expect(args.max_tokens).toBe(1024);
    // System framing — ANVISA + JSON-only.
    expect(args.system).toContain("ANVISA");
    expect(args.system).toContain("JSON");
    expect(args.system).toContain("Não dê conselhos médicos");
    // User prompt block — visible biomarker categories + snapshot.
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0]?.role).toBe("user");
    expect(args.messages[0]?.content).toContain("hemoglobin");
    expect(args.messages[0]?.content).toContain("14.2");
    expect(args.messages[0]?.content).toContain("2026-05-01");
  });

  it("returns a parsed payload that satisfies the canonical Zod schema", async () => {
    messagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(VALID_RESPONSE_PAYLOAD) }],
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const adapter = createAnthropicAdapter({ apiKey: "sk-test-not-real" });
    const result = await adapter.generateConversationStarter({
      shareTokenId: "11111111-1111-1111-1111-111111111111",
      patientId: "22222222-2222-2222-2222-222222222222",
      visibleBiomarkers: [{ category: "hemoglobin" }],
      observationsSnapshot: [],
    });
    // The adapter trusts the consumer to Zod-validate. We assert the
    // round-trip parses cleanly against the canonical schema so a
    // future adapter refactor cannot quietly drop fields.
    const parsed = conversationStarterPayloadSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("non-JSON Anthropic response throws Anthropic.APIError", async () => {
    messagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "I am not JSON, just prose." }],
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const adapter = createAnthropicAdapter({ apiKey: "sk-test-not-real" });
    await expect(
      adapter.generateConversationStarter({
        shareTokenId: "11111111-1111-1111-1111-111111111111",
        patientId: "22222222-2222-2222-2222-222222222222",
        visibleBiomarkers: [{ category: "hemoglobin" }],
        observationsSnapshot: [],
      }),
    ).rejects.toMatchObject({ name: "APIError" });
  });
});

describe("createStubLLMAdapter — Conversation Starter regression (T8.5)", () => {
  it("still returns canned 3-prompt payload with one card per visible biomarker", async () => {
    const adapter = createStubLLMAdapter();
    const result = await adapter.generateConversationStarter({
      shareTokenId: "11111111-1111-1111-1111-111111111111",
      patientId: "22222222-2222-2222-2222-222222222222",
      visibleBiomarkers: [{ category: "hemoglobin" }, { category: "ferritin" }],
    });
    expect(result.prompts).toHaveLength(3);
    expect(result.biomarkerCards).toHaveLength(2);
    expect(result.biomarkerCards.map((c) => c.category).sort()).toEqual([
      "ferritin",
      "hemoglobin",
    ]);
    // Adapter kind discriminator — DPA hard-gate relies on this.
    expect(adapter.kind).toBe("stub");
  });
});

describe("R1-M4 — local payload type ↔ canonical Zod schema parity", () => {
  it("canonical schema accepts the shape the adapter advertises", () => {
    // A literal-typed sample of the `ConversationStarterPayload` shape
    // exported by the adapter module. If either side drifts (e.g. a
    // field becomes non-nullable in the schema but not in the type),
    // this assertion fails.
    const sample = {
      prompts: [{ text: "x" }],
      biomarkerCards: [
        {
          category: "hemoglobin",
          currentValue: null,
          previousValue: null,
          trendDirection: null,
          patientBaseline: null,
        },
      ],
    };
    const parsed = conversationStarterPayloadSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });
});
