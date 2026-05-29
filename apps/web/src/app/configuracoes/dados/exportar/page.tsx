import { redirect } from "next/navigation";

import { REGISTER_ROUTE } from "@healthtracker/validators";

import { getSession } from "~/auth/server";
import { ExportarClient } from "./exportar-client";

/**
 * Story 5.5 — Configurações > Dados > Exportar registro (web).
 *
 * Page-level auth gate; the client owns the polling + share-sheet
 * logic. URL query param `?exportId=...` persists an in-flight
 * export across reload (AC2 — web parity for the Expo AsyncStorage
 * resume seam).
 */
export default async function ExportarPage() {
  const session = await getSession();
  if (!session) {
    redirect(REGISTER_ROUTE);
  }
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <ExportarClient />
    </main>
  );
}
