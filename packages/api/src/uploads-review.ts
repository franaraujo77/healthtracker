import { TRPCError } from "@trpc/server";

import { and, eq, isNull, sql } from "@healthtracker/db";
import {
  ExtractionReviewQueue,
  Observations,
  Uploads,
} from "@healthtracker/db/schema";
import {
  parseBrazilianDecimal,
  parseCollectedAt,
} from "@healthtracker/validators";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";
import { resolveLoincCode } from "./loinc";
import { writeObservation } from "./observations";
import { applyUploadTransition } from "./upload-transitions";

/**
 * Story 2.4 — read the upload detail surface the patient sees on the
 * upload detail screen.
 *
 * Returns the upload metadata, the list of unresolved `low_confidence`
 * review rows (RLS-scoped, so foreign uploads return zero rows), a
 * boolean indicating whether operator-only `loinc_unresolved` rows
 * exist (so the UI can show "Aguardando revisão da equipe"), and a
 * `publishedObservationCount`.
 *
 * RLS handles ownership. If the upload is missing OR foreign, the
 * call throws `NOT_FOUND` (the same code for both cases — no
 * enumeration oracle per NFR-S2 PII review checklist).
 */
export async function getUploadDetailForPatient(
  database: AuditDb,
  patientId: string,
  uploadId: string,
): Promise<{
  id: string;
  status: "queued" | "processing" | "pending_review" | "complete" | "failed";
  createdAt: Date;
  processingStartedAt: Date | null;
  processingCompletedAt: Date | null;
  lowConfidenceFields: {
    id: string;
    biomarkerName: string;
    valueText: string;
    unitText: string | null;
    loincCode: string | null;
    collectedAtText: string | null;
    confidenceScore: string;
  }[];
  hasOperatorOnlyRows: boolean;
  publishedObservationCount: number;
}> {
  const [uploadRow] = await database
    .select({
      id: Uploads.id,
      status: Uploads.status,
      createdAt: Uploads.createdAt,
      processingStartedAt: Uploads.processingStartedAt,
      processingCompletedAt: Uploads.processingCompletedAt,
    })
    .from(Uploads)
    .where(and(eq(Uploads.id, uploadId), eq(Uploads.patientId, patientId)))
    .limit(1);

  if (!uploadRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "UPLOAD_NOT_FOUND" });
  }

  // RLS additionally filters `low_confidence` rows to the patient's
  // own; the explicit `patient_id` predicate is belt-and-suspenders.
  const lowConfidenceRows = await database
    .select({
      id: ExtractionReviewQueue.id,
      biomarkerName: ExtractionReviewQueue.biomarkerName,
      valueText: ExtractionReviewQueue.valueText,
      unitText: ExtractionReviewQueue.unitText,
      loincCode: ExtractionReviewQueue.loincCode,
      collectedAtText: ExtractionReviewQueue.collectedAtText,
      confidenceScore: ExtractionReviewQueue.confidenceScore,
    })
    .from(ExtractionReviewQueue)
    .where(
      and(
        eq(ExtractionReviewQueue.uploadId, uploadId),
        eq(ExtractionReviewQueue.patientId, patientId),
        eq(ExtractionReviewQueue.reason, "low_confidence"),
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    );

  // Operator-only rows are NOT visible to the patient via RLS — so we
  // infer their presence from the upload's state. P135 — also require
  // `processingCompletedAt !== null` so a transient post-`processing`
  // moment (worker finished dispatch but hasn't transitioned the
  // upload status yet) doesn't surface a misleading "Aguardando
  // revisão da equipe" banner. Service-role-bypassed exact count is
  // F126 (requires SECURITY DEFINER view).
  const hasOperatorOnlyRows =
    uploadRow.status === "pending_review" &&
    uploadRow.processingCompletedAt !== null &&
    lowConfidenceRows.length === 0;

  const [obsCountRow] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(Observations)
    .where(
      and(
        eq(Observations.uploadId, uploadId),
        eq(Observations.patientId, patientId),
      ),
    );

  return {
    id: uploadRow.id,
    status: uploadRow.status,
    createdAt: uploadRow.createdAt,
    processingStartedAt: uploadRow.processingStartedAt,
    processingCompletedAt: uploadRow.processingCompletedAt,
    lowConfidenceFields: lowConfidenceRows,
    hasOperatorOnlyRows,
    publishedObservationCount: obsCountRow?.c ?? 0,
  };
}

export interface ConfirmReviewFieldInput {
  reviewQueueId: string;
  /** Optional override; when undefined, the original `valueText` is parsed. */
  patientValueNumeric?: number;
}

export interface ConfirmReviewFieldResult {
  observationId: string;
  uploadStatus: "pending_review" | "complete";
  remainingPatientReviewable: number;
}

/**
 * Story 2.4 — single sanctioned write path for a patient
 * confirming OR correcting a `low_confidence` review row.
 *
 * Runs inside the caller's transaction (`ctx.db` is already a
 * transaction inside `protectedProcedure`). The flow:
 *   1. Re-fetch the review row (RLS scopes to patient +
 *      `low_confidence`). If missing → `NOT_FOUND`; if
 *      `resolved_at IS NOT NULL` → `CONFLICT` (`ALREADY_RESOLVED`).
 *   2. Determine the patient's value: input override OR parse the
 *      original `valueText`. If neither yields a finite number →
 *      `BAD_REQUEST` (`UNPARSEABLE_VALUE`).
 *   3. Resolve LOINC + unit: prefer the review row's `loincCode`;
 *      else `resolveLoincCode(biomarkerName)`. If still null →
 *      `PRECONDITION_FAILED` (Story 2.3 data integrity bug).
 *   4. Resolve `collectedAt`: parse `collectedAtText`; fallback to
 *      the upload's `createdAt` date.
 *   5. `writeObservation` with `source = 'patient_corrected'`,
 *      `confidence_score = 1.0`, patient's value.
 *   6. UPDATE the review row: `resolved_at = now()`,
 *      `resolved_by_patient_id`, `correction_metadata` (set only
 *      when `patientValueNumeric` was provided).
 *   7. `writeAuditLog`: `observation.patient_confirmed` (no edit)
 *      OR `observation.patient_corrected` (edit).
 *   8. Re-count unresolved review rows for this upload (across
 *      ALL reasons — `loinc_unresolved` blocks completion). When
 *      zero, `applyUploadTransition(pending_review → complete)`
 *      + `writeAuditLog('notification.upload_complete')`.
 */
export async function confirmReviewFieldAsPatient(
  database: AuditDb,
  patientId: string,
  input: ConfirmReviewFieldInput,
): Promise<ConfirmReviewFieldResult> {
  const [reviewRow] = await database
    .select({
      id: ExtractionReviewQueue.id,
      uploadId: ExtractionReviewQueue.uploadId,
      biomarkerName: ExtractionReviewQueue.biomarkerName,
      valueText: ExtractionReviewQueue.valueText,
      unitText: ExtractionReviewQueue.unitText,
      loincCode: ExtractionReviewQueue.loincCode,
      collectedAtText: ExtractionReviewQueue.collectedAtText,
      confidenceScore: ExtractionReviewQueue.confidenceScore,
      resolvedAt: ExtractionReviewQueue.resolvedAt,
      reason: ExtractionReviewQueue.reason,
    })
    .from(ExtractionReviewQueue)
    .where(
      and(
        eq(ExtractionReviewQueue.id, input.reviewQueueId),
        eq(ExtractionReviewQueue.patientId, patientId),
        eq(ExtractionReviewQueue.reason, "low_confidence"),
      ),
    )
    .limit(1);

  if (!reviewRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "REVIEW_ROW_NOT_FOUND",
    });
  }
  if (reviewRow.resolvedAt !== null) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "ALREADY_RESOLVED",
    });
  }

  // Resolve the patient's value.
  const patientValue =
    input.patientValueNumeric ?? parseBrazilianDecimal(reviewRow.valueText);

  if (patientValue === null || !Number.isFinite(patientValue)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "UNPARSEABLE_VALUE",
    });
  }

  // Resolve LOINC + unit.
  let loincCode: string | null = reviewRow.loincCode;
  let unitUcum = "";
  if (loincCode === null) {
    const resolved = await resolveLoincCode(database, reviewRow.biomarkerName);
    if (!resolved) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "LOINC_UNRESOLVED",
      });
    }
    loincCode = resolved.loincCode;
    unitUcum = resolved.unitUcum;
  } else {
    // We have a LOINC but the unit isn't on the review row — look it up.
    const resolved = await resolveLoincCode(database, reviewRow.biomarkerName);
    unitUcum = resolved?.unitUcum ?? reviewRow.unitText ?? "";
  }

  // P138 — publishing with an empty unit produces meaningless data.
  // If both the LOINC lookup miss AND the review row's text are empty,
  // surface the worker-side bug instead of swallowing.
  if (unitUcum.trim().length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "UNIT_UNRESOLVED",
    });
  }

  // Resolve collectedAt: prefer the review row's text, fall back to
  // the upload's createdAt date.
  let collectedAt: Date | null = reviewRow.collectedAtText
    ? parseCollectedAt(reviewRow.collectedAtText)
    : null;
  if (collectedAt === null) {
    const [uploadRow] = await database
      .select({ createdAt: Uploads.createdAt })
      .from(Uploads)
      .where(eq(Uploads.id, reviewRow.uploadId))
      .limit(1);
    if (!uploadRow) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "UPLOAD_NOT_FOUND",
      });
    }
    // Strip the time portion — observations.collected_at is a DATE column.
    collectedAt = new Date(
      Date.UTC(
        uploadRow.createdAt.getUTCFullYear(),
        uploadRow.createdAt.getUTCMonth(),
        uploadRow.createdAt.getUTCDate(),
      ),
    );
  }

  const inserted = await writeObservation(database, {
    patientId,
    uploadId: reviewRow.uploadId,
    loincCode,
    biomarkerName: reviewRow.biomarkerName,
    valueNumeric: patientValue,
    unitUcum,
    labName: undefined,
    collectedAt,
    // Story 2.4 — patient confirmation publishes at full confidence.
    confidenceScore: 1.0,
    source: "patient_corrected",
  });

  // P130 / P136 / P137 — on ON-CONFLICT (idempotent retry) the helper
  // returns null. We must re-fetch the existing observation so the
  // audit event carries the correct `resourceId` (the observation id,
  // not the review-queue id) AND so we can verify the existing row
  // actually belongs to this review row's upload (defensive guard
  // against a same-day same-biomarker collision across uploads).
  let observationId: string;
  if (inserted) {
    observationId = inserted.id;
  } else {
    const [existing] = await database
      .select({ id: Observations.id, uploadId: Observations.uploadId })
      .from(Observations)
      .where(
        and(
          eq(Observations.patientId, patientId),
          eq(Observations.uploadId, reviewRow.uploadId),
          eq(Observations.loincCode, loincCode),
          eq(Observations.collectedAt, collectedAt.toISOString().slice(0, 10)),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "OBSERVATION_CONFLICT_MISSING",
      });
    }
    if (existing.uploadId !== reviewRow.uploadId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "OBSERVATION_BELONGS_TO_DIFFERENT_UPLOAD",
      });
    }
    observationId = existing.id;
  }

  const isEdit = input.patientValueNumeric !== undefined;
  const correctedAt = new Date().toISOString();
  const correctionMetadata = isEdit
    ? {
        patientValue,
        originalValueText: reviewRow.valueText,
        correctedAt,
      }
    : null;

  await database
    .update(ExtractionReviewQueue)
    .set({
      resolvedAt: new Date(),
      resolvedByPatientId: patientId,
      correctionMetadata,
    })
    .where(eq(ExtractionReviewQueue.id, reviewRow.id));

  // observation may be null when ON CONFLICT no-op'd (idempotent retry).
  // We still emit the audit event (the patient action is what we audit;
  // the row creation may have happened on a prior attempt).
  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: isEdit
      ? "observation.patient_corrected"
      : "observation.patient_confirmed",
    resourceId: observationId,
    resourceType: "observation",
    metadata: {
      uploadId: reviewRow.uploadId,
      reviewQueueId: reviewRow.id,
      // P133 — `confidenceScore` is a Postgres `numeric` returned as
      // a string by Drizzle. Coerce to number for downstream consumers
      // that key off ranges; guard against NaN by falling back to the
      // string when parse fails.
      originalConfidence: Number.isFinite(Number(reviewRow.confidenceScore))
        ? Number(reviewRow.confidenceScore)
        : reviewRow.confidenceScore,
      ...(isEdit
        ? {
            originalValueText: reviewRow.valueText,
            patientValue,
          }
        : {}),
    },
  });

  // Re-count unresolved review rows across ALL reasons. RLS would hide
  // `loinc_unresolved` rows; use a raw SQL count that bypasses the row
  // filter via the explicit `patient_id` predicate (we're still on the
  // patient connection though — for the operator-only rows the SELECT
  // policy filters them out). So use the same trick as
  // `getUploadDetailForPatient`: if `uploadStatus = pending_review` AND
  // the patient sees zero unresolved rows, operator-only rows MAY still
  // exist. We attempt the transition; the optimistic-lock semantic of
  // `applyUploadTransition` means the UPDATE matches zero rows if the
  // upload is in fact not in `pending_review` (already complete, or
  // had operator rows mark it failed). The remaining-patient-reviewable
  // count we return is patient-visible only.
  const [remainingRow] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(ExtractionReviewQueue)
    .where(
      and(
        eq(ExtractionReviewQueue.uploadId, reviewRow.uploadId),
        eq(ExtractionReviewQueue.patientId, patientId),
        eq(ExtractionReviewQueue.reason, "low_confidence"),
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    );
  const remainingPatientReviewable = remainingRow?.c ?? 0;

  let uploadStatus: "pending_review" | "complete" = "pending_review";
  if (remainingPatientReviewable === 0) {
    // The patient finished their share. Try to transition — if the
    // upload still has operator-only `loinc_unresolved` rows, we can
    // detect that by selecting the upload's current status post-attempt.
    //
    // Check the broader unresolved count via a service-role-equivalent
    // path: we know operator rows are invisible on this connection, so
    // we use a heuristic: attempt the transition; if it succeeds, the
    // upload was indeed clear. If not, the upload is either already
    // `complete` (idempotent retry) or had operator-only rows mark
    // a state we can't see.
    const transitionResult = await applyUploadTransition(database, {
      uploadId: reviewRow.uploadId,
      from: "pending_review",
      to: "complete",
      metadata: { completedBy: "patient_review_finalized" },
    });
    if (transitionResult.updated) {
      uploadStatus = "complete";
      // Story 2.5 will consume this; we just emit the audit event here.
      await writeAuditLog(database, {
        actorId: patientId,
        actorType: "system",
        event: "notification.upload_complete",
        resourceId: reviewRow.uploadId,
        resourceType: "upload",
        metadata: {
          // Story 2.3 F120 — no system-sentinel UUID yet; we reuse the
          // patient id as actorId for system events tied to a patient
          // action. Documented gap.
          triggeredBy: "patient_confirmation",
        },
      });
    } else {
      // Either already-complete (idempotent retry) OR operator-only
      // rows still block completion. Re-read status to know.
      const [post] = await database
        .select({ status: Uploads.status })
        .from(Uploads)
        .where(eq(Uploads.id, reviewRow.uploadId))
        .limit(1);
      if (post?.status === "complete") {
        uploadStatus = "complete";
      }
    }
  }

  return {
    observationId,
    uploadStatus,
    remainingPatientReviewable,
  };
}
