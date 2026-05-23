import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "@healthtracker/api";

import { env } from "../env";
import { supabase } from "../lib/supabase";
import { getBaseUrl } from "./base-url";

/**
 * Story 3.4 — `gcTime` must be >= the persister's `maxAge`, otherwise
 * TanStack Query garbage-collects queries from the in-memory cache
 * before the persister has a chance to hydrate them on next launch.
 * Setting `gcTime` to 7 days matches `QUERY_CACHE_MAX_AGE_MS` and
 * keeps the on-disk and in-memory windows aligned.
 */
const PERSISTED_QUERY_GC_TIME_MS = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: PERSISTED_QUERY_GC_TIME_MS,
    },
  },
});

/**
 * Story 3.4 — whitelist of query-key paths that are persisted to
 * AsyncStorage by `PersistQueryClientProvider`. Everything else
 * (notifications, push tokens, BIA, auth, consent, uploads) stays
 * in-memory only — LGPD hygiene + AsyncStorage size discipline.
 *
 * R1-P270 — `@trpc/tanstack-react-query` v11 keys queries as
 * `[['<router>', '<procedure>'], { input?, type? }]` (the first
 * element is an ARRAY path, not a dotted string — see
 * `getQueryKeyInternal` in the adapter source). Matching must walk
 * the path array, not assume a flat string key.
 */
export const PERSIST_QUERY_KEYS: readonly (readonly string[])[] = [
  ["observations", "getRecord"],
  ["observations", "getPersonalBaseline"],
] as const;

function pathMatches(
  path: readonly unknown[],
  target: readonly string[],
): boolean {
  if (path.length !== target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (path[i] !== target[i]) return false;
  }
  return true;
}

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  if (!Array.isArray(head)) return false;
  return PERSIST_QUERY_KEYS.some((target) => pathMatches(head, target));
}

// The raw tRPC client. Use this for one-off mutations outside React
// components (e.g. from app/_layout.tsx after a deep-link auth callback).
// Within components, prefer `trpc` + React Query.
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    loggerLink({
      enabled: (opts) =>
        env.NODE_ENV === "development" ||
        (opts.direction === "down" && opts.result instanceof Error),
      colorMode: "ansi",
    }),
    httpBatchLink({
      transformer: superjson,
      url: `${getBaseUrl()}/api/trpc`,
      headers: async () => {
        const headers = new Map<string, string>();
        headers.set("x-trpc-source", "expo-react");
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers.set("Authorization", `Bearer ${session.access_token}`);
        }
        return Object.fromEntries(headers);
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

export type { RouterInputs, RouterOutputs } from "@healthtracker/api";
