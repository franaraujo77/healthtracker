import AsyncStorage from "@react-native-async-storage/async-storage";

import type { UploadMimeType, UploadSource } from "@healthtracker/validators";
import {
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_SOURCES,
} from "@healthtracker/validators";

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
 * R1-P180 — namespaced per patient via `setActivePatient(patientId)`.
 * Switching identities clears the in-memory cache so the new
 * patient never sees the previous one's queue, and a new
 * AsyncStorage key isolates persistence. Sign-out clears the key.
 *
 * R1-P183 — disk writes come BEFORE cache mutation. Throws roll back
 * the cache so the in-memory state never diverges from persisted state.
 *
 * R1-P185 / R1-P186 — load-time validation drops items whose
 * `mimeType` / `source` is no longer in the validators' allowed
 * lists (enum drift between releases).
 *
 * R1-P187 — soft cap of 20 items: enqueue past the cap logs a warn
 * but still appends (no patient-facing rejection).
 */

const STORAGE_PREFIX = "@healthtracker/offline-upload-queue";
export const QUEUE_SOFT_CAP = 20;
export const MAX_ATTEMPTS_PER_ITEM = 5;

export interface OfflineUploadItem {
  clientIdempotencyKey: string;
  localUri: string;
  originalFilename: string;
  mimeType: UploadMimeType;
  sizeBytes: number;
  source: UploadSource;
  pageCount?: number;
  enqueuedAt: string;
  /** R1-P181 — drain failure counter; items past MAX_ATTEMPTS_PER_ITEM are dropped. */
  attemptCount?: number;
}

type Listener = (items: OfflineUploadItem[]) => void;

interface State {
  patientId: string | null;
  cache: OfflineUploadItem[] | null;
  loadPromise: Promise<OfflineUploadItem[]> | null;
  /**
   * R2-P191 — serializes every mutation (enqueue/dequeue/recordAttempt/
   * clearQueue) so concurrent picks don't last-writer-wins on
   * AsyncStorage. Every mutation chains onto the tail of this promise.
   */
  writeChain: Promise<unknown>;
  /**
   * R2-P195 — `whenPatientReady()` returns a promise that resolves the
   * next time `setActivePatient(<non-null>)` is called. Lets the
   * offline-pick branch survive the cold-boot race between
   * `useImportFiles` running and the auth listener firing.
   */
  patientReadyWaiters: ((patientId: string) => void)[];
}

const state: State = {
  patientId: null,
  cache: null,
  loadPromise: null,
  writeChain: Promise.resolve(),
  patientReadyWaiters: [],
};
const listeners = new Set<Listener>();

function storageKey(patientId: string): string {
  return `${STORAGE_PREFIX}/${patientId}`;
}

function isValidItem(raw: unknown): raw is OfflineUploadItem {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.clientIdempotencyKey !== "string") return false;
  if (typeof r.localUri !== "string") return false;
  if (typeof r.originalFilename !== "string") return false;
  if (typeof r.sizeBytes !== "number" || !Number.isFinite(r.sizeBytes))
    return false;
  if (typeof r.enqueuedAt !== "string") return false;
  if (typeof r.mimeType !== "string") return false;
  if (!(UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(r.mimeType))
    return false;
  if (typeof r.source !== "string") return false;
  if (!(UPLOAD_SOURCES as readonly string[]).includes(r.source)) return false;
  return true;
}

async function readFromStorage(
  patientId: string,
): Promise<OfflineUploadItem[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(patientId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // R1-P185 / R1-P186 — drop entries that fail current-schema validation.
    const valid = parsed.filter(isValidItem);
    if (valid.length !== parsed.length) {
      console.warn(
        `[offline-upload-queue] dropped ${parsed.length - valid.length} invalid item(s) on load`,
      );
    }
    return valid;
  } catch (err) {
    console.warn("[offline-upload-queue] read failed; treating as empty", err);
    return [];
  }
}

async function writeToStorage(
  patientId: string,
  items: OfflineUploadItem[],
): Promise<void> {
  await AsyncStorage.setItem(storageKey(patientId), JSON.stringify(items));
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

function requirePatientId(): string {
  if (state.patientId === null) {
    throw new Error(
      "[offline-upload-queue] no active patient set — call setActivePatient(patientId) first",
    );
  }
  return state.patientId;
}

/**
 * R1-P180 — bind the queue to the calling patient. Sign-in flows
 * call this with the patient's id; sign-out passes `null` to clear
 * the in-memory cache (the on-disk key per the previous patient
 * stays so a sign-back-in can resume their queue).
 */
export function setActivePatient(patientId: string | null): void {
  if (state.patientId === patientId) return;
  state.patientId = patientId;
  state.cache = null;
  state.loadPromise = null;
  emit([]);
  // R2-P195 — flush any pending `whenPatientReady()` awaiters when
  // we now have a non-null patient.
  if (patientId !== null) {
    const waiters = state.patientReadyWaiters;
    state.patientReadyWaiters = [];
    for (const resolve of waiters) {
      try {
        resolve(patientId);
      } catch (err) {
        console.warn("[offline-upload-queue] readyWaiter threw", err);
      }
    }
  }
}

/**
 * R2-P195 — resolves as soon as a non-null patient is bound (either
 * immediately if one already is, or on the next `setActivePatient`
 * call). Rejects on `timeoutMs` so the offline-pick branch can
 * surface a clearer message instead of throwing
 * `no active patient set`.
 */
export function whenPatientReady(timeoutMs = 5000): Promise<string> {
  if (state.patientId !== null) return Promise.resolve(state.patientId);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onReady = (patientId: string) => {
      if (timer !== null) clearTimeout(timer);
      resolve(patientId);
    };
    state.patientReadyWaiters.push(onReady);
    timer = setTimeout(() => {
      const idx = state.patientReadyWaiters.indexOf(onReady);
      if (idx !== -1) state.patientReadyWaiters.splice(idx, 1);
      reject(new Error("OFFLINE_QUEUE_PATIENT_NOT_READY"));
    }, timeoutMs);
  });
}

/**
 * R2-P191 — serialize every queue mutation through `state.writeChain`
 * so concurrent picks can't last-writer-wins on AsyncStorage. The
 * chain swallows errors from prior tasks so one failed mutation
 * doesn't poison subsequent ones; each caller still sees its own
 * task's outcome.
 */
function chainMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = state.writeChain.then(task, task);
  // Don't let a rejection from THIS task break the chain for future
  // callers — convert to a resolved void.
  state.writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function loadQueue(): Promise<OfflineUploadItem[]> {
  if (state.cache !== null) return state.cache;
  const patientId = requirePatientId();
  state.loadPromise ??= readFromStorage(patientId).then((items) => {
    state.cache = items;
    return items;
  });
  return state.loadPromise;
}

export function getQueueSnapshot(): OfflineUploadItem[] {
  return state.cache ?? [];
}

export function enqueue(item: OfflineUploadItem): Promise<void> {
  // R2-P192 — refuse to persist items that wouldn't survive a load
  // round-trip. The patient sees an upload failure (clear log) rather
  // than the card silently vanishing tomorrow.
  if (!isValidItem(item)) {
    throw new Error("OFFLINE_QUEUE_INVALID_ITEM");
  }
  return chainMutation(async () => {
    const patientId = requirePatientId();
    const current = await loadQueue();
    // R2-P197 — if an existing entry has the same key, preserve its
    // original `enqueuedAt` (and `attemptCount`) so a drain-retry
    // re-enqueue doesn't reset the timestamp / progress.
    const prior = current.find(
      (i) => i.clientIdempotencyKey === item.clientIdempotencyKey,
    );
    const merged: OfflineUploadItem = prior
      ? {
          ...item,
          enqueuedAt: prior.enqueuedAt,
          attemptCount: prior.attemptCount,
        }
      : item;
    const filtered = current.filter(
      (i) => i.clientIdempotencyKey !== item.clientIdempotencyKey,
    );
    const next = [...filtered, merged];
    if (next.length > QUEUE_SOFT_CAP) {
      console.warn(
        `[offline-upload-queue] queue size ${next.length} exceeds soft cap ${QUEUE_SOFT_CAP}`,
      );
    }
    await writeToStorage(patientId, next);
    state.cache = next;
    emit(next);
  });
}

export function dequeue(clientIdempotencyKey: string): Promise<void> {
  return chainMutation(async () => {
    const patientId = requirePatientId();
    const current = await loadQueue();
    const next = current.filter(
      (i) => i.clientIdempotencyKey !== clientIdempotencyKey,
    );
    if (next.length === current.length) return;
    await writeToStorage(patientId, next);
    state.cache = next;
    emit(next);
  });
}

/**
 * R1-P181 — record a drain failure for an item. When attemptCount
 * exceeds MAX_ATTEMPTS_PER_ITEM, the item is dropped from the queue
 * (avoids the infinite-retry loop on dead localUri / 4xx).
 */
export function recordAttempt(
  clientIdempotencyKey: string,
): Promise<{ dropped: boolean }> {
  return chainMutation(async () => {
    const patientId = requirePatientId();
    const current = await loadQueue();
    const idx = current.findIndex(
      (i) => i.clientIdempotencyKey === clientIdempotencyKey,
    );
    const target = current[idx];
    if (!target) return { dropped: false };
    const nextAttempts = (target.attemptCount ?? 0) + 1;
    if (nextAttempts >= MAX_ATTEMPTS_PER_ITEM) {
      console.warn(
        `[offline-upload-queue] dropping item ${clientIdempotencyKey} after ${nextAttempts} failed attempts`,
      );
      const next = current.filter(
        (i) => i.clientIdempotencyKey !== clientIdempotencyKey,
      );
      await writeToStorage(patientId, next);
      state.cache = next;
      emit(next);
      return { dropped: true };
    }
    const next: OfflineUploadItem[] = [...current];
    next[idx] = { ...target, attemptCount: nextAttempts };
    await writeToStorage(patientId, next);
    state.cache = next;
    emit(next);
    return { dropped: false };
  });
}

/**
 * R1-P180 — wipe the queue for the current patient (e.g. on
 * SIGNED_OUT after a successful drain, or on full sign-out reset).
 */
export function clearQueue(): Promise<void> {
  return chainMutation(async () => {
    const patientId = state.patientId;
    if (patientId === null) {
      state.cache = null;
      state.loadPromise = null;
      emit([]);
      return;
    }
    await AsyncStorage.removeItem(storageKey(patientId));
    state.cache = [];
    state.loadPromise = null;
    emit([]);
  });
}

export function __resetQueueForTests(): void {
  state.patientId = null;
  state.cache = null;
  state.loadPromise = null;
  listeners.clear();
}

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
