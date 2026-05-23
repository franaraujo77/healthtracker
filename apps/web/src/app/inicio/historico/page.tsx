import { redirect } from "next/navigation";

import { REGISTER_ROUTE } from "@healthtracker/validators";

import { getSession } from "~/auth/server";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { HistoricoClient } from "./historico-client";

// Story 2.5 — Histórico (upload history) page. Lists the patient's
// uploads with pt-BR status labels and (for failed uploads) recovery
// CTAs. Mirrors the Expo tab; SSR-prefetches the first page.
//
// Page-level auth gate (P132 pattern from Story 2.4).
export default async function HistoricoPage() {
  const session = await getSession();
  if (!session) {
    redirect(REGISTER_ROUTE);
  }
  prefetch(trpc.uploads.listUploadsForPatient.queryOptions({ limit: 50 }));
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <HydrateClient>
        <HistoricoClient />
      </HydrateClient>
    </main>
  );
}
