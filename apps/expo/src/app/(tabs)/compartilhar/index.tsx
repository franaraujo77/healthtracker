import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  COMPARTILHAR_EMPTY_HEADLINE_PT_BR,
  COMPARTILHAR_ERROR_PT_BR,
  COMPARTILHAR_LOADING_PT_BR,
  COMPARTILHAR_NEW_CTA_PT_BR,
  COMPARTILHAR_NOVO_IDENTIFICACAO_ROUTE,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

/**
 * Story 5.1 — Compartilhar tab landing. Lists active shares; offers
 * the "Novo compartilhamento" CTA (Tier 2 / secondary per UX-DR13).
 */
export default function CompartilharIndexScreen(): React.ReactNode {
  const router = useRouter();
  const query = useQuery(trpc.sharing.listShares.queryOptions());

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <YStack gap="$4">
        <Button
          variant="secondary"
          onPress={() => router.push(COMPARTILHAR_NOVO_IDENTIFICACAO_ROUTE)}
        >
          {COMPARTILHAR_NEW_CTA_PT_BR}
        </Button>

        {query.isLoading ? <Text>{COMPARTILHAR_LOADING_PT_BR}</Text> : null}
        {query.isError ? <Text>{COMPARTILHAR_ERROR_PT_BR}</Text> : null}
        {query.data && query.data.shares.length === 0 ? (
          <Text color="$textSecondary">
            {COMPARTILHAR_EMPTY_HEADLINE_PT_BR}
          </Text>
        ) : null}
        {query.data?.shares.map((share) => (
          <YStack
            key={share.id}
            padding="$3"
            borderRadius="$card"
            backgroundColor="$surfaceElevated"
            gap="$1"
          >
            <Text fontSize="$4">{share.displayName}</Text>
            <Text fontSize="$2" color="$textSecondary">
              {share.biomarkerCount} biomarcadores
            </Text>
          </YStack>
        ))}
      </YStack>
    </ScrollView>
  );
}
