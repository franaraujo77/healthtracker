import { useEffect, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import {
  COMPARTILHAR_NOVO_DURACAO_PROGRESS_PT_BR,
  compartilharBiomarcadoresRoute,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

/**
 * Story 5.1 — placeholder for Story 5.2's duration picker.
 *
 * Auto-submits `createShareToken({inviteId})` on mount with the
 * hard-coded 7-day default, then routes to the per-biomarker screen.
 * Story 5.2 will replace this body with the interactive picker UI.
 */
export default function DuracaoScreen(): React.ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteId: string }>();
  const inviteId = String(params.inviteId);
  const firedRef = useRef(false);

  const mutation = useMutation(
    trpc.sharing.createShareToken.mutationOptions({
      onSuccess: (data) => {
        router.replace(compartilharBiomarcadoresRoute(data.shareTokenId));
      },
    }),
  );

  useEffect(() => {
    if (firedRef.current) return;
    if (!inviteId) return;
    firedRef.current = true;
    mutation.mutate({ inviteId });
  }, [inviteId, mutation]);

  return (
    <YStack padding="$4" gap="$2">
      <Text>{COMPARTILHAR_NOVO_DURACAO_PROGRESS_PT_BR}</Text>
    </YStack>
  );
}
