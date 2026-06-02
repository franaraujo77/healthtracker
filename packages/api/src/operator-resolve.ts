import { TRPCError } from "@trpc/server";

import type { OperatorRejectionReason } from "@healthtracker/validators";
import { and, eq, isNull, sql } from "@healthtracker/db";
import { ExtractionReviewQueue, Uploads } from "@healthtracker/db/schema";
import {
  EXTRACTION_FIELD_OPERATOR_CONFIRMED,
  EXTRACTION_FIELD_OPERATOR_REJECTED,
  parseBrazilianDecimal,
  parseCollectedAt,
} from "@healthtracker/validators";

import type { AuditDb } from "./audit";
import type { NotificationKind } from "./notifications";
import { writeAuditLog, writeAuditLogIfNew } from "./audit";
import { enqueueNotificationSend } from "./notifications";
import { writeObservation } from "./observations";
import { applyUploadTransition } from "./upload-transitions";

/**
 * Story 8.2 — operator confirm/reject WRITE helpers for the manual review
 * queue (`reason = 'loinc_unresolved'` rows; Story 8.1 scope).
 *
 * **Privilege model (the security core).** The operator RLS principal has
 * NO write policy on `observations`/`uploads`/`extraction_review_queue`,
 * and RLS hides `low_confidence` rows from it. So the CALLER
 * (`operatorRouter.confirmField` / `.rejectField`) escalates to
 * `SET LOCAL ROLE postgres` inside the `operatorProcedure` transaction —
 * paired with `SET LOCAL ROLE NONE` in a `finally` — before invoking
 * these helpers. These functions therefore run with RLS bypassed and can
 * (a) write the cross-patient observation/transition and (b) count ALL
 * unresolved rows (both reasons) so an upload only completes when the
 * patient's `low_confidence` rows are also done. The escalation +
 * mandatory reset is the `sharing.ts` `activateProfessionalAccount`
 * precedent (CLAUDE.md "privilege escalation must reset in same tx scope").
 *
 * Confirm publishes the extracted VALUE with `loinc_code = NULL` (the row
 * is `loinc_unresolved` by definition; the operator does not map a LOINC).
 */

interface ReviewRow {
  id: string;
  uploadId: string;
  patientId: string;
  biomarkerName: string;
  valueText: string;
  unitText: string | null;
  collectedAtText: string | null;
  labName: string | null;
  resolvedAt: Date | null;
}

export interface OperatorResolveResult {
  /** Upload status after this action (may still be pending_review). */
  uploadStatus: "pending_review" | "complete";
}

async function fetchUnresolvedRow(
  database: AuditDb,
  reviewQueueId: string,
): Promise<ReviewRow> {
  const [row] = await database
    .select({
      id: ExtractionReviewQueue.id,
      uploadId: ExtractionReviewQueue.uploadId,
      patientId: ExtractionReviewQueue.patientId,
      biomarkerName: ExtractionReviewQueue.biomarkerName,
      valueText: ExtractionReviewQueue.valueText,
      unitText: ExtractionReviewQueue.unitText,
      collectedAtText: ExtractionReviewQueue.collectedAtText,
      labName: ExtractionReviewQueue.labName,
      resolvedAt: ExtractionReviewQueue.resolvedAt,
    })
    .from(ExtractionReviewQueue)
    .where(
      and(
        eq(ExtractionReviewQueue.id, reviewQueueId),
        eq(ExtractionReviewQueue.reason, "loinc_unresolved"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "REVIEW_ROW_NOT_FOUND" });
  }
  if (row.resolvedAt !== null) {
    throw new TRPCError({ code: "CONFLICT", message: "ALREADY_RESOLVED" });
  }
  return row;
}

/**
 * Resolve `collected_at` (a DATE) — prefer the row's source text,
 * normalized to UTC midnight; fall back to the upload's created date.
 * Mirrors `confirmReviewFieldAsPatient`.
 */
async function resolveCollectedAt(
  database: AuditDb,
  row: ReviewRow,
): Promise<Date> {
  let collectedAt: Date | null = row.collectedAtText
    ? parseCollectedAt(row.collectedAtText)
    : null;
  if (collectedAt !== null) {
    collectedAt = new Date(
      Date.UTC(
        collectedAt.getUTCFullYear(),
        collectedAt.getUTCMonth(),
        collectedAt.getUTCDate(),
      ),
    );
    return collectedAt;
  }
  const [uploadRow] = await database
    .select({ createdAt: Uploads.createdAt })
    .from(Uploads)
    .where(eq(Uploads.id, row.uploadId))
    .limit(1);
  if (!uploadRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "UPLOAD_NOT_FOUND" });
  }
  return new Date(
    Date.UTC(
      uploadRow.createdAt.getUTCFullYear(),
      uploadRow.createdAt.getUTCMonth(),
      uploadRow.createdAt.getUTCDate(),
    ),
  );
}

/**
 * Finalize the upload if every review row (BOTH reasons) is resolved.
 * Runs under the escalated `postgres` role, so the count sees the
 * patient's `low_confidence` rows too — the upload only completes when
 * the patient is also done. Emits exactly one finalization notification:
 * `manual_entry_required` if any field was rejected, else `complete`.
 */
async function finalizeUploadIfResolved(
  database: AuditDb,
  uploadId: string,
  patientId: string,
): Promise<"pending_review" | "complete"> {
  const [remaining] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(ExtractionReviewQueue)
    .where(
      and(
        eq(ExtractionReviewQueue.uploadId, uploadId),
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    );
  if ((remaining?.c ?? 0) > 0) return "pending_review";

  const transition = await applyUploadTransition(database, {
    uploadId,
    from: "pending_review",
    to: "complete",
    metadata: { completedBy: "operator_review_finalized" },
  });
  // Either we transitioned, or a concurrent finalizer already did.
  const isComplete =
    transition.updated || transition.currentStatus === "complete";
  if (!isComplete) return "pending_review";

  // Choose the notification kind: any rejected field on this upload →
  // the patient must enter value(s) manually.
  const [rejected] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(ExtractionReviewQueue)
    .where(
      and(
        eq(ExtractionReviewQueue.uploadId, uploadId),
        sql`${ExtractionReviewQueue.rejectionReason} IS NOT NULL`,
      ),
    );
  const kind: NotificationKind =
    (rejected?.c ?? 0) > 0 ? "manual_entry_required" : "complete";

  // `writeAuditLogIfNew` on the `(resource_id, event)` partial unique
  // index sidesteps the 23505 race with the worker's direct-publish
  // complete-emit; enqueue the notification only when WE wrote the audit.
  const { written } = await writeAuditLogIfNew(database, {
    actorId: patientId,
    actorType: "system",
    event: "notification.upload_complete",
    resourceId: uploadId,
    resourceType: "upload",
    metadata: { triggeredBy: "operator_review_finalized", kind },
  });
  if (written) {
    await enqueueNotificationSend(database, { uploadId, patientId, kind });
  }
  // NOTE: Letter generation is intentionally NOT enqueued here — it needs
  // the patient's consent/session context that the operator does not
  // carry. Operator-finalized uploads do not auto-generate a Letter
  // (documented open question; a follow-up can wire patient context).
  return "complete";
}

/**
 * Story 8.2 AC1/AC3 — operator confirms a flagged field. Publishes the
 * extracted value (loinc_code NULL, source 'operator_confirmed',
 * confidence 1.0), marks the row resolved, audits, and finalizes.
 * REQUIRES the caller to have escalated to `postgres` role.
 */
export async function confirmReviewFieldAsOperator(
  database: AuditDb,
  operatorId: string,
  input: { reviewQueueId: string },
): Promise<OperatorResolveResult> {
  const row = await fetchUnresolvedRow(database, input.reviewQueueId);

  const value = parseBrazilianDecimal(row.valueText);
  if (value === null || !Number.isFinite(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "UNPARSEABLE_VALUE" });
  }
  const unitUcum = row.unitText ?? "";
  if (unitUcum.trim().length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "UNIT_UNRESOLVED",
    });
  }
  const collectedAt = await resolveCollectedAt(database, row);

  const inserted = await writeObservation(database, {
    patientId: row.patientId,
    uploadId: row.uploadId,
    // Decision (Story 8.2): the operator does NOT map a LOINC — the row
    // is `loinc_unresolved`, so the observation publishes with NULL code.
    loincCode: undefined,
    biomarkerName: row.biomarkerName,
    valueNumeric: value,
    unitUcum,
    labName: row.labName ?? undefined,
    collectedAt,
    confidenceScore: 1.0,
    source: "operator_confirmed",
  });
  // With `loinc_code = NULL` the partial unique index never matches
  // (NULL ≠ NULL), so the insert always returns a row. Guard anyway.
  if (!inserted) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "OBSERVATION_INSERT_FAILED",
    });
  }

  await database
    .update(ExtractionReviewQueue)
    .set({ resolvedAt: new Date(), resolvedByOperatorId: operatorId })
    .where(
      and(
        eq(ExtractionReviewQueue.id, row.id),
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    );

  await writeAuditLog(database, {
    actorId: operatorId,
    actorType: "operator",
    event: EXTRACTION_FIELD_OPERATOR_CONFIRMED,
    resourceId: row.id,
    resourceType: "extraction_review_queue",
    metadata: {
      patientId: row.patientId,
      loincCode: null,
      uploadId: row.uploadId,
      reviewQueueId: row.id,
    },
  });

  const uploadStatus = await finalizeUploadIfResolved(
    database,
    row.uploadId,
    row.patientId,
  );
  return { uploadStatus };
}

/**
 * Story 8.2 AC2/AC3 — operator rejects a flagged field with a reason.
 * Marks the row rejected (no observation), audits, and finalizes.
 * REQUIRES the caller to have escalated to `postgres` role.
 */
export async function rejectReviewFieldAsOperator(
  database: AuditDb,
  operatorId: string,
  input: { reviewQueueId: string; rejectionReason: OperatorRejectionReason },
): Promise<OperatorResolveResult> {
  const row = await fetchUnresolvedRow(database, input.reviewQueueId);

  await database
    .update(ExtractionReviewQueue)
    .set({
      resolvedAt: new Date(),
      resolvedByOperatorId: operatorId,
      rejectionReason: input.rejectionReason,
    })
    .where(
      and(
        eq(ExtractionReviewQueue.id, row.id),
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    );

  await writeAuditLog(database, {
    actorId: operatorId,
    actorType: "operator",
    event: EXTRACTION_FIELD_OPERATOR_REJECTED,
    resourceId: row.id,
    resourceType: "extraction_review_queue",
    metadata: {
      patientId: row.patientId,
      loincCode: null,
      uploadId: row.uploadId,
      reviewQueueId: row.id,
      rejectionReason: input.rejectionReason,
    },
  });

  const uploadStatus = await finalizeUploadIfResolved(
    database,
    row.uploadId,
    row.patientId,
  );
  return { uploadStatus };
}
