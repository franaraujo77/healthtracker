import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, Text, YStack } from "tamagui";

import { EmptyStateRecord, ExtractionPulse } from "@healthtracker/ui";
import { UploadSourceSheet } from "@healthtracker/ui/upload-source-sheet";
import {
  HISTORICO_OFFLINE_QUEUED_HINT_PT_BR,
  INICIO_ADD_MEASUREMENT_CTA_PT_BR,
  INICIO_CTA_PT_BR,
  INICIO_HEADLINE_PT_BR,
  MANUAL_BIA_ROUTE,
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

import { useImportFiles } from "~/hooks/use-import-files";
import { useOfflineQueue } from "~/hooks/use-offline-queue";

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
        <EmptyStateRecord
          headline={INICIO_HEADLINE_PT_BR}
          ctaLabel={INICIO_CTA_PT_BR}
          // Story 2.1 — the empty-state CTA opens the post-onboarding
          // upload-source sheet. Story 1.5's recovery path
          // (`/onboarding/import` URL) is still reachable directly; the
          // CTA no longer routes to it.
          onCtaPress={() => setSheetOpen(true)}
        />
        {/* Story 2.7 — secondary "Adicionar medição" CTA opens the
            manual BIA form. Spec Task 7 collapses the picker sheet
            since only one option exists today; the button label
            spells out the option for clarity. */}
        <YStack paddingHorizontal="$3" paddingBottom="$3">
          <Button onPress={() => router.push(MANUAL_BIA_ROUTE)}>
            {INICIO_ADD_MEASUREMENT_CTA_PT_BR}
          </Button>
        </YStack>
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
