"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import type { OperatorRejectionReason } from "@healthtracker/validators";
import {
  OPERATOR_ACTION_ERROR_PT_BR,
  OPERATOR_CONFIRM_CTA_PT_BR,
  OPERATOR_REJECT_CANCEL_CTA_PT_BR,
  OPERATOR_REJECT_CONFIRM_CTA_PT_BR,
  OPERATOR_REJECT_CTA_PT_BR,
  OPERATOR_REJECT_REASON_PROMPT_PT_BR,
  OPERATOR_REJECTION_REASON_LABELS_PT_BR,
  OPERATOR_REJECTION_REASONS,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

/**
 * Story 8.2 AC12 — per-field confirm/reject controls on the operator
 * detail page. Client island; calls `operator.confirmField` /
 * `operator.rejectField` and `router.refresh()`es so the resolved field
 * drops out of the re-fetched `loinc_unresolved` list.
 */
export function OperatorFieldActions(props: {
  reviewQueueId: string;
}): React.ReactElement {
  const trpc = useTRPC();
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<OperatorRejectionReason>(
    OPERATOR_REJECTION_REASONS[0],
  );
  const [error, setError] = useState(false);

  const confirmMutation = useMutation(
    trpc.operator.confirmField.mutationOptions({
      onSuccess: () => router.refresh(),
      onError: () => setError(true),
    }),
  );
  const rejectMutation = useMutation(
    trpc.operator.rejectField.mutationOptions({
      onSuccess: () => router.refresh(),
      onError: () => setError(true),
    }),
  );

  const pending = confirmMutation.isPending || rejectMutation.isPending;

  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {!rejecting ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(false);
              confirmMutation.mutate({ reviewQueueId: props.reviewQueueId });
            }}
            style={primaryBtn(pending)}
          >
            {OPERATOR_CONFIRM_CTA_PT_BR}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(false);
              setRejecting(true);
            }}
            style={secondaryBtn(pending)}
          >
            {OPERATOR_REJECT_CTA_PT_BR}
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <label style={{ fontSize: 13, color: "#374151" }}>
            {OPERATOR_REJECT_REASON_PROMPT_PT_BR}:{" "}
            <select
              value={reason}
              disabled={pending}
              onChange={(e) =>
                setReason(e.target.value as OperatorRejectionReason)
              }
              style={{ padding: "6px 8px", borderRadius: 6, fontSize: 14 }}
            >
              {OPERATOR_REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {OPERATOR_REJECTION_REASON_LABELS_PT_BR[r]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(false);
              rejectMutation.mutate({
                reviewQueueId: props.reviewQueueId,
                rejectionReason: reason,
              });
            }}
            style={primaryBtn(pending)}
          >
            {OPERATOR_REJECT_CONFIRM_CTA_PT_BR}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setRejecting(false);
              setError(false);
            }}
            style={secondaryBtn(pending)}
          >
            {OPERATOR_REJECT_CANCEL_CTA_PT_BR}
          </button>
        </div>
      )}
      {error ? (
        <span role="alert" style={{ fontSize: 12, color: "#d97706" }}>
          {OPERATOR_ACTION_ERROR_PT_BR}
        </span>
      ) : null}
    </div>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #1f2937",
    background: "#1f2937",
    color: "#fff",
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #d4d4d8",
    background: "#fff",
    color: "#374151",
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
