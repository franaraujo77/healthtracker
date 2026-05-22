import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Story 2.6 — persistent offline upload queue.
 *
 * One item per offline-picked file. The actual file bytes live at
 * the source `localUri` (returned by expo-document-picker /
 * expo-image-picker, which copy into the app's documents directory
 * on iOS + Android — survives kill + relaunch). The queue only
 * stores the URI + metadata; on drain, the hook reads the bytes
 * via `fetch(localUri)` and POSTs to the signed URL.
 *
 * AsyncStorage is the canonical store; the in-memory `cache` is a
 * write-through mirror so `useSyncExternalStore` subscribers don't
 * need a fresh `AsyncStorage.getItem` on every event.
 */

export const OFFLINE_UPLOAD_QUEUE_KEY = "@healthtracker/offline-upload-queue";

export interface OfflineUploadItem {
  clientIdempotencyKey: string;
  localUri: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  source: "post_onboarding" | "onboarding_import";
  pageCount?: number;
  enqueuedAt: string;
}

type Listener = (items: OfflineUploadItem[]) => void;

let cache: OfflineUploadItem[] | null = null;
const listeners = new Set<Listener>();
let loadPromise: Promise<OfflineUploadItem[]> | null = null;

async function readFromStorage(): Promise<OfflineUploadItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_UPLOAD_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as OfflineUploadItem[];
  } catch (err) {
    console.warn("[offline-upload-queue] read failed; treating as empty", err);
    return [];
  }
}

async function writeToStorage(items: OfflineUploadItem[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_UPLOAD_QUEUE_KEY, JSON.stringify(items));
}

function emit(items: OfflineUploadItem[]): void {
  for (const listener of listeners) {
    try {
      listener(items);
    } catch (err) {
      console.warn("[offline-upload-queue] listener threw", err);
    }
  }
}

/**
 * Load + cache the queue. Subsequent calls return the cached value
 * without hitting AsyncStorage again. Call this on app boot to
 * populate the cache before any subscriber renders.
 */
export async function loadQueue(): Promise<OfflineUploadItem[]> {
  if (cache !== null) return cache;
  loadPromise ??= readFromStorage().then((items) => {
    cache = items;
    return items;
  });
  return loadPromise;
}

/**
 * Synchronous read of the cached queue. Returns `[]` before the
 * first `loadQueue()` completes — callers that need to render
 * before boot should `await loadQueue()` first OR subscribe and
 * react to the first emission.
 */
export function getQueueSnapshot(): OfflineUploadItem[] {
  return cache ?? [];
}

export async function enqueue(item: OfflineUploadItem): Promise<void> {
  const current = await loadQueue();
  // Dedup on `clientIdempotencyKey` — a hostile / buggy caller
  // adding the same key twice would otherwise let the drain loop
  // submit two identical requestImports.
  const next = current.filter(
    (i) => i.clientIdempotencyKey !== item.clientIdempotencyKey,
  );
  next.push(item);
  cache = next;
  await writeToStorage(next);
  emit(next);
}

export async function dequeue(clientIdempotencyKey: string): Promise<void> {
  const current = await loadQueue();
  const next = current.filter(
    (i) => i.clientIdempotencyKey !== clientIdempotencyKey,
  );
  if (next.length === current.length) return;
  cache = next;
  await writeToStorage(next);
  emit(next);
}

/**
 * Test-only seam: reset the in-memory cache so unit tests get a
 * clean slate without re-importing the module.
 */
export function __resetQueueForTests(): void {
  cache = null;
  loadPromise = null;
  listeners.clear();
}

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
