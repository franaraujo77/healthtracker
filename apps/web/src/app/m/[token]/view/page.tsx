import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@healthtracker/api";
import { appRouter, createTRPCContext } from "@healthtracker/api";
import { createSupabaseServerClient } from "@healthtracker/auth/server";
import { BiomarkerCard, ConversationStarterPrompt } from "@healthtracker/ui";

import { ConversationStarterPolling } from "./ConversationStarterPolling";
import { MarkStarterViewed } from "./MarkStarterViewed";
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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    dotIdx <= 0 || tokenHmac.length === 0 || !UUID_REGEX.test(shareTokenId);
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

  let report: RouterOutputs["sharing"]["getConversationStarter"];
  try {
    report = await doctorCaller.sharing.getConversationStarter({
      shareTokenId,
      tokenHmac,
    });
  } catch (err) {
    // R1-L3: narrow on `NOT_FOUND` (revoked / expired / cross-token /
    // unknown / bad-HMAC) → redirect to pre-auth landing for the
    // dead-link discriminator. Anything else propagates — programmer
    // errors must not silently degrade to a dead-link.
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      redirect(`/m/${token}`);
    }
    throw err;
  }

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
          return (
            <BiomarkerCard
              key={`card-${idx}`}
              biomarkerName={card.category}
              valueNumeric={card.currentValue}
              unitUcum=""
              referenceRangeLow={null}
              referenceRangeHigh={null}
              state="cold-start"
            />
          );
        })}
      </section>
    </ReportLayout>
  );
}
