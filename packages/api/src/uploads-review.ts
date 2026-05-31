import { TRPCError } from "@trpc/server";

import { and, eq, isNull, sql } from "@healthtracker/db";
import {
  EmotionalCheckins,
  ExtractionReviewQueue,
  Observations,
  Uploads,
  VoiceMemos,
} from "@healthtracker/db/schema";
import {
  parseBrazilianDecimal,
  parseCollectedAt,
} from "@healthtracker/validators";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";
import { enqueueLetterGeneration } from "./letters";
import { resolveLoincCode } from "./loinc";
import { enqueueNotificationSend } from "./notifications";
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
  // Story 7.2 — viewed_at is NULL until the first open of the upload
  // detail screen. `isFirstView` is derived BEFORE any side-effect so
  // the client can gate the pre-results emotional check-in sheet on
  // it; the actual mark lands via the separate `markUploadViewed`
  // mutation that the client fires from the sheet's open/skip
  // handlers.
  viewedAt: Date | null;
  isFirstView: boolean;
  hasPreEmotionalCheckIn: boolean;
  hasPostEmotionalCheckIn: boolean;
  hasVoiceMemo: boolean;
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
      viewedAt: Uploads.viewedAt,
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

  // Story 7.2 — defense-in-depth on top of `viewed_at`: even if a
  // future bug failed to mark `viewed_at`, the existing pre check-in
  // row blocks the sheet from re-prompting. RLS scopes by patient.
  const [preCheckInExists] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(EmotionalCheckins)
    .where(
      and(
        eq(EmotionalCheckins.uploadId, uploadId),
        eq(EmotionalCheckins.patientId, patientId),
        eq(EmotionalCheckins.type, "pre"),
      ),
    );

  // Story 7.3 — same existence probe for the post check-in. Gates
  // the "Finalizar revisão" CTA so the post sheet is only offered
  // when (a) a pre row exists, AND (b) no post row exists yet.
  const [postCheckInExists] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(EmotionalCheckins)
    .where(
      and(
        eq(EmotionalCheckins.uploadId, uploadId),
        eq(EmotionalCheckins.patientId, patientId),
        eq(EmotionalCheckins.type, "post"),
      ),
    );

  // Story 7.4 — voice memo existence probe. Gates the "Adicionar
  // memo de voz" CTA.
  const [voiceMemoExists] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(VoiceMemos)
    .where(
      and(
        eq(VoiceMemos.uploadId, uploadId),
        eq(VoiceMemos.patientId, patientId),
      ),
    );

  return {
    id: uploadRow.id,
    status: uploadRow.status,
    createdAt: uploadRow.createdAt,
    processingStartedAt: uploadRow.processingStartedAt,
    processingCompletedAt: uploadRow.processingCompletedAt,
    viewedAt: uploadRow.viewedAt,
    isFirstView: uploadRow.viewedAt === null,
    hasPreEmotionalCheckIn: (preCheckInExists?.c ?? 0) > 0,
    hasPostEmotionalCheckIn: (postCheckInExists?.c ?? 0) > 0,
    hasVoiceMemo: (voiceMemoExists?.c ?? 0) > 0,
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
  /**
   * Story 4.1 — full Supabase user object, threaded so
   * `enqueueLetterGeneration` can read `app_metadata.subscriptionTier`.
   * Optional for back-compat with existing tests that pass only the
   * patientId; in that case the premium gate falls back to "free"
   * and the Letter enqueue is skipped (safe default).
   */
  sessionUser?: unknown,
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
  // the upload's createdAt date. R2-P144 — normalize to UTC midnight
  // unconditionally so the re-SELECT conflict-key probe below uses
  // the same ISO date string the original `writeObservation` insert
  // computed (otherwise a parsed-Date with a local-TZ offset would
  // ISO-format to a different day than the on-disk row).
  let collectedAt: Date | null = reviewRow.collectedAtText
    ? parseCollectedAt(reviewRow.collectedAtText)
    : null;
  if (collectedAt !== null) {
    collectedAt = new Date(
      Date.UTC(
        collectedAt.getUTCFullYear(),
        collectedAt.getUTCMonth(),
        collectedAt.getUTCDate(),
      ),
    );
  }
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

  // P130 / P136 — on ON-CONFLICT (idempotent retry) the helper
  // returns null. Re-fetch the existing observation so the audit
  // event carries the correct `resourceId` (the observation id, not
  // the review-queue id).
  //
  // R2-P143 — the cross-upload guard that P137 added was dead code
  // (the SELECT predicate already filters by `uploadId`). The unique
  // index includes `upload_id`, so a same-(patient, loinc, date)
  // collision across two distinct uploads CANNOT trigger ON CONFLICT
  // — both rows simply insert with their own `upload_id`. The guard
  // is dropped.
  let observationId: string;
  if (inserted) {
    observationId = inserted.id;
  } else {
    const [existing] = await database
      .select({ id: Observations.id })
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

  // R2-P146 — defense-in-depth: the WHERE clause now scopes by
  // `patient_id` AND `resolved_at IS NULL`. RLS already enforces
  // ownership; the explicit predicates protect against (a) future
  // service-role callers bypassing RLS, and (b) lost-update races
  // where two confirm calls for the same review row would otherwise
  // both succeed and the second writer's `correction_metadata`
  // would silently clobber the first. The `isNull(resolvedAt)`
  // guard means the second writer's UPDATE matches zero rows; the
  // helper continues (idempotent — both calls reach the same
  // post-state) but the audit event still fires for both, which
  // matches the AC2/AC3 contract (we audit the patient action, not
  // the DB-row creation).
  const updatedRows = await database
    .update(ExtractionReviewQueue)
    .set({
      resolvedAt: new Date(),
      resolvedByPatientId: patientId,
      correctionMetadata,
    })
    .where(
      and(
        eq(ExtractionReviewQueue.id, reviewRow.id),
        eq(ExtractionReviewQueue.patientId, patientId),
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    )
    .returning({ id: ExtractionReviewQueue.id });
  // updatedRows.length === 0 means a concurrent confirm beat us;
  // log so operations can spot it but don't throw — the AC contract
  // for idempotent retry should "look like success".
  if (updatedRows.length === 0) {
    console.warn(
      `[confirmReviewField] reviewQueueId=${reviewRow.id}: UPDATE matched zero rows — concurrent confirm OR foreign UPDATE attempt`,
    );
  }

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
    } else {
      // Either already-complete (idempotent retry) OR operator-only
      // rows still block completion. Re-read status to know.
      // F133 — log the operator-row-blocked branch so ops can spot
      // orphaned operator rows quietly holding the upload back.
      const [post] = await database
        .select({ status: Uploads.status })
        .from(Uploads)
        .where(eq(Uploads.id, reviewRow.uploadId))
        .limit(1);
      if (post?.status === "complete") {
        uploadStatus = "complete";
      } else {
        // F133 — operator-only rows still block completion; surface
        // this so Ops can investigate orphans.
        console.warn(
          `[confirmReviewField] uploadId=${reviewRow.uploadId}: patient finished but upload is in ${post?.status ?? "unknown"} — operator-only rows likely block completion`,
        );
      }
    }
  }

  // R2-P149 — emit `notification.upload_complete` whenever the
  // upload reaches `complete` via this code path, INCLUDING when a
  // concurrent finalizer beat us to the transition. Story 2.5's
  // notification dispatcher is the consumer; idempotency on
  // delivery is its responsibility. The audit row carries
  // `actorType: 'system'` because the upload-completion fact is a
  // system event tied to a patient action (F127 — no system
  // sentinel UUID yet).
  if (uploadStatus === "complete") {
    // R2-P172 — defend against the TOCTOU race between this path and
    // the worker's direct-publish complete-emit. The partial unique
    // index `audit_log_notification_event_unique` makes the second
    // INSERT raise `unique_violation` (SQLSTATE 23505); catch +
    // skip the enqueue (the first writer queued it).
    try {
      await writeAuditLog(database, {
        actorId: patientId,
        actorType: "system",
        event: "notification.upload_complete",
        resourceId: reviewRow.uploadId,
        resourceType: "upload",
        metadata: { triggeredBy: "patient_confirmation" },
      });
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? err.code
          : undefined;
      if (code !== "23505") throw err;
      console.warn(
        `[confirmReviewField] uploadId=${reviewRow.uploadId}: notification.upload_complete audit already exists — skipping enqueue`,
      );
      return {
        observationId,
        uploadStatus,
        remainingPatientReviewable,
      };
    }
    // Story 2.5 — paired audit + enqueue. The pg-boss job
    // `notification.send` is singleton-keyed on `(uploadId, kind)`
    // so an idempotent retry of the patient-confirm path does NOT
    // fire two push notifications for the same completion.
    //
    // R1-P163 — there are TWO `notification.upload_complete` emit
    // sites: this one (patient-confirm path) and the worker's
    // direct-publish path in `services/extraction/src/consumers/
    // document.ts`. They are mutually exclusive by state: the worker
    // only reaches `processing → complete` when no review rows
    // were written, which means this patient-confirm path never
    // runs for that upload. If pg-boss ever sequences them in an
    // unexpected race, the singleton_key dedups the SECOND job
    // (subject to F140's snapshot guard against schema drift).
    await enqueueNotificationSend(database, {
      uploadId: reviewRow.uploadId,
      patientId,
      kind: "complete",
    });
    // Story 4.1 — Letter enqueue lives in the SAME tx as the
    // notification enqueue so a Letter for this confirmation either
    // queues atomically with the upload-complete transition or
    // (per NFR-I3) is silently skipped without blocking the commit.
    // `enqueueLetterGeneration` returns `{enqueued: false, reason}`
    // for every skip path (free tier, missing consent, muted
    // preference, already queued) — caller does not throw.
    const letterResult = await enqueueLetterGeneration(database, {
      patientId,
      uploadId: reviewRow.uploadId,
      sessionUser,
    });
    if (!letterResult.enqueued) {
      console.log(
        `[confirmReviewField] uploadId=${reviewRow.uploadId}: letter skipped (${letterResult.reason})`,
      );
    }
  }

  return {
    observationId,
    uploadStatus,
    remainingPatientReviewable,
  };
}
