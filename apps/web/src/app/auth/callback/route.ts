import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { appRouter, createTRPCContext } from "@healthtracker/api";
import { createSupabaseServerClient } from "@healthtracker/auth/server";
import { ONBOARDING_CONSENT_ROUTE } from "@healthtracker/validators";

// Validates `next` is a safe relative path to prevent open-redirect attacks.
// Rejects protocol-relative URLs (//evil.com) and absolute URLs.
function safeRedirectPath(next: string): string {
  if (next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next") ?? "/");

  if (code) {
    const supabase = await createSupabaseServerClient();
    // Use the session returned by the exchange directly — re-fetching via
    // `getSession()` would mean a round-trip with no benefit, and risks
    // reading a stale-cookie session if the cookies haven't propagated.
    const { data: exchangeData, error } =
      await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // The patient has just verified their email — call initializeProfile
      // so the `users` row and `patient.created` audit event are created
      // (Story 1.1 AC1 / AC4). Idempotent, so safe on every callback hit.
      // Supabase's TS narrowing guarantees a session when `error` is null.
      const ctx = createTRPCContext({
        headers: request.headers,
        session: exchangeData.session,
      });
      const caller = appRouter.createCaller(ctx);

      // Default to consent: if `initializeProfile` throws we can't tell
      // whether the patient is consent-complete, and landing a brand-new
      // patient on a health-data screen would violate Story 1.2 AC3.
      let destination: string = ONBOARDING_CONSENT_ROUTE;
      try {
        await caller.account.initializeProfile();
        // initializeProfile succeeded → profile exists. From here we
        // trust `next` as the safe default: a transient `consent.list`
        // failure would otherwise bounce consent-complete returning
        // users back through onboarding.
        try {
          const grants = await caller.consent.list();
          destination = grants.length === 0 ? ONBOARDING_CONSENT_ROUTE : next;
        } catch (listError) {
          console.error(
            "[auth/callback] consent.list failed (assuming completed):",
            listError instanceof Error ? listError.message : listError,
          );
          destination = next;
        }
      } catch (initError) {
        console.error(
          "[auth/callback] initializeProfile failed:",
          initError instanceof Error ? initError.message : initError,
        );
      }
      return NextResponse.redirect(`${origin}${destination}`);
    }
    console.error("[auth] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
