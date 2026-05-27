import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ClientAccessLogItemRow } from "@healthtracker/validators";
import {
  AccessLogList,
  RevokeConfirmDialog,
  UndoToast,
} from "@healthtracker/ui";
import {
  ACCESS_LOG_REFETCH_THROTTLE_MS,
  REVOKE_FAILED_PT_BR,
  REVOKE_TIMEOUT_MS,
  REVOKE_UNDO_BUTTON_PT_BR,
  REVOKE_UNDO_TOAST_PT_BR,
  REVOKE_UNDONE_TOAST_PT_BR,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

/**
 * Story 5.3 + 5.4 — Acessos tab screen.
 *
 * Pagination model: see Story 5.3 docblock (priorPages snapshot +
 * react-hooks/set-state-in-effect avoidance).
 *
 * Story 5.4 — revoke ceremony lives here:
 *   - `revokingTokenIds: Set<string>` — parent-owned pending state;
 *     each id is injected as `tokenStatus="revoked-pending"` into
 *     the list via the `accumulated` mapper (AC3).
 *   - `timersRef` — keyed by shareTokenId; the 5s `setTimeout` that
 *     fires the server mutation (AC3, AC10). Lives in a ref so a
 *     parent re-render doesn't tear timers down.
 *   - `activeToast` — most-recent pending revoke; older toasts are
 *     replaced on screen but their timers keep running (AC8).
 *   - Cleanup `useEffect` on unmount fires any pending timers
 *     immediately — the user already confirmed; we MUST NOT silently
 *     lose the action (AC8; flushAsync precedent from Story 5.2).
 */
export default function AcessosIndexScreen(): React.ReactNode {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [priorPages, setPriorPages] = useState<ClientAccessLogItemRow[]>([]);
  const lastRefetchAt = useRef<number | null>(null);

  // Revoke-ceremony state (Story 5.4).
  const [pendingDialog, setPendingDialog] = useState<{
    shareTokenId: string;
    displayName: string;
  } | null>(null);
  const [revokingTokenIds, setRevokingTokenIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Story 5.4 review-fix Patch #3 — discriminated union over toast
  // kinds. The `revoking` surface carries the undo button; `undone`
  // + `error` surfaces hide it (passing `undoLabel={null}` to
  // UndoToast) so tapping never re-enters `handleUndo` and loops.
  type ActiveToast =
    | { kind: "revoking"; shareTokenId: string; message: string }
    | { kind: "undone"; shareTokenId: string; message: string }
    | { kind: "error"; shareTokenId: string; message: string };
  const [activeToast, setActiveToast] = useState<ActiveToast | null>(null);
  // setTimeout handles keyed by shareTokenId — ref so a parent
  // re-render (e.g. from `setRevokingTokenIds`) doesn't drop them.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const clearRevokingId = useCallback((shareTokenId: string) => {
    setRevokingTokenIds((prev) => {
      if (!prev.has(shareTokenId)) return prev;
      const next = new Set(prev);
      next.delete(shareTokenId);
      return next;
    });
  }, []);

  const revokeMutation = useMutation(
    trpc.sharing.revokeShareToken.mutationOptions({
      // Patch #5 — clear the pending-set entry BEFORE invalidating;
      // otherwise the refetch can resolve to `revogado` while the
      // Set still forces `revoked-pending`, producing a visible
      // `revoked → pending → revoked` flicker.
      onSuccess: (data) => {
        clearRevokingId(data.shareTokenId);
        void queryClient.invalidateQueries({
          queryKey: trpc.sharing.listAccessLog.queryKey(),
        });
      },
      // Patch #1 — surface failure paths. The re-revoke 404
      // (row already revoked elsewhere) is silenced — the next
      // refetch surfaces the correct `revogado` state. Other
      // errors (network / 5xx / unknown) flip the toast to an
      // error surface so the patient knows to re-tap.
      onError: (error, variables) => {
        clearRevokingId(variables.shareTokenId);
        const isAlreadyRevoked =
          error.data?.code === "NOT_FOUND" || error.data?.httpStatus === 404;
        if (isAlreadyRevoked) {
          // Refetch so the patient sees the correct revoked state.
          void queryClient.invalidateQueries({
            queryKey: trpc.sharing.listAccessLog.queryKey(),
          });
          // Clear any in-flight `revoking` toast for this id; nothing
          // to undo and nothing to apologize for.
          setActiveToast((prev) =>
            prev?.shareTokenId === variables.shareTokenId ? null : prev,
          );
          return;
        }
        setActiveToast({
          kind: "error",
          shareTokenId: variables.shareTokenId,
          message: REVOKE_FAILED_PT_BR,
        });
      },
    }),
  );

  const fireRevoke = useCallback(
    (shareTokenId: string) => {
      timersRef.current.delete(shareTokenId);
      // No `onSettled` clear — `onSuccess` + `onError` cover both
      // paths and clear the pending-set entry there (patch #5).
      revokeMutation.mutate({ shareTokenId });
    },
    [revokeMutation],
  );

  const query = useQuery({
    ...trpc.sharing.listAccessLog.queryOptions({ cursor, pageSize: 20 }),
    refetchOnWindowFocus: false,
  });

  const accumulated = useMemo<ClientAccessLogItemRow[]>(() => {
    if (query.data?.upgradeRequired) return [];
    const liveItems = query.data?.items ?? [];
    const merged =
      priorPages.length === 0
        ? liveItems
        : (() => {
            const seen = new Set(priorPages.map((r) => r.id));
            return [...priorPages, ...liveItems.filter((r) => !seen.has(r.id))];
          })();
    // Story 5.4 (T4.5) — inject the `revoked-pending` override for
    // rows whose shareTokenId is currently in the 5s undo window.
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
  }, [queryClient]);

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
    setPriorPages(accumulated);
    setCursor(nc);
  }, [accumulated, query.data?.nextCursor]);

  // Revoke handlers (Story 5.4).
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
    setActiveToast({
      kind: "revoking",
      shareTokenId,
      message: REVOKE_UNDO_TOAST_PT_BR,
    });
    const handle = setTimeout(() => {
      fireRevoke(shareTokenId);
      // If this was the surface toast, clear it.
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
    clearRevokingId(shareTokenId);
    // Replace the toast surface with the "Revogação cancelada."
    // confirmation. `kind: "undone"` causes the JSX below to pass
    // `undoLabel={null}` so the toast has no button (patch #3 —
    // prevents the previous `:undone:undone:undone…` infinite chain
    // when the user tapped Desfazer on the cancel-confirmation
    // toast). The toast auto-dismisses after `REVOKE_TIMEOUT_MS`.
    setActiveToast({
      kind: "undone",
      shareTokenId: `${shareTokenId}:undone`,
      message: REVOKE_UNDONE_TOAST_PT_BR,
    });
  }, [activeToast, clearRevokingId]);

  const handleToastTimeout = useCallback(() => {
    setActiveToast(null);
  }, []);

  // AC8 — cleanup fires any pending timers immediately (the user
  // already confirmed). The latest-fire-fn is stored in a ref via
  // an effect (ref writes during render trip react-hooks/refs);
  // the unmount cleanup reads it. NEVER clearTimeout-without-fire
  // here — the intent is to FLUSH the pending action, not cancel.
  const fireRevokeRef = useRef(fireRevoke);
  useEffect(() => {
    fireRevokeRef.current = fireRevoke;
  }, [fireRevoke]);
  useEffect(() => {
    // Snapshot the ref outside the cleanup so the lint rule
    // (react-hooks/exhaustive-deps) is satisfied. Both refs point at
    // the same Map / function identity across renders for this
    // component's lifetime, so the snapshot is safe.
    const timers = timersRef.current;
    const fireFnRef = fireRevokeRef;
    return () => {
      // Patch #4 — snapshot keys BEFORE iterating. `fireFnRef.current`
      // calls `timersRef.current.delete(id)`, and any future maintainer
      // who adds a `timers.set(...)` inside the fire-fn would silently
      // get tripped by Map iteration semantics. Snapshot is safer.
      const ids = Array.from(timers.keys());
      for (const id of ids) {
        const handle = timers.get(id);
        if (handle) clearTimeout(handle);
        fireFnRef.current(id);
      }
      timers.clear();
    };
  }, []);

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
        onRevokePress={handleRevokePress}
      />

      <RevokeConfirmDialog
        open={pendingDialog !== null}
        displayName={pendingDialog?.displayName ?? ""}
        onConfirm={handleConfirmRevoke}
        onCancel={handleCancelDialog}
      />

      {/*
        `key` forces a remount when the toast surface flips between
        revoke targets — resets the internal `remaining` state to
        durationMs so the progress bar starts full each time.
      */}
      <UndoToast
        key={activeToast?.shareTokenId ?? "none"}
        visible={activeToast !== null}
        toastId={activeToast?.shareTokenId ?? "none"}
        message={activeToast?.message ?? ""}
        // Patch #3 — only the `revoking` surface carries an undo
        // button; `undone` / `error` surfaces pass `null` to hide
        // it (no infinite `:undone:undone` chain; no Desfazer on
        // an error message that has nothing to undo).
        undoLabel={
          activeToast?.kind === "revoking" ? REVOKE_UNDO_BUTTON_PT_BR : null
        }
        onUndo={handleUndo}
        onTimeout={handleToastTimeout}
        durationMs={REVOKE_TIMEOUT_MS}
      />
    </ScrollView>
  );
}
