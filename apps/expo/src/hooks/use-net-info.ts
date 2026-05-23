import type { NetInfoState } from "@react-native-community/netinfo";
import { useSyncExternalStore } from "react";
import NetInfo from "@react-native-community/netinfo";

/**
 * Story 3.4 — single shared NetInfo subscription exposed as a React
 * state-like value via `useSyncExternalStore`. Components that need
 * to re-render on connectivity transitions (the offline-cached
 * "Última atualização" label, the disabled-CTA branches) read from
 * this hook. The hook is render-safe and concurrent-mode-safe.
 *
 * Initial value is `{ isConnected: null, isInternetReachable: null }`
 * — `null` (unknown) is distinct from `false` (offline). Components
 * MUST treat `null` as "not yet known" and not as "offline" (we use
 * `isConnected === false` in the call sites — never `!isConnected`).
 */

export interface NetInfoExternalState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

let currentSnapshot: NetInfoExternalState = {
  isConnected: null,
  isInternetReachable: null,
};
const subscribers = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function ensureSubscription(): void {
  if (unsubscribe !== null) return;
  unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const next: NetInfoExternalState = {
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
    };
    // Only update + emit when something actually changed; avoids
    // spurious re-renders on identical events.
    if (
      next.isConnected === currentSnapshot.isConnected &&
      next.isInternetReachable === currentSnapshot.isInternetReachable
    ) {
      return;
    }
    currentSnapshot = next;
    for (const sub of subscribers) sub();
  });
  // Best-effort initial fetch so components that mount before the
  // first NetInfo emit get the latest known value.
  void NetInfo.fetch().then((state: NetInfoState) => {
    const next: NetInfoExternalState = {
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
    };
    if (
      next.isConnected === currentSnapshot.isConnected &&
      next.isInternetReachable === currentSnapshot.isInternetReachable
    ) {
      return;
    }
    currentSnapshot = next;
    for (const sub of subscribers) sub();
  });
}

function subscribe(onStoreChange: () => void): () => void {
  ensureSubscription();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot(): NetInfoExternalState {
  return currentSnapshot;
}

export function useNetInfoExternal(): NetInfoExternalState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only reset. */
export function __resetNetInfoForTests(): void {
  currentSnapshot = { isConnected: null, isInternetReachable: null };
  subscribers.clear();
  if (unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }
}
