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
  HISTORICO_RECOVERY_PHOTO_PT_BR,
  HISTORICO_RECOVERY_RESEND_PT_BR,
  HISTORICO_RECOVERY_SKIP_PT_BR,
  HISTORICO_TITLE_PT_BR,
  INICIO_ROUTE,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

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
    router.push(`/uploads/${row.id}`);
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
    >
      <Text fontWeight="600" color="$textPrimary">
        {row.originalFilename}
      </Text>
      <Text fontSize="$2" color="$textSecondary">
        {row.createdAt.toLocaleDateString("pt-BR")}
      </Text>
      <Text fontSize="$2">{UPLOAD_STATUS_LABELS_PT_BR[row.status]}</Text>
      {isFailed ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$textSecondary">
            {failureReasonLabel(row.failureReason)}
          </Text>
          <Button onPress={() => router.push(INICIO_ROUTE)}>
            {HISTORICO_RECOVERY_RESEND_PT_BR}
          </Button>
          <Button onPress={() => router.push(INICIO_ROUTE)}>
            {HISTORICO_RECOVERY_PHOTO_PT_BR}
          </Button>
          <Button>{HISTORICO_RECOVERY_SKIP_PT_BR}</Button>
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

  const rows = (query.data?.rows ?? []).filter((r) => !dismissed.has(r.id));

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
          {query.isSuccess && rows.length === 0 ? (
            <YStack gap="$2">
              <Text fontSize="$4">{HISTORICO_EMPTY_HEADLINE_PT_BR}</Text>
              <Button onPress={() => router.push(INICIO_ROUTE)}>
                {HISTORICO_EMPTY_CTA_PT_BR}
              </Button>
            </YStack>
          ) : null}
          {rows.map((row) => (
            <YStack
              key={row.id}
              onTouchEnd={
                row.status === "failed"
                  ? () => {
                      // "Pular" sets a local-state dismiss.
                      // Touch is wired on the surrounding YStack rather
                      // than the button itself because the button is
                      // the third in the recovery stack.
                    }
                  : undefined
              }
            >
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
