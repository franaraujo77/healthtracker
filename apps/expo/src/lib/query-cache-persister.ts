import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import superjson from "superjson";

/**
 * The persister type isn't exported from `@tanstack/query-async-storage-
 * persister` v5; derive it from the factory's return type so refactors
 * follow the source.
 */
export type QueryCachePersister = ReturnType<
  typeof createAsyncStoragePersister
>;

/**
 * Story 3.4 — patient-namespaced React Query cache persister.
 *
 * Mirrors the offline-upload-queue (Story 2.6) namespacing model:
 * AsyncStorage keys are `@healthtracker/query-cache/{patientId}`, so
 * two patients on the same device never see each other's cached
 * Fingerprint data. `setActiveQueryCachePatient(patientId)` is called
 * from the auth-listener (`useQueryCacheLifecycle`) on `SIGNED_IN`;
 * `setActiveQueryCachePatient(null)` on `SIGNED_OUT` removes the
 * patient's AsyncStorage key (LGPD-aligned — data at rest disappears
 * when the patient signs out).
 *
 * IMPORTANT — audit-trail note (Dev Notes § "Story 3.3 surfaces
 * preserved"). Hydrated cache reads do NOT emit
 * `observation.read` / `observation.baseline.read` audit rows: those
 * fire server-side inside the tRPC procedure. When offline, no
 * procedure runs → no audit row. This is by design, not a gap.
 *
 * Serialization: `superjson` so the persisted snapshot matches the
 * shape tRPC wrote (Date / bigint / etc. round-trip cleanly). Tied
 * to the same `superjson` instance the tRPC link uses.
 *
 * Narrow catch discipline (CLAUDE.md): we do NOT wrap AsyncStorage
 * calls in `try/catch`. The TanStack persister is itself the consumer
 * of these calls and applies its own error handling around hydrate /
 * dehydrate. Wrapping here would swallow programmer errors
 * (TypeError / ReferenceError) and confuse the persister's own
 * recovery path.
 */

const STORAGE_PREFIX = "@healthtracker/query-cache";

/** AC6 — defence-in-depth: discard persisted snapshots older than 7 days. */
export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Coalesced AsyncStorage writes (1 s — TanStack default-ish). */
const PERSISTER_THROTTLE_MS = 1000;

export function queryCacheStorageKey(patientId: string): string {
  return `${STORAGE_PREFIX}/${patientId}`;
}

interface State {
  patientId: string | null;
  persister: QueryCachePersister | null;
}

type Listener = (persister: QueryCachePersister | null) => void;

const state: State = {
  patientId: null,
  persister: null,
};
const listeners = new Set<Listener>();

function emit(persister: QueryCachePersister | null): void {
  for (const listener of listeners) {
    listener(persister);
  }
}

/**
 * Returns a persister bound to the given patient's AsyncStorage key.
 * Exported for tests and for the rare case a consumer wants to mint a
 * persister directly without going through `setActiveQueryCachePatient`.
 */
export function createPatientPersister(patientId: string): QueryCachePersister {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: queryCacheStorageKey(patientId),
    throttleTime: PERSISTER_THROTTLE_MS,
    serialize: (client: unknown) => superjson.stringify(client),
    deserialize: (cached: string) => superjson.parse(cached),
  });
}

/**
 * Auth-driven entry point. Called from `useQueryCacheLifecycle` on
 * `SIGNED_IN` (with the patient id) and `SIGNED_OUT` (with `null`).
 *
 * - On `null`: also removes the PREVIOUS patient's AsyncStorage key
 *   (LGPD: data at rest disappears at sign-out — AC6).
 * - On a non-null patient: mints a fresh persister and notifies
 *   subscribers so `PersistQueryClientProvider` rebinds.
 * - No-op when the patient id is unchanged.
 */
export function setActiveQueryCachePatient(patientId: string | null): void {
  if (state.patientId === patientId) return;
  const previousPatientId = state.patientId;
  state.patientId = patientId;
  if (patientId === null) {
    state.persister = null;
    if (previousPatientId !== null) {
      // AC6 — fire-and-forget removal; the persister isn't rebinding
      // anyway. Narrow catch: only AsyncStorage IO failure is
      // expected here; programmer errors are surfaced as console.warn
      // (the previous patient's key staying behind is a tolerable
      // worst case for a sign-out cleanup).
      void AsyncStorage.removeItem(
        queryCacheStorageKey(previousPatientId),
      ).catch((err: unknown) => {
        console.warn(
          "[query-cache-persister] failed to remove key on sign-out",
          err,
        );
      });
    }
  } else {
    state.persister = createPatientPersister(patientId);
  }
  emit(state.persister);
}

export function getActivePersister(): QueryCachePersister | null {
  return state.persister;
}

export function getActivePatientId(): string | null {
  return state.patientId;
}

/**
 * Subscribe to active-persister changes. The
 * `PersistQueryClientProvider`-aware wrapper in `_layout.tsx` uses
 * this to re-mount when the patient binding changes.
 */
export function subscribeToPersister(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. Not exported from a barrel; tests import directly. */
export function __resetPersisterForTests(): void {
  state.patientId = null;
  state.persister = null;
  listeners.clear();
}
