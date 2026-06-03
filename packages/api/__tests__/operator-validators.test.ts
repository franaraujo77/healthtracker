import { describe, expect, it } from "vitest";

import {
  ACCESS_LOG_EVENT_KINDS,
  EXTRACTION_FIELD_OPERATOR_CONFIRMED,
  EXTRACTION_FIELD_OPERATOR_REJECTED,
  formatConfidencePct,
  formatOperatorCollectedAt,
  getOperatorQueueItemInputSchema,
  OPERATOR_QUEUE_EMPTY_PT_BR,
  OPERATOR_REJECTION_REASON_LABELS_PT_BR,
  OPERATOR_REVIEW_QUEUE_ROUTE,
  operatorQueueFlaggedFieldsLabelPtBr,
  operatorQueueItemRoute,
  rejectReviewFieldAsOperatorInputSchema,
} from "@healthtracker/validators";

/**
 * Story 8.1 — coverage for the operator validators copy + helpers. Lives
 * in @healthtracker/api (not @healthtracker/validators) because the
 * validators package ships no test runner; api depends on validators, so
 * these run under api's vitest.
 */
describe("operator validators — Story 8.1", () => {
  it("exposes the exact AC4 empty-state string", () => {
    expect(OPERATOR_QUEUE_EMPTY_PT_BR).toBe(
      "Fila vazia — todos os resultados foram revisados",
    );
  });

  it("renders confidence as a whole percent", () => {
    expect(formatConfidencePct(0.71)).toBe("71%");
    expect(formatConfidencePct(0.955)).toBe("96%");
    expect(formatConfidencePct(0)).toBe("0%");
  });

  it("pluralises the flagged-fields label", () => {
    expect(operatorQueueFlaggedFieldsLabelPtBr(1)).toBe("1 campo para revisar");
    expect(operatorQueueFlaggedFieldsLabelPtBr(3)).toBe(
      "3 campos para revisar",
    );
  });

  it("builds the detail route under the queue route", () => {
    expect(operatorQueueItemRoute("abc")).toBe(
      `${OPERATOR_REVIEW_QUEUE_ROUTE}/abc`,
    );
  });

  it("formats ISO collected-at to pt-BR, passes free-form, falls back on null", () => {
    expect(formatOperatorCollectedAt("2024-03-12")).toBe("12/03/2024");
    expect(formatOperatorCollectedAt("12/03/2024")).toBe("12/03/2024");
    expect(formatOperatorCollectedAt(null)).toBe("—");
  });

  it("rejects a non-uuid uploadId and unknown keys (.strict)", () => {
    expect(
      getOperatorQueueItemInputSchema.safeParse({ uploadId: "nope" }).success,
    ).toBe(false);
    expect(
      getOperatorQueueItemInputSchema.safeParse({
        uploadId: "123e4567-e89b-42d3-a456-426614174000",
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      getOperatorQueueItemInputSchema.safeParse({
        uploadId: "123e4567-e89b-42d3-a456-426614174000",
      }).success,
    ).toBe(true);
  });

  // --- Story 8.2 ---

  it("excludes operator action audit kinds from the patient Access Log (AC11)", () => {
    expect(ACCESS_LOG_EVENT_KINDS).not.toContain(
      EXTRACTION_FIELD_OPERATOR_CONFIRMED,
    );
    expect(ACCESS_LOG_EVENT_KINDS).not.toContain(
      EXTRACTION_FIELD_OPERATOR_REJECTED,
    );
  });

  it("maps the three rejection reasons to pt-BR labels", () => {
    expect(OPERATOR_REJECTION_REASON_LABELS_PT_BR.decimal_separator).toBe(
      "Separador decimal incorreto",
    );
    expect(OPERATOR_REJECTION_REASON_LABELS_PT_BR.illegible).toBe(
      "Valor ilegível",
    );
    expect(OPERATOR_REJECTION_REASON_LABELS_PT_BR.wrong_unit).toBe(
      "Unidade incorreta",
    );
  });

  it("rejects an unknown rejection reason (.strict + enum)", () => {
    expect(
      rejectReviewFieldAsOperatorInputSchema.safeParse({
        reviewQueueId: "123e4567-e89b-42d3-a456-426614174000",
        rejectionReason: "made_up",
      }).success,
    ).toBe(false);
    expect(
      rejectReviewFieldAsOperatorInputSchema.safeParse({
        reviewQueueId: "123e4567-e89b-42d3-a456-426614174000",
        rejectionReason: "illegible",
      }).success,
    ).toBe(true);
  });
});
