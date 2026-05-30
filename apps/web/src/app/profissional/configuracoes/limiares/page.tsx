import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@healthtracker/api";
import { appRouter, createTRPCContext } from "@healthtracker/api";
import { getVerifiedSessionForCaller } from "@healthtracker/auth/server";
import {
  PROFESSIONAL_STALENESS_THRESHOLDS_ROUTE,
  STALENESS_THRESHOLDS_HEADING_PT_BR,
  STALENESS_THRESHOLDS_NOT_ACTIVATED_BODY_PT_BR,
  STALENESS_THRESHOLDS_NOT_ACTIVATED_HEADING_PT_BR,
  STALENESS_THRESHOLDS_SUBHEADING_PT_BR,
} from "@healthtracker/validators";

import { StalenessThresholdsForm } from "./StalenessThresholdsForm";

/**
 * Story 6.5 AC1 — `/profissional/configuracoes/limiares`.
 *
 * First `/profissional/*` route in the codebase. RSC fetches the
 * doctor's current threshold list via `accountRouter.listStalenessThresholds`
 * and renders the form. Session-only gate; if the doctor has no
 * `professionals` row, the resolver throws `PRECONDITION_FAILED` and
 * we render the "ative sua conta" placeholder card.
 *
 * No tokens cached.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LimiaresPage(): Promise<React.ReactElement> {
  // R1-followup MEDIUM-4 — consolidated session helper (see
  // `packages/auth/src/server.ts`). Replaces the inline `getUser()` +
  // `getSession()` + synthetic-shim pattern that lived here and in
  // `m/[token]/view/page.tsx`.
  const session = await getVerifiedSessionForCaller();
  if (!session) {
    redirect(
      `/auth/login?next=${encodeURIComponent(PROFESSIONAL_STALENESS_THRESHOLDS_ROUTE)}`,
    );
  }

  const reqHeaders = await headers();
  const ctx = createTRPCContext({
    headers: reqHeaders,
    session,
  });
  const caller = appRouter.createCaller(ctx);

  let data: RouterOutputs["account"]["listStalenessThresholds"] | null = null;
  try {
    data = await caller.account.listStalenessThresholds({});
  } catch (err) {
    if (err instanceof TRPCError && err.code === "PRECONDITION_FAILED") {
      // AC1 — placeholder card for not-yet-activated doctors.
      return (
        <main
          style={{
            margin: "0 auto",
            maxWidth: 640,
            padding: "32px 16px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>
            {STALENESS_THRESHOLDS_NOT_ACTIVATED_HEADING_PT_BR}
          </h1>
          <p style={{ color: "#6b7280" }}>
            {STALENESS_THRESHOLDS_NOT_ACTIVATED_BODY_PT_BR}
          </p>
        </main>
      );
    }
    throw err;
  }

  return (
    <main
      style={{
        margin: "0 auto",
        maxWidth: 640,
        padding: "32px 16px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>
        {STALENESS_THRESHOLDS_HEADING_PT_BR}
      </h1>
      <p style={{ color: "#6b7280", marginBottom: 24 }}>
        {STALENESS_THRESHOLDS_SUBHEADING_PT_BR}
      </p>
      <StalenessThresholdsForm
        initialCategories={data.categories}
        defaultDays={data.defaultDays}
      />
    </main>
  );
}
