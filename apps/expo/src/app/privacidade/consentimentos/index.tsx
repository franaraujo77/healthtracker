import { useCallback } from "react";
import { ActivityIndicator, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Separator, Text, YStack } from "tamagui";

import { EmptyStateRecord } from "@healthtracker/ui";
import { Button } from "@healthtracker/ui/button";
import {
  CONSENT_GRANTED_ON_LABEL_PT_BR,
  CONSENT_SCREEN_COPY,
  CONSENT_VERSION_LABEL_PT_BR,
  formatConsentGrantedDate,
  isConsentScreenType,
  MEUS_CONSENTIMENTOS_EMPTY_CTA_PT_BR,
  MEUS_CONSENTIMENTOS_EMPTY_HEADLINE_PT_BR,
  MEUS_CONSENTIMENTOS_ERROR_PT_BR,
  MEUS_CONSENTIMENTOS_RETRY_PT_BR,
  MEUS_CONSENTIMENTOS_TITLE_PT_BR,
  ONBOARDING_CONSENT_ROUTE,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

/**
 * Story 1.4 — Meus Consentimentos list. Fetches the patient's active
 * grants with `surface: 'settings'` so the resolver writes a single
 * `consent.read` audit event per visit (AC4). `staleTime: Infinity`
 * keeps that single emission honest — a focus / re-mount won't
 * re-fetch and re-audit.
 */
export default function MeusConsentimentos() {
  const router = useRouter();

  const consentListQuery = useQuery(
    trpc.consent.list.queryOptions(
      { surface: "settings" },
      { staleTime: Infinity },
    ),
  );

  const refresh = useCallback(() => {
    void consentListQuery.refetch();
  }, [consentListQuery]);

  if (consentListQuery.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
        <Stack.Screen options={{ title: MEUS_CONSENTIMENTOS_TITLE_PT_BR }} />
        <YStack
          flex={1}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$backgroundPrimary"
        >
          <ActivityIndicator />
        </YStack>
      </SafeAreaView>
    );
  }

  if (consentListQuery.isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
        <Stack.Screen options={{ title: MEUS_CONSENTIMENTOS_TITLE_PT_BR }} />
        <YStack
          flex={1}
          padding="$4"
          gap="$3"
          backgroundColor="$backgroundPrimary"
          alignItems="center"
          justifyContent="center"
        >
          <Text
            fontFamily="$body"
            fontSize="$4"
            color="$textPrimary"
            textAlign="center"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {MEUS_CONSENTIMENTOS_ERROR_PT_BR}
          </Text>
          <Button onPress={refresh}>{MEUS_CONSENTIMENTOS_RETRY_PT_BR}</Button>
        </YStack>
      </SafeAreaView>
    );
  }

  const rows = consentListQuery.data ?? [];

  if (rows.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
        <Stack.Screen options={{ title: MEUS_CONSENTIMENTOS_TITLE_PT_BR }} />
        <YStack flex={1} backgroundColor="$backgroundPrimary">
          <EmptyStateRecord
            headline={MEUS_CONSENTIMENTOS_EMPTY_HEADLINE_PT_BR}
            ctaLabel={MEUS_CONSENTIMENTOS_EMPTY_CTA_PT_BR}
            onCtaPress={() =>
              router.push({ pathname: ONBOARDING_CONSENT_ROUTE })
            }
          />
        </YStack>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: MEUS_CONSENTIMENTOS_TITLE_PT_BR }} />
      <ScrollView
        backgroundColor="$backgroundPrimary"
        refreshControl={
          <RefreshControl
            refreshing={consentListQuery.isFetching}
            onRefresh={refresh}
          />
        }
      >
        <YStack padding="$4" gap="$3">
          {rows.map((row, index) => {
            if (!isConsentScreenType(row.consentType)) {
              // Defensive: a future enum widening (Epic 4 / 5) could
              // surface unknown types in this list. Skip silently —
              // the detail screen would 404 on copy lookup anyway.
              return null;
            }
            const copy = CONSENT_SCREEN_COPY[row.consentType];
            // Review P24 — thread `version` + `grantedAt` to the detail
            // screen so it can render the row's actual agreed-to values
            // (Expo Router URL-encodes params and only accepts strings).
            const grantedAtIso =
              row.grantedAt instanceof Date
                ? row.grantedAt.toISOString()
                : String(row.grantedAt);
            return (
              <YStack key={row.id} gap="$2">
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/privacidade/consentimentos/[consentType]",
                      params: {
                        consentType: row.consentType,
                        version: row.version,
                        grantedAt: grantedAtIso,
                      },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${copy.title}, ${CONSENT_GRANTED_ON_LABEL_PT_BR} ${formatConsentGrantedDate(row.grantedAt)}`}
                >
                  <YStack gap="$1" paddingVertical="$2">
                    <Text
                      fontFamily="$body"
                      fontSize="$5"
                      fontWeight="600"
                      color="$textPrimary"
                    >
                      {copy.title}
                    </Text>
                    <Text
                      fontFamily="$body"
                      fontSize="$3"
                      color="$textSecondary"
                    >
                      {CONSENT_GRANTED_ON_LABEL_PT_BR}{" "}
                      {formatConsentGrantedDate(row.grantedAt)}
                    </Text>
                    <Text
                      fontFamily="$body"
                      fontSize="$2"
                      color="$textTertiary"
                    >
                      {CONSENT_VERSION_LABEL_PT_BR}: {row.version}
                    </Text>
                  </YStack>
                </Pressable>
                {index < rows.length - 1 && <Separator />}
              </YStack>
            );
          })}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
