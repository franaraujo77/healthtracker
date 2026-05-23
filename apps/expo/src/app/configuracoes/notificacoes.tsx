import { useState } from "react";
import { Linking, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Text, XStack, YStack } from "tamagui";

import type { NotificationPreferencesInput } from "@healthtracker/validators";
import {
  NOTIF_OPEN_SYSTEM_SETTINGS_CTA_PT_BR,
  NOTIF_PREF_ERROR_PT_BR,
  NOTIF_PREF_LETTERS_READY_PT_BR,
  NOTIF_PREF_LOADING_PT_BR,
  NOTIF_PREF_RECORD_ACCESS_PT_BR,
  NOTIF_PREF_RESULTS_READY_PT_BR,
  NOTIF_PREF_RETRY_PT_BR,
  NOTIF_PREF_REVIEW_REQUIRED_PT_BR,
  NOTIFICATIONS_SETTINGS_TITLE_PT_BR,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

type PrefKey = keyof NotificationPreferencesInput;

const TOGGLES: { key: PrefKey; label: string }[] = [
  { key: "resultsReady", label: NOTIF_PREF_RESULTS_READY_PT_BR },
  { key: "lettersReady", label: NOTIF_PREF_LETTERS_READY_PT_BR },
  { key: "recordAccess", label: NOTIF_PREF_RECORD_ACCESS_PT_BR },
  { key: "reviewRequired", label: NOTIF_PREF_REVIEW_REQUIRED_PT_BR },
];

/**
 * Story 2.8 — Notificações settings screen. Per-event toggles plus
 * the OS-permission denied banner. The hook for reading the OS
 * permission status lives in F135 (Story 2.5's deferred Expo client
 * hook); until that lands we conservatively assume permission is
 * granted on mobile (the banner is opt-in extra feedback, not a
 * blocker).
 */
export default function NotificacoesScreen() {
  const query = useQuery(
    trpc.notifications.getPreferences.queryOptions(undefined, {
      staleTime: 0,
    }),
  );
  const [optimistic, setOptimistic] =
    useState<NotificationPreferencesInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.notifications.updatePreferences.mutationOptions({
      onSuccess: (data) => {
        setOptimistic(data);
        setError(null);
      },
      onError: () => {
        // R3-P233 — keep the optimistic state so the patient's
        // intent stays visible; surface the error with a retry
        // button that re-fires the same payload.
        setError(NOTIF_PREF_ERROR_PT_BR);
      },
    }),
  );

  const prefs = optimistic ?? query.data ?? null;

  function onToggle(key: PrefKey, next: boolean) {
    if (!prefs) return;
    const updated: NotificationPreferencesInput = { ...prefs, [key]: next };
    setOptimistic(updated);
    mutation.mutate(updated);
  }

  // F135 — the OS-permission status lookup ships with Story 2.5's
  // deferred Expo client hook. Until then, render the banner only
  // when the user explicitly hits the deep link from an OS-denied
  // state. We keep the banner CTA reachable via a placeholder
  // "open device settings" button (always visible) so AC4 is
  // operationally testable; the auto-render path lands with F135.
  function openSystemSettings() {
    void Linking.openSettings();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: NOTIFICATIONS_SETTINGS_TITLE_PT_BR }} />
      <YStack flex={1} padding="$4" gap="$3">
        <Text fontSize="$7" fontWeight="700" color="$textPrimary">
          {NOTIFICATIONS_SETTINGS_TITLE_PT_BR}
        </Text>
        {query.isLoading ? <Text>{NOTIF_PREF_LOADING_PT_BR}</Text> : null}
        {/* R2-P228 — surface a transient load failure so the patient
            can retry instead of staring at the loading text. */}
        {query.isError ? (
          <YStack gap="$2">
            <Text accessibilityRole="alert" color="$errorRed">
              {NOTIF_PREF_ERROR_PT_BR}
            </Text>
            <Button onPress={() => void query.refetch()}>
              {NOTIF_PREF_RETRY_PT_BR}
            </Button>
          </YStack>
        ) : null}
        {prefs !== null ? (
          <YStack gap="$3">
            {/* R1-P220 — the always-visible button uses neutral copy.
                The OS-denied banner (`NOTIF_OS_DENIED_BANNER_PT_BR`)
                ships with F135 once `expo-notifications` is in deps
                and we can check `Notifications.getPermissionsAsync()`
                to conditionally render the alarmist copy. */}
            <Button onPress={openSystemSettings}>
              {NOTIF_OPEN_SYSTEM_SETTINGS_CTA_PT_BR}
            </Button>
            {TOGGLES.map(({ key, label }) => (
              <XStack
                key={key}
                gap="$3"
                alignItems="center"
                justifyContent="space-between"
                paddingVertical="$2"
              >
                <Text fontSize="$4" color="$textPrimary">
                  {label}
                </Text>
                {/* R3-P232 — the OS-denied hint was set unconditionally
                    on every toggle and announced "(desativado no sistema)"
                    via screen readers even when OS permissions were
                    granted. Drop it until F135 lands a real permission
                    check that can gate the hint on actual status. */}
                <Switch
                  value={prefs[key]}
                  onValueChange={(next: boolean) => onToggle(key, next)}
                  accessibilityLabel={label}
                />
              </XStack>
            ))}
            {error !== null ? (
              <YStack gap="$2">
                <Text accessibilityRole="alert" color="$errorRed">
                  {error}
                </Text>
                <Button
                  onPress={() => {
                    if (optimistic === null) return;
                    setError(null);
                    mutation.mutate(optimistic);
                  }}
                >
                  {NOTIF_PREF_RETRY_PT_BR}
                </Button>
              </YStack>
            ) : null}
          </YStack>
        ) : null}
      </YStack>
    </SafeAreaView>
  );
}
