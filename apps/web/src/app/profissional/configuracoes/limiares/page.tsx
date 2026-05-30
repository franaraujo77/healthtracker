import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@healthtracker/api";
import { appRouter, createTRPCContext } from "@healthtracker/api";
import { createSupabaseServerClient } from "@healthtracker/auth/server";
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
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/auth/login?next=${encodeURIComponent(PROFESSIONAL_STALENESS_THRESHOLDS_ROUTE)}`,
    );
  }

  const reqHeaders = await headers();
  const { data: sessionData } = await supabase.auth.getSession();
  const session =
    sessionData.session ??
    ({
      access_token: "",
      refresh_token: "",
      expires_in: 0,
      token_type: "bearer",
      user,
    } as unknown as NonNullable<typeof sessionData.session>);
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
