import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Text, YStack } from "tamagui";

import {
  failureReasonLabel,
  HISTORICO_EMPTY_CTA_PT_BR,
  HISTORICO_EMPTY_HEADLINE_PT_BR,
  HISTORICO_ERROR_PT_BR,
  HISTORICO_LOADING_PT_BR,
  HISTORICO_OFFLINE_QUEUED_HINT_PT_BR,
  HISTORICO_RECOVERY_PHOTO_PT_BR,
  HISTORICO_RECOVERY_RESEND_PT_BR,
  HISTORICO_RECOVERY_SKIP_PT_BR,
  HISTORICO_TITLE_PT_BR,
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
    // R1-P154 — use the canonical UPLOAD_DETAIL_ROUTE; the
    // hand-built `/uploads/<id>` route doesn't exist under the
    // `(tabs)` group and would 404.
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
      {/* R2-P175 — cast widens the indexed type to `string | undefined`
          so the fallback survives if a future column value reaches the
          UI without a pt-BR label. TS thinks the union is closed; the
          wire type is `string`, so the runtime guard is real. */}
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
          {/* R2-P176 — the real "Pular este resultado" button lives
              outside this Card (in HistoricoScreen) so it can flip
              the parent's `dismissed` state. Two same-label buttons
              would confuse a11y. */}
        </YStack>
      ) : null}
    </YStack>
  );
}

export default function HistoricoScreen() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const query = useQuery(
    trpc.uploads.listUploadsForPatient.queryOptions(
      { limit: 50 },
      { refetchOnWindowFocus: true, staleTime: 0 },
    ),
  );

  const rawRows = query.data?.rows ?? [];
  const rows = rawRows.filter((r) => !dismissed.has(r.id));
  // Story 2.6 — local-only rows from the offline queue render at the
  // top of the list with the `offline_queued` virtual status. They
  // are NOT in the server's `uploads` table yet; the drain hook
  // submits them as soon as connectivity returns.
  const offlineRows = useOfflineQueue();
  // R1-P160 — empty state must distinguish "no uploads ever" from
  // "all uploads dismissed". R2-P194 — offline rows also count as
  // "has uploads" so the dismiss banner doesn't render above a
  // populated offline list.
  const allDismissed =
    query.isSuccess &&
    rawRows.length > 0 &&
    rows.length === 0 &&
    offlineRows.length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
          />
        }
      >
        <YStack gap="$3">
          <Text fontSize="$7" fontWeight="700">
            {HISTORICO_TITLE_PT_BR}
          </Text>
          {query.isLoading ? <Text>{HISTORICO_LOADING_PT_BR}</Text> : null}
          {query.isError ? (
            <Text accessibilityRole="alert">{HISTORICO_ERROR_PT_BR}</Text>
          ) : null}
          {/* Story 2.6 — offline rows count toward "has uploads"
              so the empty state doesn't compete with a queue of
              pending offline picks. */}
          {query.isSuccess &&
          rawRows.length === 0 &&
          offlineRows.length === 0 ? (
            <YStack gap="$2">
              <Text fontSize="$4">{HISTORICO_EMPTY_HEADLINE_PT_BR}</Text>
              <Button onPress={() => router.push(INICIO_ROUTE)}>
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
          {/* Story 2.6 — local-only offline-queue rows render at the
              top with the "Aguardando conexão" virtual status. The
              drain hook submits them on the next online tick. */}
          {offlineRows.map((item) => (
            <YStack
              key={item.clientIdempotencyKey}
              gap="$2"
              padding="$3"
              borderRadius="$card"
              borderWidth={1}
              borderColor="$warningAmber"
              backgroundColor="$warningAmberSurface"
              accessibilityRole="text"
            >
              <Text fontWeight="600" color="$textPrimary">
                {item.originalFilename}
              </Text>
              {/* R1-P188 — guard against malformed/legacy enqueuedAt
                  values so we don't render "Data inválida". */}
              <Text fontSize="$2" color="$textSecondary">
                {(() => {
                  const d = new Date(item.enqueuedAt);
                  return Number.isFinite(d.getTime())
                    ? d.toLocaleDateString("pt-BR")
                    : "—";
                })()}
              </Text>
              <Text fontSize="$2">
                {UPLOAD_STATUS_LABELS_PT_BR.offline_queued}
              </Text>
              <Text fontSize="$2" color="$textSecondary">
                {HISTORICO_OFFLINE_QUEUED_HINT_PT_BR}
              </Text>
            </YStack>
          ))}
          {/* R1-P165 — drop the dead `onTouchEnd` block; the dismiss
              is handled by the Button below the Card. */}
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
      </ScrollView>
    </SafeAreaView>
  );
}
