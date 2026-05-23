import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, XStack, YStack } from "tamagui";

import { Button, EmptyStateRecord } from "@healthtracker/ui";
import {
  failureReasonLabel,
  formatCollectedAtPtBr,
  HISTORICO_EMPTY_CTA_PT_BR,
  HISTORICO_EMPTY_HEADLINE_PT_BR,
  HISTORICO_ERROR_PT_BR,
  HISTORICO_LAB_NAME_FALLBACK_PT_BR,
  HISTORICO_LOADING_PT_BR,
  HISTORICO_OFFLINE_QUEUED_HINT_PT_BR,
  HISTORICO_RECOVERY_PHOTO_PT_BR,
  HISTORICO_RECOVERY_RESEND_PT_BR,
  HISTORICO_RECOVERY_SKIP_PT_BR,
  HISTORICO_RESULTS_EMPTY_CTA_PT_BR,
  HISTORICO_RESULTS_EMPTY_HEADLINE_PT_BR,
  HISTORICO_RESULTS_ERROR_PT_BR,
  HISTORICO_RESULTS_LOADING_PT_BR,
  HISTORICO_RESULTS_TAB_LABEL_PT_BR,
  HISTORICO_TITLE_PT_BR,
  HISTORICO_UPLOADS_TAB_LABEL_PT_BR,
  historicoDrawBiomarkerCountPtBr,
  historicoDrawDetailRoute,
  INICIO_ROUTE,
  postOnboardingImportRoute,
  UPLOAD_DETAIL_ROUTE,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

import { useOfflineQueue } from "~/hooks/use-offline-queue";
import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

interface UploadRow {
  id: string;
  originalFilename: string;
  status: "queued" | "processing" | "pending_review" | "complete" | "failed";
  createdAt: Date;
  failureReason: string | null;
}

function Card({ row }: { row: UploadRow }) {
  const tappable = row.status === "pending_review" || row.status === "complete";
  const isFailed = row.status === "failed";
  const onTap = () => {
    if (!tappable) return;
    router.push(UPLOAD_DETAIL_ROUTE(row.id));
  };
  return (
    <YStack
      gap="$2"
      padding="$3"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$border"
      backgroundColor="$surfaceElevated"
      onPress={tappable ? onTap : undefined}
      accessibilityRole={tappable ? "button" : "text"}
      accessibilityHint={
        tappable ? "Toque para abrir o detalhe deste upload" : undefined
      }
    >
      <Text fontWeight="600" color="$textPrimary">
        {row.originalFilename}
      </Text>
      <Text fontSize="$2" color="$textSecondary">
        {row.createdAt.toLocaleDateString("pt-BR")}
      </Text>
      <Text fontSize="$2">
        {(UPLOAD_STATUS_LABELS_PT_BR as Record<string, string | undefined>)[
          row.status
        ] ?? row.status}
      </Text>
      {isFailed ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$textSecondary">
            {failureReasonLabel(row.failureReason)}
          </Text>
          <Button
            onPress={() => router.push(postOnboardingImportRoute("file"))}
          >
            {HISTORICO_RECOVERY_RESEND_PT_BR}
          </Button>
          <Button
            onPress={() => router.push(postOnboardingImportRoute("photo"))}
          >
            {HISTORICO_RECOVERY_PHOTO_PT_BR}
          </Button>
        </YStack>
      ) : null}
    </YStack>
  );
}

/**
 * Story 3.1 — `Resultados` subtab. Renders the patient's published
 * observations, grouped by `(collectedAt, labName)` (the API helper
 * does the grouping). Tap a draw to open the detail screen
 * `/historico/[collectedAt]?labName=…` (Story 3.1 Task 3.4 helper).
 *
 * The detail screen filters this same payload client-side instead of
 * issuing a second tRPC call (dataset is small ≤1000 rows per Epic 2
 * retro § preparation gaps).
 */
function ResultadosSection() {
  const query = useQuery(
    trpc.observations.getRecord.queryOptions(undefined, {
      // Story 2.5 pattern — refetch on focus so a fresh publish surfaces
      // without a pull-to-refresh.
      refetchOnWindowFocus: true,
      staleTime: 0,
    }),
  );

  if (query.isLoading) {
    return <Text>{HISTORICO_RESULTS_LOADING_PT_BR}</Text>;
  }
  if (query.isError) {
    return (
      <Text accessibilityRole="alert">{HISTORICO_RESULTS_ERROR_PT_BR}</Text>
    );
  }
  const draws = query.data?.draws ?? [];
  if (draws.length === 0) {
    return (
      <EmptyStateRecord
        headline={HISTORICO_RESULTS_EMPTY_HEADLINE_PT_BR}
        ctaLabel={HISTORICO_RESULTS_EMPTY_CTA_PT_BR}
        onCtaPress={() => router.push(INICIO_ROUTE)}
        variant="inline"
      />
    );
  }
  return (
    <YStack gap="$3">
      {draws.map((draw) => {
        // R3-P246 — `draw.collectedAt` is a `yyyy-mm-dd` date-only
        // string; `new Date(yyyy-mm-dd).toLocaleDateString(...)` parses
        // as UTC midnight and shifts to the previous calendar day in
        // every Brazilian timezone (UTC-3/-4/-5). Use the validators
        // helper that formats the string directly.
        const drawDate = formatCollectedAtPtBr(draw.collectedAt);
        const labLabel = draw.labName ?? HISTORICO_LAB_NAME_FALLBACK_PT_BR;
        const summary = historicoDrawBiomarkerCountPtBr(
          draw.observations.length,
        );
        // Empty-string sentinel for "no lab recorded" — the detail
        // screen's client-side filter pairs it with null labName.
        const labParam = draw.labName ?? "";
        return (
          <YStack
            key={`${draw.collectedAt}|${labLabel}`}
            gap="$1"
            padding="$3"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$border"
            backgroundColor="$surfaceElevated"
            minHeight={72}
            onPress={() =>
              // R1-P231 — use the validators-side helper so the
              // producer/consumer coupling is explicit (Epic 2 retro
              // action item 3, Story 2.5 R1-P153 lesson). The helper
              // URL-encodes `labName` defensively.
              router.push(historicoDrawDetailRoute(draw.collectedAt, labParam))
            }
            accessibilityRole="button"
            accessibilityLabel={`${labLabel}, ${drawDate}, ${summary}`}
            accessibilityHint="Toque para ver os biomarcadores deste exame"
          >
            <Text fontWeight="600" color="$textPrimary">
              {labLabel}
            </Text>
            <Text fontSize="$2" color="$textSecondary">
              {drawDate}
            </Text>
            <Text fontSize="$2" color="$textSecondary">
              {summary}
            </Text>
          </YStack>
        );
      })}
    </YStack>
  );
}

/**
 * Story 2.5 — `Envios` subtab (verbatim move of the original
 * `historico.tsx` body so Story 3.1 doesn't regress upload-status
 * behavior). All existing offline-queue / dismissal / recovery logic
 * is preserved.
 */
function EnviosSection() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const query = useQuery(
    trpc.uploads.listUploadsForPatient.queryOptions(
      { limit: 50 },
      { refetchOnWindowFocus: true, staleTime: 0 },
    ),
  );

  const rawRows = query.data?.rows ?? [];
  const rows = rawRows.filter((r) => !dismissed.has(r.id));
  const offlineRows = useOfflineQueue();
  const allDismissed =
    query.isSuccess &&
    rawRows.length > 0 &&
    rows.length === 0 &&
    offlineRows.length === 0;

  return (
    <YStack gap="$3">
      {query.isLoading ? <Text>{HISTORICO_LOADING_PT_BR}</Text> : null}
      {query.isError ? (
        <Text accessibilityRole="alert">{HISTORICO_ERROR_PT_BR}</Text>
      ) : null}
      {query.isSuccess && rawRows.length === 0 && offlineRows.length === 0 ? (
        <YStack gap="$2">
          <Text fontSize="$4">{HISTORICO_EMPTY_HEADLINE_PT_BR}</Text>
          <Button onPress={() => router.push(INICIO_ROUTE)}>
            {/* R2-P244 — preserve Story 2.5's `"Enviar primeiro exame"`
                CTA copy on the Envios subtab. Story 3.1's verbatim move
                of `historico.tsx` into `historico/index.tsx` accidentally
                swapped to `HISTORICO_RESULTS_EMPTY_CTA_PT_BR`
                ("Enviar resultado"), which regresses the upload-status
                empty-state wording. */}
            {HISTORICO_EMPTY_CTA_PT_BR}
          </Button>
        </YStack>
      ) : null}
      {allDismissed ? (
        <YStack gap="$2">
          <Text fontSize="$4">Todos os resultados foram pulados.</Text>
          <Button onPress={() => setDismissed(new Set())}>
            Mostrar pulados
          </Button>
        </YStack>
      ) : null}
      {offlineRows.map((item) => (
        <YStack
          key={item.clientIdempotencyKey}
          gap="$2"
          padding="$3"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$biomarkerDeviation"
          backgroundColor="$biomarkerDeviationBg"
          accessibilityRole="text"
        >
          <Text fontWeight="600" color="$textPrimary">
            {item.originalFilename}
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            {(() => {
              const d = new Date(item.enqueuedAt);
              return Number.isFinite(d.getTime())
                ? d.toLocaleDateString("pt-BR")
                : "—";
            })()}
          </Text>
          <Text fontSize="$2">{UPLOAD_STATUS_LABELS_PT_BR.offline_queued}</Text>
          <Text fontSize="$2" color="$textSecondary">
            {HISTORICO_OFFLINE_QUEUED_HINT_PT_BR}
          </Text>
        </YStack>
      ))}
      {rows.map((row) => (
        <YStack key={row.id}>
          <Card row={row} />
          {row.status === "failed" ? (
            <Button
              onPress={() =>
                setDismissed((prev) => {
                  const next = new Set(prev);
                  next.add(row.id);
                  return next;
                })
              }
            >
              {HISTORICO_RECOVERY_SKIP_PT_BR}
            </Button>
          ) : null}
        </YStack>
      ))}
    </YStack>
  );
}

type SubTab = "resultados" | "envios";

export default function HistoricoScreen() {
  const [tab, setTab] = useState<SubTab>("resultados");
  // Story 2.6 `EnviosSection` re-renders on focus via its own
  // refetchOnWindowFocus — wiring pull-to-refresh at this level would
  // duplicate refetches. The Resultados query owns its own refetch.
  const resultadosQuery = useQuery(
    trpc.observations.getRecord.queryOptions(undefined, {
      enabled: false,
    }),
  );
  const uploadsQuery = useQuery(
    trpc.uploads.listUploadsForPatient.queryOptions(
      { limit: 50 },
      { enabled: false },
    ),
  );
  const onRefresh = () => {
    if (tab === "resultados") void resultadosQuery.refetch();
    else void uploadsQuery.refetch();
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={
              tab === "resultados"
                ? resultadosQuery.isRefetching
                : uploadsQuery.isRefetching
            }
            onRefresh={onRefresh}
          />
        }
      >
        <YStack gap="$3">
          <Text fontSize="$7" fontWeight="700">
            {HISTORICO_TITLE_PT_BR}
          </Text>
          <XStack gap="$2" role="tablist">
            <Button
              size="md"
              variant={tab === "resultados" ? "primary" : "outline"}
              onPress={() => setTab("resultados")}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === "resultados" }}
            >
              {HISTORICO_RESULTS_TAB_LABEL_PT_BR}
            </Button>
            <Button
              size="md"
              variant={tab === "envios" ? "primary" : "outline"}
              onPress={() => setTab("envios")}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === "envios" }}
            >
              {HISTORICO_UPLOADS_TAB_LABEL_PT_BR}
            </Button>
          </XStack>
          {tab === "resultados" ? <ResultadosSection /> : <EnviosSection />}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
