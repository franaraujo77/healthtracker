import Anthropic from "@anthropic-ai/sdk";

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

export interface LLMAdapter {
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
}

export function createAnthropicAdapter(opts: { apiKey: string }): LLMAdapter {
  const client = new Anthropic({ apiKey: opts.apiKey });

  return {
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
