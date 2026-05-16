import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";

import { TamaguiProvider } from "@healthtracker/ui";

import { queryClient } from "~/utils/api";

// SafeAreaView/Stack.screenOptions are native APIs that can't use Tamagui tokens.
// These values must match colorTokens.primaryTeal.light and colorTokens.backgroundPrimary.light.
const HEADER_BG = "#0D6E6E";
const CONTENT_BG = "#F9F7F4";

export default function RootLayout() {
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
