"use client";

import { useQuery } from "@tanstack/react-query";

import {
  UPLOAD_DETAIL_ALL_DONE_PT_BR,
  UPLOAD_DETAIL_ERROR_PT_BR,
  UPLOAD_DETAIL_LOADING_PT_BR,
  UPLOAD_DETAIL_TITLE_PT_BR,
  UPLOAD_DETAIL_WAITING_TEAM_PT_BR,
  UPLOAD_STATUS_LABELS_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";
import { ReviewCard } from "./review-card";

interface Props {
  uploadId: string;
}

export function UploadDetailClient({ uploadId }: Props) {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.uploads.getUploadDetail.queryOptions(
      { uploadId },
      { refetchOnWindowFocus: true },
    ),
  );

  if (query.isLoading) {
    return <p className="text-stone-700">{UPLOAD_DETAIL_LOADING_PT_BR}</p>;
  }
  if (query.isError || !query.data) {
    return (
      <p role="alert" className="text-sm text-stone-700">
        {UPLOAD_DETAIL_ERROR_PT_BR}
      </p>
    );
  }

  const detail = query.data;
  const statusLabel = UPLOAD_STATUS_LABELS_PT_BR[detail.status];

  let banner: string | null = null;
  if (detail.hasOperatorOnlyRows && detail.lowConfidenceFields.length === 0) {
    banner = UPLOAD_DETAIL_WAITING_TEAM_PT_BR;
  } else if (
    detail.status === "complete" &&
    detail.lowConfidenceFields.length === 0
  ) {
    banner = UPLOAD_DETAIL_ALL_DONE_PT_BR;
  }

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{UPLOAD_DETAIL_TITLE_PT_BR}</h1>
        <span className="rounded-full border px-3 py-1 text-sm text-stone-700">
          {statusLabel}
        </span>
      </header>

      {banner !== null ? (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {banner}
        </div>
      ) : null}

      <ul className="flex flex-col gap-4">
        {detail.lowConfidenceFields.map((field) => (
          <li key={field.id}>
            <ReviewCard
              uploadId={uploadId}
              reviewQueueId={field.id}
              biomarkerName={field.biomarkerName}
              valueText={field.valueText}
              unitText={field.unitText}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
