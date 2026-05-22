import { useRef, useState } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Separator, Text, XStack, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import {
  GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR,
  IMPORT_BODY_PT_BR,
  IMPORT_CONFIRM_CTA_PT_BR,
  IMPORT_PICK_CTA_PT_BR,
  IMPORT_SKIP_CTA_PT_BR,
  IMPORT_TITLE_PT_BR,
  INICIO_ROUTE,
  UPLOAD_QUEUED_BADGE_PT_BR,
  UPLOAD_SHEET_PHOTO_CAMERA_LABEL_PT_BR,
} from "@healthtracker/validators";

import type {
  PickedFile,
  PickedFileWithError,
  UploadFileResult,
} from "~/hooks/use-import-files";
import { useImportFiles } from "~/hooks/use-import-files";

// SafeAreaView is native and can't read Tamagui tokens — mirror
// colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

/**
 * Story 1.5 — onboarding "Enviar resultados anteriores" screen. The
 * patient lands here after the biometric offer (Story 1.3) and can
 * pick PDFs / images to upload, or skip with "Fazer isso depois".
 */
export default function ImportScreen() {
  const router = useRouter();
  const {
    pickDocuments,
    pickImages,
    uploadFiles,
    isUploading,
    progressByPath,
  } = useImportFiles({ source: "onboarding_import" });
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [rejected, setRejected] = useState<PickedFileWithError[]>([]);
  const [submitted, setSubmitted] = useState(false);

  function goToInicio() {
    router.replace({ pathname: INICIO_ROUTE });
  }

  // Round-1 P74 — shared re-entry guard so double-taps (or
  // tap-while-sibling-pending) don't spawn concurrent
  // DocumentPicker / launchCameraAsync invocations. Mirrors the
  // Início handlers' pattern (Story 2.1 R2-P59 + Story 2.2 P74).
  const isPickingRef = useRef(false);

  async function handlePick() {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const result = await pickDocuments();
      setPicked((prev) => [...prev, ...result.files]);
      // Review P44 — accumulate rejections across picks so the patient
      // doesn't lose context from an earlier batch when picking again.
      setRejected((prev) => [...prev, ...result.rejected]);
    } finally {
      isPickingRef.current = false;
    }
  }

  /**
   * Story 2.2 — F60 fix: wire the camera-capture path into the
   * onboarding screen. Library/PDF stays on the existing
   * "Escolher arquivos" button (DocumentPicker already accepts the
   * full mime allowlist); the new "Tirar foto" button funnels
   * through `pickImages({ source: 'camera' })` for single-capture
   * which gets appended to the same `picked` batch as the other
   * sources.
   */
  async function handlePickCamera() {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const result = await pickImages({ source: "camera" });
      setPicked((prev) => [...prev, ...result.files]);
      setRejected((prev) => [...prev, ...result.rejected]);
    } finally {
      isPickingRef.current = false;
    }
  }

  async function handleConfirm() {
    setSubmitted(true);
    const results = await uploadFiles(picked);
    // Review P45 — only auto-navigate when at least one file
    // successfully queued. If every upload failed, stay on the screen
    // with the failed rows highlighted so the patient can retry; the
    // "Fazer isso depois" button remains available to escape.
    const anySucceeded = results.some(
      (r) => r.status === "queued" || r.status === "skipped_duplicate",
    );
    if (anySucceeded) {
      goToInicio();
      return;
    }
    setSubmitted(false);
  }

  const canSubmit = picked.length > 0 && !isUploading && !submitted;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: IMPORT_TITLE_PT_BR }} />
      <ScrollView>
        <YStack padding="$4" gap="$3" backgroundColor="$backgroundPrimary">
          <Text
            fontFamily="$body"
            fontSize="$8"
            fontWeight="700"
            color="$textPrimary"
          >
            {IMPORT_TITLE_PT_BR}
          </Text>
          <Text fontFamily="$body" fontSize="$4" color="$textSecondary">
            {IMPORT_BODY_PT_BR}
          </Text>

          <Button onPress={handlePick} disabled={isUploading} variant="outline">
            {IMPORT_PICK_CTA_PT_BR}
          </Button>
          <Button
            onPress={handlePickCamera}
            disabled={isUploading}
            variant="outline"
          >
            {UPLOAD_SHEET_PHOTO_CAMERA_LABEL_PT_BR}
          </Button>

          {picked.length > 0 && (
            <YStack gap="$2" marginTop="$3">
              <Text fontFamily="$body" fontSize="$3" color="$textTertiary">
                Selecionados ({picked.length}):
              </Text>
              {picked.map((file) => {
                const progress: UploadFileResult | undefined =
                  progressByPath[file.uri];
                return (
                  <YStack key={file.uri} gap="$1" paddingVertical="$1">
                    <XStack justifyContent="space-between" alignItems="center">
                      <Text
                        fontFamily="$body"
                        fontSize="$3"
                        color="$textPrimary"
                        flex={1}
                        marginRight="$2"
                      >
                        {file.name}
                      </Text>
                      <Text
                        fontFamily="$body"
                        fontSize="$2"
                        color={
                          progress?.status === "failed"
                            ? "$biomarkerDeviation"
                            : "$textSecondary"
                        }
                      >
                        {progress?.status === "queued" ||
                        progress?.status === "skipped_duplicate"
                          ? UPLOAD_QUEUED_BADGE_PT_BR
                          : progress?.status === "uploading"
                            ? "Enviando…"
                            : progress?.status === "failed"
                              ? "Falhou"
                              : `${Math.round(file.size / 1024)} kB`}
                      </Text>
                    </XStack>
                    {progress?.status === "failed" && (
                      <Text
                        fontFamily="$body"
                        fontSize="$2"
                        color="$biomarkerDeviation"
                        accessibilityRole="alert"
                      >
                        {GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR}
                      </Text>
                    )}
                    <Separator />
                  </YStack>
                );
              })}
            </YStack>
          )}

          {rejected.length > 0 && (
            <YStack gap="$1" marginTop="$2">
              {rejected.map((file) => (
                <Text
                  key={file.uri}
                  fontFamily="$body"
                  fontSize="$2"
                  color="$biomarkerDeviation"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {file.name}: {file.validationError}
                </Text>
              ))}
            </YStack>
          )}

          <YStack gap="$2" marginTop="$4">
            <Button onPress={handleConfirm} disabled={!canSubmit}>
              {IMPORT_CONFIRM_CTA_PT_BR}
            </Button>
            <Button
              onPress={goToInicio}
              disabled={isUploading}
              variant="outline"
            >
              {IMPORT_SKIP_CTA_PT_BR}
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
