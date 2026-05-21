import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  CONFIGURACOES_DISABLED_HINT_PT_BR,
  MEUS_CONSENTIMENTOS_ROUTE,
  MEUS_CONSENTIMENTOS_TITLE_PT_BR,
  PRIVACIDADE_TITLE_PT_BR,
} from "@healthtracker/validators";

const BACKGROUND_PRIMARY = "#F9F7F4";

/**
 * Story 1.4 — Privacidade landing. One functional row today (Meus
 * Consentimentos); "Acesso de médicos" placeholder reserved for Epic 5
 * Story 5.3 (Access Log).
 */
export default function PrivacidadeIndex() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: PRIVACIDADE_TITLE_PT_BR }} />
      <YStack
        flex={1}
        padding="$4"
        gap="$3"
        backgroundColor="$backgroundPrimary"
      >
        <Text
          fontFamily="$body"
          fontSize="$8"
          fontWeight="700"
          color="$textPrimary"
        >
          {PRIVACIDADE_TITLE_PT_BR}
        </Text>

        <Button
          onPress={() => router.push({ pathname: MEUS_CONSENTIMENTOS_ROUTE })}
        >
          {MEUS_CONSENTIMENTOS_TITLE_PT_BR}
        </Button>
        <Button
          disabled
          variant="outline"
          accessibilityHint={CONFIGURACOES_DISABLED_HINT_PT_BR}
        >
          Acesso de médicos
        </Button>
        <Text fontFamily="$body" fontSize="$2" color="$textTertiary">
          {CONFIGURACOES_DISABLED_HINT_PT_BR}
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
