import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Text, YStack } from "tamagui";

import type { EmotionalCheckinState } from "@healthtracker/validators";
import { EmotionalCheckInSheet } from "@healthtracker/ui";
import {
  EMOTIONAL_CHECKIN_POST_CTA_PT_BR,
  formatBrazilianDecimal,
  parseBrazilianDecimal,
  UPLOAD_DETAIL_ALL_DONE_PT_BR,
  UPLOAD_DETAIL_CONFIRM_CTA_PT_BR,
  UPLOAD_DETAIL_ERROR_PT_BR,
  UPLOAD_DETAIL_EXTRACTED_VALUE_PT_BR,
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
  // P131 — see web review-card.tsx for the rationale.
  const [touched, setTouched] = useState(false);
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

  const parsedCurrent = parseBrazilianDecimal(value);
  const isDirty =
    touched &&
    (parsedCurrent === null ||
      parsedOriginal === null ||
      parsedCurrent !== parsedOriginal);
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
        {UPLOAD_DETAIL_EXTRACTED_VALUE_PT_BR}: {field.valueText}
        {field.unitText !== null ? ` ${field.unitText}` : ""}
      </Text>
      <Input
        value={value}
        onChangeText={(next: string) => {
          setValue(next);
          setTouched(true);
        }}
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
  const { uploadId } = useLocalSearchParams<{ uploadId: string }>();
  const queryClient = useQueryClient();
  const query = useQuery(
    trpc.uploads.getUploadDetail.queryOptions(
      { uploadId },
      { refetchOnWindowFocus: true },
    ),
  );

  // Story 7.2 — pre-results emotional check-in sheet (AC1).
  // Gate: status === 'complete' AND isFirstView AND no pre-check-in
  // row exists yet, AND the patient hasn't already dismissed/submitted
  // within this screen mount. Derived inline (no setState-in-effect)
  // — `preCheckInDismissed` is the only piece of imperative state.
  const [preCheckInDismissed, setPreCheckInDismissed] = useState(false);
  // R1-L2 — explicit Boolean coercion so the type is `boolean` (not
  // `boolean | undefined`) for the EmotionalCheckInSheet `open` prop.
  const preCheckInSheetOpen = Boolean(
    !preCheckInDismissed &&
    query.data?.status === "complete" &&
    query.data.isFirstView &&
    !query.data.hasPreEmotionalCheckIn,
  );

  const recordPreCheckInMutation = useMutation(
    trpc.emotionalCheckIns.recordPreResults.mutationOptions(),
  );
  const recordPostCheckInMutation = useMutation(
    trpc.emotionalCheckIns.recordPostResults.mutationOptions(),
  );
  const markViewedMutation = useMutation(
    trpc.uploads.markUploadViewed.mutationOptions(),
  );

  // Story 7.3 — post-results sheet (AC1). Opens on tap of the
  // "Finalizar revisão" CTA at the bottom of the screen, NOT on
  // mount (the patient must first review the results).
  const [postCheckInSheetOpen, setPostCheckInSheetOpen] = useState(false);
  // R1-H3 — gate the post CTA on `!preCheckInSheetOpen` AND
  // `!postCheckInSheetOpen` so opacity-0 results body (while either
  // sheet is open) can't expose a hit-target the patient accidentally
  // activates. Mirrors the AC1 "before results appear" contract.
  const showPostCheckInCta = Boolean(
    query.data?.status === "complete" &&
    query.data.hasPreEmotionalCheckIn &&
    !query.data.hasPostEmotionalCheckIn &&
    !preCheckInSheetOpen &&
    !postCheckInSheetOpen,
  );

  async function handlePostCheckInSubmit(state: EmotionalCheckinState) {
    await recordPostCheckInMutation.mutateAsync({
      uploadId,
      state,
      type: "post",
    });
    invalidateUploadDetail();
  }

  function handlePostCheckInSkip() {
    setPostCheckInSheetOpen(false);
  }

  function handlePostCheckInOpenChange(next: boolean) {
    setPostCheckInSheetOpen(next);
  }

  function invalidateUploadDetail() {
    void queryClient.invalidateQueries({
      queryKey: trpc.uploads.getUploadDetail.queryKey({ uploadId }),
    });
  }

  async function handlePreCheckInSubmit(state: EmotionalCheckinState) {
    await recordPreCheckInMutation.mutateAsync({
      uploadId,
      state,
      type: "pre",
    });
    markViewedMutation.mutate(
      { uploadId },
      { onSettled: invalidateUploadDetail },
    );
  }

  // R1-H3 / R1-M1 — every non-decision close path (Pular, Android
  // back-press, Tamagui internal close, sheet handle gesture) is
  // treated as Skip: dismisses the sheet AND marks the upload viewed
  // so the patient doesn't get re-prompted on next mount. Without
  // this, `viewed_at` stays NULL on any close path that wasn't the
  // explicit submit/skip handler, defeating the AC1 non-dismissible
  // contract and creating a re-prompt loop.
  function dismissPreCheckInAsSkip() {
    if (preCheckInDismissed) return;
    setPreCheckInDismissed(true);
    markViewedMutation.mutate(
      { uploadId },
      { onSettled: invalidateUploadDetail },
    );
  }

  function handlePreCheckInSkip() {
    dismissPreCheckInAsSkip();
  }

  function handlePreCheckInOpenChange(next: boolean) {
    if (!next) dismissPreCheckInAsSkip();
  }

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

  // Story 7.2 — results body hides while the pre-results check-in
  // sheet is open so the patient doesn't peek at the values before
  // making their selection (AC1: "before results appear").
  const resultsHidden = preCheckInSheetOpen;

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
        <YStack
          gap="$3"
          opacity={resultsHidden ? 0 : 1}
          pointerEvents={resultsHidden ? "none" : "auto"}
        >
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
              {showPostCheckInCta ? (
                <Button
                  onPress={() => setPostCheckInSheetOpen(true)}
                  accessibilityRole="button"
                >
                  {EMOTIONAL_CHECKIN_POST_CTA_PT_BR}
                </Button>
              ) : null}
            </>
          ) : null}
        </YStack>
      </ScrollView>
      <EmotionalCheckInSheet
        open={preCheckInSheetOpen}
        onOpenChange={handlePreCheckInOpenChange}
        onSubmit={handlePreCheckInSubmit}
        onSkip={handlePreCheckInSkip}
        isSubmitting={recordPreCheckInMutation.isPending}
      />
      <EmotionalCheckInSheet
        mode="post"
        open={postCheckInSheetOpen}
        onOpenChange={handlePostCheckInOpenChange}
        onSubmit={handlePostCheckInSubmit}
        onSkip={handlePostCheckInSkip}
        isSubmitting={recordPostCheckInMutation.isPending}
      />
    </SafeAreaView>
  );
}
