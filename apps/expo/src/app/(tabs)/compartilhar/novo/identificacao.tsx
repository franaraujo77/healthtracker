import { useState } from "react";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";
import { Label } from "@healthtracker/ui/label";
import {
  COMPARTILHAR_NOVO_CONTINUE_CTA_PT_BR,
  COMPARTILHAR_NOVO_DURACAO_ROUTE,
  COMPARTILHAR_NOVO_IDENTIFICACAO_TITLE_PT_BR,
  DOCTOR_DISPLAY_NAME_LABEL_PT_BR,
  DOCTOR_IDENTIFIER_LABEL_PT_BR,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

/**
 * Story 5.1 — sharing ceremony step 1: doctor identifier capture.
 * On submit creates a `pending_invites` row (idempotent on
 * `(patient_id, identifier_hash)`) and forwards to the duration
 * picker placeholder (Story 5.2 fills the picker UI).
 */
export default function IdentificacaoScreen(): React.ReactNode {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [identifier, setIdentifier] = useState("");

  const mutation = useMutation(
    trpc.sharing.createPendingInvite.mutationOptions({
      onSuccess: (data) => {
        router.push(
          `${COMPARTILHAR_NOVO_DURACAO_ROUTE}?inviteId=${data.inviteId}`,
        );
      },
    }),
  );

  const canSubmit =
    displayName.trim().length > 0 && identifier.trim().length >= 3;

  return (
    <YStack padding="$4" gap="$4">
      <Text fontSize="$5">{COMPARTILHAR_NOVO_IDENTIFICACAO_TITLE_PT_BR}</Text>

      <YStack gap="$2">
        <Label>{DOCTOR_DISPLAY_NAME_LABEL_PT_BR}</Label>
        <Input value={displayName} onChangeText={setDisplayName} />
      </YStack>

      <YStack gap="$2">
        <Label>{DOCTOR_IDENTIFIER_LABEL_PT_BR}</Label>
        <Input
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
        />
      </YStack>

      <Button
        variant="secondary"
        disabled={!canSubmit || mutation.isPending}
        onPress={() =>
          mutation.mutate({
            displayName: displayName.trim(),
            identifier: identifier.trim(),
          })
        }
      >
        {COMPARTILHAR_NOVO_CONTINUE_CTA_PT_BR}
      </Button>
    </YStack>
  );
}
