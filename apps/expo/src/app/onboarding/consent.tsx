import { useState } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Text, XStack, YStack } from "tamagui";

import type { ConsentScreenType } from "@healthtracker/validators";
import { Button } from "@healthtracker/ui/button";
import {
  CONSENT_SCREEN_COPY,
  CONSENT_SCREEN_TYPES,
  CONSENT_TEXT_VERSION,
  CONSENT_VERSION_LABEL_PT_BR,
  GENERIC_CONSENT_ERROR_MESSAGE_PT_BR,
  INICIO_ROUTE,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

// SafeAreaView is native and can't read Tamagui tokens.
const BACKGROUND_PRIMARY = "#F9F7F4";

export default function Consent() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation(trpc.consent.grant.mutationOptions());
  const decline = useMutation(trpc.consent.decline.mutationOptions());

  const currentType: ConsentScreenType =
    CONSENT_SCREEN_TYPES[stepIndex] ?? CONSENT_SCREEN_TYPES[0];
  const copy = CONSENT_SCREEN_COPY[currentType];
  const isLast = stepIndex === CONSENT_SCREEN_TYPES.length - 1;
  const pending = grant.isPending || decline.isPending;

  function advance() {
    if (isLast) {
      router.replace({ pathname: INICIO_ROUTE });
      return;
    }
    setStepIndex((i) => i + 1);
  }

  async function handleGrant() {
    setError(null);
    try {
      await grant.mutateAsync({
        consentType: currentType,
        version: CONSENT_TEXT_VERSION,
      });
      advance();
    } catch {
      setError(GENERIC_CONSENT_ERROR_MESSAGE_PT_BR);
    }
  }

  async function handleDecline() {
    setError(null);
    try {
      await decline.mutateAsync({
        consentType: currentType,
        version: CONSENT_TEXT_VERSION,
      });
      advance();
    } catch {
      setError(GENERIC_CONSENT_ERROR_MESSAGE_PT_BR);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Consentimento" }} />
      <YStack flex={1} backgroundColor="$backgroundPrimary">
        {/* ScrollView so long pt-BR copy (the AI narrative body is ~60
            words) never pushes the action row off-screen on small phones. */}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <Text
            fontFamily="$body"
            fontSize="$2"
            color="$textTertiary"
            textTransform="uppercase"
          >
            {stepIndex + 1} / {CONSENT_SCREEN_TYPES.length}
          </Text>
          <Text
            fontFamily="$body"
            fontSize="$7"
            fontWeight="700"
            color="$textPrimary"
          >
            {copy.title}
          </Text>
          <Text fontFamily="$body" fontSize="$4" color="$textPrimary">
            {copy.body}
          </Text>
          <Text fontFamily="$body" fontSize="$2" color="$textTertiary">
            {CONSENT_VERSION_LABEL_PT_BR}: {CONSENT_TEXT_VERSION}
          </Text>
          <Text
            fontFamily="$body"
            fontSize="$3"
            fontStyle="italic"
            color="$textSecondary"
          >
            {copy.declineConsequence}
          </Text>
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
        </ScrollView>
        {/* Footer pinned outside the ScrollView so Concordo / Pular stay
            reachable no matter how long the body grows. */}
        <XStack gap="$2" justifyContent="flex-end" padding="$4">
          <Button variant="ghost" onPress={handleDecline} disabled={pending}>
            {copy.secondaryCta}
          </Button>
          <Button onPress={handleGrant} disabled={pending}>
            {copy.primaryCta}
          </Button>
        </XStack>
      </YStack>
    </SafeAreaView>
  );
}
