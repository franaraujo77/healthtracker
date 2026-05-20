import type { AuthChangeEvent } from "@supabase/supabase-js";
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { router, Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import * as Sentry from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";

import { sentryBeforeSend } from "@healthtracker/config";
import { TamaguiProvider } from "@healthtracker/ui";
import {
  BIOMETRIC_LOCK_ROUTE,
  ONBOARDING_CONSENT_ROUTE,
} from "@healthtracker/validators";

import {
  BIOMETRIC_ENABLED_KEY,
  BIOMETRIC_ENABLED_VALUE,
} from "~/hooks/use-biometric";
import { supabase } from "~/lib/supabase";
import { queryClient, trpcClient } from "~/utils/api";

// Module-scope guard (P6) so HMR / Fast Refresh remounts don't re-fire
// the cold-launch lock redirect mid-session. `useRef` in the component
// resets across remounts; this `let` persists for the lifetime of the
// JS context.
//
// Round-2 P16: the flag is now reset on `SIGNED_OUT` and re-evaluated on
// `SIGNED_IN`, so a sign-out + sign-in cycle within the same JS context
// (different patient on the same device) correctly re-gates the new
// session.
//
// Round-3 P21: the flag is now ONLY set true on a successful evaluation
// — a transient SecureStore / getSession failure no longer permanently
// latches the gate for the rest of the JS context.
let lockEvaluated = false;

/**
 * Returns `true` when the current launch is an `/auth/callback` deep
 * link. The verification flow owns routing in that case, so the
 * biometric gate must not race it (round-1 P3, extended in round-3 P20
 * to also cover the SIGNED_IN listener path which previously bypassed
 * this guard).
 */
async function isAuthCallbackLaunch(): Promise<boolean> {
  try {
    const initialUrl = await Linking.getInitialURL();
    if (!initialUrl) return false;
    return Linking.parse(initialUrl).path === "/auth/callback";
  } catch {
    return false;
  }
}

/**
 * Cold-launch / post-sign-in biometric gate. Reads the persisted
 * Supabase session and the SecureStore preference; if both present,
 * redirects to the lock screen. Idempotent — `lockEvaluated` guards
 * against re-fire during the same gated session.
 *
 * Returns silently on any failure: the lock is a convenience gate,
 * not the primary credential, and Supabase still enforces the session
 * on every tRPC call.
 */
async function evaluateBiometricGate(): Promise<void> {
  if (lockEvaluated) return;

  try {
    // P20 — skip the gate when launching via `/auth/callback`. Both
    // the cold-launch effect and the SIGNED_IN listener funnel through
    // this function, so the check lives here (not at the call sites)
    // and is uniformly applied.
    if (await isAuthCallbackLaunch()) return;

    const [{ data }, stored] = await Promise.all([
      supabase.auth.getSession(),
      SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY),
    ]);
    // P21 — only latch the flag once we've reached a deterministic
    // outcome (either a redirect or a confirmed "no lock needed").
    // If an earlier await throws, we fall to the catch and the flag
    // stays false so the next SIGNED_IN / retry can try again.
    lockEvaluated = true;
    if (data.session && stored === BIOMETRIC_ENABLED_VALUE) {
      router.replace({ pathname: BIOMETRIC_LOCK_ROUTE });
    }
  } catch (err) {
    console.error(
      "[biometric] gate evaluation failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enableNativeCrashHandling: true,
  debug: __DEV__,
  // Cast required: sentryBeforeSend uses duck-typed interfaces to avoid SDK version coupling
  beforeSend: sentryBeforeSend as Parameters<
    typeof Sentry.init
  >[0]["beforeSend"],
  // Session replay omitted — health data on screen risk (NFR-S5)
});

// SafeAreaView/Stack.screenOptions are native APIs that can't use Tamagui tokens.
// These values must match colorTokens.primaryTeal.light and colorTokens.backgroundPrimary.light.
const HEADER_BG = "#0D6E6E";
const CONTENT_BG = "#F9F7F4";

const AUTH_INVALIDATING_EVENTS: AuthChangeEvent[] = [
  "SIGNED_IN",
  "SIGNED_OUT",
  "USER_UPDATED",
];

function RootLayout() {
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (AUTH_INVALIDATING_EVENTS.includes(event)) {
        void queryClient.invalidateQueries();
      }
      // P10 — Account switching: clear the previous patient's biometric
      // preference on sign-out so the cold-launch gate doesn't ask a
      // newly-registered patient on the same device for the prior
      // patient's biometric. P16: also reset the in-process gate flag
      // so a subsequent sign-in (different patient) re-evaluates the
      // lock instead of silently skipping.
      if (event === "SIGNED_OUT") {
        lockEvaluated = false;
        void SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY).catch(
          (err: unknown) => {
            console.error(
              "[biometric] SIGNED_OUT preference cleanup failed:",
              err instanceof Error ? err.message : err,
            );
          },
        );
      }
      // P16 — Re-evaluate on SIGNED_IN: a patient who signs in after a
      // prior sign-out within the same JS context needs the gate to fire
      // for them. `evaluateBiometricGate` is internally idempotent via
      // `lockEvaluated`; the SIGNED_OUT branch above arms it.
      if (event === "SIGNED_IN") {
        void evaluateBiometricGate();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Cold-launch biometric gate (Story 1.3 AC2). One-shot per JS context:
  // if the app boots with a valid session AND the SecureStore preference
  // is set, redirect to the lock screen before the tabs become visible.
  // The `/auth/callback` deep-link skip lives inside `evaluateBiometricGate`
  // so it covers both this cold-launch caller and the SIGNED_IN listener
  // above (round-3 P20).
  useEffect(() => {
    void evaluateBiometricGate();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const handleUrl = async ({ url }: { url: string }) => {
      const parsed = Linking.parse(url);
      if (parsed.path !== "/auth/callback") return;

      // queryParams.code can be string[] for repeated params — take first element
      const raw = parsed.queryParams?.code;
      const code = Array.isArray(raw) ? raw[0] : raw;

      if (code) {
        // Requires PKCE flow enabled in Supabase Dashboard (Authentication → Settings → Auth Flow)
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("[auth] exchangeCodeForSession failed:", error.message);
          return;
        }
        // The patient has just verified their email — create the `users` row
        // and write the `patient.created` audit event (Story 1.1 AC1 / AC4).
        // initializeProfile is idempotent so a re-fired deep link is safe.
        try {
          await trpcClient.account.initializeProfile.mutate();
          // initializeProfile succeeded → profile exists. A failing
          // consent.list now is treated as "assume completed" so a
          // transient blip doesn't bounce returning users back through
          // onboarding.
          try {
            const grants = await trpcClient.consent.list.query();
            if (grants.length === 0) {
              router.replace({ pathname: ONBOARDING_CONSENT_ROUTE });
            }
          } catch (listError) {
            console.error(
              "[auth] consent.list failed (assuming completed):",
              listError instanceof Error ? listError.message : listError,
            );
          }
        } catch (initError) {
          // Safe fallback: if we can't tell whether the patient has been
          // initialized, send them through consent rather than land them
          // on a health-data screen.
          console.error(
            "[auth] initializeProfile failed:",
            initError instanceof Error ? initError.message : initError,
          );
          router.replace({ pathname: ONBOARDING_CONSENT_ROUTE });
        }
      }
    };

    const sub = Linking.addEventListener("url", ({ url }) => {
      void handleUrl({ url });
    });

    void Linking.getInitialURL()
      .then((url) => {
        if (!cancelled && url) void handleUrl({ url });
      })
      .catch((err: unknown) => {
        console.error("[auth] getInitialURL failed:", err);
      });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return (
    <TamaguiProvider>
      <QueryClientProvider client={queryClient}>
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: HEADER_BG,
            },
            contentStyle: {
              backgroundColor: CONTENT_BG,
            },
          }}
        />
        <StatusBar />
      </QueryClientProvider>
    </TamaguiProvider>
  );
}

export default Sentry.wrap(RootLayout);
