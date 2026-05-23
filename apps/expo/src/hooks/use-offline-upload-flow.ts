import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import type { OfflineUploadItem } from "~/lib/offline-upload-queue";
import {
  dequeue,
  loadQueue,
  recordAttempt,
  setActivePatient,
} from "~/lib/offline-upload-queue";
import { supabase } from "~/lib/supabase";
import { trpcClient } from "~/utils/api";

/**
 * Story 2.6 — drain hook. Mounted once at the app root (after the
 * auth bootstrap). Subscribes to NetInfo + AppState + Supabase auth
 * state.
 *
 * R1-P182 — drain is gated on the presence of an active session.
 * On `SIGNED_IN` the queue is bound to the patient via
 * `setActivePatient`; on `SIGNED_OUT` we clear the in-memory state.
 * Without a session, NetInfo / AppState transitions don't drain —
 * preventing UNAUTHORIZED loops and protecting against the
 * register-screen case.
 *
 * R1-P181 — per-item attempt counter via `recordAttempt(...)`. Items
 * past MAX_ATTEMPTS_PER_ITEM are dropped, preventing infinite-retry
 * loops on dead `localUri` / permanent 4xx.
 *
 * In-flight guard: `drainingRef` prevents concurrent drains when
 * NetInfo + AppState fire transitions back-to-back.
 */
export function useOfflineUploadFlow(): void {
  const drainingRef = useRef(false);
  const lastConnectedRef = useRef<boolean | null>(null);
  const hasSessionRef = useRef(false);

  useEffect(() => {
    const submitOne = async (item: OfflineUploadItem): Promise<boolean> => {
      try {
        const minted = await trpcClient.uploads.requestImport.mutate({
          originalFilename: item.originalFilename,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          source: item.source,
          pageCount: item.pageCount,
          clientIdempotencyKey: item.clientIdempotencyKey,
        });
        const bytes = await fetch(item.localUri).then((r) => r.blob());
        const putResponse = await fetch(minted.uploadUrl, {
          method: "PUT",
          body: bytes,
          headers: { "Content-Type": item.mimeType },
        });
        if (!putResponse.ok) {
          console.warn(
            `[offline-upload-flow] PUT failed for ${item.clientIdempotencyKey}: ${putResponse.status}`,
          );
          return false;
        }
        await trpcClient.uploads.confirmImport.mutate({
          idempotencyKey: minted.idempotencyKey,
          originalFilename: item.originalFilename,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          source: item.source,
          pageCount: item.pageCount,
        });
        return true;
      } catch (err) {
        // R2-P193 — programmer errors (TypeError / ReferenceError /
        // SyntaxError) are NOT transient and shouldn't burn an
        // attemptCount. Re-throw so the caller treats them as a
        // drain-level abort; the outer try/finally still clears the
        // drainingRef.
        if (
          err instanceof TypeError ||
          err instanceof ReferenceError ||
          err instanceof SyntaxError
        ) {
          console.error(
            `[offline-upload-flow] programmer error for ${item.clientIdempotencyKey} — aborting drain`,
            err,
          );
          throw err;
        }
        console.warn(
          `[offline-upload-flow] submit failed for ${item.clientIdempotencyKey}`,
          err,
        );
        return false;
      }
    };

    const drain = async () => {
      if (drainingRef.current) return;
      // R1-P182 — never drain without an authenticated session. The
      // tRPC `protectedProcedure` would throw UNAUTHORIZED and the
      // failed item would just queue another retry.
      if (!hasSessionRef.current) return;
      drainingRef.current = true;
      try {
        let items = await loadQueue();
        while (items.length > 0) {
          const item = items[0];
          if (!item) break;
          const ok = await submitOne(item);
          if (ok) {
            await dequeue(item.clientIdempotencyKey);
          } else {
            // R1-P181 — record the failure. If max attempts exceeded
            // the item is dropped here; otherwise it stays in the
            // queue with an incremented counter. Either way exit
            // drain so we don't retry the same failing item in a
            // tight loop within a single online transition.
            await recordAttempt(item.clientIdempotencyKey);
            break;
          }
          items = await loadQueue();
        }
      } finally {
        drainingRef.current = false;
      }
    };

    // Track sign-in / sign-out state. R1-P180 — bind the queue to
    // the patient on SIGNED_IN; clear in-memory state on SIGNED_OUT.
    const { data: authSub } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          hasSessionRef.current = true;
          setActivePatient(session.user.id);
          // After a fresh sign-in (e.g. token-refresh), try a drain.
          void NetInfo.fetch().then((state) => {
            if (state.isConnected) void drain();
          });
        } else if (event === "SIGNED_OUT") {
          hasSessionRef.current = false;
          setActivePatient(null);
        }
      },
    );

    // Initialise from the current session at mount (the listener
    // only fires on changes, not on the current value).
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        hasSessionRef.current = true;
        setActivePatient(data.session.user.id);
        void loadQueue().then(async () => {
          const state = await NetInfo.fetch();
          lastConnectedRef.current = state.isConnected ?? null;
          if (state.isConnected) void drain();
        });
      }
    });

    const netUnsub = NetInfo.addEventListener((state) => {
      const wasConnected = lastConnectedRef.current;
      lastConnectedRef.current = state.isConnected ?? null;
      if (state.isConnected && wasConnected !== true) {
        void drain();
      }
    });

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      // R2-P196 — if we believe we're online AND no drain is in flight,
      // don't waste a NetInfo round-trip / spurious drain. The
      // NetInfo listener is the authoritative source for connectivity
      // changes; AppState is the belt-and-suspenders for "user came
      // back from a long suspend".
      if (lastConnectedRef.current === true && !drainingRef.current) {
        return;
      }
      void NetInfo.fetch().then((state) => {
        if (state.isConnected) void drain();
      });
    });

    return () => {
      netUnsub();
      appStateSub.remove();
      authSub.subscription.unsubscribe();
    };
  }, []);
}
