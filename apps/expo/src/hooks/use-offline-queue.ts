import { useSyncExternalStore } from "react";

import type { OfflineUploadItem } from "~/lib/offline-upload-queue";
import { getQueueSnapshot, subscribeToQueue } from "~/lib/offline-upload-queue";

/**
 * Story 2.6 — selector hook for Histórico + Início to render the
 * offline-queue items alongside server-side uploads. Uses
 * `useSyncExternalStore` so each surface stays in sync without
 * polling AsyncStorage.
 *
 * Callers must have called `loadQueue()` once at app boot for the
 * first synchronous snapshot to be populated (otherwise it returns
 * `[]` until the first emission).
 */
export function useOfflineQueue(): OfflineUploadItem[] {
  return useSyncExternalStore(
    subscribeToQueue,
    getQueueSnapshot,
    getQueueSnapshot,
  );
}
