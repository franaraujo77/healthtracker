import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@healthtracker/api";
import { appRouter, createTRPCContext } from "@healthtracker/api";
import { createSupabaseServerClient } from "@healthtracker/auth/server";
import { BiomarkerCard, ConversationStarterPrompt } from "@healthtracker/ui";
import {
  PROFESSIONAL_STALENESS_THRESHOLDS_ROUTE,
  STALENESS_THRESHOLDS_LINK_PT_BR,
  UUID_SHAPE_REGEX,
} from "@healthtracker/validators";

import { ConversationStarterPolling } from "./ConversationStarterPolling";
import { InvitePatientButton } from "./InvitePatientButton";
import { MarkStarterViewed } from "./MarkStarterViewed";
import { ProfessionalAccountBanner } from "./ProfessionalAccountBanner";
import { ReportLayout } from "./ReportLayout";

/**
 * Story 6.2 AC5 / T5.4 — doctor report view (RSC).
 *
 * Sequence:
 *   1. Parse `[token]` on first `.` (same shape as Story 6.1).
 *   2. `supabase.auth.getUser()` — no user → redirect to `/m/[token]/auth`
 *      (NOT `/m/[token]` — the doctor already cleared the pre-auth
 *      landing).
 *   3. Re-validate the share-token via `getPreAuthContext` — if not
 *      `active`, redirect to `/m/[token]` so Story 6.1 renders the
 *      dead-link state. (Trust nothing — a token can be revoked between
 *      the magic-link click and the report load.)
 *   4. Set `x-share-token` header and call `getConversationStarter` via
 *      the RSC-side caller. Render the payload (ready) or the polling
 *      skeleton (queued/failed).
 *
 * `noindex,nofollow` + `force-dynamic` — never cache a token-shaped
 * URL.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function DoctorReportView({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { token } = await params;
  const reqHeaders = await headers();

  const dotIdx = token.indexOf(".");
  const shareTokenId = dotIdx > 0 ? token.slice(0, dotIdx) : "";
  const tokenHmac =
    dotIdx > 0 && dotIdx < token.length - 1 ? token.slice(dotIdx + 1) : "";
  const malformed =
    dotIdx <= 0 ||
    tokenHmac.length === 0 ||
    !UUID_SHAPE_REGEX.test(shareTokenId);
  if (malformed) {
    redirect(`/m/${token}`);
  }

  // Auth gate — no session → magic-link request.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/m/${token}/auth`);
  }

  // Token-status gate — RE-VALIDATE (publicProcedure path discriminates
  // expired/revoked/invalid). A token can be revoked between the
  // magic-link click and the report load.
  const preAuthCtx = createTRPCContext({
    headers: reqHeaders,
    session: null,
  });
  const preAuthCaller = appRouter.createCaller(preAuthCtx);
  const preAuth = await preAuthCaller.sharing.getPreAuthContext({
    shareTokenId,
    tokenHmac,
  });
  if (preAuth.status !== "active") {
    redirect(`/m/${token}`);
  }

  // Doctor-procedure caller — inject `x-share-token` header so the
  // middleware binds `app.current_share_token_id` GUC. The session
  // (verified by `getUser()` above) satisfies the T4 session gate.
  const doctorHeaders = new Headers(reqHeaders);
  doctorHeaders.set("x-share-token", shareTokenId);
  // R1-M1 fix-up: prefer the real Supabase session (so future
  // middleware that reads `session.access_token` works), fall back to
  // a synthetic user-only shape if the cookie has no session row. The
  // doctorProcedure middleware reads only `session.user` today; the
  // real-session preference keeps Story 6.3+ honest when it grows new
  // reads. `getUser()` above has already revalidated the JWT.
  const { data: sessionData } = await supabase.auth.getSession();
  const doctorSession =
    sessionData.session ??
    ({
      access_token: "",
      refresh_token: "",
      expires_in: 0,
      token_type: "bearer",
      user,
    } as unknown as NonNullable<typeof sessionData.session>);
  const doctorCtx = createTRPCContext({
    headers: doctorHeaders,
    session: doctorSession,
  });
  const doctorCaller = appRouter.createCaller(doctorCtx);

  // Story 6.3 T5.1 — `getConversationStarter` and
  // `getActivationStatus` run concurrently (NFR-P4 <3s budget intact;
  // neither adds a serial RTT).
  //
  // R1-L3 fix-up: only `getConversationStarter` can throw NOT_FOUND
  // (revoked / expired / cross-token / unknown / bad-HMAC).
  // `getActivationStatus` is read-only against `professionals` and
  // returns `activated:false` for the unbound case — it does NOT
  // throw NOT_FOUND. The previous `Promise.all` wrapped a single
  // try/catch around both, which would silently redirect to the
  // dead-link page if a future change made the activation resolver
  // throw on, say, a missing RLS policy. Split the awaits so each
  // resolver's error surface is narrow.
  //
  // The activation status is `auth.uid()`-scoped (NOT share-token-
  // scoped), so a doctor activated via patient A's link surfaces as
  // activated when viewing patient B's report.
  const reportPromise = doctorCaller.sharing.getConversationStarter({
    shareTokenId,
    tokenHmac,
  });
  const activationPromise = doctorCaller.sharing.getActivationStatus({});
  let report: RouterOutputs["sharing"]["getConversationStarter"];
  try {
    report = await reportPromise;
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      // Wait for the activation promise so an unhandled-rejection
      // warning doesn't fire when we redirect away.
      await activationPromise.catch(() => undefined);
      redirect(`/m/${token}`);
    }
    throw err;
  }
  const activationStatus: RouterOutputs["sharing"]["getActivationStatus"] =
    await activationPromise;

  const patientFirstName = report.patientFirstName;

  if (report.cacheStatus !== "ready" || report.payload === null) {
    return (
      <ReportLayout patientFirstName={patientFirstName}>
        <ConversationStarterPolling
          shareTokenId={shareTokenId}
          tokenHmac={tokenHmac}
        />
      </ReportLayout>
    );
  }

  const { prompts, biomarkerCards } = report.payload;
  const stalenessByIdx = report.biomarkerStaleness;

  return (
    <ReportLayout patientFirstName={patientFirstName}>
      {/* R1-H1: one-shot audit emission on view (replaces per-tick). */}
      <MarkStarterViewed shareTokenId={shareTokenId} tokenHmac={tokenHmac} />
      <section
        aria-label="Prompts de conversa"
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        {prompts.map((p, idx) => (
          <ConversationStarterPrompt
            key={`prompt-${idx}`}
            index={idx + 1}
            text={p.text}
          />
        ))}
      </section>
      <section
        aria-label="Biomarcadores"
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        }}
      >
        {biomarkerCards.map((card, idx) => {
          // R1-N1: when `currentValue` is null, the LLM had no draw to
          // surface — collapsing `null` to `0` would render as a real
          // observation of zero. Render the biomarker category as a
          // bare label instead; the card requires a finite `number`.
          if (card.currentValue === null) {
            return (
              <div
                key={`card-${idx}`}
                aria-label={`${card.category} — sem dados`}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 12,
                  color: "#6b7280",
                }}
              >
                <strong>{card.category}</strong>
                <div style={{ marginTop: 4 }}>—</div>
              </div>
            );
          }
          const staleness = stalenessByIdx?.[idx];
          return (
            <BiomarkerCard
              key={`card-${idx}`}
              biomarkerName={card.category}
              valueNumeric={card.currentValue}
              unitUcum=""
              referenceRangeLow={null}
              referenceRangeHigh={null}
              state="cold-start"
              isStale={staleness?.isStale ?? false}
              stalenessThresholdDays={staleness?.thresholdDays}
            />
          );
        })}
      </section>
      {/*
        Story 6.3 AC1 — activation offer rendered below the report when
        the doctor is not yet activated. Per-session dismiss; deliberately
        not persisted (see spec T5.2 deferred-work entry).
      */}
      {!activationStatus.activated ? (
        <ProfessionalAccountBanner
          shareTokenId={shareTokenId}
          tokenHmac={tokenHmac}
          email={user.email ?? ""}
          defaultDisplayName={user.email?.split("@")[0] ?? ""}
          // R1-H1: pass the RSC-fetched status as `initialData` for
          // the client subscriber. The banner refetches on the
          // modal's `invalidateQueries` and unmounts itself when
          // `activated` flips to true.
          initialActivationStatus={activationStatus}
        />
      ) : (
        /*
         * Story 6.4 AC1 — Tier-1 "Convidar paciente" slot. Mutually
         * exclusive with the activation banner per UX-DR20 (single
         * Tier-1 action at report close). The button mounts its own
         * `<ShareTokenProvider>` so the doctorProcedure mutation
         * carries the `x-share-token` header.
         */
        <InvitePatientButton shareTokenId={shareTokenId} />
      )}
      {/*
        Story 6.5 AC1 / AC12 — Tier-3 settings link, only when activated.
        Placed under the InvitePatientButton (NOT next to it) per
        UX-DR20 (single Tier-1 action at report close).
      */}
      {activationStatus.activated ? (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Link
            href={PROFESSIONAL_STALENESS_THRESHOLDS_ROUTE}
            style={{
              fontSize: 13,
              color: "#6b7280",
              textDecoration: "underline",
            }}
          >
            {STALENESS_THRESHOLDS_LINK_PT_BR}
          </Link>
        </div>
      ) : null}
    </ReportLayout>
  );
}
