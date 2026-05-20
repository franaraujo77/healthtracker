import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { YStack } from "tamagui";

import { EmptyStateRecord } from "@healthtracker/ui";
import {
  INICIO_CTA_PT_BR,
  INICIO_HEADLINE_PT_BR,
} from "@healthtracker/validators";

// SafeAreaView is native and can't read Tamagui tokens — mirror
// colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

export default function Inicio() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Início" }} />
      <YStack flex={1} backgroundColor="$backgroundPrimary">
        <EmptyStateRecord
          headline={INICIO_HEADLINE_PT_BR}
          ctaLabel={INICIO_CTA_PT_BR}
          // Upload entry point ships in Epic 2 — this CTA is a placeholder
          // seam so the route is reachable today.
          onCtaPress={() => {
            /* no-op until Epic 2 wires uploads */
          }}
        />
      </YStack>
    </SafeAreaView>
  );
}
