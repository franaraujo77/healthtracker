"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/**
 * Story 5.1 T4.6 / T4.7 — web parity of the Expo
 * `useDebouncedConfigureBiomarkers` hook. The behaviour is
 * identical (250 ms debounce, single batched UPSERT, per-row revert
 * on failure); the only delta is the tRPC accessor — web uses
 * `useTRPC()` while Expo imports the module-level `trpc`. See
 * `apps/expo/src/hooks/use-debounced-configure-biomarkers.ts`.
 */

const DEFAULT_DEBOUNCE_MS = 250;

export interface UseDebouncedConfigureBiomarkersOptions {
  initialScope: { category: string; visible: boolean }[];
  shareTokenId: string;
  debounceMs?: number;
  onError?: () => void;
}

export function useDebouncedConfigureBiomarkers(
  options: UseDebouncedConfigureBiomarkersOptions,
) {
  const trpc = useTRPC();
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
    pendingRef.current = new Map();
    mutation.mutate(
      { shareTokenId: options.shareTokenId, scope: batch },
      {
        onError: () => {
          setScope((prev) => {
            const next = new Map(prev);
            for (const row of batch)
              next.set(row.biomarkerCategory, !row.visible);
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

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingRef.current.size > 0) flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { scope, toggle, flushPending: flush, isPending: mutation.isPending };
}
