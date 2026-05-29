import { redirect } from "next/navigation";

import { REGISTER_ROUTE } from "@healthtracker/validators";

import { getSession } from "~/auth/server";
import { ExcluirContaClient } from "./excluir-conta-client";

/**
 * Story 5.6 T6.3 — Configurações > Conta > Excluir conta (web).
 *
 * Page-level auth gate; the client owns the EXCLUIR magic-word +
 * 30s cooldown ceremony. LGPD Art. 18.
 */
export default async function ExcluirContaPage() {
  const session = await getSession();
  if (!session) {
    redirect(REGISTER_ROUTE);
  }
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <ExcluirContaClient />
    </main>
  );
}
