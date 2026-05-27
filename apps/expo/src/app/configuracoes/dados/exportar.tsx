import { useCallback, useEffect, useRef, useState } from "react";
import { Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Text, YStack } from "tamagui";

import type { ExportFormat } from "@healthtracker/validators";
import { ExportFormatOption, ExportProgressCard } from "@healthtracker/ui";
import {
  EXPORT_FORMAT_GROUP_A11Y_PT_BR,
  EXPORT_FORMAT_OPTIONS,
  EXPORT_POLL_INTERVAL_MS,
  EXPORT_POLL_TIMEOUT_MS,
  EXPORT_SCREEN_BODY_PT_BR,
  EXPORT_SCREEN_TITLE_PT_BR,
  EXPORT_SUBMIT_A11Y_PT_BR_FN,
  EXPORT_SUBMIT_BUTTON_PT_BR,
  exportFilename,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";
const ASYNC_STORAGE_KEY = "story-5-5.current-export-id";

/**
 * Story 5.5 — Configurações > Dados > Exportar registro.
 *
 * LGPD Art. 18 portability surface. Patient picks JSON / PDF →
 * mutation enqueues a pg-boss job → screen polls `getExport` every
 * 2s until the artifact is ready → "Baixar" fetches a fresh signed
 * URL and hands it to the system share-sheet (the URL is NEVER
 * cached client-side; every tap re-queries — AC11).
 *
 * `exportId` is persisted to AsyncStorage so leaving + returning to
 * the screen resumes polling against the same row (AC2).
 */
export default function ExportarScreen(): React.ReactElement {
  const [format, setFormat] = useState<ExportFormat>("json");
  const [exportId, setExportId] = useState<string | null>(null);
  const [downloadInFlight, setDownloadInFlight] = useState(false);
  // Story 5.5 review-fix Decision C — wall-clock anchor for the
  // 5-minute client-side polling timeout. Refs (not state) — flipping
  // it should NOT re-render. `nowTick` forces a re-evaluation of the
  // derived `isStuck` flag every poll cycle.
  const pollStartAtRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(0);

  // Resume an in-flight export across re-mount (AC2).
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(ASYNC_STORAGE_KEY).then((stored) => {
      if (!cancelled && stored !== null && exportId === null) {
        setExportId(stored);
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentional one-shot mount load; subsequent setExportId is local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestMutation = useMutation(
    trpc.sharing.requestExport.mutationOptions({
      onSuccess: (data) => {
        setExportId(data.exportId);
        pollStartAtRef.current = Date.now();
        void AsyncStorage.setItem(ASYNC_STORAGE_KEY, data.exportId);
      },
    }),
  );

  // Anchor `pollStartAt` on AsyncStorage-resumed exports too.
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
        // TanStack v5 — `refetchInterval` accepts a function so we
        // stop polling once the row is terminal (ready / failed).
        // Story 5.5 review-fix Decision C — also stop polling after
        // EXPORT_POLL_TIMEOUT_MS elapses while still queued/generating.
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
          // Bump `nowTick` so the next render re-derives `isStuck`.
          setNowTick((t) => t + 1);
          return EXPORT_POLL_INTERVAL_MS;
        },
      },
    ),
  });

  // Derived flag — recomputed each render (cheap). The `nowTick`
  // dependency keeps it fresh after each poll cycle.
  const isStuck =
    pollStartAtRef.current !== null &&
    Date.now() - pollStartAtRef.current >= EXPORT_POLL_TIMEOUT_MS &&
    (pollQuery.data?.status === "queued" ||
      pollQuery.data?.status === "generating");
  // Reference `nowTick` so React re-renders pick up the new value;
  // ESLint flags this otherwise as an unused-state warning.
  void nowTick;

  const onSubmit = useCallback(() => {
    requestMutation.mutate({ format });
  }, [format, requestMutation]);

  const onDownload = useCallback(async () => {
    // CLAUDE.md anti-pattern guard: never cache the signed URL —
    // re-fetch on every tap so an expired (1h TTL) URL is rotated.
    if (downloadInFlight) return;
    setDownloadInFlight(true);
    try {
      const fresh = await pollQuery.refetch();
      const url = fresh.data?.downloadUrl;
      if (url) {
        // Expo `Share.share({ url })` opens the system share-sheet.
        // The filename is encoded in the URL path; iOS / Android
        // surface it as the share title.
        await Share.share({ url, message: url });
      }
    } finally {
      setDownloadInFlight(false);
    }
  }, [downloadInFlight, pollQuery]);

  const onRetry = useCallback(() => {
    setExportId(null);
    pollStartAtRef.current = null;
    void AsyncStorage.removeItem(ASYNC_STORAGE_KEY);
    requestMutation.mutate({ format });
  }, [format, requestMutation]);

  // Story 5.5 review-fix Patch #6 — derive filename from
  // server-authoritative `pollQuery.data.format`, not the local `format`
  // state. If the patient flips the radio mid-poll the artifact format
  // stays whatever was queued; the filename must match.
  const effectiveFormat = pollQuery.data?.format ?? format;
  const downloadFilename = exportFilename(effectiveFormat, new Date());

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: EXPORT_SCREEN_TITLE_PT_BR }} />
      <YStack flex={1} padding="$4" gap="$4">
        <Text fontSize="$7" fontWeight="700" color="$textPrimary">
          {EXPORT_SCREEN_TITLE_PT_BR}
        </Text>
        <Text fontSize="$3" color="$textSecondary">
          {EXPORT_SCREEN_BODY_PT_BR}
        </Text>

        <YStack
          accessibilityRole="radiogroup"
          accessibilityLabel={EXPORT_FORMAT_GROUP_A11Y_PT_BR}
          gap="$2"
        >
          {EXPORT_FORMAT_OPTIONS.map((opt) => (
            <ExportFormatOption
              key={opt.value}
              value={opt.value}
              label={opt.label}
              hint={opt.hint}
              selected={format === opt.value}
              onSelect={() => setFormat(opt.value)}
            />
          ))}
        </YStack>

        {exportId === null ? (
          <Button
            onPress={onSubmit}
            disabled={requestMutation.isPending}
            accessibilityLabel={EXPORT_SUBMIT_A11Y_PT_BR_FN(format)}
            testID="export-submit-button"
          >
            {EXPORT_SUBMIT_BUTTON_PT_BR}
          </Button>
        ) : (
          <ExportProgressCard
            status={pollQuery.data?.status ?? "queued"}
            onDownload={() => void onDownload()}
            onRetry={onRetry}
            downloadInFlight={downloadInFlight}
            expired={pollQuery.data?.expired === true}
            stuck={isStuck}
          />
        )}

        {/* Hidden a11y line so screen readers can announce the
            target filename without cluttering the visual surface. */}
        <Text testID="export-download-filename" position="absolute" opacity={0}>
          {downloadFilename}
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
