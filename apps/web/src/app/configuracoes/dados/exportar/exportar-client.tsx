"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";

import type { ExportFormat } from "@healthtracker/validators";
import {
  EXPORT_DOWNLOAD_BUTTON_PT_BR,
  EXPORT_EXPIRED_PT_BR,
  EXPORT_FAILED_PT_BR,
  EXPORT_FORMAT_GROUP_A11Y_PT_BR,
  EXPORT_FORMAT_OPTIONS,
  EXPORT_POLL_INTERVAL_MS,
  EXPORT_POLL_TIMEOUT_MS,
  EXPORT_PROGRESS_PT_BR,
  EXPORT_READY_PT_BR,
  EXPORT_RETRY_BUTTON_PT_BR,
  EXPORT_SCREEN_BODY_PT_BR,
  EXPORT_SCREEN_TITLE_PT_BR,
  EXPORT_STUCK_BUTTON_PT_BR,
  EXPORT_STUCK_PT_BR,
  EXPORT_SUBMIT_A11Y_PT_BR_FN,
  EXPORT_SUBMIT_BUTTON_PT_BR,
  exportFilename,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

/**
 * Story 5.5 — web parity client for the Expo export screen. URL
 * query param `?exportId=…` persists in-flight state across reload
 * (web's equivalent of the Expo AsyncStorage resume seam).
 *
 * Anti-pattern enforcement (CLAUDE.md): the signed URL is NEVER
 * cached — every "Baixar" tap re-runs the polling query so a stale
 * (1h TTL) URL gets rotated.
 *
 * Tailwind classes mirror the Story 2.8 `notificacoes-client.tsx`
 * shape — no Tamagui on the web settings surfaces.
 */
export function ExportarClient(): React.ReactElement {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryExportId = searchParams.get("exportId");

  const [format, setFormat] = useState<ExportFormat>("json");
  const [exportId, setExportId] = useState<string | null>(queryExportId);
  const [downloadInFlight, setDownloadInFlight] = useState(false);
  // Story 5.5 review-fix Decision C — 5-min client-side polling
  // timeout anchor. See Expo screen for shape rationale.
  const pollStartAtRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(0);

  // Sync URL query param ⇄ state.
  useEffect(() => {
    if (queryExportId !== exportId) {
      setExportId(queryExportId);
    }
    // Intentionally one-way: URL is the source of truth on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryExportId]);

  const requestMutation = useMutation(
    trpc.sharing.requestExport.mutationOptions({
      onSuccess: (data) => {
        setExportId(data.exportId);
        pollStartAtRef.current = Date.now();
        const next = new URLSearchParams(searchParams.toString());
        next.set("exportId", data.exportId);
        router.replace(`?${next.toString()}`);
      },
    }),
  );

  // Anchor `pollStartAt` on URL-resumed exports too.
  useEffect(() => {
    if (exportId !== null && pollStartAtRef.current === null) {
      pollStartAtRef.current = Date.now();
    }
  }, [exportId]);

  const pollQuery = useQuery({
    ...trpc.sharing.getExport.queryOptions(
      { exportId: exportId ?? "00000000-0000-0000-0000-000000000000" },
      {
        enabled: exportId !== null,
        // Story 5.5 review-fix Decision C — stop after 5min of
        // non-terminal polling. Patient gets a stuck-CTA path.
        refetchInterval: (query) => {
          const data = query.state.data;
          if (!data) return EXPORT_POLL_INTERVAL_MS;
          if (data.status === "ready" || data.status === "failed") return false;
          const startedAt = pollStartAtRef.current;
          if (
            startedAt !== null &&
            Date.now() - startedAt >= EXPORT_POLL_TIMEOUT_MS
          ) {
            return false;
          }
          setNowTick((t) => t + 1);
          return EXPORT_POLL_INTERVAL_MS;
        },
      },
    ),
  });

  const isStuck =
    pollStartAtRef.current !== null &&
    Date.now() - pollStartAtRef.current >= EXPORT_POLL_TIMEOUT_MS &&
    (pollQuery.data?.status === "queued" ||
      pollQuery.data?.status === "generating");
  void nowTick;

  const onSubmit = useCallback(() => {
    requestMutation.mutate({ format });
  }, [format, requestMutation]);

  const onDownload = useCallback(async () => {
    if (downloadInFlight) return;
    setDownloadInFlight(true);
    try {
      const fresh = await pollQuery.refetch();
      const url = fresh.data?.downloadUrl;
      if (url) {
        // Programmatic anchor download — Story 5.2 share-sheet pattern.
        // Story 5.5 review-fix Patch #6 — server-authoritative format.
        const a = document.createElement("a");
        a.href = url;
        a.download = exportFilename(fresh.data?.format ?? format, new Date());
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      setDownloadInFlight(false);
    }
  }, [downloadInFlight, format, pollQuery]);

  const onRetry = useCallback(() => {
    setExportId(null);
    pollStartAtRef.current = null;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("exportId");
    router.replace(`?${next.toString()}`);
    requestMutation.mutate({ format });
  }, [format, requestMutation, router, searchParams]);

  const status = pollQuery.data?.status ?? null;
  const expired = pollQuery.data?.expired === true;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{EXPORT_SCREEN_TITLE_PT_BR}</h1>
        <p className="text-stone-600">{EXPORT_SCREEN_BODY_PT_BR}</p>
      </header>

      <div
        role="radiogroup"
        aria-label={EXPORT_FORMAT_GROUP_A11Y_PT_BR}
        className="flex flex-col gap-2"
      >
        {EXPORT_FORMAT_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 ${
              format === opt.value
                ? "border-teal-600 bg-teal-50"
                : "border-stone-300"
            }`}
          >
            <input
              type="radio"
              name="export-format"
              value={opt.value}
              checked={format === opt.value}
              onChange={() => setFormat(opt.value)}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="font-medium">{opt.label}</span>
              <span className="text-sm text-stone-500">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {exportId === null ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={requestMutation.isPending}
          aria-label={EXPORT_SUBMIT_A11Y_PT_BR_FN(format)}
          className="rounded-lg border border-teal-700 px-4 py-2 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-60"
        >
          {EXPORT_SUBMIT_BUTTON_PT_BR}
        </button>
      ) : expired ? (
        <div
          data-testid="export-expired"
          className="space-y-3 rounded-lg border border-stone-300 bg-stone-50 p-4"
        >
          <p role="alert" className="text-stone-800">
            {EXPORT_EXPIRED_PT_BR}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-teal-700 px-4 py-2 font-medium text-teal-800 hover:bg-teal-50"
          >
            {EXPORT_RETRY_BUTTON_PT_BR}
          </button>
        </div>
      ) : isStuck ? (
        <div
          data-testid="export-stuck"
          className="space-y-3 rounded-lg border border-stone-300 bg-stone-50 p-4"
        >
          <p role="alert" className="text-stone-800">
            {EXPORT_STUCK_PT_BR}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-teal-700 px-4 py-2 font-medium text-teal-800 hover:bg-teal-50"
          >
            {EXPORT_STUCK_BUTTON_PT_BR}
          </button>
        </div>
      ) : status === "ready" ? (
        <div className="space-y-3 rounded-lg border border-stone-300 bg-stone-50 p-4">
          <p className="text-lg">{EXPORT_READY_PT_BR}</p>
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={downloadInFlight}
            className="rounded-lg border border-teal-700 px-4 py-2 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-60"
          >
            {EXPORT_DOWNLOAD_BUTTON_PT_BR}
          </button>
        </div>
      ) : status === "failed" ? (
        <div className="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4">
          <p role="alert" className="text-red-800">
            {EXPORT_FAILED_PT_BR}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-teal-700 px-4 py-2 font-medium text-teal-800 hover:bg-teal-50"
          >
            {EXPORT_RETRY_BUTTON_PT_BR}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-stone-300 bg-stone-50 p-4">
          <p className="text-stone-700">{EXPORT_PROGRESS_PT_BR}</p>
        </div>
      )}
    </section>
  );
}
