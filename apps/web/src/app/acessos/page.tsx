"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AccessLogItemRow } from "@healthtracker/validators";
import {
  AccessLogList,
  RevokeConfirmDialog,
  UndoToast,
} from "@healthtracker/ui";
import {
  ACCESS_LOG_REFETCH_THROTTLE_MS,
  ACCESS_LOG_TITLE_PT_BR,
  REVOKE_TIMEOUT_MS,
  REVOKE_UNDO_BUTTON_PT_BR,
  REVOKE_UNDO_TOAST_PT_BR,
  REVOKE_UNDONE_TOAST_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

/**
 * Story 5.3 + 5.4 — Acessos page, web parity.
 *
 * Revoke ceremony — see the Expo screen's docblock; the shape is
 * identical (state lives in `useState` + a `timersRef` Map; cleanup
 * on unmount fires pending revokes).
 */
export default function AcessosPage(): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [priorPages, setPriorPages] = useState<AccessLogItemRow[]>([]);
  const lastRefetchAt = useRef<number | null>(null);

  const [pendingDialog, setPendingDialog] = useState<{
    shareTokenId: string;
    displayName: string;
  } | null>(null);
  const [revokingTokenIds, setRevokingTokenIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeToast, setActiveToast] = useState<{
    shareTokenId: string;
    message: string;
  } | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const revokeMutation = useMutation(
    trpc.sharing.revokeShareToken.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.sharing.listAccessLog.queryKey(),
        });
      },
    }),
  );

  const fireRevoke = useCallback(
    (shareTokenId: string) => {
      timersRef.current.delete(shareTokenId);
      revokeMutation.mutate(
        { shareTokenId },
        {
          onSettled: () => {
            setRevokingTokenIds((prev) => {
              if (!prev.has(shareTokenId)) return prev;
              const next = new Set(prev);
              next.delete(shareTokenId);
              return next;
            });
          },
        },
      );
    },
    [revokeMutation],
  );

  const query = useQuery({
    ...trpc.sharing.listAccessLog.queryOptions({ cursor, pageSize: 20 }),
    refetchOnWindowFocus: false,
  });

  const accumulated = useMemo<AccessLogItemRow[]>(() => {
    if (query.data?.upgradeRequired) return [];
    const liveItems = query.data?.items ?? [];
    const merged =
      priorPages.length === 0
        ? liveItems
        : (() => {
            const seen = new Set(priorPages.map((r) => r.id));
            return [...priorPages, ...liveItems.filter((r) => !seen.has(r.id))];
          })();
    if (revokingTokenIds.size === 0) return merged;
    return merged.map((r) =>
      r.shareTokenId && revokingTokenIds.has(r.shareTokenId)
        ? { ...r, tokenStatus: "revoked-pending" as const }
        : r,
    );
  }, [priorPages, query.data, revokingTokenIds]);

  const refetch = useCallback(() => {
    setCursor(undefined);
    setPriorPages([]);
    lastRefetchAt.current = Date.now();
    void queryClient.invalidateQueries({
      queryKey: trpc.sharing.listAccessLog.queryKey(),
    });
  }, [queryClient, trpc.sharing.listAccessLog]);

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

  const handleRevokePress = useCallback(
    (shareTokenId: string, displayName: string) => {
      setPendingDialog({ shareTokenId, displayName });
    },
    [],
  );

  const handleConfirmRevoke = useCallback(() => {
    if (!pendingDialog) return;
    const { shareTokenId } = pendingDialog;
    setRevokingTokenIds((prev) => {
      const next = new Set(prev);
      next.add(shareTokenId);
      return next;
    });
    setActiveToast({ shareTokenId, message: REVOKE_UNDO_TOAST_PT_BR });
    const handle = setTimeout(() => {
      fireRevoke(shareTokenId);
      setActiveToast((prev) =>
        prev?.shareTokenId === shareTokenId ? null : prev,
      );
    }, REVOKE_TIMEOUT_MS);
    timersRef.current.set(shareTokenId, handle);
    setPendingDialog(null);
  }, [pendingDialog, fireRevoke]);

  const handleCancelDialog = useCallback(() => {
    setPendingDialog(null);
  }, []);

  const handleUndo = useCallback(() => {
    const current = activeToast;
    if (!current) return;
    const { shareTokenId } = current;
    const handle = timersRef.current.get(shareTokenId);
    if (handle) {
      clearTimeout(handle);
      timersRef.current.delete(shareTokenId);
    }
    setRevokingTokenIds((prev) => {
      if (!prev.has(shareTokenId)) return prev;
      const next = new Set(prev);
      next.delete(shareTokenId);
      return next;
    });
    setActiveToast({
      shareTokenId: `${shareTokenId}:undone`,
      message: REVOKE_UNDONE_TOAST_PT_BR,
    });
  }, [activeToast]);

  const handleToastTimeout = useCallback(() => {
    setActiveToast(null);
  }, []);

  // AC8 cleanup — see the Expo screen's comment. Ref write must
  // happen inside an effect, not during render (react-hooks/refs).
  const fireRevokeRef = useRef(fireRevoke);
  useEffect(() => {
    fireRevokeRef.current = fireRevoke;
  }, [fireRevoke]);
  useEffect(() => {
    // Snapshot refs at mount so the cleanup doesn't trip
    // react-hooks/exhaustive-deps. Both refs hold stable identity
    // for the component's lifetime.
    const timers = timersRef.current;
    const fireFnRef = fireRevokeRef;
    return () => {
      for (const [id, handle] of timers.entries()) {
        clearTimeout(handle);
        fireFnRef.current(id);
      }
      timers.clear();
    };
  }, []);

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
        onRevokePress={handleRevokePress}
      />

      <RevokeConfirmDialog
        open={pendingDialog !== null}
        displayName={pendingDialog?.displayName ?? ""}
        onConfirm={handleConfirmRevoke}
        onCancel={handleCancelDialog}
      />

      {/* See Expo screen — `key` forces remount + state reset. */}
      <UndoToast
        key={activeToast?.shareTokenId ?? "none"}
        visible={activeToast !== null}
        toastId={activeToast?.shareTokenId ?? "none"}
        message={activeToast?.message ?? ""}
        undoLabel={REVOKE_UNDO_BUTTON_PT_BR}
        onUndo={handleUndo}
        onTimeout={handleToastTimeout}
        durationMs={REVOKE_TIMEOUT_MS}
      />
    </main>
  );
}
