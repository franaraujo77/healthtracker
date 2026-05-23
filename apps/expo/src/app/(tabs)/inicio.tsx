import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Text, YStack } from "tamagui";

import type { FingerprintChartBaselineBiomarker } from "@healthtracker/ui";
import {
  BiomarkerCard,
  EmptyStateRecord,
  ExtractionPulse,
  FingerprintChart,
} from "@healthtracker/ui";
import { UploadSourceSheet } from "@healthtracker/ui/upload-source-sheet";
import {
  FINGERPRINT_PARTIAL_EMPTY_CTA_PT_BR,
  FINGERPRINT_PARTIAL_EMPTY_HEADLINE_PT_BR,
  HISTORICO_OFFLINE_QUEUED_HINT_PT_BR,
  INICIO_ADD_MEASUREMENT_CTA_PT_BR,
  INICIO_CTA_DRAW_ONE_PT_BR,
  INICIO_CTA_PT_BR,
  INICIO_FINGERPRINT_ERROR_PT_BR,
  INICIO_FINGERPRINT_LOADING_PT_BR,
  INICIO_HEADLINE_DRAW_ONE_PT_BR,
  INICIO_HEADLINE_PT_BR,
  MANUAL_BIA_ROUTE,
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

import { useImportFiles } from "~/hooks/use-import-files";
import { useOfflineQueue } from "~/hooks/use-offline-queue";
import { trpc } from "~/utils/api";

// SafeAreaView is native and can't read Tamagui tokens — mirror
// colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

const PDF_ONLY_ACCEPT = [UPLOAD_ALLOWED_MIME_TYPES[0]] as const;
const ELAPSED_TICK_MS = 1000;

export default function Inicio() {
  // R2-P171 — auto-open the source-picker when Story 2.5's
  // failed-card "Enviar uma foto" recovery CTA navigates here with
  // `?source=post_onboarding_photo`.
  const params = useLocalSearchParams<{ source?: string }>();
  const [sheetOpen, setSheetOpen] = useState(
    params.source === "post_onboarding_photo",
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const {
    pickDocuments,
    pickImages,
    uploadFiles,
    isUploading,
    progressByPath,
    startedAtByPath,
  } = useImportFiles({
    source: "post_onboarding",
    pickDocumentsAccept: PDF_ONLY_ACCEPT,
  });

  // Story 3.2 — mirror the Histórico → Resultados options (staleTime
  // 0 + refetchOnWindowFocus) so a freshly-published draw surfaces on
  // Início without a pull-to-refresh. AC6: this is the EXISTING
  // `getRecord` procedure — Story 3.2 adds no new tRPC surface and no
  // new audit event kind.
  const recordQuery = useQuery(
    trpc.observations.getRecord.queryOptions(undefined, {
      staleTime: 0,
      refetchOnWindowFocus: true,
    }),
  );

  // Story 3.3 — second query for the personal baseline. `enabled`
  // gates on `drawCount >= 2` so we don't emit a spurious
  // `observation.baseline.read` audit row at draw 0 / 1 (AC6).
  const drawCountFromRecord = recordQuery.data?.drawCount ?? 0;
  const baselineQuery = useQuery(
    trpc.observations.getPersonalBaseline.queryOptions(undefined, {
      staleTime: 0,
      refetchOnWindowFocus: true,
      enabled: drawCountFromRecord >= 2,
    }),
  );

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (mounted) setReducedMotion(reduced);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // Story 2.1 — drive the ExtractionPulse patience-pattern copy from a
  // 1 s tick. Only run the interval while we have an active upload —
  // the 10 s buckets don't need sub-second precision.
  const activeUris = Object.keys(progressByPath).filter((uri) => {
    const status = progressByPath[uri]?.status;
    return status === "uploading" || status === "queued";
  });
  const hasActive = activeUris.length > 0;
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => setNowTick(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(id);
  }, [hasActive]);

  // Story 2.1 P59 — re-entry guard so a double-tap on the sheet's
  // "Arquivo PDF" CTA doesn't spawn two concurrent
  // `DocumentPicker.getDocumentAsync` calls (iOS may throw on the
  // second; either platform would otherwise queue duplicate batches).
  const isPickingRef = useRef(false);
  async function handlePickPdf() {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const result = await pickDocuments();
      if (result.files.length === 0) return;
      await uploadFiles(result.files);
    } finally {
      // Round-2 R2-P69 — close the sheet AFTER the picker resolves,
      // regardless of success/cancel/error. The previous version
      // only closed on the success branch, so iOS picker errors left
      // the sheet open with no user feedback.
      setSheetOpen(false);
      isPickingRef.current = false;
    }
  }

  // Story 2.2 — the sheet's library + camera rows funnel through
  // `pickImages` with the matching source. Share the re-entry guard
  // with the PDF picker: only one picker can be open at a time.
  //
  // Round-1 P80 — `pickImages` returns `rejected` entries on
  // permission denial, launch error, or unsupported mime (P75/P77);
  // for Início there is no rejection surface yet (Início renders
  // only ExtractionPulse + EmptyStateRecord — no rejection list).
  // We `console.warn` the rejections so they appear in Sentry /
  // dev console; a patient-facing surface is deferred (see F95).
  // Round-2 R2-P85 — only warn on launch-error rejections; permission
  // denials are an expected user choice and would otherwise pollute
  // Sentry / logs on every "I want to think about it" tap.
  function unexpectedRejections(
    rejected: { uri: string; validationError: string }[],
  ) {
    return rejected.filter((r) => !r.uri.startsWith("permission-"));
  }

  async function handlePickImageLibrary() {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const result = await pickImages({ source: "library" });
      const unexpected = unexpectedRejections(result.rejected);
      if (unexpected.length > 0) {
        console.warn("[inicio] image library picker rejections", unexpected);
      }
      if (result.files.length === 0) return;
      await uploadFiles(result.files);
    } catch (err) {
      console.warn("[inicio] image library upload error", err);
    } finally {
      setSheetOpen(false);
      isPickingRef.current = false;
    }
  }
  async function handlePickImageCamera() {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const result = await pickImages({ source: "camera" });
      const unexpected = unexpectedRejections(result.rejected);
      if (unexpected.length > 0) {
        console.warn("[inicio] camera picker rejections", unexpected);
      }
      if (result.files.length === 0) return;
      await uploadFiles(result.files);
    } catch (err) {
      console.warn("[inicio] camera upload error", err);
    } finally {
      setSheetOpen(false);
      isPickingRef.current = false;
    }
  }

  // Compute ExtractionPulse render inputs from the active uploads.
  const filenames = activeUris.map((uri) => progressByPath[uri]?.name ?? uri);
  const earliestStart = activeUris.reduce<number | undefined>((min, uri) => {
    const started = startedAtByPath[uri];
    if (started === undefined) return min;
    return min === undefined || started < min ? started : min;
  }, undefined);
  const elapsedMs =
    earliestStart !== undefined ? Math.max(0, nowTick - earliestStart) : 0;

  // R2-P190 — spec Task 4: surface offline-queued picks on Início so
  // the patient gets a signal that the pick was saved (the picker
  // sheet just closes; without this banner Início renders the
  // default empty state and the patient has no idea the queue
  // captured their file).
  const offlineRows = useOfflineQueue();
  const hasOfflineQueued = offlineRows.length > 0;

  // Story 3.2 — render-gating AC5. The Fingerprint cold-start-1
  // surfaces render ONLY at exactly `drawCount === 1`. `0` falls
  // back to today's cold-start landing; `>= 2` is Story 3.3's
  // domain. Loading + error states both render the existing shell
  // unchanged (AC5: layout shift on resolve is acceptable; Task
  // 3.7: error must NOT interrupt the upload affordance).
  const drawCount = recordQuery.data?.drawCount ?? 0;
  const showFingerprintColdStart1 = drawCount === 1;
  // Story 3.3 AC5 — render-gating uses `drawCount` from `getRecord`
  // ONLY (single source of truth — Task 4.9 dead-code guard). The
  // baseline query can race; the chart prop layer handles the
  // empty-baselines case.
  const showFingerprintBaseline = drawCount >= 2;
  // The single draw is `draws[0]` because the API helper sorts
  // `desc(collectedAt)` and there is exactly one. Map to the chart's
  // narrow prop shape (pass-through; the helper already coerced
  // numeric strings to `number` at the API boundary).
  const fingerprintBiomarkers = (
    recordQuery.data?.draws[0]?.observations ?? []
  ).map((o) => ({
    biomarkerName: o.biomarkerName,
    valueNumeric: o.valueNumeric,
    unitUcum: o.unitUcum,
    referenceRangeLow: o.referenceRangeLow,
    referenceRangeHigh: o.referenceRangeHigh,
  }));

  // Story 3.3 Task 4.3 — merge baseline rows + per-biomarker history
  // sourced from `recordQuery.data.draws[].observations[]`. Tiny
  // dataset (≤ ~1000 rows; Epic 2 retro) so a single linear pass per
  // baseline row is fine. Memo on both query data refs so the work
  // only recomputes when either query resolves.
  const baselineChartBiomarkers: FingerprintChartBaselineBiomarker[] =
    useMemo(() => {
      const baselines = baselineQuery.data?.baselines ?? [];
      const draws = recordQuery.data?.draws ?? [];
      if (baselines.length === 0) return [];
      return baselines.map((b) => {
        // Build chronological history by walking all draws and
        // collecting observations that match by LOINC (when set) or
        // by (biomarkerName, unitUcum) fallback. Reverse-chrono in
        // `draws` is the helper's contract — reverse to chronological
        // for the chart.
        const matching: { collectedAt: string; valueNumeric: number }[] = [];
        for (const draw of draws) {
          for (const obs of draw.observations) {
            const sameGroup =
              b.loincCode !== null
                ? obs.loincCode === b.loincCode
                : obs.loincCode === null &&
                  obs.biomarkerName === b.biomarkerName &&
                  obs.unitUcum === b.unitUcum;
            if (sameGroup) {
              matching.push({
                collectedAt: obs.collectedAt,
                valueNumeric: obs.valueNumeric,
              });
            }
          }
        }
        // `draws` is reverse-chrono → reverse to chronological for
        // line/scatter direction.
        matching.reverse();
        return {
          loincCode: b.loincCode,
          biomarkerName: b.biomarkerName,
          unitUcum: b.unitUcum,
          history: matching,
          baseline: {
            mean: b.mean,
            stddev: b.stddev,
            sampleSize: b.sampleSize,
          },
          latestValue: b.latestValue,
          zScore: b.zScore,
        };
      });
    }, [baselineQuery.data, recordQuery.data]);

  // Story 3.3 AC3 — cold-start fallback per biomarker. Biomarkers
  // present in the latest draw but absent from `baselines` (single
  // historical sample) render as `BiomarkerCard` `cold-start`.
  const baselineKeys = useMemo(() => {
    const set = new Set<string>();
    for (const b of baselineQuery.data?.baselines ?? []) {
      set.add(
        b.loincCode !== null
          ? `loinc:${b.loincCode}`
          : `name:${b.biomarkerName}|${b.unitUcum}`,
      );
    }
    return set;
  }, [baselineQuery.data]);

  // Build the BiomarkerCard list: one card per baseline row +
  // one cold-start card per biomarker in the latest draw without
  // a baseline entry.
  const baselineCards = useMemo(() => {
    if (!showFingerprintBaseline) return [];
    const baselines = baselineQuery.data?.baselines ?? [];
    const latestObs = recordQuery.data?.draws[0]?.observations ?? [];
    const cards: {
      key: string;
      biomarkerName: string;
      valueNumeric: number;
      unitUcum: string;
      referenceRangeLow: number | null;
      referenceRangeHigh: number | null;
      zScore?: number | null;
      personalBaselineMean?: number;
      personalBaselineStddev?: number;
    }[] = [];
    baselines.forEach((b, idx) => {
      // Look up the latest population reference range from the most-
      // recent observation in the matching group.
      const refSource = latestObs.find((o) =>
        b.loincCode !== null
          ? o.loincCode === b.loincCode
          : o.loincCode === null &&
            o.biomarkerName === b.biomarkerName &&
            o.unitUcum === b.unitUcum,
      );
      cards.push({
        key: `bl-${b.loincCode ?? b.biomarkerName}-${b.unitUcum}-${idx}`,
        biomarkerName: b.biomarkerName,
        valueNumeric: b.latestValue,
        unitUcum: b.unitUcum,
        referenceRangeLow: refSource?.referenceRangeLow ?? null,
        referenceRangeHigh: refSource?.referenceRangeHigh ?? null,
        zScore: b.zScore,
        personalBaselineMean: b.mean,
        personalBaselineStddev: b.stddev,
      });
    });
    // Cold-start fallback for single-history biomarkers in the
    // latest draw.
    latestObs.forEach((o, idx) => {
      const key =
        o.loincCode !== null
          ? `loinc:${o.loincCode}`
          : `name:${o.biomarkerName}|${o.unitUcum}`;
      if (baselineKeys.has(key)) return;
      cards.push({
        key: `cs-${o.id}-${idx}`,
        biomarkerName: o.biomarkerName,
        valueNumeric: o.valueNumeric,
        unitUcum: o.unitUcum,
        referenceRangeLow: o.referenceRangeLow,
        referenceRangeHigh: o.referenceRangeHigh,
        // `zScore` undefined → BiomarkerCard falls back to
        // population-range state (AC3 fallback contract).
      });
    });
    return cards;
  }, [
    showFingerprintBaseline,
    baselineQuery.data,
    recordQuery.data,
    baselineKeys,
  ]);

  // Story 3.2 Task 3.7 — error surfaces a console.warn only (no red
  // banner). Use a ref so we don't spam the log on every re-render.
  const warnedErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (recordQuery.isError && warnedErrorRef.current !== recordQuery.error) {
      warnedErrorRef.current = recordQuery.error;
      console.warn("[inicio] getRecord error", recordQuery.error);
    }
  }, [recordQuery.isError, recordQuery.error]);
  // Story 3.3 Task 4.6 — baseline query errors warn-only; the UI
  // shows a calm amber text instead of a red banner.
  const warnedBaselineErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (
      baselineQuery.isError &&
      warnedBaselineErrorRef.current !== baselineQuery.error
    ) {
      warnedBaselineErrorRef.current = baselineQuery.error;
      console.warn("[inicio] getPersonalBaseline error", baselineQuery.error);
    }
  }, [baselineQuery.isError, baselineQuery.error]);

  // Story 3.2 Task 3.6 — swap the primary `EmptyStateRecord` copy at
  // `drawCount === 1` so the headline + CTA reflect "continue
  // building" instead of "start". At `drawCount === 0` (and on
  // loading/error) the existing copy is byte-for-byte preserved.
  const primaryHeadline = showFingerprintColdStart1
    ? INICIO_HEADLINE_DRAW_ONE_PT_BR
    : INICIO_HEADLINE_PT_BR;
  const primaryCtaLabel = showFingerprintColdStart1
    ? INICIO_CTA_DRAW_ONE_PT_BR
    : INICIO_CTA_PT_BR;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Início" }} />
      <YStack flex={1} backgroundColor="$backgroundPrimary">
        {hasActive ? (
          <ExtractionPulse
            state="processing"
            filenames={filenames}
            elapsedMs={elapsedMs}
            reducedMotion={reducedMotion}
          />
        ) : null}
        {hasOfflineQueued ? (
          <YStack
            gap="$2"
            margin="$3"
            padding="$3"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$warningAmber"
            backgroundColor="$warningAmberSurface"
            accessibilityRole="text"
          >
            <Text fontWeight="600" color="$textPrimary">
              {UPLOAD_STATUS_LABELS_PT_BR.offline_queued} ({offlineRows.length})
            </Text>
            <Text fontSize="$2" color="$textSecondary">
              {HISTORICO_OFFLINE_QUEUED_HINT_PT_BR}
            </Text>
          </YStack>
        ) : null}
        {showFingerprintColdStart1 ? (
          <>
            <FingerprintChart
              state="cold-start-1"
              biomarkers={fingerprintBiomarkers}
              reducedMotion={reducedMotion}
            />
            <EmptyStateRecord
              headline={FINGERPRINT_PARTIAL_EMPTY_HEADLINE_PT_BR}
              ctaLabel={FINGERPRINT_PARTIAL_EMPTY_CTA_PT_BR}
              onCtaPress={() => setSheetOpen(true)}
              variant="inline"
              state="partial"
            />
          </>
        ) : null}
        {showFingerprintBaseline ? (
          <>
            {baselineQuery.isPending ? (
              <YStack padding="$4" margin="$3">
                <Text color="$textSecondary" fontFamily="$body" fontSize={14}>
                  {INICIO_FINGERPRINT_LOADING_PT_BR}
                </Text>
              </YStack>
            ) : baselineQuery.isError ? (
              <YStack padding="$4" margin="$3">
                <Text
                  color="$biomarkerDeviation"
                  fontFamily="$body"
                  fontSize={14}
                >
                  {INICIO_FINGERPRINT_ERROR_PT_BR}
                </Text>
              </YStack>
            ) : (
              <>
                <FingerprintChart
                  state="baseline-established"
                  baselines={baselineChartBiomarkers}
                  reducedMotion={reducedMotion}
                />
                <YStack gap="$2" paddingHorizontal="$3" paddingBottom="$3">
                  {baselineCards.map((c) => (
                    <BiomarkerCard
                      key={c.key}
                      biomarkerName={c.biomarkerName}
                      valueNumeric={c.valueNumeric}
                      unitUcum={c.unitUcum}
                      referenceRangeLow={c.referenceRangeLow}
                      referenceRangeHigh={c.referenceRangeHigh}
                      zScore={c.zScore}
                      personalBaselineMean={c.personalBaselineMean}
                      personalBaselineStddev={c.personalBaselineStddev}
                    />
                  ))}
                </YStack>
              </>
            )}
          </>
        ) : (
          <>
            <EmptyStateRecord
              headline={primaryHeadline}
              ctaLabel={primaryCtaLabel}
              // Story 2.1 — the empty-state CTA opens the post-
              // onboarding upload-source sheet. Story 1.5's recovery
              // path (`/onboarding/import` URL) is still reachable
              // directly; the CTA no longer routes to it.
              onCtaPress={() => setSheetOpen(true)}
            />
            {/* Story 2.7 — secondary "Adicionar medição" CTA opens
                the manual BIA form. Story 3.3 AC5 suppresses both
                this and the primary EmptyStateRecord at drawCount>=2
                (the patient with a Fingerprint should see their
                Fingerprint, not an upload prompt; uploads remain
                reachable via Histórico). */}
            <YStack paddingHorizontal="$3" paddingBottom="$3">
              <Button onPress={() => router.push(MANUAL_BIA_ROUTE)}>
                {INICIO_ADD_MEASUREMENT_CTA_PT_BR}
              </Button>
            </YStack>
          </>
        )}
        <UploadSourceSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onPickPdf={() => void handlePickPdf()}
          onPickImageFromLibrary={() => void handlePickImageLibrary()}
          onPickImageFromCamera={() => void handlePickImageCamera()}
          pdfDisabled={isUploading}
          photoDisabled={isUploading}
        />
      </YStack>
    </SafeAreaView>
  );
}
