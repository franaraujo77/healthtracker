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
  /** Called once when streaming completes; `body` is the full text. */
  onDone: (result: {
    body: string;
    model: string;
    tokensUsed: number;
    firstTokenMs: number | null;
  }) => void;
  /** Called once when streaming errors out. */
  onError: (err: unknown) => void;
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
        args.callbacks.onDone({
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
        args.callbacks.onDone({
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
  };
}
