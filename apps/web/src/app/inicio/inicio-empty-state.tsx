"use client";

import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import type { UploadMimeType } from "@healthtracker/validators";
import { EmptyStateRecord, ExtractionPulse } from "@healthtracker/ui";
import { UploadSourceSheet } from "@healthtracker/ui/upload-source-sheet";
import {
  countPdfPages,
  INICIO_CTA_PT_BR,
  INICIO_HEADLINE_PT_BR,
  isUploadMimeType,
  UPLOAD_EMPTY_FILE_PT_BR,
  UPLOAD_FILE_TOO_LARGE_PT_BR,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PDF_PAGES,
  UPLOAD_PDF_TOO_MANY_PAGES_PT_BR,
  UPLOAD_PDF_UNREADABLE_PT_BR,
  UPLOAD_UNSUPPORTED_MIME_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

interface ActiveUpload {
  /** Story 2.1 P53 — synthetic id so duplicate filenames don't collide. */
  id: string;
  name: string;
  startedAt: number;
}

interface UploadOutcome {
  status: "queued" | "skipped_duplicate" | "failed" | "rejected";
  error?: string;
  name: string;
}

function validateClientSide(file: File): string | null {
  if (file.size <= 0) return UPLOAD_EMPTY_FILE_PT_BR;
  if (file.size > UPLOAD_MAX_BYTES) return UPLOAD_FILE_TOO_LARGE_PT_BR;
  // Story 2.2 — widened from PDF-only to the full allowlist (PDF +
  // JPEG/PNG/HEIC). Image flows route through the same request/
  // confirm pipeline; the page-count gate (`gatePdfPageCount`)
  // short-circuits for non-PDF mime types.
  if (!isUploadMimeType(file.type)) return UPLOAD_UNSUPPORTED_MIME_PT_BR;
  return null;
}

async function gatePdfPageCount(
  file: File,
): Promise<{ pageCount: number } | { error: string }> {
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
  // extraction worker's perspective; treat it as such instead of
  // letting it pass the gate (0 > 10 is false).
  if (pageCount <= 0) {
    return { error: UPLOAD_PDF_UNREADABLE_PT_BR };
  }
  if (pageCount > UPLOAD_MAX_PDF_PAGES) {
    return { error: UPLOAD_PDF_TOO_MANY_PAGES_PT_BR };
  }
  return { pageCount };
}

export function InicioEmptyState() {
  const trpc = useTRPC();
  const requestImport = useMutation(
    trpc.uploads.requestImport.mutationOptions(),
  );
  const confirmImport = useMutation(
    trpc.uploads.confirmImport.mutationOptions(),
  );
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Story 2.2 — separate `<input>`s for each source so the `accept`
  // and `capture` attributes can differ. The PDF input restricts to
  // PDF; the library input accepts any image mime; the camera input
  // adds `capture="environment"` so mobile browsers open the camera.
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Story 2.1 P59 — re-entry guard so a double-tap on a sheet CTA
  // can't open two native pickers / fire two `handleFileInput`
  // batches concurrently. Shared across all three sources.
  const isPickingRef = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [active, setActive] = useState<ActiveUpload[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [lastOutcomes, setLastOutcomes] = useState<UploadOutcome[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (ev: MediaQueryListEvent) => setReducedMotion(ev.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (active.length === 0) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active.length]);

  function openPicker(input: HTMLInputElement | null) {
    // Story 2.1 P59 — drop the second tap if a picker is already open.
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    setSheetOpen(false);
    if (!input) {
      isPickingRef.current = false;
      return;
    }
    // Round-2 R2-P65 — the native file `change` event does NOT fire
    // when the user cancels the picker dialog, so a `change`-only
    // reset leaves `isPickingRef.current === true` forever and every
    // subsequent CTA tap is silently dropped. Wire the `cancel`
    // event (supported on modern browsers) AND fall back to a
    // window-focus listener for older Safari versions.
    const reset = () => {
      isPickingRef.current = false;
    };
    input.addEventListener("cancel", reset, { once: true });
    const onFocus = () => {
      // Brief delay so the `change` handler runs first if a file was
      // actually picked.
      window.setTimeout(reset, 250);
      window.removeEventListener("focus", onFocus);
    };
    window.addEventListener("focus", onFocus);
    input.click();
  }

  function openPdfPicker() {
    openPicker(pdfInputRef.current);
  }
  function openLibraryPicker() {
    openPicker(libraryInputRef.current);
  }
  function openCameraPicker() {
    openPicker(cameraInputRef.current);
  }

  async function handleFileInput(ev: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? []);
    ev.target.value = "";
    // Reset the picker guard now that the browser-side picker dialog
    // is closed (regardless of whether files were chosen).
    isPickingRef.current = false;
    if (files.length === 0) return;
    const outcomes: UploadOutcome[] = [];
    for (const file of files) {
      const validationError = validateClientSide(file);
      if (validationError) {
        outcomes.push({
          status: "rejected",
          error: validationError,
          name: file.name,
        });
        continue;
      }
      const gate = await gatePdfPageCount(file);
      if ("error" in gate) {
        outcomes.push({
          status: "rejected",
          error: gate.error,
          name: file.name,
        });
        continue;
      }
      // Story 2.1 P53 + Round-2 R2-P66 — synthetic per-upload id via
      // `crypto.randomUUID()` (collision-free) so two files sharing
      // a name don't trip `setActive(... filter !== name)`.
      const id = crypto.randomUUID();
      const startedAt = Date.now();
      setActive((prev) => [...prev, { id, name: file.name, startedAt }]);
      try {
        const req = await requestImport.mutateAsync({
          originalFilename: file.name,
          mimeType: file.type as UploadMimeType,
          sizeBytes: file.size,
          source: "post_onboarding",
          pageCount: gate.pageCount,
        });
        const put = await fetch(req.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!put.ok) throw new Error(`storage PUT ${put.status}`);
        const confirm = await confirmImport.mutateAsync({
          idempotencyKey: req.idempotencyKey,
          originalFilename: file.name,
          mimeType: file.type as UploadMimeType,
          sizeBytes: file.size,
          source: "post_onboarding",
          pageCount: gate.pageCount,
        });
        outcomes.push({
          status: confirm.created ? "queued" : "skipped_duplicate",
          name: file.name,
        });
      } catch (err) {
        outcomes.push({
          status: "failed",
          name: file.name,
          error: err instanceof Error ? err.message : "unknown error",
        });
      } finally {
        setActive((prev) => prev.filter((a) => a.id !== id));
      }
    }
    setLastOutcomes(outcomes);
  }

  const earliestStart = active.reduce<number | undefined>((min, a) => {
    return min === undefined || a.startedAt < min ? a.startedAt : min;
  }, undefined);
  const elapsedMs =
    earliestStart !== undefined ? Math.max(0, nowTick - earliestStart) : 0;

  return (
    <>
      {active.length > 0 ? (
        <ExtractionPulse
          state="processing"
          filenames={active.map((a) => a.name)}
          elapsedMs={elapsedMs}
          reducedMotion={reducedMotion}
        />
      ) : null}
      <EmptyStateRecord
        headline={INICIO_HEADLINE_PT_BR}
        ctaLabel={INICIO_CTA_PT_BR}
        onCtaPress={() => setSheetOpen(true)}
      />
      {lastOutcomes.length > 0 ? (
        <ul aria-live="polite" className="mt-4 space-y-1 text-xs">
          {lastOutcomes.map((o, idx) => (
            <li
              key={`${o.name}-${idx}`}
              className={
                o.status === "rejected" || o.status === "failed"
                  ? "text-amber-700"
                  : "text-stone-600"
              }
            >
              {o.name}
              {o.error ? `: ${o.error}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {/*
        Story 2.2 — three internal-plumbing `<input>`s, one per
        source. All hidden from keyboard + screen reader (R2-P71);
        the visible CTAs are the sheet rows.
      */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(ev) => {
          void handleFileInput(ev);
        }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(ev) => {
          void handleFileInput(ev);
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif"
        // `capture="environment"` triggers the device camera on
        // mobile browsers (iOS Safari + Android Chrome). Desktop
        // browsers ignore it and fall back to the file picker —
        // documented in the sheet's accessibilityHint.
        capture="environment"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(ev) => {
          void handleFileInput(ev);
        }}
      />
      <UploadSourceSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onPickPdf={openPdfPicker}
        onPickImageFromLibrary={openLibraryPicker}
        onPickImageFromCamera={openCameraPicker}
        pdfDisabled={active.length > 0}
        photoDisabled={active.length > 0}
        cameraHintIsWeb
      />
    </>
  );
}
