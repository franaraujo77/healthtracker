import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { BiomarkerCard, Button } from "@healthtracker/ui";
import {
  formatCollectedAtPtBr,
  HISTORICO_DRAW_DETAIL_BACK_PT_BR,
  HISTORICO_DRAW_NOT_FOUND_PT_BR,
  HISTORICO_LAB_NAME_FALLBACK_PT_BR,
  HISTORICO_RESULTS_ERROR_PT_BR,
  HISTORICO_RESULTS_LOADING_PT_BR,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

/**
 * Story 3.1 — draw detail screen. Reads `(collectedAt, labName)` from
 * the route params and filters the cached `observations.getRecord`
 * payload client-side (no second tRPC call — dataset is small,
 * Epic 2 retro § preparation gaps).
 *
 * Query-param coupling (Epic 2 retro action item 3, R2-P171 lesson):
 * this file is the CONSUMER of the `labName` query param emitted by
 * `historicoDrawDetailRoute` and the draw-card press handler in
 * `apps/expo/src/app/(tabs)/historico/index.tsx`. Don't remove the
 * `useLocalSearchParams` read without auditing both producers.
 *
 * Empty-string `labName` is the sentinel for "no lab recorded" (the
 * Resultados list passes `""` when `draw.labName === null`). Match
 * draws with `labName === null` against that sentinel so a null-lab
 * draw is reachable from a tap.
 */
export default function DrawDetailScreen() {
  const params = useLocalSearchParams<{
    collectedAt: string;
    labName?: string;
  }>();
  const collectedAt = params.collectedAt;
  const labParam = params.labName ?? "";

  const query = useQuery(
    trpc.observations.getRecord.queryOptions(undefined, {
      // The detail view typically opens right after the list — use
      // the cached payload (no `staleTime: 0`). If the cache is cold
      // (deep-link), this fetches on mount.
      refetchOnWindowFocus: false,
    }),
  );

  const draw = query.data?.draws.find(
    (d) => d.collectedAt === collectedAt && (d.labName ?? "") === labParam,
  );

  const labLabel = draw?.labName ?? HISTORICO_LAB_NAME_FALLBACK_PT_BR;
  // R3-P246 — see validators `formatCollectedAtPtBr` for why we don't
  // round-trip through `new Date(...)` here (UTC-midnight shift to the
  // previous calendar day in every Brazilian timezone).
  const drawDate = collectedAt ? formatCollectedAtPtBr(collectedAt) : "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <YStack gap="$3">
          <Button variant="ghost" onPress={() => router.back()}>
            {HISTORICO_DRAW_DETAIL_BACK_PT_BR}
          </Button>
          <Text fontSize="$7" fontWeight="700">
            {labLabel}
          </Text>
          <Text fontSize="$3" color="$textSecondary">
            {drawDate}
          </Text>
          {query.isLoading ? (
            <Text>{HISTORICO_RESULTS_LOADING_PT_BR}</Text>
          ) : null}
          {query.isError ? (
            <Text accessibilityRole="alert">
              {HISTORICO_RESULTS_ERROR_PT_BR}
            </Text>
          ) : null}
          {query.isSuccess && !draw ? (
            // R1-P241 — distinguish "draw not found in payload"
            // (deep-link to a soft-deleted / nonexistent draw) from
            // a fetch failure. The fetch succeeded; the draw simply
            // isn't there.
            <Text accessibilityRole="alert">
              {HISTORICO_DRAW_NOT_FOUND_PT_BR}
            </Text>
          ) : null}
          {draw?.observations.map((obs) => (
            <BiomarkerCard
              key={obs.id}
              biomarkerName={obs.biomarkerName}
              valueNumeric={obs.valueNumeric}
              unitUcum={obs.unitUcum}
              referenceRangeLow={obs.referenceRangeLow}
              referenceRangeHigh={obs.referenceRangeHigh}
            />
          ))}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
