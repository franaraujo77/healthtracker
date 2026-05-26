"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AccessLogItemRow } from "@healthtracker/validators";
import { AccessLogList } from "@healthtracker/ui";
import { ACCESS_LOG_TITLE_PT_BR } from "@healthtracker/validators";

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

  // AC10 — refetch on tab visibility change.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") refetch();
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
