import type { Metadata } from "next";
import { headers } from "next/headers";

import {
  appRouter,
  createTRPCContext,
  writePreAuthAudit,
} from "@healthtracker/api";
import { db } from "@healthtracker/db/client";
import { PreAuthLandingCard } from "@healthtracker/ui";
import { SHARE_TOKEN_UNKNOWN_SENTINEL } from "@healthtracker/validators";

/**
 * Story 6.1 — pre-auth doctor landing page (AC1, AC7, AC8, AC9).
 *
 * Server component — no client-side fetch on first paint (NFR-P4
 * sub-1s requirement). The `[token]` segment is the
 * `${shareTokenId}.${tokenHmac}` composite minted by `buildShareUrl`
 * in Story 5.2. We split on the first `.`, validate the prefix is a
 * uuid, and call `sharing.getPreAuthContext` via the RSC-side tRPC
 * caller. The malformed-segment branch renders `invalid` directly
 * (without round-tripping the resolver) and emits its own audit row
 * with the unknown-sentinel actor/resource id so the patient's
 * Access Log still surfaces the probe.
 *
 * `noindex,nofollow` — the URL is a secret; we never want a search
 * engine to index a shared link's landing page.
 */

// AC7 — never serve a stale `expired` state from a caching layer.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Same loose RFC 4122 UUID shape Zod's `z.uuid()` accepts. Reused
// across Story 5.3's `decodeAccessLogCursor` for the same purpose
// (defensive uuid parse without throwing).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function PreAuthLandingPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { token } = await params;
  const reqHeaders = await headers();
  const rawUserAgent = reqHeaders.get("user-agent") ?? "";
  const userAgent =
    rawUserAgent.length > 200 ? rawUserAgent.slice(0, 200) : rawUserAgent;

  // AC9 — parse `[token]` on first `.`. Malformed shapes (no dot,
  // empty HMAC, prefix that's not a uuid) render the same `invalid`
  // UI as a bad-HMAC or unknown-id — no enumeration oracle.
  const dotIdx = token.indexOf(".");
  const shareTokenId = dotIdx > 0 ? token.slice(0, dotIdx) : "";
  const tokenHmac =
    dotIdx > 0 && dotIdx < token.length - 1 ? token.slice(dotIdx + 1) : "";

  const malformed =
    dotIdx <= 0 || tokenHmac.length === 0 || !UUID_REGEX.test(shareTokenId);

  if (malformed) {
    // Emit audit row directly — bypass the resolver because the
    // shareTokenId is not a valid uuid (Zod would reject the input).
    // Use the unknown-sentinel as actor/resource id so future
    // probes show up under a single filterable bucket.
    await writePreAuthAudit(db, {
      shareTokenId: SHARE_TOKEN_UNKNOWN_SENTINEL,
      status: "invalid",
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

  // Well-formed token segment — call the resolver. Service-role
  // connection, no RLS principal (intentional — see resolver
  // docblock for why doctorProcedure would collapse the state
  // discriminator).
  const ctx = createTRPCContext({ headers: reqHeaders, session: null });
  const caller = appRouter.createCaller(ctx);
  const result = await caller.sharing.getPreAuthContext({
    shareTokenId,
    tokenHmac,
    userAgent: userAgent.length > 0 ? userAgent : undefined,
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
        status={result.status}
        patientFirstName={result.patientFirstName}
        sharedAt={result.sharedAt}
        token={token}
      />
    </main>
  );
}
