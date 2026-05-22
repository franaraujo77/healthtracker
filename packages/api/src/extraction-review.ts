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
  confidenceScore: number;
  reason: "low_confidence" | "loinc_unresolved";
}

/**
 * Story 2.3 — single sanctioned write path for
 * `extraction_review_queue` rows.
 *
 * No idempotency seam (each row is a unique reviewer task; the same
 * upload re-processed produces a new row, which the operator UI
 * deduplicates by `(upload_id, biomarker_name)` if needed).
 *
 * Worker calls via service-role connection; RLS on the table has
 * zero patient/doctor policies so only service-role can write.
 */
export async function writeReviewQueueEntry(
  database: AuditDb,
  entry: ReviewQueueEntryInsert,
): Promise<{ id: string }> {
  const [row] = await database
    .insert(ExtractionReviewQueue)
    .values({
      patientId: entry.patientId,
      uploadId: entry.uploadId,
      biomarkerName: entry.biomarkerName,
      valueText: entry.valueText,
      unitText: entry.unitText ?? null,
      loincCode: entry.loincCode ?? null,
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
