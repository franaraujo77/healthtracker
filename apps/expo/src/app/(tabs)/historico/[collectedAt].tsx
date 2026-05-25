import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { BiomarkerCard, Button } from "@healthtracker/ui";
import {
  BIOMARKER_DETAIL_ROUTE,
  CARTA_ROUTE,
  formatCollectedAtPtBr,
  HISTORICO_DRAW_DETAIL_BACK_PT_BR,
  HISTORICO_DRAW_NOT_FOUND_PT_BR,
  HISTORICO_LAB_NAME_FALLBACK_PT_BR,
  HISTORICO_RESULTS_ERROR_PT_BR,
  HISTORICO_RESULTS_LOADING_PT_BR,
  LETTER_FAILED_PT_BR,
  LETTER_PREPARING_RETRY_PT_BR,
  LETTER_READ_CTA_PT_BR,
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

  // Story 4.2 — surface the "Ler carta" entry point when a Letter
  // exists for this draw. Enabled only when the draw is reachable in
  // the cached payload — for free-tier patients the procedure throws
  // PRECONDITION_FAILED, which lands in `letterQuery.isError`; we
  // render nothing in that case (silent absence is the correct UX —
  // upsells live on Story 4.3's surface).
  const letterQuery = useQuery(
    trpc.letter.getForDraw.queryOptions(
      { collectedAt, labName: labParam },
      {
        enabled: Boolean(collectedAt) && Boolean(draw),
        // Code-review F1 — free-tier patients hit `premiumProcedure`'s
        // PRECONDITION_FAILED gate. With TanStack's default `retry: 3`,
        // each Histórico draw open triggers ~4 requests with backoff
        // for every free-tier user — a silent retry storm. Letter
        // metadata is non-essential UX; one failed request is enough.
        retry: false,
      },
    ),
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
              // Story 4.3 — tap routes to "Pergunte ao seu médico".
              // Skip the tap surface when loincCode is null (Story 2.3
              // R1-P102 — no LLM anchor exists for unresolved LOINC).
              onPress={
                obs.loincCode === null
                  ? undefined
                  : () => {
                      const loinc = obs.loincCode;
                      if (loinc === null) return;
                      router.push(
                        BIOMARKER_DETAIL_ROUTE(
                          loinc,
                          obs.biomarkerName,
                          obs.valueNumeric,
                          obs.unitUcum,
                        ),
                      );
                    }
              }
            />
          ))}
          {/* Story 4.2 — Letter entry point. Append below the
              biomarker list (AC5); never interleave. Three outcomes:
              complete → CTA, queued/generating/failed → preparing
              message, no Letter (or free-tier error) → render nothing. */}
          {renderLetterSlot(letterQuery.data)}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}

type LetterForDraw =
  | {
      letterId: string;
      status: "queued" | "generating" | "complete" | "failed";
    }
  | null
  | undefined;

function renderLetterSlot(data: LetterForDraw): React.ReactNode {
  if (!data) return null;
  if (data.status === "complete") {
    return (
      <Button onPress={() => router.push(CARTA_ROUTE(data.letterId))}>
        {LETTER_READ_CTA_PT_BR}
      </Button>
    );
  }
  // Code-review F3 — `failed` is terminal (pg-boss retries exhausted),
  // so the "you'll get a notification" copy promises a push that will
  // never come. Show the soft terminal-failure copy instead.
  if (data.status === "failed") {
    return <Text accessibilityRole="alert">{LETTER_FAILED_PT_BR}</Text>;
  }
  // queued | generating — the push is genuinely on the way.
  return <Text accessibilityRole="alert">{LETTER_PREPARING_RETRY_PT_BR}</Text>;
}
