import { redirect } from "next/navigation";

import { REGISTER_ROUTE } from "@healthtracker/validators";

import { getSession } from "~/auth/server";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { NotificacoesClient } from "./notificacoes-client";

/**
 * Story 2.8 — push-notification preferences. Page-level auth gate
 * (P132 pattern); SSR-prefetches the current preferences so the
 * client hydrates without a loading flash.
 */
export default async function NotificacoesPage() {
  const session = await getSession();
  if (!session) {
    redirect(REGISTER_ROUTE);
  }
  prefetch(trpc.notifications.getPreferences.queryOptions());
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <HydrateClient>
        <NotificacoesClient />
      </HydrateClient>
    </main>
  );
}
