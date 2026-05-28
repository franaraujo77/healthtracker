import { useCallback, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { DeleteAccountConfirmationCard } from "@healthtracker/ui";
import {
  DELETE_ACCOUNT_CANCELLED_TOAST_PT_BR,
  DELETE_ACCOUNT_FAILED_PT_BR,
  DELETE_ACCOUNT_HEADER_PT_BR,
} from "@healthtracker/validators";

import { supabase } from "~/lib/supabase";
import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

/**
 * Story 5.6 T6.2 — Configurações > Conta > Excluir conta. Wires the
 * `DeleteAccountConfirmationCard` (which owns the input → 30s
 * cooldown state machine) to `accountRouter.requestDeletion`.
 *
 * On 30s timer expiry:
 *   - mutation fires;
 *   - onSuccess → `supabase.auth.signOut()` immediately + `router.replace`
 *     to the auth root. The worker continues out-of-band (pg-boss);
 *     the patient never sees the deletion-complete state.
 *   - onError → cancellation toast + reset (via `key` remount).
 *
 * Single-use per ceremony — no AsyncStorage persistence (deliberate;
 * the screen is throwaway on success, the row is enqueued server-side
 * and re-tap is idempotent).
 */
export default function ExcluirContaScreen(): React.ReactElement {
  const router = useRouter();
  const [resetKey, setResetKey] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const requestMutation = useMutation(
    trpc.account.requestDeletion.mutationOptions({
      onSuccess: async () => {
        // Sign out immediately (client-side). The worker handles the
        // server-side cascade out-of-band.
        try {
          await supabase.auth.signOut();
        } catch (err) {
          // Narrow-catch — signOut can fail if there's no network; the
          // worker still runs server-side. Programmer errors rethrow.
          if (err instanceof TypeError) throw err;
          console.warn("[excluir-conta] signOut threw", err);
        }
        router.replace("/auth/login");
      },
      onError: () => {
        setStatusMessage(DELETE_ACCOUNT_FAILED_PT_BR);
        setResetKey((k) => k + 1);
      },
    }),
  );

  const onTimeout = useCallback(() => {
    setStatusMessage(null);
    requestMutation.mutate({});
  }, [requestMutation]);

  const onCancel = useCallback(() => {
    setStatusMessage(DELETE_ACCOUNT_CANCELLED_TOAST_PT_BR);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: DELETE_ACCOUNT_HEADER_PT_BR }} />
      <YStack padding="$4" gap="$3">
        <DeleteAccountConfirmationCard
          key={resetKey}
          onTimeout={onTimeout}
          onCancel={onCancel}
        />
        {statusMessage !== null ? (
          <Text
            testID="delete-account-status"
            fontSize="$3"
            color="$textSecondary"
            accessibilityLiveRegion="polite"
          >
            {statusMessage}
          </Text>
        ) : null}
      </YStack>
    </SafeAreaView>
  );
}
