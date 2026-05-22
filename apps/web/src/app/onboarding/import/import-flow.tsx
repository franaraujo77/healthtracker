"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import type { UploadMimeType, UploadSource } from "@healthtracker/validators";
import { Button } from "@healthtracker/ui/button";
import {
  countPdfPages,
  GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR,
  IMPORT_BODY_PT_BR,
  IMPORT_CONFIRM_CTA_PT_BR,
  IMPORT_PICK_CTA_PT_BR,
  IMPORT_SKIP_CTA_PT_BR,
  IMPORT_TITLE_PT_BR,
  INICIO_ROUTE,
  isUploadMimeType,
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_EMPTY_FILE_PT_BR,
  UPLOAD_FILE_TOO_LARGE_PT_BR,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PDF_PAGES,
  UPLOAD_PDF_TOO_MANY_PAGES_PT_BR,
  UPLOAD_PDF_UNREADABLE_PT_BR,
  UPLOAD_QUEUED_BADGE_PT_BR,
  UPLOAD_UNSUPPORTED_MIME_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

type PickedFileStatus =
  | "pending"
  | "uploading"
  | "queued"
  | "skipped_duplicate"
  | "failed";

interface PickedFile {
  file: File;
  status: PickedFileStatus;
  errorMessage?: string;
  /** Story 2.1 — populated for PDFs by `validateClientSide`. */
  pageCount?: number;
}

function validateClientSide(file: File): string | null {
  if (file.size <= 0) return UPLOAD_EMPTY_FILE_PT_BR;
  if (file.size > UPLOAD_MAX_BYTES) return UPLOAD_FILE_TOO_LARGE_PT_BR;
  if (!isUploadMimeType(file.type)) return UPLOAD_UNSUPPORTED_MIME_PT_BR;
  return null;
}

/**
 * Story 2.1 AC4 — PDF page-count gate. Runs after `validateClientSide`
 * for `application/pdf` files. Returns either the page count (passes)
 * or the pt-BR error string (rejects). Failure to parse is treated as
 * a hard reject. Non-PDF mime types return `null` (no gate applies).
 */
async function gatePdfPageCount(
  file: File,
): Promise<{ pageCount: number } | { error: string } | null> {
  if (file.type !== "application/pdf") return null;
  let pageCount: number;
  try {
    const bytes = await file.arrayBuffer();
    pageCount = await countPdfPages(bytes);
  } catch {
    // Story 2.1 P54 — fetch / parse / encrypted PDF failures surface
    // as "unreadable" instead of being blamed on the page cap.
    return { error: UPLOAD_PDF_UNREADABLE_PT_BR };
  }
  // Round-2 R2-P67 — `ignoreEncryption: true` (P60) lets encrypted
  // PDFs report a page count, and `pdf-lib` can return 0 for some
  // malformed structures. A 0-page PDF is "unreadable" from the
  // extraction worker's perspective.
  if (pageCount <= 0) {
    return { error: UPLOAD_PDF_UNREADABLE_PT_BR };
  }
  if (pageCount > UPLOAD_MAX_PDF_PAGES) {
    return { error: UPLOAD_PDF_TOO_MANY_PAGES_PT_BR };
  }
  return { pageCount };
}

/**
 * Story 2.1 — `source` is required, no default. The onboarding page
 * passes `'onboarding_import'`; future post-onboarding consumers pass
 * `'post_onboarding'`.
 */
export interface ImportFlowProps {
  source: UploadSource;
}

export function ImportFlow({ source }: ImportFlowProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const requestImport = useMutation(
    trpc.uploads.requestImport.mutationOptions(),
  );
  const confirmImport = useMutation(
    trpc.uploads.confirmImport.mutationOptions(),
  );
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>(
    [],
  );
  const [isUploading, setIsUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function goToInicio() {
    router.replace(INICIO_ROUTE);
  }

  async function handleFileInput(ev: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? []);
    const valid: PickedFile[] = [];
    const bad: { name: string; reason: string }[] = [];
    for (const file of files) {
      const err = validateClientSide(file);
      if (err) {
        bad.push({ name: file.name, reason: err });
        continue;
      }
      // Story 2.1 AC4 — PDF page-count gate runs pre-transmission so
      // oversize PDFs never reach `requestImport`.
      const gate = await gatePdfPageCount(file);
      if (gate && "error" in gate) {
        bad.push({ name: file.name, reason: gate.error });
        continue;
      }
      const picked: PickedFile = { file, status: "pending" };
      if (gate && "pageCount" in gate) {
        picked.pageCount = gate.pageCount;
      }
      valid.push(picked);
    }
    setPicked((prev) => [...prev, ...valid]);
    // Review P44 — accumulate rejections across picks (matches the
    // `picked` accumulation pattern; the prior code overwrote earlier
    // rejections silently).
    setRejected((prev) => [...prev, ...bad]);
    // Reset the input so the same file can be re-picked after a remove.
    ev.target.value = "";
  }

  async function uploadOne(
    item: PickedFile,
    index: number,
  ): Promise<PickedFileStatus> {
    setPicked((prev) =>
      prev.map((p, i) => (i === index ? { ...p, status: "uploading" } : p)),
    );
    try {
      const req = await requestImport.mutateAsync({
        originalFilename: item.file.name,
        mimeType: item.file.type as UploadMimeType,
        sizeBytes: item.file.size,
        source,
        ...(item.pageCount !== undefined ? { pageCount: item.pageCount } : {}),
      });
      const putResponse = await fetch(req.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": item.file.type },
        body: item.file,
      });
      if (!putResponse.ok) {
        throw new Error(`storage PUT failed: ${putResponse.status}`);
      }
      // Review P38 — `storagePath` is now derived server-side, not
      // echoed by the client.
      const confirm = await confirmImport.mutateAsync({
        idempotencyKey: req.idempotencyKey,
        originalFilename: item.file.name,
        mimeType: item.file.type as UploadMimeType,
        sizeBytes: item.file.size,
        source,
        ...(item.pageCount !== undefined ? { pageCount: item.pageCount } : {}),
      });
      const next: PickedFileStatus = confirm.created
        ? "queued"
        : "skipped_duplicate";
      setPicked((prev) =>
        prev.map((p, i) => (i === index ? { ...p, status: next } : p)),
      );
      return next;
    } catch (err) {
      setPicked((prev) =>
        prev.map((p, i) =>
          i === index
            ? {
                ...p,
                status: "failed",
                errorMessage:
                  err instanceof Error ? err.message : "unknown error",
              }
            : p,
        ),
      );
      return "failed";
    }
  }

  async function handleConfirm() {
    setSubmitted(true);
    setIsUploading(true);
    // Round-2 P50 — collect per-file outcomes in a local array and
    // decide navigation from that. The prior version read state
    // inside a `setPicked(current => ...)` updater and called
    // `router.replace` as a side effect, which fires twice under
    // React 18 StrictMode (updaters run twice in dev). Mirrors the
    // Expo flow's local-`results` pattern.
    const results: PickedFileStatus[] = [];
    try {
      // Sequential to keep server transaction pressure even — a parallel
      // burst of 5 simultaneous protectedProcedure transactions can
      // tip the Supabase session-mode pool.
      for (let i = 0; i < picked.length; i += 1) {
        const item = picked[i];
        if (!item) continue;
        results.push(await uploadOne(item, i));
      }
    } finally {
      setIsUploading(false);
    }
    // Review P45 — only auto-navigate when at least one file
    // succeeded. Otherwise stay on the screen with the failed rows
    // highlighted so the patient can retry; "Fazer isso depois"
    // remains available as an escape.
    const anySucceeded = results.some(
      (s) => s === "queued" || s === "skipped_duplicate",
    );
    if (anySucceeded) {
      goToInicio();
    } else {
      setSubmitted(false);
    }
  }

  const canSubmit = picked.length > 0 && !isUploading && !submitted;

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{IMPORT_TITLE_PT_BR}</h1>
      </header>
      <p className="text-base leading-relaxed">{IMPORT_BODY_PT_BR}</p>

      <div>
        <label
          htmlFor="lab-uploads-input"
          className="inline-flex cursor-pointer items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-stone-50"
        >
          {IMPORT_PICK_CTA_PT_BR}
        </label>
        <input
          id="lab-uploads-input"
          type="file"
          multiple
          className="sr-only"
          accept={UPLOAD_ALLOWED_MIME_TYPES.join(",")}
          onChange={handleFileInput}
          disabled={isUploading}
        />
      </div>

      {picked.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {picked.map((item, idx) => (
            <li
              key={`${item.file.name}-${idx}`}
              className="flex items-start justify-between px-4 py-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{item.file.name}</span>
                {item.status === "failed" && (
                  <span role="alert" className="text-xs text-amber-700">
                    {GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR}
                  </span>
                )}
              </div>
              <span className="text-xs text-stone-500">
                {item.status === "queued" || item.status === "skipped_duplicate"
                  ? UPLOAD_QUEUED_BADGE_PT_BR
                  : item.status === "uploading"
                    ? "Enviando…"
                    : item.status === "failed"
                      ? "Falhou"
                      : `${Math.round(item.file.size / 1024)} kB`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {rejected.length > 0 ? (
        <ul className="space-y-1">
          {rejected.map((r, idx) => (
            <li
              key={`rej-${idx}`}
              role="alert"
              className="text-xs text-amber-700"
            >
              {r.name}: {r.reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onPress={goToInicio} disabled={isUploading}>
          {IMPORT_SKIP_CTA_PT_BR}
        </Button>
        <Button onPress={handleConfirm} disabled={!canSubmit}>
          {IMPORT_CONFIRM_CTA_PT_BR}
        </Button>
      </div>
    </article>
  );
}
