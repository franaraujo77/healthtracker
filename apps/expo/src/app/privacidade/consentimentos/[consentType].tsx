import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, ScrollView, Text, XStack, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  CONSENT_GRANTED_ON_LABEL_PT_BR,
  CONSENT_REVOKE_CONFIRM_PRIMARY_PT_BR,
  CONSENT_REVOKE_CONFIRM_SECONDARY_PT_BR,
  CONSENT_REVOKE_CONFIRM_TITLE_PT_BR,
  CONSENT_REVOKE_CTA_PT_BR,
  CONSENT_REVOKE_DATA_RETENTION_PT_BR,
  CONSENT_SCREEN_COPY,
  CONSENT_VERSION_LABEL_PT_BR,
  formatConsentGrantedDate,
  GENERIC_CONSENT_ERROR_MESSAGE_PT_BR,
  isConsentScreenType,
  MEUS_CONSENTIMENTOS_ROUTE,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

/**
 * Story 1.4 — detail view + revoke flow. Reads the full consent text
 * from the shared `CONSENT_SCREEN_COPY` (single source of truth with
 * the onboarding flow — never duplicate the body string here) and
 * exposes the "Retirar consentimento" CTA gated by a confirmation
 * dialog (UX consequence-language pattern).
 */
export default function ConsentimentoDetalhe() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Review P24 — `version` and `grantedAt` are threaded from the list
  // screen so the detail screen renders the patient's actual agreed-to
  // values rather than today's date and a hardcoded version literal.
  // Both are URL-safe strings (ISO timestamp + plain version label).
  const params = useLocalSearchParams<{
    consentType?: string;
    version?: string;
    grantedAt?: string;
  }>();
  const rawConsentType = params.consentType;
  const rowVersion = params.version;
  const rowGrantedAt = params.grantedAt;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Narrow once. `consentType` below is a `ConsentScreenType` when
  // non-null and `null` when the route param is missing / unknown.
  const consentType =
    typeof rawConsentType === "string" && isConsentScreenType(rawConsentType)
      ? rawConsentType
      : null;

  // Review P26 — defensive redirect for an unknown / missing route
  // param. Moved out of the render body into an effect so React 19
  // strict-mode doesn't warn and to prevent a render-time side-effect
  // loop. The render returns `null` while the effect schedules the
  // navigation.
  useEffect(() => {
    if (consentType === null) {
      router.replace({ pathname: MEUS_CONSENTIMENTOS_ROUTE });
    }
  }, [consentType, router]);

  const revokeMutation = useMutation(
    trpc.consent.revoke.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.consent.list.queryKey(),
        });
        setConfirmOpen(false);
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace({ pathname: MEUS_CONSENTIMENTOS_ROUTE });
        }
      },
      onError: () => {
        setError(GENERIC_CONSENT_ERROR_MESSAGE_PT_BR);
      },
    }),
  );

  if (consentType === null) {
    return null;
  }

  const copy = CONSENT_SCREEN_COPY[consentType];

  function handleConfirmRevoke() {
    if (consentType === null) return;
    setError(null);
    revokeMutation.mutate({ consentType });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: copy.title }} />
      <ScrollView backgroundColor="$backgroundPrimary">
        <YStack padding="$4" gap="$3">
          <Text
            fontFamily="$body"
            fontSize="$7"
            fontWeight="700"
            color="$textPrimary"
          >
            {copy.title}
          </Text>
          <Text fontFamily="$body" fontSize="$4" color="$textSecondary">
            {copy.body}
          </Text>
          {rowVersion && (
            <Text fontFamily="$body" fontSize="$3" color="$textTertiary">
              {CONSENT_VERSION_LABEL_PT_BR}: {rowVersion}
            </Text>
          )}
          {rowGrantedAt && (
            <Text fontFamily="$body" fontSize="$3" color="$textTertiary">
              {CONSENT_GRANTED_ON_LABEL_PT_BR}{" "}
              {formatConsentGrantedDate(rowGrantedAt)}
            </Text>
          )}

          <YStack gap="$2" marginTop="$4">
            <Text fontFamily="$body" fontSize="$3" color="$textSecondary">
              {copy.declineConsequence}
            </Text>
            <Text fontFamily="$body" fontSize="$3" color="$textSecondary">
              {CONSENT_REVOKE_DATA_RETENTION_PT_BR}
            </Text>
          </YStack>

          {error && (
            <Text
              fontFamily="$body"
              fontSize="$3"
              color="$biomarkerDeviation"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          )}

          <Button
            variant="destructive"
            onPress={() => setConfirmOpen(true)}
            disabled={revokeMutation.isPending}
            marginTop="$3"
          >
            {CONSENT_REVOKE_CTA_PT_BR}
          </Button>
        </YStack>
      </ScrollView>

      <Dialog modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            key="overlay"
            animation="quick"
            opacity={0.5}
            enterStyle={{ opacity: 0 }}
            exitStyle={{ opacity: 0 }}
          />
          <Dialog.Content
            bordered
            elevate
            key="content"
            animateOnly={["transform", "opacity"]}
            animation="quick"
            enterStyle={{ x: 0, y: -10, opacity: 0 }}
            exitStyle={{ x: 0, y: -10, opacity: 0 }}
            gap="$3"
            padding="$4"
          >
            <Dialog.Title>{CONSENT_REVOKE_CONFIRM_TITLE_PT_BR}</Dialog.Title>
            <Dialog.Description>
              {copy.declineConsequence}
              {"\n\n"}
              {CONSENT_REVOKE_DATA_RETENTION_PT_BR}
            </Dialog.Description>
            <XStack gap="$3" justifyContent="flex-end" marginTop="$2">
              <Dialog.Close asChild>
                <Button variant="outline">
                  {CONSENT_REVOKE_CONFIRM_SECONDARY_PT_BR}
                </Button>
              </Dialog.Close>
              <Button
                variant="destructive"
                onPress={handleConfirmRevoke}
                disabled={revokeMutation.isPending}
              >
                {CONSENT_REVOKE_CONFIRM_PRIMARY_PT_BR}
              </Button>
            </XStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </SafeAreaView>
  );
}
