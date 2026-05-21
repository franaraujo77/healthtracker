import { useState } from "react";
import { ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  BIOMETRIC_BODY_PT_BR,
  BIOMETRIC_ENABLE_CTA_PT_BR,
  BIOMETRIC_SKIP_CTA_PT_BR,
  BIOMETRIC_TITLE_PT_BR,
  BIOMETRIC_UNAVAILABLE_MESSAGE_PT_BR,
  GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR,
  IMPORT_ROUTE,
} from "@healthtracker/validators";

import { useBiometric } from "~/hooks/use-biometric";

// SafeAreaView is native and can't read Tamagui tokens — mirror
// colorTokens.backgroundPrimary.light (Story 1.1 idiom, F17/F24 deferred).
const BACKGROUND_PRIMARY = "#F9F7F4";

export default function BiometricOffer() {
  const router = useRouter();
  const { capability, enable } = useBiometric();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Story 1.5 — onboarding now ends at the import screen (biometric →
  // import → Início). Both the enable-success and skip paths route to
  // the same next step.
  function goToImport() {
    router.replace({ pathname: IMPORT_ROUTE });
  }

  async function handleEnable() {
    setError(null);
    setPending(true);
    try {
      const result = await enable();
      if (result.ok) {
        goToImport();
        return;
      }
      if (result.reason === "cancelled") {
        // Patient may try again — leave them on the offer screen.
        return;
      }
      setError(GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR);
    } finally {
      setPending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: BIOMETRIC_TITLE_PT_BR }} />
      <YStack
        flex={1}
        padding="$4"
        gap="$4"
        backgroundColor="$backgroundPrimary"
      >
        <Text
          fontFamily="$body"
          fontSize="$8"
          fontWeight="700"
          color="$textPrimary"
        >
          {BIOMETRIC_TITLE_PT_BR}
        </Text>
        <Text fontFamily="$body" fontSize="$4" color="$textSecondary">
          {BIOMETRIC_BODY_PT_BR}
        </Text>

        {capability === "idle" && (
          <YStack flex={1} alignItems="center" justifyContent="center">
            <ActivityIndicator />
          </YStack>
        )}

        {capability === "unavailable" && (
          <Text fontFamily="$body" fontSize="$3" color="$textSecondary">
            {BIOMETRIC_UNAVAILABLE_MESSAGE_PT_BR}
          </Text>
        )}

        {error && (
          <Text
            fontFamily="$body"
            fontSize="$3"
            color="$biomarkerDeviation"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        )}

        <YStack gap="$2" marginTop="auto">
          {capability === "available" && (
            <Button onPress={handleEnable} disabled={pending}>
              {BIOMETRIC_ENABLE_CTA_PT_BR}
            </Button>
          )}
          <Button onPress={goToImport} disabled={pending} variant="outline">
            {BIOMETRIC_SKIP_CTA_PT_BR}
          </Button>
        </YStack>
      </YStack>
    </SafeAreaView>
  );
}
