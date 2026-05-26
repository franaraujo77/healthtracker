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
 *
 * Server is source-of-truth — the hook does NOT refetch on success;
 * the parent screen's `getDraftConfig` query is the read path.
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

  const pendingRef = useRef<Map<string, boolean>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation(
    trpc.sharing.configureBiomarkers.mutationOptions(),
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current.size === 0) return;

    const batch = Array.from(pendingRef.current.entries()).map(
      ([biomarkerCategory, visible]) => ({ biomarkerCategory, visible }),
    );
    // Snapshot the batch BEFORE clearing — revert needs the original
    // visibility-before-toggle, but the simpler safe shape is to
    // revert by flipping the visibility we just sent. Failure-revert
    // policy per T4.6: revert local map for the failed rows only.
    pendingRef.current = new Map();

    mutation.mutate(
      { shareTokenId: options.shareTokenId, scope: batch },
      {
        onError: () => {
          setScope((prev) => {
            const next = new Map(prev);
            for (const row of batch) {
              next.set(row.biomarkerCategory, !row.visible);
            }
            return next;
          });
          options.onError?.();
        },
      },
    );
  }, [mutation, options]);

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
  // the final toggle.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Best-effort flush on unmount (fire-and-forget mutation).
      if (pendingRef.current.size > 0) flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    scope,
    toggle,
    flushPending: flush,
    isPending: mutation.isPending,
  };
}
