import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { trpc } from "~/utils/api";

/**
 * Story 5.1 T4.6 — debounced batch UPSERT hook for the
 * per-biomarker toggle screen (AC2 / AC3).
 *
 * Behaviour:
 *   - Maintains a local visibility map keyed by `biomarkerCategory`.
 *   - On `toggle(category, next)` the local map is updated
 *     optimistically and a 250 ms debounce timer is (re)scheduled.
 *   - On timer fire the pending diff is drained into a SINGLE
 *     `configureBiomarkers` mutation carrying the whole batch.
 *   - On failure, only the rows that were in the failed batch are
 *     reverted on the local map; a caller-provided `onError`
 *     callback can surface the Toast.
 *   - `flushAsync()` returns a Promise that resolves when the
 *     in-flight mutation settles — used by the "Concluir" handler
 *     so navigation doesn't preempt the Toast / revert path
 *     (review 2026-05-26 Patch #3).
 *
 * Server is source-of-truth — the hook does NOT refetch on success;
 * the parent screen's `getDraftConfig` query is the read path.
 *
 * Review 2026-05-26 Patch #9 — `options.onError` and
 * `options.shareTokenId` are routed through refs so `flush` does
 * not re-create on every parent render (the previous shape made
 * `useCallback`'s dependency on `options` a no-op stability claim).
 */

const DEFAULT_DEBOUNCE_MS = 250;

export interface UseDebouncedConfigureBiomarkersOptions {
  /** Hydrate the local map from the server's draft config. */
  initialScope: { category: string; visible: boolean }[];
  shareTokenId: string;
  debounceMs?: number;
  onError?: () => void;
}

export interface UseDebouncedConfigureBiomarkersResult {
  scope: Map<string, boolean>;
  toggle: (category: string, next: boolean) => void;
  flushPending: () => void;
  flushAsync: () => Promise<void>;
  isPending: boolean;
}

export function useDebouncedConfigureBiomarkers(
  options: UseDebouncedConfigureBiomarkersOptions,
): UseDebouncedConfigureBiomarkersResult {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const [scope, setScope] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    for (const entry of options.initialScope)
      m.set(entry.category, entry.visible);
    return m;
  });

  // Patch #9 — stable refs for the parts of `options` that the
  // `flush` closure needs. Updated via `useEffect` so the closure
  // always reads the latest values without re-creating.
  const shareTokenIdRef = useRef(options.shareTokenId);
  const onErrorRef = useRef(options.onError);
  useEffect(() => {
    shareTokenIdRef.current = options.shareTokenId;
    onErrorRef.current = options.onError;
  }, [options.shareTokenId, options.onError]);

  const pendingRef = useRef<Map<string, boolean>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation(
    trpc.sharing.configureBiomarkers.mutationOptions(),
  );

  // Stable ref to the mutation so `flush`/`flushAsync` don't re-create.
  const mutateAsyncRef = useRef(mutation.mutateAsync);
  useEffect(() => {
    mutateAsyncRef.current = mutation.mutateAsync;
  }, [mutation.mutateAsync]);

  const flushAsync = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current.size === 0) return;

    const batch = Array.from(pendingRef.current.entries()).map(
      ([biomarkerCategory, visible]) => ({ biomarkerCategory, visible }),
    );
    pendingRef.current = new Map();

    try {
      await mutateAsyncRef.current({
        shareTokenId: shareTokenIdRef.current,
        scope: batch,
      });
    } catch {
      setScope((prev) => {
        const next = new Map(prev);
        for (const row of batch) {
          next.set(row.biomarkerCategory, !row.visible);
        }
        return next;
      });
      onErrorRef.current?.();
    }
  }, []);

  const flush = useCallback(() => {
    void flushAsync();
  }, [flushAsync]);

  const toggle = useCallback(
    (category: string, next: boolean) => {
      setScope((prev) => {
        const m = new Map(prev);
        m.set(category, next);
        return m;
      });
      pendingRef.current.set(category, next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, debounceMs);
    },
    [debounceMs, flush],
  );

  // Drain pending on unmount so a quick "Concluir" tap doesn't lose
  // the final toggle. No parent Toast is available at unmount time;
  // log a warning so the failure isn't silent (Patch #9 fallback).
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingRef.current.size > 0) {
        flushAsync().catch((err: unknown) => {
          console.warn(
            "[useDebouncedConfigureBiomarkers] unmount-flush failed",
            err,
          );
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    scope,
    toggle,
    flushPending: flush,
    flushAsync,
    isPending: mutation.isPending,
  };
}
