import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { appRouter, createTRPCContext } from "@healthtracker/api";
import { createSupabaseServerClient } from "@healthtracker/auth/server";

/**
 * Story 6.2 AC3 / T5.3 — doctor magic-link callback.
 *
 * Same pattern as `apps/web/src/app/auth/callback/route.ts` but:
 *   - re-validates the share-token via the pre-auth resolver BEFORE
 *     exchanging the auth code (don't leave a half-signed-in doctor
 *     on a dead-link page);
 *   - on `exchangeCodeForSession` failure, redirects to
 *     `/m/{shareTokenId}.{tokenHmac}` with the `invalid` branch — NOT
 *     to `/auth/error` (that's the patient-side error page; the
 *     doctor never saw it and "error" is the wrong copy);
 *   - does NOT call `account.initializeProfile` (that's the patient
 *     onboarding path; the doctor's `users` row stays minimal until
 *     Story 6.3's `activateProfessionalAccount` flips it).
 *
 * **Open-redirect hardening (AC3.6):** `shareTokenId` is uuid-shaped
 * and `tokenHmac` matches `/^[A-Za-z0-9_-]{1,128}$/`. Reject otherwise
 * and redirect to a sentinel-malformed segment so Story 6.1's
 * malformed-segment branch handles the trace.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_HMAC_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
const SENTINEL_SEGMENT = "00000000-0000-0000-0000-000000000000.invalid";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const shareTokenId = searchParams.get("shareTokenId") ?? "";
  const tokenHmac = searchParams.get("tokenHmac") ?? "";

  // Open-redirect hardening — validate BEFORE composing the
  // destination URL string.
  if (!UUID_REGEX.test(shareTokenId) || !TOKEN_HMAC_REGEX.test(tokenHmac)) {
    return NextResponse.redirect(`${origin}/m/${SENTINEL_SEGMENT}`);
  }

  const segment = `${shareTokenId}.${tokenHmac}`;

  // Re-validate the share-token BEFORE exchanging the code. A token
  // that revoked / expired between the magic-link send and the user's
  // click MUST land on the dead-link page, not on a half-signed-in
  // /view route. The pre-auth resolver discriminates the state.
  const ctx = createTRPCContext({ headers: request.headers, session: null });
  const caller = appRouter.createCaller(ctx);
  let preAuthStatus: "active" | "expired" | "revoked" | "invalid";
  try {
    const result = await caller.sharing.getPreAuthContext({
      shareTokenId,
      tokenHmac,
    });
    preAuthStatus = result.status;
  } catch {
    // Resolver throws are silently treated as invalid — the calling
    // page renders the same `invalid` copy. Narrow swallow here is
    // intentional: any shape (network, Zod, RPC) collapses to the
    // same redirect target (the user-visible Story 6.1 dead-link
    // card). Programmer errors (TypeError / ReferenceError) would
    // surface in the page's RSC anyway.
    preAuthStatus = "invalid";
  }

  if (preAuthStatus !== "active") {
    return NextResponse.redirect(`${origin}/m/${segment}`);
  }

  if (!code) {
    // No code in the callback URL — Supabase magic-link verify
    // failed before redirecting back to us. Treat as invalid.
    return NextResponse.redirect(`${origin}/m/${segment}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(
      "[m/auth/callback] exchangeCodeForSession failed:",
      error.message,
    );
    // Doctor-side dead-link copy lives in Story 6.1's
    // PreAuthLandingCard (`invalid` branch). DO NOT redirect to
    // /auth/error — wrong audience and wrong copy.
    return NextResponse.redirect(`${origin}/m/${segment}`);
  }

  // Story 6.2 AC3.5 — do NOT call `account.initializeProfile`. The
  // doctor's `users` row stays minimal until Story 6.3's
  // `activateProfessionalAccount` flips it.
  return NextResponse.redirect(`${origin}/m/${segment}/view`);
}
