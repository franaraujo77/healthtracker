import { useEffect, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Story 3.4 — invalidate the supplied query keys on a NetInfo
 * rising-edge transition (offline → online). On reconnect:
 *
 * 1. `queryClient.invalidateQueries({ queryKey })` for each whitelisted
 *    cache key (the Fingerprint queries: `observations.getRecord` and
 *    `observations.getPersonalBaseline`).
 * 2. The fresh fetch advances `dataUpdatedAt` → the stale-amber label
 *    is removed (AC3) and the disabled CTAs re-enable (AC2).
 *
 * Mirrors `useOfflineUploadFlow` lines 159–165 byte-for-byte:
 *  - `lastConnectedRef` carries the previous tick's connectivity so
 *    we react to the rising edge, not every NetInfo emit.
 *  - `inFlightRef` short-circuits while an invalidate is in progress
 *    so a NetInfo flap (`true → true`) can't fire the invalidate
 *    twice (Story 2.6 R2-P196 lesson).
 */
export function useCacheRefetchOnOnline(
  queryKeys: readonly (readonly unknown[])[],
): void {
  const queryClient = useQueryClient();
  const lastConnectedRef = useRef<boolean | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      const wasConnected = lastConnectedRef.current;
      lastConnectedRef.current = state.isConnected ?? null;
      if (state.isConnected !== true) return;
      if (wasConnected === true) return; // not a rising edge
      if (inFlightRef.current) return; // dedupe (R2-P196)
      inFlightRef.current = true;
      const work = Promise.all(
        queryKeys.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      void work.finally(() => {
        inFlightRef.current = false;
      });
    });
    return () => {
      sub();
    };
  }, [queryClient, queryKeys]);
}
