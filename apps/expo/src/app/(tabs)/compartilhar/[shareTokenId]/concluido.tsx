import { useRouter } from "expo-router";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  COMPARTILHAR_CONCLUIDO_PT_BR,
  COMPARTILHAR_ROUTE,
} from "@healthtracker/validators";

/**
 * Story 5.1 — minimal completion stub. Story 5.2 will replace with
 * the plain-language summary screen.
 */
export default function ConcluidoScreen(): React.ReactNode {
  const router = useRouter();
  return (
    <YStack padding="$4" gap="$3">
      <Text fontSize="$6">{COMPARTILHAR_CONCLUIDO_PT_BR}</Text>
      <Button
        variant="secondary"
        onPress={() => router.replace(COMPARTILHAR_ROUTE)}
      >
        ← Voltar
      </Button>
    </YStack>
  );
}
