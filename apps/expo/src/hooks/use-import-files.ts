import { useCallback, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { UploadMimeType } from "@healthtracker/validators";
import {
  isUploadMimeType,
  PHOTO_LIBRARY_PERMISSION_PT_BR,
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_EMPTY_FILE_PT_BR,
  UPLOAD_FILE_TOO_LARGE_PT_BR,
  UPLOAD_MAX_BYTES,
  UPLOAD_UNSUPPORTED_MIME_PT_BR,
} from "@healthtracker/validators";

import { trpcClient } from "~/utils/api";

/**
 * Story 1.5 — Expo file-import hook. Wraps `expo-document-picker` (PDF)
 * and `expo-image-picker` (JPEG/PNG/HEIC) with the two-step
 * `requestImport` → PUT-to-signed-URL → `confirmImport` flow.
 *
 * Per-file validation happens client-side BEFORE the `requestImport`
 * call so the server doesn't have to count invalid attempts. The
 * server validates again (the Zod schemas in validators) — belt and
 * suspenders against a hostile client.
 *
 * Errors are surfaced per-file via the `progressByPath` map; one bad
 * file does not abort the others.
 */

export type FileImportStatus =
  | "pending"
  | "uploading"
  | "queued"
  | "skipped_duplicate"
  | "failed";

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: UploadMimeType;
  size: number;
}

export interface PickedFileWithError {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  validationError: string;
}

export interface PickResult {
  files: PickedFile[];
  rejected: PickedFileWithError[];
}

export interface UploadFileResult {
  uri: string;
  name: string;
  status: FileImportStatus;
  uploadId?: string;
  errorMessage?: string;
}

function inferMimeFromExtension(name: string): string | undefined {
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "heic":
      return "image/heic";
    default:
      return undefined;
  }
}

function validatePicked(file: {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}): PickedFile | PickedFileWithError {
  if (file.size <= 0) {
    return { ...file, validationError: UPLOAD_EMPTY_FILE_PT_BR };
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    return { ...file, validationError: UPLOAD_FILE_TOO_LARGE_PT_BR };
  }
  if (!isUploadMimeType(file.mimeType)) {
    return { ...file, validationError: UPLOAD_UNSUPPORTED_MIME_PT_BR };
  }
  return {
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
  };
}

export function useImportFiles() {
  const [isUploading, setIsUploading] = useState(false);
  const [progressByPath, setProgressByPath] = useState<
    Record<string, UploadFileResult>
  >({});

  /**
   * Opens the document picker (PDFs). Returns normalized `PickedFile`s
   * for files that pass client-side validation, plus a list of rejected
   * picks with localized error messages.
   */
  const pickDocuments = useCallback(async (): Promise<PickResult> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: UPLOAD_ALLOWED_MIME_TYPES.slice(), // PDF + image mime types
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return { files: [], rejected: [] };
    const files: PickedFile[] = [];
    const rejected: PickedFileWithError[] = [];
    for (const asset of result.assets) {
      const candidate = {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? inferMimeFromExtension(asset.name) ?? "",
        size: asset.size ?? 0,
      };
      const validated = validatePicked(candidate);
      if ("validationError" in validated) rejected.push(validated);
      else files.push(validated);
    }
    return { files, rejected };
  }, []);

  /**
   * Opens the image picker (JPEG/PNG/HEIC from photo library).
   * Granular permission prompt handled by `expo-image-picker`.
   */
  const pickImages = useCallback(async (): Promise<PickResult> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      // Review P43 — surface the denied permission instead of silently
      // returning empty. The screen renders rejections in the same row
      // as validation errors, so the patient sees an actionable
      // explanation.
      return {
        files: [],
        rejected: [
          {
            uri: "permission-denied",
            name: "",
            mimeType: "",
            size: 0,
            validationError: PHOTO_LIBRARY_PERMISSION_PT_BR,
          },
        ],
      };
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled) return { files: [], rejected: [] };
    const files: PickedFile[] = [];
    const rejected: PickedFileWithError[] = [];
    for (const asset of result.assets) {
      const candidate = {
        uri: asset.uri,
        name: asset.fileName ?? `image-${Date.now()}.jpg`,
        mimeType:
          asset.mimeType ??
          inferMimeFromExtension(asset.fileName ?? "") ??
          "image/jpeg",
        size: asset.fileSize ?? 0,
      };
      const validated = validatePicked(candidate);
      if ("validationError" in validated) rejected.push(validated);
      else files.push(validated);
    }
    return { files, rejected };
  }, []);

  /**
   * Two-step upload per file: requestImport → PUT to signed URL →
   * confirmImport. Per-file failure does not abort the batch.
   */
  const uploadFiles = useCallback(
    async (files: PickedFile[]): Promise<UploadFileResult[]> => {
      setIsUploading(true);
      const results: UploadFileResult[] = [];
      try {
        for (const file of files) {
          setProgressByPath((prev) => ({
            ...prev,
            [file.uri]: { uri: file.uri, name: file.name, status: "uploading" },
          }));
          try {
            const req = await trpcClient.uploads.requestImport.mutate({
              originalFilename: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.size,
            });
            // Stream the file bytes to the signed upload URL. RN's
            // `fetch` accepts a `{ uri }` body shape via the
            // `react-native` polyfill; alternatively, we'd read the
            // file via `FileSystem.uploadAsync`. Using fetch keeps
            // dependencies minimal — `expo-file-system` is not yet a
            // dep and this story doesn't justify adding it.
            const fileResponse = await fetch(file.uri);
            const blob = await fileResponse.blob();
            const putResponse = await fetch(req.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": file.mimeType },
              body: blob,
            });
            if (!putResponse.ok) {
              throw new Error(
                `storage PUT failed: ${putResponse.status} ${putResponse.statusText}`,
              );
            }
            // Review P38 — server re-derives the storagePath from
            // (patientId, idempotencyKey, sanitizedFilename). We no
            // longer send it back; trusting the client's echo was the
            // forgery vector.
            const confirm = await trpcClient.uploads.confirmImport.mutate({
              idempotencyKey: req.idempotencyKey,
              originalFilename: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.size,
            });
            const status: FileImportStatus = confirm.created
              ? "queued"
              : "skipped_duplicate";
            const result: UploadFileResult = {
              uri: file.uri,
              name: file.name,
              status,
            };
            if (confirm.uploadId !== null) {
              result.uploadId = confirm.uploadId;
            }
            results.push(result);
            setProgressByPath((prev) => ({ ...prev, [file.uri]: result }));
          } catch (err) {
            const result: UploadFileResult = {
              uri: file.uri,
              name: file.name,
              status: "failed",
              errorMessage:
                err instanceof Error ? err.message : "unknown error",
            };
            results.push(result);
            setProgressByPath((prev) => ({ ...prev, [file.uri]: result }));
          }
        }
        return results;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return {
    pickDocuments,
    pickImages,
    uploadFiles,
    isUploading,
    progressByPath,
  };
}
