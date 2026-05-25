import { useEffect, useRef } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { Button } from "@healthtracker/ui";
import {
  BIOMARKER_SUGGESTION_COOLDOWN_PT_BR,
  BIOMARKER_SUGGESTION_ERROR_PT_BR,
  BIOMARKER_SUGGESTION_HEADER_PT_BR,
  BIOMARKER_SUGGESTION_LOADING_PT_BR,
  BIOMARKER_SUGGESTION_PREMIUM_REQUIRED_PT_BR,
  formatBrazilianDecimal,
  HISTORICO_DRAW_DETAIL_BACK_PT_BR,
  LETTER_PREMIUM_UPGRADE_CTA_PT_BR,
} from "@healthtracker/validators";

import type { RouterInputs } from "~/utils/api";
import { trpc, trpcClient } from "~/utils/api";

type SuggestionInput = RouterInputs["letter"]["generateBiomarkerSuggestion"];

const BACKGROUND_PRIMARY = "#F9F7F4";

/**
 * Story 4.3 — biomarker detail screen ("Pergunte ao seu médico").
 *
 * NOT a fullScreenModal — tab bar persists per UX-DR11. Auto-fires
 * the mutation on mount via `useMutation.mutate` inside a single-shot
 * effect. TanStack `useMutation` does NOT retry by default, so the
 * free-tier retry-storm finding from Story 4.2 F1 does not apply
 * here.
 *
 * Route params (from `BIOMARKER_DETAIL_ROUTE`):
 *   loincCode → path param (UUID-or-LOINC string)
 *   name      → biomarker name (URL-decoded)
 *   value     → string-encoded number
 *   unit      → UCUM unit
 */
export default function BiomarkerDetailScreen(): React.ReactNode {
  const params = useLocalSearchParams<{
    loincCode: string;
    name?: string;
    value?: string;
    unit?: string;
  }>();
  const loincCode = String(params.loincCode);
  const biomarkerName = params.name ?? "";
  const valueNumeric = Number(params.value ?? "NaN");
  const unitUcum = params.unit ?? "";

  // Code-review F2 — cancel the in-flight request when the screen
  // unmounts. tRPC v11's per-call `signal` plumbs straight into the
  // underlying fetch, so a back-navigation mid-call aborts the HTTP
  // round-trip cleanly; the API helper's `await fetch(...)` throws,
  // the audit row is never written, and Anthropic stops streaming.
  // (Cooldown bumping is also gated on success after the F1 fix.)
  const abortRef = useRef<AbortController | null>(null);
  // Spread the tRPC mutationOptions so the mutation keeps its
  // `mutationKey` ([['letter','generateBiomarkerSuggestion']]) —
  // restored for devtools grouping and any future
  // `useIsMutating({ mutationKey })` filter. Override only the
  // `mutationFn` so we can thread the AbortSignal for F2 unmount-
  // cancellation.
  const mutation = useMutation({
    ...trpc.letter.generateBiomarkerSuggestion.mutationOptions(),
    mutationFn: (input: SuggestionInput) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      return trpcClient.letter.generateBiomarkerSuggestion.mutate(input, {
        signal: ctrl.signal,
      });
    },
  });

  useEffect(() => {
    if (!biomarkerName || !Number.isFinite(valueNumeric) || !unitUcum) return;
    mutation.mutate({
      biomarkerName,
      value: valueNumeric,
      unitUcum,
      loincCode,
    });
    // Auto-fire once on mount; explicitly do NOT depend on `mutation`
    // (its identity changes on every render and would re-trigger).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loincCode]);

  // Cleanup separate from the auto-fire effect so unmount always
  // aborts, even when the auto-fire early-returned on bad params.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  // The TRPCClientError shape lets us key on the server message we
  // set in `entitlements.ts` and `letters.ts`.
  const errorMessage = mutation.error?.message ?? "";
  const isPremiumGate = errorMessage === "PREMIUM_REQUIRED";
  const isCooldown = errorMessage === "COOLDOWN";

  const valueDisplay = Number.isFinite(valueNumeric)
    ? `${formatBrazilianDecimal(valueNumeric)} ${unitUcum}`
    : "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <YStack gap="$3">
          <Button variant="ghost" onPress={() => router.back()}>
            {HISTORICO_DRAW_DETAIL_BACK_PT_BR}
          </Button>
          <Text fontSize="$7" fontWeight="700">
            {biomarkerName}
          </Text>
          {valueDisplay ? (
            <Text fontSize="$3" color="$textSecondary">
              {valueDisplay}
            </Text>
          ) : null}
          <Text fontSize="$5" fontWeight="600" marginTop="$4">
            {BIOMARKER_SUGGESTION_HEADER_PT_BR}
          </Text>
          {mutation.isPending ? (
            <Text accessibilityRole="alert">
              {BIOMARKER_SUGGESTION_LOADING_PT_BR}
            </Text>
          ) : null}
          {mutation.isSuccess ? (
            <Text fontSize="$4" lineHeight={24}>
              {mutation.data.suggestion}
            </Text>
          ) : null}
          {isPremiumGate ? (
            <YStack gap="$3">
              <Text accessibilityRole="alert">
                {BIOMARKER_SUGGESTION_PREMIUM_REQUIRED_PT_BR}
              </Text>
              <Button>{LETTER_PREMIUM_UPGRADE_CTA_PT_BR}</Button>
            </YStack>
          ) : null}
          {isCooldown ? (
            <Text accessibilityRole="alert">
              {BIOMARKER_SUGGESTION_COOLDOWN_PT_BR}
            </Text>
          ) : null}
          {mutation.isError && !isPremiumGate && !isCooldown ? (
            <Text accessibilityRole="alert">
              {BIOMARKER_SUGGESTION_ERROR_PT_BR}
            </Text>
          ) : null}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
