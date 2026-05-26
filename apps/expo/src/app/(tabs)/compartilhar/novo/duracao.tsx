import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { ScrollView, Text, YStack } from "tamagui";

import type { ShareDuration } from "@healthtracker/validators";
import { DurationOption, NoExpiryConfirmDialog } from "@healthtracker/ui";
import { Button } from "@healthtracker/ui/button";
import { useToastController } from "@healthtracker/ui/toast";
import {
  BIOMARKER_TOGGLE_FAILED_PT_BR,
  COMPARTILHAR_NOVO_DURACAO_TITLE_PT_BR,
  compartilharBiomarcadoresRoute,
  CONTINUE_BUTTON_PT_BR,
  DURATION_OPTIONS,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

/**
 * Story 5.2 T6.3 — duration picker. Local state holds the selected
 * value (default `"7d"` per AC1); the mutation does NOT fire until
 * the patient taps "Continuar". The "Sem prazo" branch opens the
 * extra-confirmation modal before proceeding (AC2).
 */
export default function DuracaoScreen(): React.ReactNode {
  const router = useRouter();
  const toast = useToastController();
  const params = useLocalSearchParams<{ inviteId: string }>();
  const inviteId = String(params.inviteId);
  const [selectedDuration, setSelectedDuration] = useState<ShareDuration>("7d");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mutation = useMutation(
    trpc.sharing.createShareToken.mutationOptions({
      onSuccess: (data) => {
        router.replace(compartilharBiomarcadoresRoute(data.shareTokenId));
      },
      onError: () => {
        toast.show(BIOMARKER_TOGGLE_FAILED_PT_BR);
      },
    }),
  );

  const submit = (duration: ShareDuration): void => {
    if (mutation.isPending) return;
    mutation.mutate({ inviteId, duration });
  };

  const handleContinue = (): void => {
    if (selectedDuration === "no_expiry") {
      setConfirmOpen(true);
      return;
    }
    submit(selectedDuration);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <YStack gap="$3">
        <Text fontSize="$5">{COMPARTILHAR_NOVO_DURACAO_TITLE_PT_BR}</Text>
        {DURATION_OPTIONS.map((opt) => (
          <DurationOption
            key={opt.value}
            value={opt.value}
            label={opt.labelPtBr}
            selected={selectedDuration === opt.value}
            onSelect={() => setSelectedDuration(opt.value)}
          />
        ))}
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onPress={handleContinue}
        >
          {CONTINUE_BUTTON_PT_BR}
        </Button>
      </YStack>
      <NoExpiryConfirmDialog
        open={confirmOpen}
        onConfirm={() => {
          setConfirmOpen(false);
          submit("no_expiry");
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </ScrollView>
  );
}
