import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { YStack } from "tamagui";

import { EmptyStateRecord } from "@healthtracker/ui";
import {
  IMPORT_ROUTE,
  INICIO_CTA_PT_BR,
  INICIO_HEADLINE_PT_BR,
} from "@healthtracker/validators";

// SafeAreaView is native and can't read Tamagui tokens — mirror
// colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

export default function Inicio() {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Início" }} />
      <YStack flex={1} backgroundColor="$backgroundPrimary">
        <EmptyStateRecord
          headline={INICIO_HEADLINE_PT_BR}
          ctaLabel={INICIO_CTA_PT_BR}
          // Story 1.5 — the empty-state CTA now opens the same import
          // screen the onboarding flow uses (AC3 + AC4 recovery path).
          onCtaPress={() => router.push({ pathname: IMPORT_ROUTE })}
        />
      </YStack>
    </SafeAreaView>
  );
}
