"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchStreamLink,
  loggerLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import SuperJSON from "superjson";

import type { AppRouter } from "@healthtracker/api";

import { env } from "~/env";
import { createQueryClient } from "./query-client";

/**
 * Story 6.2 T5.5 — per-request `x-share-token` header injection.
 *
 * The doctor surface's tRPC calls (polling `getConversationStarter`
 * from `<ConversationStarterPolling>` and future Epic 6 hooks) must
 * carry the `x-share-token` header for `doctorProcedure` to bind the
 * RLS principal. The link's `headers()` callback runs at request time
 * (post-render); reading from a module-level holder is safe and lets
 * `<ShareTokenProvider>` mounts mutate it on the client.
 *
 * Why a module-level singleton (not a ref-in-context): the
 * `react-hooks/refs` ESLint rule forbids reading refs during render
 * or passing them into closures captured at render-time. The link is
 * created inside `useState(() => …)` (render-phase initializer). The
 * holder is module-scoped so the closure reads it at request-fire
 * time, when whatever provider mounted last has already written.
 *
 * Patient-side calls leave the holder empty and behave exactly as
 * before — only doctor-surface subtrees mount the provider.
 */
const shareTokenHolder: { current: string | null } = { current: null };

export function ShareTokenProvider(props: {
  shareTokenId: string;
  children: React.ReactNode;
}): React.ReactElement {
  // Effect (not render) — so the rule doesn't fire and the write
  // happens after commit. The link callback fires only on a tRPC
  // request, which happens after the effect ran.
  useEffect(() => {
    shareTokenHolder.current = props.shareTokenId;
    return () => {
      shareTokenHolder.current = null;
    };
  }, [props.shareTokenId]);
  return <>{props.children}</>;
}

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return createQueryClient();
  } else {
    // Browser: use singleton pattern to keep the same query client
    return (clientQueryClientSingleton ??= createQueryClient());
  }
};

export const { useTRPC, useTRPCClient, TRPCProvider } =
  createTRPCContext<AppRouter>();

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          headers() {
            const headers = new Headers();
            headers.set("x-trpc-source", "nextjs-react");
            // Story 6.2 T5.5 — read the module-level holder at
            // request-fire time (post-render).
            const shareTokenId = shareTokenHolder.current;
            if (shareTokenId && shareTokenId.length > 0) {
              headers.set("x-share-token", shareTokenId);
            }
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

const getBaseUrl = () => {
  if (typeof window !== "undefined") return window.location.origin;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  // eslint-disable-next-line no-restricted-properties
  return `http://localhost:${process.env.PORT ?? 3000}`;
};
