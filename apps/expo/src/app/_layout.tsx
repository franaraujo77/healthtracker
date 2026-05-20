import type { AuthChangeEvent } from "@supabase/supabase-js";
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Sentry from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";

import { sentryBeforeSend } from "@healthtracker/config";
import { TamaguiProvider } from "@healthtracker/ui";
import { ONBOARDING_CONSENT_ROUTE } from "@healthtracker/validators";

import { supabase } from "~/lib/supabase";
import { queryClient, trpcClient } from "~/utils/api";

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
    });
    return () => subscription.unsubscribe();
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
