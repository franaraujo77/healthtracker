import { redirect } from "next/navigation";

import { REGISTER_ROUTE } from "@healthtracker/validators";

import { getSession } from "~/auth/server";
import { BiaForm } from "./bia-form";

/**
 * Story 2.7 — manual BIA entry page. Page-level auth gate (P132
 * pattern from Story 2.4); the actual form is the client component.
 */
export default async function ManualBiaPage() {
  const session = await getSession();
  if (!session) {
    redirect(REGISTER_ROUTE);
  }
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <BiaForm />
    </main>
  );
}
