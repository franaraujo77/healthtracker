import type { Metadata } from "next";
import { headers } from "next/headers";

import {
  appRouter,
  auditMalformedTokenProbe,
  createTRPCContext,
} from "@healthtracker/api";
import { PreAuthLandingCard } from "@healthtracker/ui";
import {
  AUTH_REQUEST_HEADING_PT_BR,
  AUTH_REQUEST_SUBHEADING_FN,
  PRE_AUTH_LANDING_ACTIVE_FALLBACK_NAME_PT_BR,
} from "@healthtracker/validators";

import { DoctorMagicLinkForm } from "./DoctorMagicLinkForm";

/**
 * Story 6.2 AC1 / T5.1 — Doctor magic-link request page.
 *
 * Server component wrapper: re-runs Story 6.1's token-validate-and-
 * status branch table BEFORE rendering the form. Reaching
 * `/m/[token]/auth` directly via deep-link MUST NOT bypass the
 * dead-link gate.
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

export default async function DoctorAuthPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { token } = await params;
  const reqHeaders = await headers();
  const rawUserAgent = reqHeaders.get("user-agent") ?? "";
  const userAgent =
    rawUserAgent.length > 200 ? rawUserAgent.slice(0, 200) : rawUserAgent;

  const dotIdx = token.indexOf(".");
  const shareTokenId = dotIdx > 0 ? token.slice(0, dotIdx) : "";
  const tokenHmac =
    dotIdx > 0 && dotIdx < token.length - 1 ? token.slice(dotIdx + 1) : "";
  const malformed =
    dotIdx <= 0 || tokenHmac.length === 0 || !UUID_REGEX.test(shareTokenId);

  if (malformed) {
    await auditMalformedTokenProbe({
      userAgent: userAgent.length > 0 ? userAgent : null,
    });
    return (
      <main
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <PreAuthLandingCard
          status="invalid"
          patientFirstName={null}
          sharedAt={null}
        />
      </main>
    );
  }

  const ctx = createTRPCContext({ headers: reqHeaders, session: null });
  const caller = appRouter.createCaller(ctx);
  const result = await caller.sharing.getPreAuthContext({
    shareTokenId,
    tokenHmac,
    userAgent: userAgent.length > 0 ? userAgent : undefined,
  });

  // Dead-link gate — never render the email form for non-active states.
  if (result.status !== "active") {
    return (
      <main
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <PreAuthLandingCard
          status={result.status}
          patientFirstName={result.patientFirstName}
          sharedAt={result.sharedAt}
        />
      </main>
    );
  }

  const patientFirstName =
    result.patientFirstName && result.patientFirstName.length > 0
      ? result.patientFirstName
      : PRE_AUTH_LANDING_ACTIVE_FALLBACK_NAME_PT_BR;

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <section
        style={{
          maxWidth: 480,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>
          {AUTH_REQUEST_HEADING_PT_BR}
        </h1>
        <p style={{ margin: 0, color: "#555" }}>
          {AUTH_REQUEST_SUBHEADING_FN(patientFirstName)}
        </p>
        <DoctorMagicLinkForm
          shareTokenId={shareTokenId}
          tokenHmac={tokenHmac}
        />
      </section>
    </main>
  );
}
