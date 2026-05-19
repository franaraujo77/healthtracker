import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import type { AppRouter } from "@healthtracker/api";

import { env } from "../env";
import { supabase } from "../lib/supabase";
import { getBaseUrl } from "./base-url";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ...
    },
  },
});

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
