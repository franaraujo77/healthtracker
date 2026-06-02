import { ExtractionReviewQueue } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

export interface ReviewQueueEntryInsert {
  patientId: string;
  uploadId: string;
  biomarkerName: string;
  /** Original textual value from the source — NOT parsed. */
  valueText: string;
  unitText?: string;
  loincCode?: string;
  /** Story 8.1 — denormalised lab name; keeps the operator queue off `uploads`. */
  labName?: string;
  confidenceScore: number;
  reason: "low_confidence" | "loinc_unresolved";
}

/**
 * Story 2.3 — single sanctioned write path for
 * `extraction_review_queue` rows.
 *
 * R2-P127 — idempotency seam: a unique index on
 * `(upload_id, biomarker_name, reason)` (added by R2-P113) makes
 * crash-recovery resumes safe. The Drizzle helper itself doesn't
 * call `.onConflictDoNothing()` (callers that need that semantic
 * use the worker's raw SQL path); this helper throws if the row
 * already exists.
 *
 * Worker calls via service-role connection; RLS on the table has
 * zero patient/doctor policies so only service-role can write.
 */
export async function writeReviewQueueEntry(
  database: AuditDb,
  entry: ReviewQueueEntryInsert,
): Promise<{ id: string }> {
  // R2-P125 — mirror R1-P108 finite-numeric validation from
  // writeObservation. NaN confidenceScore would otherwise become
  // the string `'NaN'`, which postgres numeric rejects at the DB
  // layer rather than the helper boundary.
  if (!Number.isFinite(entry.confidenceScore)) {
    throw new Error(
      `writeReviewQueueEntry: confidenceScore must be finite, got ${entry.confidenceScore}`,
    );
  }

  const [row] = await database
    .insert(ExtractionReviewQueue)
    .values({
      patientId: entry.patientId,
      uploadId: entry.uploadId,
      biomarkerName: entry.biomarkerName,
      valueText: entry.valueText,
      unitText: entry.unitText ?? null,
      loincCode: entry.loincCode ?? null,
      labName: entry.labName ?? null,
      confidenceScore: String(entry.confidenceScore),
      reason: entry.reason,
    })
    .returning({ id: ExtractionReviewQueue.id });
  if (!row) {
    throw new Error(
      "writeReviewQueueEntry: insert returned no row — unexpected for a non-ON-CONFLICT insert",
    );
  }
  return row;
}
