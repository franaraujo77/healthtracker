import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import type { AccessLogItemRow } from "@healthtracker/validators";
import { AccessLogList } from "@healthtracker/ui";

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
 * regains focus. `expo-router` re-exports `useFocusEffect` from
 * `@react-navigation/native`. If a future Expo SDK drops it, fall
 * back to `useNavigation().addListener('focus', refetch)`.
 */
export default function AcessosIndexScreen(): React.ReactNode {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [priorPages, setPriorPages] = useState<AccessLogItemRow[]>([]);

  const query = useQuery({
    ...trpc.sharing.listAccessLog.queryOptions({ cursor, pageSize: 20 }),
    refetchOnWindowFocus: false,
  });

  const accumulated = useMemo<AccessLogItemRow[]>(() => {
    const liveItems = query.data?.items ?? [];
    if (priorPages.length === 0) return liveItems;
    const seen = new Set(priorPages.map((r) => r.id));
    return [...priorPages, ...liveItems.filter((r) => !seen.has(r.id))];
  }, [priorPages, query.data]);

  const refetch = useCallback(() => {
    setCursor(undefined);
    setPriorPages([]);
    void query.refetch();
  }, [query]);

  // AC10 — refetch on tab focus.
  useFocusEffect(
    useCallback(() => {
      refetch();
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
