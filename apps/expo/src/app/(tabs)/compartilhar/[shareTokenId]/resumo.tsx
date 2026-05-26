import { useState } from "react";
import { Share } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, YStack } from "tamagui";

import type { ShareDuration } from "@healthtracker/validators";
import { Button } from "@healthtracker/ui/button";
import { useToastController } from "@healthtracker/ui/toast";
import {
  COMPARTILHAR_BACK_PT_BR,
  COMPARTILHAR_LOADING_PT_BR,
  COMPARTILHAR_RESUMO_TITLE_PT_BR,
  COMPARTILHAR_ROUTE,
  SHARE_SUBMIT_BUTTON_PT_BR,
  SHARE_SUMMARY_PT_BR_FN,
  SHARE_TOKEN_INVALID_PT_BR,
  SHARE_URL_ERROR_PT_BR,
} from "@healthtracker/validators";

import { trpc, trpcClient } from "~/utils/api";

/**
 * Story 5.2 T6.5 — plain-language summary + Tier-2 "Enviar".
 * Replaces Story 5.1's `concluido.tsx` stub. The share URL is
 * generated server-side via `sharingRouter.getShareUrl` so the HMAC
 * secret never leaves the server.
 */
export default function ResumoScreen(): React.ReactNode {
  const router = useRouter();
  const toast = useToastController();
  const params = useLocalSearchParams<{ shareTokenId: string }>();
  const shareTokenId = String(params.shareTokenId);
  const [submitting, setSubmitting] = useState(false);

  const draft = useQuery(
    trpc.sharing.getDraftConfig.queryOptions({ shareTokenId }),
  );

  if (draft.isError) {
    return (
      <YStack padding="$4" gap="$3">
        <Text>{SHARE_TOKEN_INVALID_PT_BR}</Text>
        <Button
          variant="secondary"
          onPress={() => router.replace(COMPARTILHAR_ROUTE)}
        >
          {COMPARTILHAR_BACK_PT_BR}
        </Button>
      </YStack>
    );
  }
  if (!draft.data) {
    return (
      <YStack padding="$4">
        <Text>{COMPARTILHAR_LOADING_PT_BR}</Text>
      </YStack>
    );
  }

  const duration = deriveDurationFromExpiresAt(draft.data.shareToken.expiresAt);
  const visibleLabels = draft.data.biomarkerScope
    .filter((s) => s.visible)
    .map((s) => s.label);
  const summary = SHARE_SUMMARY_PT_BR_FN(
    draft.data.doctor.displayName,
    visibleLabels,
    duration,
  );

  const handleSend = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { url } = await trpcClient.sharing.getShareUrl.query({
        shareTokenId,
      });
      // React Native's Share API is the native share-sheet trigger
      // (no extra dep). On failure we surface a Toast.
      await Share.share({ url, message: url });
    } catch {
      toast.show(SHARE_URL_ERROR_PT_BR);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <YStack gap="$3">
        <Text fontSize="$6">{COMPARTILHAR_RESUMO_TITLE_PT_BR}</Text>
        <Text fontSize="$4" color="$textPrimary">
          {summary}
        </Text>
        <Button
          variant="secondary"
          disabled={submitting}
          onPress={() => {
            void handleSend();
          }}
        >
          {SHARE_SUBMIT_BUTTON_PT_BR}
        </Button>
      </YStack>
    </ScrollView>
  );
}

/**
 * Story 5.2 — derive the duration enum value from the persisted
 * `expires_at` so the summary screen can render the right label.
 * NULL → `no_expiry`; non-null → pick the closest of 24h/7d/30d by
 * remaining-window approximation (the share token was created
 * recently — getDraftConfig is called moments later in the ceremony,
 * so this approximation is accurate enough to render the label).
 */
function deriveDurationFromExpiresAt(
  expiresAt: Date | null | undefined,
): ShareDuration {
  if (!expiresAt) return "no_expiry";
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  const hours = remainingMs / (60 * 60 * 1000);
  if (hours <= 36) return "24h";
  if (hours <= 14 * 24) return "7d";
  return "30d";
}
