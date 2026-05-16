import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";

import { TamaguiProvider } from "@healthtracker/ui";

import { queryClient } from "~/utils/api";

export default function RootLayout() {
  return (
    <TamaguiProvider>
      <QueryClientProvider client={queryClient}>
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: "#0D6E6E",
            },
            contentStyle: {
              backgroundColor: "#F9F7F4",
            },
          }}
        />
        <StatusBar />
      </QueryClientProvider>
    </TamaguiProvider>
  );
}
