import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useGlobalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Text, YStack } from "tamagui";

import {
  formatBrazilianDecimal,
  parseBrazilianDecimal,
  UPLOAD_DETAIL_ALL_DONE_PT_BR,
  UPLOAD_DETAIL_CONFIRM_CTA_PT_BR,
  UPLOAD_DETAIL_ERROR_PT_BR,
  UPLOAD_DETAIL_LOADING_PT_BR,
  UPLOAD_DETAIL_REVIEW_HEADER_PT_BR,
  UPLOAD_DETAIL_SAVE_CTA_PT_BR,
  UPLOAD_DETAIL_SAVE_ERROR_PT_BR,
  UPLOAD_DETAIL_VALUE_INVALID_PT_BR,
  UPLOAD_DETAIL_WAITING_TEAM_PT_BR,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

import { trpc } from "~/utils/api";

const BACKGROUND_PRIMARY = "#F9F7F4";

interface LowConfidenceField {
  id: string;
  biomarkerName: string;
  valueText: string;
  unitText: string | null;
}

interface CardProps {
  uploadId: string;
  field: LowConfidenceField;
}

function ReviewCard({ uploadId, field }: CardProps) {
  const queryClient = useQueryClient();
  const parsedOriginal = parseBrazilianDecimal(field.valueText);
  const initialDisplay =
    parsedOriginal !== null
      ? formatBrazilianDecimal(parsedOriginal)
      : field.valueText;
  const [value, setValue] = useState(initialDisplay);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.uploads.confirmReviewField.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.uploads.getUploadDetail.queryKey({ uploadId }),
        });
      },
      onError: () => {
        setError(UPLOAD_DETAIL_SAVE_ERROR_PT_BR);
      },
    }),
  );

  const isDirty = value !== initialDisplay;
  const isPending = mutation.isPending;

  function onConfirm() {
    setError(null);
    mutation.mutate({ reviewQueueId: field.id });
  }
  function onSave() {
    setError(null);
    const parsed = parseBrazilianDecimal(value);
    if (parsed === null || !Number.isFinite(parsed)) {
      setError(UPLOAD_DETAIL_VALUE_INVALID_PT_BR);
      return;
    }
    mutation.mutate({
      reviewQueueId: field.id,
      patientValueNumeric: parsed,
    });
  }

  return (
    <YStack
      gap="$2"
      padding="$3"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$warningAmber"
      backgroundColor="$warningAmberSurface"
    >
      <Text fontWeight="600" color="$textPrimary">
        ⚑ {UPLOAD_DETAIL_REVIEW_HEADER_PT_BR}
      </Text>
      <Text fontSize="$4" color="$textPrimary">
        {field.biomarkerName}
      </Text>
      <Text fontSize="$2" color="$textSecondary">
        Valor extraído: {field.valueText}
        {field.unitText !== null ? ` ${field.unitText}` : ""}
      </Text>
      <Input
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        editable={!isPending}
        accessibilityLabel={`${field.biomarkerName} valor`}
      />
      {field.unitText !== null ? (
        <Text fontSize="$2" color="$textSecondary">
          {field.unitText}
        </Text>
      ) : null}
      {error !== null ? (
        <Text color="$errorRed" fontSize="$2">
          {error}
        </Text>
      ) : null}
      {isDirty ? (
        <Button onPress={onSave} disabled={isPending}>
          {UPLOAD_DETAIL_SAVE_CTA_PT_BR}
        </Button>
      ) : (
        <Button onPress={onConfirm} disabled={isPending}>
          {UPLOAD_DETAIL_CONFIRM_CTA_PT_BR}
        </Button>
      )}
    </YStack>
  );
}

export default function UploadDetailScreen() {
  const { uploadId } = useGlobalSearchParams<{ uploadId: string }>();
  const query = useQuery(
    trpc.uploads.getUploadDetail.queryOptions(
      { uploadId },
      { refetchOnWindowFocus: true },
    ),
  );

  let banner: string | null = null;
  if (query.data) {
    if (
      query.data.hasOperatorOnlyRows &&
      query.data.lowConfidenceFields.length === 0
    ) {
      banner = UPLOAD_DETAIL_WAITING_TEAM_PT_BR;
    } else if (
      query.data.status === "complete" &&
      query.data.lowConfidenceFields.length === 0
    ) {
      banner = UPLOAD_DETAIL_ALL_DONE_PT_BR;
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Resultado" }} />
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
          {query.isLoading ? <Text>{UPLOAD_DETAIL_LOADING_PT_BR}</Text> : null}
          {query.isError ? (
            <Text accessibilityRole="alert">{UPLOAD_DETAIL_ERROR_PT_BR}</Text>
          ) : null}
          {query.data ? (
            <>
              <Text fontSize="$6" fontWeight="700">
                {UPLOAD_STATUS_LABELS_PT_BR[query.data.status]}
              </Text>
              {banner !== null ? (
                <Text accessibilityRole="text">{banner}</Text>
              ) : null}
              {query.data.lowConfidenceFields.map((field) => (
                <ReviewCard key={field.id} uploadId={uploadId} field={field} />
              ))}
            </>
          ) : null}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
