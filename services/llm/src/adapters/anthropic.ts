import Anthropic from "@anthropic-ai/sdk";

import { buildConversationStarterPrompt } from "../prompts/conversation-starter.js";

/**
 * Story 4.1 — LLM adapter for streamed Letter generation.
 *
 * The adapter wraps `anthropic.messages.stream({...})` and forwards
 * each `text_delta` event to `onToken` as it arrives. We deliberately
 * do NOT buffer (NFR-P2: first token < 3 s; buffering kills the
 * budget). On the first delta the adapter records `firstTokenMs` and
 * exposes it via the returned promise so the consumer can log /
 * surface the metric.
 *
 * Errors are narrowed inside the consumer (`generate-letter.ts`) —
 * this adapter just rethrows whatever Anthropic gives us so the
 * consumer can decide based on `error instanceof Anthropic.APIError`,
 * `Anthropic.APIConnectionError`, etc.
 */

export interface LetterStreamCallbacks {
  /** Called once for every `text_delta` event. */
  onToken: (token: string) => void;
  /**
   * Called once when streaming completes; `body` is the full text.
   *
   * **Code-review F4 (Story 4.1):** signature is `Promise<void>` and
   * the adapter `await`s it before resolving `streamLetter`. The
   * pg-boss consumer therefore does NOT mark the job complete until
   * the caller's post-stream DB writes (status='complete' UPDATE +
   * letter.generated audit + push enqueue) have committed. Without
   * this await, a worker crash between `finalMessage()` and the DB
   * tx commit left the letter stuck at `generating` forever and
   * pg-boss never retried (the job was already marked done).
   */
  onDone: (result: {
    body: string;
    model: string;
    tokensUsed: number;
    firstTokenMs: number | null;
  }) => Promise<void> | void;
  /** Called once when streaming errors out. */
  onError: (err: unknown) => void;
}

export interface BiomarkerSuggestionResult {
  body: string;
  model: string;
  tokensUsed: number;
}

/**
 * Story 5.2 — Conversation Starter pre-gen payload. Shape locked
 * here so the Epic 6 doctor-side surface (Story 6.2) can consume
 * exactly this JSONB. The stub adapter returns canned values; the
 * real Anthropic prompt + system message is Epic 6's territory
 * (DPA + Conversation Starter prompt land together).
 */
export interface ConversationStarterPrompt {
  text: string;
}
export interface ConversationStarterBiomarkerCard {
  category: string;
  currentValue: number | null;
  previousValue: number | null;
  trendDirection: "up" | "down" | "flat" | null;
  patientBaseline: number | null;
}
export interface ConversationStarterPayload {
  prompts: ConversationStarterPrompt[];
  biomarkerCards: ConversationStarterBiomarkerCard[];
}

export interface ConversationStarterInput {
  shareTokenId: string;
  patientId: string;
  visibleBiomarkers: { category: string }[];
  /**
   * Story 6.2 T7.3 — per-category top-3 observations snapshot, fetched
   * by the consumer via a service-role window-function query. The
   * adapter forwards these into the user prompt block. Stub adapter
   * ignores them (canned payload).
   */
  observationsSnapshot?: ConversationStarterObservation[];
}

/**
 * Story 6.2 — single observation row used in the user-prompt block.
 * Pre-computed by the consumer (top-3 per visible category via window
 * function); the adapter does NOT re-query.
 */
export interface ConversationStarterObservation {
  category: string;
  value: number;
  /** ISO `yyyy-mm-dd` collection date. */
  collectedAt: string;
}

/**
 * Story 6.2 Q5 — discriminated adapter kind so the consumer can
 * hard-gate the "DPA-signed" cache state on a typed property instead
 * of a runtime string sniff. The boot-time selection in `index.ts`
 * picks `"real"` (when `ANTHROPIC_API_KEY` is set) or `"stub"`
 * (otherwise) and stamps the resulting adapter; the consumer reads
 * `adapter.kind` BEFORE setting `cache.status = 'ready'` when
 * `NODE_ENV === 'production'`.
 */
export type LLMAdapterKind = "real" | "stub";

export interface LLMAdapter {
  /**
   * Q5 hard-gate marker. The consumer's "set ready" arm refuses to
   * persist `ready` when this is `"stub"` and `NODE_ENV ===
   * 'production'`. See `consumers/generate-conversation-starter.ts`.
   */
  readonly kind: LLMAdapterKind;
  streamLetter(args: {
    system: string;
    userPrompt: string;
    model: string;
    maxTokens: number;
    callbacks: LetterStreamCallbacks;
    abortSignal?: AbortSignal;
  }): Promise<void>;
  /**
   * Story 4.3 — synchronous (non-streaming) Anthropic call for the
   * biomarker-suggestion path. ~50-word output; Anthropic
   * `messages.create` returns a single completion. The caller applies
   * any post-filter (ANVISA regex) on the returned body.
   */
  generateBiomarkerSuggestion(args: {
    system: string;
    userPrompt: string;
    model: string;
    maxTokens: number;
  }): Promise<BiomarkerSuggestionResult>;
  /**
   * Story 5.2 — Conversation Starter pre-gen. The stub returns a
   * deterministic canned payload (3 prompts + one card per visible
   * biomarker). The real Anthropic adapter throws — Story 6.2
   * lands the real prompt + DPA gate.
   */
  generateConversationStarter(
    input: ConversationStarterInput,
  ): Promise<ConversationStarterPayload>;
}

/**
 * Story 6.2 AC9 — Anthropic model used for the Conversation Starter.
 * Centralised here so the adapter + test stub agree.
 */
const CONVERSATION_STARTER_MODEL = "claude-sonnet-4-5";

export function createAnthropicAdapter(opts: { apiKey: string }): LLMAdapter {
  const client = new Anthropic({ apiKey: opts.apiKey });

  return {
    kind: "real" as const,
    async streamLetter(args) {
      const startedAt = Date.now();
      let firstTokenMs: number | null = null;
      const chunks: string[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const stream = client.messages.stream({
          model: args.model,
          max_tokens: args.maxTokens,
          system: args.system,
          messages: [{ role: "user", content: args.userPrompt }],
        });
        // The SDK exposes both event-emitter and async-iter; we use
        // the event-emitter so we capture text deltas without
        // building an intermediate iterator.
        stream.on("text", (delta: string) => {
          firstTokenMs ??= Date.now() - startedAt;
          chunks.push(delta);
          args.callbacks.onToken(delta);
        });
        if (args.abortSignal) {
          const onAbort = (): void => stream.abort();
          if (args.abortSignal.aborted) onAbort();
          else
            args.abortSignal.addEventListener("abort", onAbort, { once: true });
        }
        const finalMessage = await stream.finalMessage();
        inputTokens = finalMessage.usage.input_tokens;
        outputTokens = finalMessage.usage.output_tokens;
        // F4 — await onDone so the consumer's post-stream DB writes
        // commit before this method resolves (and before pg-boss
        // marks the job complete).
        await args.callbacks.onDone({
          body: chunks.join(""),
          model: finalMessage.model,
          tokensUsed: inputTokens + outputTokens,
          firstTokenMs,
        });
      } catch (err) {
        args.callbacks.onError(err);
        throw err;
      }
    },
    async generateConversationStarter(
      input: ConversationStarterInput,
    ): Promise<ConversationStarterPayload> {
      // Story 6.2 AC9 — non-streaming `messages.create`. The
      // Conversation Starter is one JSON payload, not a token stream.
      // Prompt + system message live in
      // `services/llm/src/prompts/conversation-starter.ts` so reviewers
      // can sign off on the framing in isolation. Response is JSON-only
      // (system message constrains); Zod validates at the consumer.
      const { system, userPrompt } = buildConversationStarterPrompt({
        visibleBiomarkers: input.visibleBiomarkers,
        observationsSnapshot: input.observationsSnapshot ?? [],
      });
      const response = await client.messages.create({
        model: CONVERSATION_STARTER_MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userPrompt }],
      });
      const text = response.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (parseErr) {
        // Anthropic returned non-JSON despite the system message —
        // surface as an Anthropic.APIError shape so the consumer's
        // narrow-catch arm marks the cache `failed` after retries.
        // Wrap the original message for operator forensics.
        throw new Anthropic.APIError(
          500,
          {
            error: {
              type: "invalid_response",
              message: `non-JSON response: ${
                parseErr instanceof Error ? parseErr.message : "unknown"
              }`,
            },
          },
          "non-JSON response",
          {},
        );
      }
      // The adapter trusts the consumer to Zod-validate via
      // `conversationStarterPayloadSchema.parse(raw)`. Returning the
      // unvalidated shape here would silently widen the contract; the
      // consumer's wrapper handles validation + the `failed` mark.
      return raw as ConversationStarterPayload;
    },
    async generateBiomarkerSuggestion(args) {
      const response = await client.messages.create({
        model: args.model,
        max_tokens: args.maxTokens,
        system: args.system,
        messages: [{ role: "user", content: args.userPrompt }],
      });
      const text = response.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      return {
        body: text.trim(),
        model: response.model,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      };
    },
  };
}

/**
 * Stub adapter used when `ANTHROPIC_API_KEY` is not configured. Emits
 * a short pt-BR placeholder body so the SSE plumbing can be exercised
 * end-to-end in dev / E2E. Never returned by `createAnthropicAdapter`;
 * the bootstrap in `index.ts` picks one or the other.
 */
export function createStubLLMAdapter(): LLMAdapter {
  const stubBody =
    "Olá. Esta é uma carta de exemplo gerada sem chave da API da Anthropic. " +
    "Sua história de saúde está sendo registrada — pode valer a pena " +
    "discutir os próximos passos com seu médico de confiança.";
  return {
    kind: "stub" as const,
    async streamLetter(args) {
      const startedAt = Date.now();
      let firstTokenMs: number | null = null;
      try {
        const tokens = stubBody.split(/(\s+)/);
        for (const tok of tokens) {
          if (args.abortSignal?.aborted) {
            throw new Error("aborted");
          }
          firstTokenMs ??= Date.now() - startedAt;
          args.callbacks.onToken(tok);
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        await args.callbacks.onDone({
          body: stubBody,
          model: "stub",
          tokensUsed: 0,
          firstTokenMs,
        });
      } catch (err) {
        args.callbacks.onError(err);
        throw err;
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- deterministic stub for Story 5.2
    async generateConversationStarter(
      input: ConversationStarterInput,
    ): Promise<ConversationStarterPayload> {
      // Deterministic canned payload — used in dev/CI until the real
      // Anthropic prompt + DPA gate land in Story 6.2. Three prompts
      // are fixed; one biomarker card per visible category mirrors
      // the input so tests can assert on the round-trip.
      return {
        prompts: [
          {
            text: "Como evoluiu sua hemoglobina nos últimos 6 meses?",
          },
          {
            text: "Há algum biomarcador que você gostaria de discutir primeiro?",
          },
          { text: "Você notou alguma mudança recente em como se sente?" },
        ],
        biomarkerCards: input.visibleBiomarkers.map((b) => ({
          category: b.category,
          currentValue: null,
          previousValue: null,
          trendDirection: null,
          patientBaseline: null,
        })),
      };
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- stub returns instantly; the real adapter is async
    async generateBiomarkerSuggestion() {
      // Story 4.3 — pt-BR placeholder used when ANTHROPIC_API_KEY is
      // unset (dev/CI). Contains the "pode valer a pena discutir"
      // anchor so the AC2 regex post-filter never strips it.
      return {
        body:
          "Pode valer a pena discutir esse resultado com o seu médico " +
          "para entender o que essa tendência significa no seu caso.",
        model: "stub",
        tokensUsed: 0,
      };
    },
  };
}
