import { useCallback, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { UploadMimeType, UploadSource } from "@healthtracker/validators";
import {
  countPdfPages,
  isUploadMimeType,
  PHOTO_LIBRARY_PERMISSION_PT_BR,
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_EMPTY_FILE_PT_BR,
  UPLOAD_FILE_TOO_LARGE_PT_BR,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PDF_PAGES,
  UPLOAD_PDF_TOO_MANY_PAGES_PT_BR,
  UPLOAD_PDF_UNREADABLE_PT_BR,
  UPLOAD_UNSUPPORTED_MIME_PT_BR,
} from "@healthtracker/validators";

import { trpcClient } from "~/utils/api";

/**
 * Story 1.5 — Expo file-import hook. Wraps `expo-document-picker` (PDF)
 * and `expo-image-picker` (JPEG/PNG/HEIC) with the two-step
 * `requestImport` → PUT-to-signed-URL → `confirmImport` flow.
 *
 * Story 2.1 — adds:
 *   - required `source` so `'onboarding_import'` vs `'post_onboarding'`
 *     audit/analytics rows are unambiguous (no default — Story 1.5 P46
 *     pattern).
 *   - optional `pickDocumentsAccept` to narrow the picker mime types
 *     (the post-onboarding sheet picks PDF only; the onboarding screen
 *     passes the full allowed list).
 *   - pre-transmission PDF page-count gate (AC4) — oversize PDFs are
 *     rejected by the picker; no signed URL is minted.
 *   - `startedAtByPath` so the ExtractionPulse can compute elapsedMs.
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
  /**
   * Story 2.1 — page count for `application/pdf` files. Populated by
   * `pickDocuments` after `countPdfPages` succeeds; undefined for
   * non-PDFs. Threaded through both tRPC mutations so the server can
   * defense-in-depth re-check.
   */
  pageCount?: number;
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

export interface UseImportFilesOptions {
  source: UploadSource;
  pickDocumentsAccept?: readonly UploadMimeType[];
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

/**
 * Story 2.1 AC4 — PDF page-count gate. Fetches the file bytes from the
 * picker URI, counts pages via `pdf-lib`, and converts the result into
 * either a per-file `pageCount` field (passes) or a `validationError`
 * (rejects). Runs only for `application/pdf` — other mime types pass
 * through unchanged. Pre-transmission: this happens BEFORE the
 * `requestImport` mutation so no signed URL is minted for oversize PDFs.
 *
 * Failure to fetch / parse the PDF is treated as a hard reject — a
 * file we can't read is a file we shouldn't enqueue extraction for.
 */
async function applyPageCountGate(
  file: PickedFile,
): Promise<PickedFile | PickedFileWithError> {
  if (file.mimeType !== "application/pdf") return file;
  let pageCount: number;
  try {
    const response = await fetch(file.uri);
    // Round-2 R2-P68 — guard against a non-OK response (404 / HTML
    // error body) silently flowing into `pdf-lib.load`. Without
    // this, the patient is blamed for an "unreadable PDF" when the
    // real failure was an upstream fetch error.
    if (!response.ok) {
      throw new Error(`picker-fetch-failed: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    pageCount = await countPdfPages(bytes);
  } catch {
    // Story 2.1 P54 — fetch / parse / encrypted PDF failures surface
    // as "unreadable" instead of being blamed on the page cap.
    return {
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      validationError: UPLOAD_PDF_UNREADABLE_PT_BR,
    };
  }
  // Round-2 R2-P67 — `ignoreEncryption: true` (P60) lets encrypted
  // PDFs report a page count, and `pdf-lib` can return 0 for some
  // malformed structures. A 0-page PDF is "unreadable" from the
  // extraction worker's perspective; treat it as such instead of
  // letting it pass the gate (0 > 10 is false).
  if (pageCount <= 0) {
    return {
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      validationError: UPLOAD_PDF_UNREADABLE_PT_BR,
    };
  }
  if (pageCount > UPLOAD_MAX_PDF_PAGES) {
    return {
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      validationError: UPLOAD_PDF_TOO_MANY_PAGES_PT_BR,
    };
  }
  return { ...file, pageCount };
}

export function useImportFiles(options: UseImportFilesOptions) {
  const { source, pickDocumentsAccept } = options;
  const [isUploading, setIsUploading] = useState(false);
  const [progressByPath, setProgressByPath] = useState<
    Record<string, UploadFileResult>
  >({});
  /**
   * Story 2.1 — start-time per file (ms epoch) for the ExtractionPulse
   * patience-pattern copy. Set on the first transition into `uploading`;
   * the ExtractionPulse renderer computes
   * `elapsedMs = Date.now() - startedAtByPath[uri]`.
   */
  const [startedAtByPath, setStartedAtByPath] = useState<
    Record<string, number>
  >({});

  /**
   * Opens the document picker (PDFs by default; the caller can narrow
   * via `pickDocumentsAccept`). Returns normalized `PickedFile`s for
   * files that pass client-side validation, plus a list of rejected
   * picks with localized error messages.
   */
  const pickDocuments = useCallback(async (): Promise<PickResult> => {
    const accept = pickDocumentsAccept ?? UPLOAD_ALLOWED_MIME_TYPES;
    const result = await DocumentPicker.getDocumentAsync({
      type: accept.slice(),
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
      if ("validationError" in validated) {
        rejected.push(validated);
        continue;
      }
      // Story 2.1 AC4 — PDF page-count gate runs pre-transmission so
      // oversize PDFs never reach `requestImport`.
      const gated = await applyPageCountGate(validated);
      if ("validationError" in gated) rejected.push(gated);
      else files.push(gated);
    }
    return { files, rejected };
  }, [pickDocumentsAccept]);

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
          const startedAt = Date.now();
          setStartedAtByPath((prev) => ({ ...prev, [file.uri]: startedAt }));
          setProgressByPath((prev) => ({
            ...prev,
            [file.uri]: { uri: file.uri, name: file.name, status: "uploading" },
          }));
          // Story 2.1 P55 — clear the started-at entry after the file
          // finishes (success OR failure). The map would otherwise grow
          // unbounded across sessions; a reused picker URI would also
          // pollute future `earliestStart` derivations on Início.
          const cleanupStartedAt = () =>
            setStartedAtByPath((prev) => {
              const next = { ...prev };
              delete next[file.uri];
              return next;
            });
          try {
            const req = await trpcClient.uploads.requestImport.mutate({
              originalFilename: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.size,
              source,
              ...(file.pageCount !== undefined
                ? { pageCount: file.pageCount }
                : {}),
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
              source,
              ...(file.pageCount !== undefined
                ? { pageCount: file.pageCount }
                : {}),
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
          } finally {
            cleanupStartedAt();
          }
        }
        return results;
      } finally {
        setIsUploading(false);
      }
    },
    [source],
  );

  return {
    pickDocuments,
    pickImages,
    uploadFiles,
    isUploading,
    progressByPath,
    startedAtByPath,
  };
}
