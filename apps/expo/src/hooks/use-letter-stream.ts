import { useEffect, useState } from "react";

import { LETTER_STREAM_ROUTE } from "@healthtracker/validators";

import { env } from "~/env";
import { supabase } from "~/lib/supabase";

/**
 * Story 4.1 — SSE consumer for the LetterReader.
 *
 * Connects to `${EXPO_PUBLIC_LLM_SERVICE_URL}/api/stream/letter/:letterId`
 * with `Authorization: Bearer <supabase access_token>`. React Native's
 * built-in `EventSource` does not forward custom headers reliably, so
 * we implement the SSE parser on top of `fetch` + `ReadableStream`
 * (RN 0.81 supports the streaming `fetch` body via Hermes' undici-
 * style polyfill).
 *
 * Cancellation is coordinated via the `AbortController.signal` —
 * `controller.abort()` in the cleanup terminates the in-flight
 * fetch + reader and short-circuits the SSE-frame loop.
 *
 * Does NOT auto-reconnect on transport failure — that is Story 4.2's
 * re-read responsibility.
 */

export type LetterStreamState =
  | { status: "connecting" }
  | { status: "streaming"; body: string }
  | { status: "complete"; body: string }
  | { status: "error"; code: string };

interface SseEvent {
  type: string;
  content?: string;
  code?: string;
}

export function useLetterStream(letterId: string): LetterStreamState {
  const [state, setState] = useState<LetterStreamState>({
    status: "connecting",
  });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let accumulated = "";

    const setIfNotAborted = (next: LetterStreamState): void => {
      if (!signal.aborted) setState(next);
    };

    const run = async (): Promise<void> => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setIfNotAborted({ status: "error", code: "UNAUTHENTICATED" });
        return;
      }
      const url = `${env.EXPO_PUBLIC_LLM_SERVICE_URL}${LETTER_STREAM_ROUTE(letterId)}`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${data.session.access_token}`,
          },
          signal,
        });
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setIfNotAborted({ status: "error", code: "LETTER_UNAVAILABLE" });
        return;
      }
      if (!response.ok) {
        setIfNotAborted({ status: "error", code: "LETTER_UNAVAILABLE" });
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        setIfNotAborted({ status: "error", code: "LETTER_UNAVAILABLE" });
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        let chunk: { done: boolean; value: Uint8Array | undefined };
        try {
          chunk = (await reader.read()) as typeof chunk;
        } catch (err) {
          if (signal.aborted) return;
          if (err instanceof Error && err.name === "AbortError") return;
          setIfNotAborted({ status: "error", code: "LETTER_UNAVAILABLE" });
          return;
        }
        if (chunk.done) break;
        if (!chunk.value) continue;
        buffer += decoder.decode(chunk.value, { stream: true });
        let frameEnd: number;
        while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const json = line.slice(6);
          let event: SseEvent;
          try {
            event = JSON.parse(json) as SseEvent;
          } catch {
            continue;
          }
          if (event.type === "token" && typeof event.content === "string") {
            accumulated += event.content;
            setIfNotAborted({ status: "streaming", body: accumulated });
          } else if (event.type === "done") {
            setIfNotAborted({ status: "complete", body: accumulated });
            return;
          } else if (event.type === "error" && typeof event.code === "string") {
            setIfNotAborted({ status: "error", code: event.code });
            return;
          }
        }
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [letterId]);

  return state;
}
