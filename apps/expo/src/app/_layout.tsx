import type { AuthChangeEvent } from "@supabase/supabase-js";
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";

import { TamaguiProvider } from "@healthtracker/ui";

import { supabase } from "~/lib/supabase";
import { queryClient } from "~/utils/api";

// SafeAreaView/Stack.screenOptions are native APIs that can't use Tamagui tokens.
// These values must match colorTokens.primaryTeal.light and colorTokens.backgroundPrimary.light.
const HEADER_BG = "#0D6E6E";
const CONTENT_BG = "#F9F7F4";

const AUTH_INVALIDATING_EVENTS: AuthChangeEvent[] = [
  "SIGNED_IN",
  "SIGNED_OUT",
  "USER_UPDATED",
];

export default function RootLayout() {
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
      if (!url.includes("auth/callback")) return;

      const parsed = Linking.parse(url);
      // queryParams.code can be string[] for repeated params — take first element
      const raw = parsed.queryParams?.code;
      const code = Array.isArray(raw) ? raw[0] : raw;

      if (code) {
        // Requires PKCE flow enabled in Supabase Dashboard (Authentication → Settings → Auth Flow)
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("[auth] exchangeCodeForSession failed:", error.message);
        }
      }
    };

    const sub = Linking.addEventListener("url", ({ url }) => {
      void handleUrl({ url });
    });

    void Linking.getInitialURL().then((url) => {
      if (!cancelled && url) void handleUrl({ url });
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
