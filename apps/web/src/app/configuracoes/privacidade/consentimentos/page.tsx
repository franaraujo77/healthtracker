import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { ConsentimentosList } from "./consentimentos-list";

export const dynamic = "force-dynamic";

// Story 1.4 — Meus Consentimentos (web). The Server Component prefetches
// `consent.list({ surface: 'settings' })` so the audit event fires
// inside the same protectedProcedure transaction as the SSR query
// (single emission per visit, AC4). The client component hydrates from
// the dehydrated cache with `staleTime: Infinity` and never refetches
// — `consent.read` stays a per-visit event, not a per-render one.
export default function MeusConsentimentosPage() {
  // The `prefetch` helper is fire-and-forget — it schedules the query
  // on the server-side React Query cache without awaiting it here. The
  // tRPC server caller runs inside the prefetch; the audit event fires
  // there. `HydrateClient` then dehydrates the cache for the client.
  prefetch(trpc.consent.list.queryOptions({ surface: "settings" }));

  return (
    <main className="container mx-auto max-w-2xl px-6 py-12">
      <HydrateClient>
        <ConsentimentosList />
      </HydrateClient>
    </main>
  );
}
