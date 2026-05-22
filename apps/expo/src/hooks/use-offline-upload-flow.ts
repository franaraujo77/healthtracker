import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import type { UploadMimeType } from "@healthtracker/validators";

import type { OfflineUploadItem } from "~/lib/offline-upload-queue";
import { dequeue, loadQueue } from "~/lib/offline-upload-queue";
import { trpcClient } from "~/utils/api";

/**
 * Story 2.6 — drain hook. Mounted once at the app root (after the
 * auth bootstrap so the tRPC client has a session). Subscribes to
 * NetInfo + AppState; on every offline→online transition AND on
 * AppState `active` while online, drains the persisted queue in
 * FIFO order.
 *
 * Drain semantics:
 *   - For each item: requestImport → PUT bytes → confirmImport.
 *   - Success (`created: true OR false`) → dequeue + continue.
 *   - Network error → keep item, exit drain, wait for next reconnect.
 *   - Server error → keep item, log, exit drain. Next online tick
 *     retries.
 *
 * In-flight guard: `drainingRef` prevents concurrent drains when
 * NetInfo + AppState fire transitions back-to-back.
 */
export function useOfflineUploadFlow(): void {
  const drainingRef = useRef(false);
  const lastConnectedRef = useRef<boolean | null>(null);

  useEffect(() => {
    const submitOne = async (item: OfflineUploadItem): Promise<boolean> => {
      try {
        const minted = await trpcClient.uploads.requestImport.mutate({
          originalFilename: item.originalFilename,
          mimeType: item.mimeType as UploadMimeType,
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
          mimeType: item.mimeType as UploadMimeType,
          sizeBytes: item.sizeBytes,
          source: item.source,
          pageCount: item.pageCount,
        });
        return true;
      } catch (err) {
        console.warn(
          `[offline-upload-flow] submit failed for ${item.clientIdempotencyKey}`,
          err,
        );
        return false;
      }
    };

    const drain = async () => {
      if (drainingRef.current) return;
      drainingRef.current = true;
      try {
        let items = await loadQueue();
        while (items.length > 0) {
          const item = items[0];
          if (!item) break;
          const ok = await submitOne(item);
          if (!ok) break;
          await dequeue(item.clientIdempotencyKey);
          items = await loadQueue();
        }
      } finally {
        drainingRef.current = false;
      }
    };

    // Re-hydrate the cache + attempt one drain if online at mount.
    void loadQueue().then(async () => {
      const state = await NetInfo.fetch();
      lastConnectedRef.current = state.isConnected ?? null;
      if (state.isConnected) {
        void drain();
      }
    });

    const netUnsub = NetInfo.addEventListener((state) => {
      const wasConnected = lastConnectedRef.current;
      lastConnectedRef.current = state.isConnected ?? null;
      // Only drain on the false→true (or null→true) transition.
      if (state.isConnected && wasConnected !== true) {
        void drain();
      }
    });

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void NetInfo.fetch().then((state) => {
        if (state.isConnected) void drain();
      });
    });

    return () => {
      netUnsub();
      appStateSub.remove();
    };
  }, []);
}
