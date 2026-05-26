"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { AccessLogItemRow } from "@healthtracker/validators";
import { AccessLogList } from "@healthtracker/ui";
import {
  ACCESS_LOG_REFETCH_THROTTLE_MS,
  ACCESS_LOG_TITLE_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

/**
 * Story 5.3 — Acessos page, web parity with `apps/expo/.../acessos`.
 *
 * Tab-focus refetch on web: `visibilitychange` is more reliable than
 * `focus` for SPA tab-switching (`focus` only fires when the OS
 * window regains focus; `visibilitychange` covers the patient
 * switching browser tabs within the same window). Decision documented
 * in the Dev Agent Record.
 *
 * Pagination follows the Expo screen's pattern — see that file for
 * the rationale on the prior-pages snapshot and the
 * react-hooks/set-state-in-effect avoidance.
 */
export default function AcessosPage(): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [priorPages, setPriorPages] = useState<AccessLogItemRow[]>([]);
  // null sentinel = "never refetched yet"; first visibility-change refetches.
  const lastRefetchAt = useRef<number | null>(null);

  const query = useQuery({
    ...trpc.sharing.listAccessLog.queryOptions({ cursor, pageSize: 20 }),
    refetchOnWindowFocus: false,
  });

  const accumulated = useMemo<AccessLogItemRow[]>(() => {
    // Patch #4 (2026-05-26) — gate prior pages behind `upgradeRequired`
    // to avoid stranded rows under the upgrade prompt. The setState-in-
    // effect alternative is blocked by react-hooks lint.
    if (query.data?.upgradeRequired) return [];
    const liveItems = query.data?.items ?? [];
    if (priorPages.length === 0) return liveItems;
    const seen = new Set(priorPages.map((r) => r.id));
    return [...priorPages, ...liveItems.filter((r) => !seen.has(r.id))];
  }, [priorPages, query.data]);

  // Review-fix Patch #1 — invalidate the whole `listAccessLog` query
  // key instead of calling `query.refetch()` on the old cursor's
  // observer (which would race the `setCursor(undefined)` state
  // update).
  const refetch = useCallback(() => {
    setCursor(undefined);
    setPriorPages([]);
    lastRefetchAt.current = Date.now();
    void queryClient.invalidateQueries({
      queryKey: trpc.sharing.listAccessLog.queryKey(),
    });
  }, [queryClient, trpc.sharing.listAccessLog]);

  // AC10 — refetch on tab visibility change, throttled (Review
  // decision A): only refresh if last refetch was more than
  // ACCESS_LOG_REFETCH_THROTTLE_MS ago.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastRefetchAt.current;
      if (last === null || Date.now() - last > ACCESS_LOG_REFETCH_THROTTLE_MS) {
        refetch();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refetch]);

  const fetchNextPage = useCallback(() => {
    const nc = query.data?.nextCursor;
    if (!nc) return;
    setPriorPages(accumulated);
    setCursor(nc);
  }, [accumulated, query.data?.nextCursor]);

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 16 }}>{ACCESS_LOG_TITLE_PT_BR}</h1>
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
    </main>
  );
}
