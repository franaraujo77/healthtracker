import { useCallback, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { AccessLogItemRow } from "@healthtracker/validators";
import { AccessLogList } from "@healthtracker/ui";
import { ACCESS_LOG_REFETCH_THROTTLE_MS } from "@healthtracker/validators";

import { trpc } from "~/utils/api";

/**
 * Story 5.3 — Acessos tab screen (AC1, AC4, AC5, AC9, AC10).
 *
 * Pagination model: we keep a frozen array of "completed" earlier
 * pages in `priorPages` state, and concatenate the live query result
 * for the current cursor. Tapping "Carregar mais" snapshots the
 * current items into `priorPages` and advances the cursor — this
 * keeps `setState` out of effect bodies (react-hooks/set-state-in-effect)
 * and avoids the cascade-render anti-pattern.
 *
 * AC10 — `useFocusEffect` re-fetches the first page when the tab
 * regains focus. Review-fix (2026-05-26): the refetch is throttled
 * via `ACCESS_LOG_REFETCH_THROTTLE_MS` so a quick tab-switch
 * (Acessos → Inicio → Acessos within a few seconds) no longer wipes
 * scroll state.
 */
export default function AcessosIndexScreen(): React.ReactNode {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [priorPages, setPriorPages] = useState<AccessLogItemRow[]>([]);
  // null sentinel = "never refetched yet"; first focus refetches.
  const lastRefetchAt = useRef<number | null>(null);

  const query = useQuery({
    ...trpc.sharing.listAccessLog.queryOptions({ cursor, pageSize: 20 }),
    refetchOnWindowFocus: false,
  });

  const accumulated = useMemo<AccessLogItemRow[]>(() => {
    // Patch #4 (2026-05-26) — when the resolver flips `upgradeRequired`
    // (e.g. mid-scroll subscription downgrade), hide the accumulated
    // prior pages so the upgrade prompt isn't layered on stranded
    // rows. The `setState`-in-effect alternative is blocked by
    // react-hooks lint; this JSX-level gate is the cleaner shape.
    if (query.data?.upgradeRequired) return [];
    const liveItems = query.data?.items ?? [];
    if (priorPages.length === 0) return liveItems;
    const seen = new Set(priorPages.map((r) => r.id));
    return [...priorPages, ...liveItems.filter((r) => !seen.has(r.id))];
  }, [priorPages, query.data]);

  // Review-fix Patch #1 — invalidate the entire `listAccessLog` query
  // key (covers every cached cursor) and reset the cursor / prior-page
  // accumulator. Dropping the explicit `query.refetch()` avoids the
  // race where the manual refetch hits the OLD cursor's observer.
  const refetch = useCallback(() => {
    setCursor(undefined);
    setPriorPages([]);
    lastRefetchAt.current = Date.now();
    void queryClient.invalidateQueries({
      queryKey: trpc.sharing.listAccessLog.queryKey(),
    });
  }, [queryClient]);

  // AC10 — refetch on tab focus, throttled to once per
  // ACCESS_LOG_REFETCH_THROTTLE_MS (Review decision A).
  useFocusEffect(
    useCallback(() => {
      const last = lastRefetchAt.current;
      if (last === null || Date.now() - last > ACCESS_LOG_REFETCH_THROTTLE_MS) {
        refetch();
      }
    }, [refetch]),
  );

  const fetchNextPage = useCallback(() => {
    const nc = query.data?.nextCursor;
    if (!nc) return;
    // Snapshot the current accumulator into the frozen prior-pages
    // state, then advance the cursor. The next `useQuery` invocation
    // returns the next page; `accumulated` recomputes via useMemo.
    setPriorPages(accumulated);
    setCursor(nc);
  }, [accumulated, query.data?.nextCursor]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 0 }}
      refreshControl={
        <RefreshControl refreshing={query.isFetching} onRefresh={refetch} />
      }
    >
      <AccessLogList
        data={accumulated}
        isLoading={query.isLoading}
        isError={query.isError}
        isFetchingNextPage={query.isFetching && cursor !== undefined}
        hasNextPage={
          query.data?.nextCursor !== null &&
          query.data?.nextCursor !== undefined
        }
        fetchNextPage={fetchNextPage}
        refetch={refetch}
        upgradeRequired={query.data?.upgradeRequired ?? false}
      />
    </ScrollView>
  );
}
