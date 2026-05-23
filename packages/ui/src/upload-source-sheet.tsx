"use client";

import { Sheet, Text, YStack } from "tamagui";

import {
  UPLOAD_SHEET_CANCEL_PT_BR,
  UPLOAD_SHEET_PDF_LABEL_PT_BR,
  UPLOAD_SHEET_PHOTO_CAMERA_HINT_PT_BR,
  UPLOAD_SHEET_PHOTO_CAMERA_HINT_WEB_PT_BR,
  UPLOAD_SHEET_PHOTO_CAMERA_LABEL_PT_BR,
  UPLOAD_SHEET_PHOTO_LIBRARY_HINT_PT_BR,
  UPLOAD_SHEET_PHOTO_LIBRARY_LABEL_PT_BR,
  UPLOAD_SHEET_TITLE_PT_BR,
} from "@healthtracker/validators";

import { Button } from "./button";

/**
 * Story 2.1 / 2.2 — post-onboarding upload source picker.
 *
 * Three rows (Story 2.2): "Arquivo PDF", "Foto da galeria", and
 * "Tirar foto". Story 2.1 shipped this sheet with the photo branch as
 * a single disabled "Em breve" row; Story 2.2 splits it into two
 * active rows and removes the stub.
 *
 * The photo rows are visible-and-active only when the matching
 * callback prop is supplied — so onboarding consumers can stay
 * PDF-only by omitting them.
 *
 * Implemented as a Tamagui `Sheet` which renders as a bottom sheet on
 * Expo and as a modal on Web (Tamagui handles the platform mapping).
 */

export interface UploadSourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickPdf: () => void;
  pdfDisabled?: boolean;
  /** Story 2.2 — when provided, renders the "Foto da galeria" row. */
  onPickImageFromLibrary?: () => void;
  /** Story 2.2 — when provided, renders the "Tirar foto" row. */
  onPickImageFromCamera?: () => void;
  /** Story 2.2 — disables the photo rows while an upload is in flight. */
  photoDisabled?: boolean;
  /**
   * Story 2.2 — the web camera-capture row uses `<input capture>`,
   * which falls back to the file picker on desktop. The hint text
   * differs accordingly. Caller-supplied so the component stays
   * platform-agnostic.
   */
  cameraHintIsWeb?: boolean;
}

export function UploadSourceSheet({
  open,
  onOpenChange,
  onPickPdf,
  pdfDisabled,
  onPickImageFromLibrary,
  onPickImageFromCamera,
  photoDisabled,
  cameraHintIsWeb,
}: UploadSourceSheetProps) {
  return (
    <Sheet
      modal
      open={open}
      onOpenChange={onOpenChange}
      snapPointsMode="fit"
      dismissOnSnapToBottom
      animation="medium"
    >
      <Sheet.Overlay
        animation="medium"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <Sheet.Handle />
      <Sheet.Frame
        padding="$4"
        gap="$3"
        backgroundColor="$surfaceElevated"
        accessibilityRole="menu"
      >
        <Text
          fontFamily="$body"
          fontSize="$6"
          fontWeight="700"
          color="$textPrimary"
        >
          {UPLOAD_SHEET_TITLE_PT_BR}
        </Text>
        <YStack gap="$2">
          <Button
            onPress={onPickPdf}
            disabled={pdfDisabled}
            accessibilityRole="button"
          >
            {UPLOAD_SHEET_PDF_LABEL_PT_BR}
          </Button>
          {onPickImageFromLibrary ? (
            <Button
              variant="outline"
              onPress={onPickImageFromLibrary}
              disabled={photoDisabled}
              accessibilityRole="button"
              accessibilityHint={UPLOAD_SHEET_PHOTO_LIBRARY_HINT_PT_BR}
            >
              {UPLOAD_SHEET_PHOTO_LIBRARY_LABEL_PT_BR}
            </Button>
          ) : null}
          {onPickImageFromCamera ? (
            <Button
              variant="outline"
              onPress={onPickImageFromCamera}
              disabled={photoDisabled}
              accessibilityRole="button"
              accessibilityHint={
                cameraHintIsWeb
                  ? UPLOAD_SHEET_PHOTO_CAMERA_HINT_WEB_PT_BR
                  : UPLOAD_SHEET_PHOTO_CAMERA_HINT_PT_BR
              }
            >
              {UPLOAD_SHEET_PHOTO_CAMERA_LABEL_PT_BR}
            </Button>
          ) : null}
          <Button variant="ghost" onPress={() => onOpenChange(false)}>
            {UPLOAD_SHEET_CANCEL_PT_BR}
          </Button>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  );
}
