"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@healthtracker/ui/button";
import {
  formatBrazilianDecimal,
  parseBrazilianDecimal,
  UPLOAD_DETAIL_CONFIRM_CTA_PT_BR,
  UPLOAD_DETAIL_REVIEW_HEADER_PT_BR,
  UPLOAD_DETAIL_SAVE_CTA_PT_BR,
  UPLOAD_DETAIL_SAVE_ERROR_PT_BR,
  UPLOAD_DETAIL_VALUE_INVALID_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

interface Props {
  uploadId: string;
  reviewQueueId: string;
  biomarkerName: string;
  valueText: string;
  unitText: string | null;
}

export function ReviewCard({
  uploadId,
  reviewQueueId,
  biomarkerName,
  valueText,
  unitText,
}: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Pre-fill the input with the original textual value — preserves
  // the decimal-comma format the patient sees on the lab report
  // (UX-DR12). Fallback: if `valueText` is unparseable, leave the
  // input pre-filled with the raw text and let the patient retype.
  const parsedOriginal = parseBrazilianDecimal(valueText);
  const initialDisplay =
    parsedOriginal !== null
      ? formatBrazilianDecimal(parsedOriginal)
      : valueText;
  const [value, setValue] = useState(initialDisplay);
  const [error, setError] = useState<string | null>(null);

  const confirmMutation = useMutation(
    trpc.uploads.confirmReviewField.mutationOptions({
      onSuccess: () => {
        // Invalidate the parent detail query so the card list refreshes.
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
  const isPending = confirmMutation.isPending;

  function onConfirm() {
    setError(null);
    confirmMutation.mutate({ reviewQueueId });
  }

  function onSave() {
    setError(null);
    const parsed = parseBrazilianDecimal(value);
    if (parsed === null || !Number.isFinite(parsed)) {
      setError(UPLOAD_DETAIL_VALUE_INVALID_PT_BR);
      return;
    }
    confirmMutation.mutate({ reviewQueueId, patientValueNumeric: parsed });
  }

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-amber-950"
        >
          ⚑
        </span>
        <h2 className="text-sm font-semibold text-amber-950">
          {UPLOAD_DETAIL_REVIEW_HEADER_PT_BR}
        </h2>
      </div>
      <div>
        <p className="text-base font-medium text-stone-900">{biomarkerName}</p>
        <p className="text-xs text-stone-600">
          Valor extraído: {valueText}
          {unitText !== null ? ` ${unitText}` : ""}
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-stone-700">Valor</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${biomarkerName} valor`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={isPending}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-base"
        />
        {unitText !== null ? (
          <span className="text-xs text-stone-600">{unitText}</span>
        ) : null}
      </label>
      {error !== null ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        {isDirty ? (
          <Button onPress={onSave} disabled={isPending}>
            {UPLOAD_DETAIL_SAVE_CTA_PT_BR}
          </Button>
        ) : (
          <Button onPress={onConfirm} disabled={isPending}>
            {UPLOAD_DETAIL_CONFIRM_CTA_PT_BR}
          </Button>
        )}
      </div>
    </article>
  );
}
