import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { Text, YStack } from "tamagui";

// Placeholder destination for post-registration onboarding (Story 1.1, AC3).
// The full LGPD per-data-type consent UI ships in Story 1.2.

const BACKGROUND_PRIMARY = "#F9F7F4";

export default function ConsentPlaceholder() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Consentimento" }} />
      <YStack
        flex={1}
        padding="$4"
        gap="$3"
        backgroundColor="$backgroundPrimary"
        justifyContent="center"
      >
        <Text
          fontFamily="$body"
          fontSize="$7"
          fontWeight="700"
          color="$textPrimary"
          textAlign="center"
        >
          Consentimento
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$textSecondary"
          textAlign="center"
        >
          Antes de coletarmos qualquer dado de saúde, vamos pedir o seu
          consentimento para cada tipo. Em breve.
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
