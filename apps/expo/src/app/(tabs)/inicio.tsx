import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Text, YStack } from "tamagui";

import type {
  FingerprintChartBaselineBiomarker,
  FingerprintLifeEventMarker,
} from "@healthtracker/ui/fingerprint-chart-baseline";
import {
  BiomarkerCard,
  EmptyStateRecord,
  ExtractionPulse,
  LifeEventSheet,
} from "@healthtracker/ui";
import { FingerprintChart } from "@healthtracker/ui/fingerprint-chart";
import { UploadSourceSheet } from "@healthtracker/ui/upload-source-sheet";
import {
  BIOMARKER_DETAIL_ROUTE,
  FINGERPRINT_CACHE_FRESH_A11Y_PT_BR,
  FINGERPRINT_CACHE_STALE_A11Y_PT_BR,
  FINGERPRINT_CACHE_STALE_HINT_PT_BR,
  FINGERPRINT_CACHE_STALE_THRESHOLD_MS,
  FINGERPRINT_CACHE_UPDATED_AT_PREFIX_PT_BR,
  FINGERPRINT_PARTIAL_EMPTY_CTA_PT_BR,
  FINGERPRINT_PARTIAL_EMPTY_HEADLINE_PT_BR,
  formatCachedUpdatedAtPtBr,
  HISTORICO_OFFLINE_QUEUED_HINT_PT_BR,
  INICIO_ADD_MEASUREMENT_CTA_PT_BR,
  INICIO_CTA_DRAW_ONE_PT_BR,
  INICIO_CTA_PT_BR,
  INICIO_FINGERPRINT_ERROR_PT_BR,
  INICIO_FINGERPRINT_LOADING_PT_BR,
  INICIO_HEADLINE_DRAW_ONE_PT_BR,
  INICIO_HEADLINE_PT_BR,
  INICIO_OFFLINE_UPLOAD_DISABLED_PT_BR,
  LIFE_EVENT_CTA_PT_BR,
  LIFE_EVENT_SAVE_ERROR_PT_BR,
  LIFE_EVENT_SAVED_TOAST_PT_BR,
  MANUAL_BIA_ROUTE,
  todayInSaoPauloIso,
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

import { useCacheRefetchOnOnline } from "~/hooks/use-cache-refetch-on-online";
import { useImportFiles } from "~/hooks/use-import-files";
import { useNetInfoExternal } from "~/hooks/use-net-info";
import { useOfflineQueue } from "~/hooks/use-offline-queue";
import { trpc } from "~/utils/api";

// SafeAreaView is native and can't read Tamagui tokens — mirror
// colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

const PDF_ONLY_ACCEPT = [UPLOAD_ALLOWED_MIME_TYPES[0]] as const;
const ELAPSED_TICK_MS = 1000;

/**
 * Story 3.4 — the two query-key path filters consumed by
 * `useCacheRefetchOnOnline`. Hoisted to module scope so the array
 * identity is stable (the hook's `useEffect` dep includes it).
 *
 * R1-P270 — `@trpc/tanstack-react-query` v11 keys queries as
 * `[['<router>', '<procedure>'], { input?, type? }]`. The first
 * element of the key is the PATH ARRAY (`['observations','getRecord']`)
 * — NOT a dotted string. `queryClient.invalidateQueries({ queryKey })`
 * does prefix-match against the array head, so we pass the wrapping
 * `[['observations','getRecord']]` shape to match every variant
 * (input, type=any/infinite) of the procedure. Order matches the
 * dehydrate whitelist in `apps/expo/src/utils/api.tsx::PERSIST_QUERY_KEYS`.
 */
const FINGERPRINT_CACHE_QUERY_KEYS: readonly (readonly unknown[])[] = [
  [["observations", "getRecord"]],
  [["observations", "getPersonalBaseline"]],
] as const;

export default function Inicio() {
  // R2-P171 — auto-open the source-picker when Story 2.5's
  // failed-card "Enviar uma foto" recovery CTA navigates here with
  // `?source=post_onboarding_photo`.
  const params = useLocalSearchParams<{ source?: string }>();
  const [sheetOpen, setSheetOpen] = useState(
    params.source === "post_onboarding_photo",
  );
  // Story 7.1 — life-event Tier-2 sheet state. Visible only on the
  // `baseline-established` branch (one Fingerprint = one place to
  // contextualise). The save error is rendered inline below the CTA.
  const [lifeEventSheetOpen, setLifeEventSheetOpen] = useState(false);
  const [lifeEventError, setLifeEventError] = useState<string | null>(null);
  const [lifeEventToast, setLifeEventToast] = useState<string | null>(null);
  const queryClient = useQueryClient();
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

  // Story 3.4 — connectivity-aware label + disabled-CTA branches.
  // `isConnected === false` means definitively offline; `null` (unknown)
  // is treated as online (don't false-alarm patients on a slow first
  // NetInfo emit).
  const { isConnected } = useNetInfoExternal();
  const isOffline = isConnected === false;

  // Story 3.4 AC4 — invalidate the Fingerprint queries on a NetInfo
  // rising-edge transition (offline → online). The keys are memoized
  // via the module-scope `FINGERPRINT_CACHE_QUERY_KEYS` constant so
  // the hook's effect dep array stays stable across renders.
  useCacheRefetchOnOnline(FINGERPRINT_CACHE_QUERY_KEYS);

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
      // Story 4.3 — null when LOINC is unresolved (Story 2.3 R1-P102);
      // BiomarkerCard.onPress stays undefined for these rows, so tap
      // is a no-op (no LLM anchor exists).
      loincCode: string | null;
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
        loincCode: b.loincCode,
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
        loincCode: o.loincCode,
      });
    });
    return cards;
  }, [
    showFingerprintBaseline,
    baselineQuery.data,
    recordQuery.data,
    baselineKeys,
  ]);

  // Story 7.1 — life-event window. Derive the visible Fingerprint
  // window from the merged baseline chart data (chronological history
  // across every biomarker). When the patient has at least one
  // historical sample we pad the window to "today" so just-saved
  // events are immediately visible as markers (AC3).
  const lifeEventWindow = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const b of baselineChartBiomarkers) {
      for (const h of b.history) {
        if (min === null || h.collectedAt < min) min = h.collectedAt;
        if (max === null || h.collectedAt > max) max = h.collectedAt;
      }
    }
    if (min === null || max === null) return null;
    // R1-followup LOW #4 — use São Paulo "today" instead of the
    // device local clock so devices set to a non-Brazil timezone
    // don't see a one-day window drift. The server refine
    // (`todayInSaoPauloIso` in the validator) is the auth boundary;
    // matching the client here is just consistency.
    const today = todayInSaoPauloIso();
    return { fromDate: min, toDate: max > today ? max : today };
  }, [baselineChartBiomarkers]);

  // The tRPC adapter requires a concrete input even when the query is
  // disabled (the queryKey carries the input). Pass the sentinel
  // window when none is derivable yet — `enabled` short-circuits the
  // network call and the resolver is never reached.
  const SENTINEL_WINDOW = {
    fromDate: "1970-01-01",
    toDate: "1970-01-01",
  } as const;
  const lifeEventsQuery = useQuery(
    trpc.lifeEvents.listInWindow.queryOptions(
      lifeEventWindow ?? SENTINEL_WINDOW,
      {
        staleTime: 0,
        refetchOnWindowFocus: true,
        enabled: lifeEventWindow !== null,
      },
    ),
  );

  const lifeEventMarkers: FingerprintLifeEventMarker[] = useMemo(() => {
    const events = lifeEventsQuery.data?.events ?? [];
    // R1-followup LOW #1 — PII discipline: only ship id + eventDate
    // to the chart layer. `description` stays in the React Query
    // cache for the future sheet/editor surface, but never reaches
    // the marker prop or render tree.
    return events.map((e) => ({
      id: e.id,
      eventDate: e.eventDate,
    }));
  }, [lifeEventsQuery.data]);

  const createLifeEventMutation = useMutation(
    trpc.lifeEvents.createLifeEvent.mutationOptions({
      onSuccess: () => {
        setLifeEventError(null);
        setLifeEventToast(LIFE_EVENT_SAVED_TOAST_PT_BR);
        setLifeEventSheetOpen(false);
        // Refetch markers — the new row may or may not fall inside the
        // current chart window; the query refetch is cheap and
        // mirrors the existing Fingerprint cache-invalidation pattern.
        void queryClient.invalidateQueries({
          queryKey: [["lifeEvents", "listInWindow"]],
        });
      },
      onError: () => {
        setLifeEventError(LIFE_EVENT_SAVE_ERROR_PT_BR);
      },
    }),
  );

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

  // Story 3.4 — cached-data freshness label (AC1, AC3). We render the
  // "Última atualização: …" label whenever the data the patient is
  // currently looking at came from the persisted cache, not a fresh
  // fetch. The conservative signal is `isOffline` (the user is on
  // airplane mode / no connectivity — anything visible is necessarily
  // cached); we deliberately do NOT render the label while online to
  // avoid noise on the happy path. The threshold-based amber
  // treatment (`isStale`) is a separate axis evaluated only when the
  // label is rendered.
  const recordUpdatedAt = recordQuery.dataUpdatedAt;
  const baselineUpdatedAt = baselineQuery.dataUpdatedAt;
  const effectiveUpdatedAt = Math.max(recordUpdatedAt, baselineUpdatedAt);
  const hasCachedFingerprint =
    effectiveUpdatedAt > 0 && recordQuery.data !== undefined;
  const showCachedLabel = hasCachedFingerprint && isOffline;
  const isCacheStale =
    showCachedLabel &&
    nowTick - effectiveUpdatedAt > FINGERPRINT_CACHE_STALE_THRESHOLD_MS;
  const cachedFormatted = showCachedLabel
    ? formatCachedUpdatedAtPtBr(effectiveUpdatedAt)
    : "";
  const cachedA11y = showCachedLabel
    ? isCacheStale
      ? FINGERPRINT_CACHE_STALE_A11Y_PT_BR(cachedFormatted)
      : FINGERPRINT_CACHE_FRESH_A11Y_PT_BR(cachedFormatted)
    : "";

  // Story 3.4 — keep the freshness label's stale evaluation honest
  // across long idle periods. The existing `nowTick` from the active-
  // upload interval only ticks while an upload is in flight. Add a
  // lightweight 60s tick while the cached label is visible so a
  // 23h59m → 24h00m crossover surfaces without a navigation event.
  useEffect(() => {
    if (!showCachedLabel) return;
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [showCachedLabel]);

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
        {showCachedLabel ? (
          <YStack
            paddingHorizontal="$3"
            paddingTop="$3"
            paddingBottom="$1"
            accessibilityRole="text"
            accessibilityLabel={cachedA11y}
          >
            <Text
              fontSize="$3"
              color={isCacheStale ? "$biomarkerDeviation" : "$textSecondary"}
            >
              {FINGERPRINT_CACHE_UPDATED_AT_PREFIX_PT_BR}
              {cachedFormatted}
            </Text>
            {isCacheStale ? (
              <Text fontSize="$2" color="$textSecondary">
                {FINGERPRINT_CACHE_STALE_HINT_PT_BR}
              </Text>
            ) : null}
          </YStack>
        ) : null}
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
              // Story 3.4 AC2 — when offline, opening the sheet would
              // surface CTAs the patient can't use; short-circuit the
              // tap and let the inline-disabled-hint below explain.
              onCtaPress={() => {
                if (isOffline) return;
                setSheetOpen(true);
              }}
              variant="inline"
              state="partial"
            />
            {isOffline ? (
              <YStack paddingHorizontal="$4" paddingBottom="$2">
                <Text
                  fontSize="$2"
                  color="$textSecondary"
                  textAlign="center"
                  accessibilityRole="text"
                >
                  {INICIO_OFFLINE_UPLOAD_DISABLED_PT_BR}
                </Text>
              </YStack>
            ) : null}
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
                  lifeEvents={lifeEventMarkers}
                />
                <YStack gap="$2" paddingHorizontal="$3" paddingBottom="$3">
                  {/* Story 7.1 — Tier-2 "Adicionar evento de vida" CTA. */}
                  <Button
                    disabled={isOffline || createLifeEventMutation.isPending}
                    onPress={() => {
                      if (isOffline) return;
                      setLifeEventError(null);
                      setLifeEventToast(null);
                      setLifeEventSheetOpen(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={LIFE_EVENT_CTA_PT_BR}
                  >
                    {LIFE_EVENT_CTA_PT_BR}
                  </Button>
                  {lifeEventError ? (
                    <Text
                      fontSize="$2"
                      color="$biomarkerDeviation"
                      accessibilityRole="text"
                    >
                      {lifeEventError}
                    </Text>
                  ) : null}
                  {lifeEventToast ? (
                    <Text
                      fontSize="$2"
                      color="$textSecondary"
                      accessibilityRole="text"
                    >
                      {lifeEventToast}
                    </Text>
                  ) : null}
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
                      // Story 4.3 — tap routes to the "Pergunte ao seu
                      // médico" detail. Skip the surface entirely when
                      // loincCode is null (Story 2.3 R1-P102 — observation
                      // rows can have null loinc; no LLM anchor exists).
                      onPress={
                        c.loincCode === null
                          ? undefined
                          : () => {
                              const loinc = c.loincCode;
                              if (loinc === null) return;
                              router.push(
                                BIOMARKER_DETAIL_ROUTE(
                                  loinc,
                                  c.biomarkerName,
                                  c.valueNumeric,
                                  c.unitUcum,
                                ),
                              );
                            }
                      }
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
              // Story 3.4 AC2 — short-circuit offline taps; the
              // inline hint below explains.
              onCtaPress={() => {
                if (isOffline) return;
                setSheetOpen(true);
              }}
            />
            {isOffline ? (
              <YStack paddingHorizontal="$4" paddingBottom="$2">
                <Text
                  fontSize="$2"
                  color="$textSecondary"
                  textAlign="center"
                  accessibilityRole="text"
                >
                  {INICIO_OFFLINE_UPLOAD_DISABLED_PT_BR}
                </Text>
              </YStack>
            ) : null}
            {/* Story 2.7 — secondary "Adicionar medição" CTA opens
                the manual BIA form. Story 3.3 AC5 suppresses both
                this and the primary EmptyStateRecord at drawCount>=2
                (the patient with a Fingerprint should see their
                Fingerprint, not an upload prompt; uploads remain
                reachable via Histórico).
                Story 3.4 AC2 — disabled offline; the local-only
                manual-BIA form still requires the submit to reach
                the server, so offline entry can't complete. */}
            <YStack paddingHorizontal="$3" paddingBottom="$3">
              <Button
                disabled={isOffline}
                onPress={() => {
                  if (isOffline) return;
                  router.push(MANUAL_BIA_ROUTE);
                }}
              >
                {INICIO_ADD_MEASUREMENT_CTA_PT_BR}
              </Button>
            </YStack>
          </>
        )}
        <LifeEventSheet
          open={lifeEventSheetOpen}
          onOpenChange={(open) => {
            setLifeEventSheetOpen(open);
            if (!open) setLifeEventError(null);
          }}
          saving={createLifeEventMutation.isPending}
          onSubmit={(values) => {
            createLifeEventMutation.mutate(values);
          }}
        />
        <UploadSourceSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onPickPdf={() => void handlePickPdf()}
          onPickImageFromLibrary={() => void handlePickImageLibrary()}
          onPickImageFromCamera={() => void handlePickImageCamera()}
          pdfDisabled={isUploading || isOffline}
          photoDisabled={isUploading || isOffline}
        />
      </YStack>
    </SafeAreaView>
  );
}
