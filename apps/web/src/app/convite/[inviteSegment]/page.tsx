import type { Metadata } from "next";
import { headers } from "next/headers";

import { appRouter, createTRPCContext } from "@healthtracker/api";
import {
  parsePatientInviteSegment,
  PATIENT_INVITE_LANDING_INVALID_BODY_PT_BR,
  PATIENT_INVITE_LANDING_INVALID_HEADING_PT_BR,
  patientInviteLandingValidHeadingPtBr,
} from "@healthtracker/validators";

import { PatientInviteLanding } from "./PatientInviteLanding";

/**
 * Story 6.4 AC7 — patient-facing invite landing page (RSC).
 *
 * Route: `/convite/<inviteId>.<tokenHmac>` (single dynamic segment
 * split on the first `.`; mirrors the doctor-side `/m/[token]` shape).
 *
 * Sequence:
 *   1. Parse the segment via `parsePatientInviteSegment` (strict UUID
 *      + non-empty HMAC). Malformed → render "Convite inválido" card.
 *   2. Call `accountRouter.getPatientInviteContext` (publicProcedure —
 *      no session). Returns `valid` + `doctorDisplayName`.
 *   3. Valid → render `<RegisterForm inviteId tokenHmac>`; the form
 *      threads both fields into `initializeProfile` which resolves the
 *      invite atomically with the user-row INSERT.
 *   4. Invalid (expired / revoked / bad-hmac / unknown) → render the
 *      generic "expired-message" card. No register form, no audit.
 *
 * `noindex,nofollow` + `force-dynamic` — the URL is a one-time invite
 * link; never cache.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ inviteSegment: string }>;
}

export default async function PatientInviteLandingPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { inviteSegment } = await params;
  const reqHeaders = await headers();

  const parsed = parsePatientInviteSegment(inviteSegment);
  if (!parsed) {
    return (
      <InvalidLandingShell
        heading={PATIENT_INVITE_LANDING_INVALID_HEADING_PT_BR}
        body={PATIENT_INVITE_LANDING_INVALID_BODY_PT_BR}
      />
    );
  }

  const ctx = createTRPCContext({ headers: reqHeaders, session: null });
  const caller = appRouter.createCaller(ctx);
  const context = await caller.account.getPatientInviteContext({
    inviteId: parsed.inviteId,
    tokenHmac: parsed.tokenHmac,
  });

  if (!context.valid || context.doctorDisplayName === null) {
    return (
      <InvalidLandingShell
        heading={PATIENT_INVITE_LANDING_INVALID_HEADING_PT_BR}
        body={PATIENT_INVITE_LANDING_INVALID_BODY_PT_BR}
      />
    );
  }

  return (
    <main className="container flex min-h-screen items-center justify-center py-16">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">
            {patientInviteLandingValidHeadingPtBr(context.doctorDisplayName)}
          </h1>
          <p className="text-muted-foreground text-sm">
            Crie sua conta para começar.
          </p>
        </header>
        <PatientInviteLanding
          inviteId={parsed.inviteId}
          tokenHmac={parsed.tokenHmac}
        />
      </div>
    </main>
  );
}

function InvalidLandingShell(props: {
  heading: string;
  body: string;
}): React.ReactElement {
  return (
    <main className="container flex min-h-screen items-center justify-center py-16">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold">{props.heading}</h1>
        <p className="text-muted-foreground text-sm">{props.body}</p>
      </div>
    </main>
  );
}
