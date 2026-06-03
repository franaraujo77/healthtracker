import { and, asc, eq, isNull, sql } from "@healthtracker/db";
import { ExtractionReviewQueue } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

/**
 * Story 8.1 — read-side helpers for the operator anonymised review
 * queue. Both helpers read ONLY `extraction_review_queue` and filter to
 * `reason = 'loinc_unresolved'` (the operator-only review reason;
 * `low_confidence` rows are patient-facing, Story 2.4).
 *
 * **The anonymisation boundary is RLS, not these queries.** The operator
 * RLS principal (`app.current_user_role = 'operator'`) has zero read
 * policy on `users` or `uploads`, so these helpers physically cannot
 * touch a PII-bearing table — and they don't try to. `lab_name` and
 * `collected_at_text` are denormalised onto this table precisely so no
 * `uploads` join (and thus no `uploads.original_filename` PII leak) is
 * needed (AR5 / NFR-S7). The explicit `WHERE reason = 'loinc_unresolved'`
 * is defense-in-depth and keeps the query correct under any principal
 * (e.g. service-role in tests).
 *
 * **Read-only.** No `writeAuditLog`, no mutation — Story 8.1 is FR38
 * (view) only. Operator confirm/reject + audit land in Story 8.2.
 */

/** One queue row in the operator list — one upload with flagged fields. */
export interface OperatorQueueListItem {
  uploadId: string;
  /** UUID only — the sole patient identifier the operator ever sees. */
  patientId: string;
  labName: string | null;
  /** Unparsed source draw-date text (may be free-form or ISO). */
  collectedAtText: string | null;
  flaggedFieldCount: number;
}

/** One flagged field in the operator detail view. */
export interface OperatorQueueField {
  id: string;
  biomarkerName: string;
  /** Original textual value from the source — for these rows this IS the raw OCR output. */
  valueText: string;
  unitText: string | null;
  collectedAtText: string | null;
  labName: string | null;
  confidenceScore: number;
}

/**
 * Coerce a Drizzle PG-numeric column (typed as `string`) to a JS
 * `number`; defaults to 0 on null/NaN (a bad confidence must not hide a
 * field that still needs review). Narrow contract — `parseFloat` never
 * throws (Story 2.4 numeric discipline).
 */
function coerceConfidence(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Story 8.1 AC1 — the operator queue list. One item per upload that has
 * at least one `loinc_unresolved` row, oldest-first so the
 * longest-waiting upload is triaged first.
 */
export async function listOperatorReviewQueue(
  database: AuditDb,
): Promise<OperatorQueueListItem[]> {
  // Group by (upload_id, patient_id) ONLY — NOT lab_name. `lab_name` is
  // denormalised per-field, and a single upload's fields can legitimately
  // carry different (or NULL) lab names (a multi-lab PDF; the worker even
  // tallies distinct lab names). Grouping by it would split one upload
  // into several list rows with partial counts + duplicate React keys,
  // breaking AC1's "one item per upload". `lab_name`/`collected_at_text`
  // are collapsed via `min()` to one deterministic value per upload.
  const rows = await database
    .select({
      uploadId: ExtractionReviewQueue.uploadId,
      patientId: ExtractionReviewQueue.patientId,
      labName: sql<string | null>`min(${ExtractionReviewQueue.labName})`,
      collectedAtText: sql<
        string | null
      >`min(${ExtractionReviewQueue.collectedAtText})`,
      flaggedFieldCount: sql<number>`count(*)::int`,
    })
    .from(ExtractionReviewQueue)
    // Story 8.2 — exclude rows an operator has already resolved
    // (confirmed/rejected) so they leave the queue view.
    .where(
      and(
        eq(ExtractionReviewQueue.reason, "loinc_unresolved"),
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    )
    .groupBy(ExtractionReviewQueue.uploadId, ExtractionReviewQueue.patientId)
    .orderBy(asc(sql`min(${ExtractionReviewQueue.createdAt})`));

  return rows.map((row) => ({
    uploadId: row.uploadId,
    patientId: row.patientId,
    labName: row.labName,
    collectedAtText: row.collectedAtText,
    flaggedFieldCount: row.flaggedFieldCount,
  }));
}

/**
 * Story 8.1 AC2 — the operator detail view: every `loinc_unresolved`
 * flagged field for one upload, ordered by insertion.
 */
export async function getOperatorQueueItem(
  database: AuditDb,
  uploadId: string,
): Promise<OperatorQueueField[]> {
  const rows = await database
    .select({
      id: ExtractionReviewQueue.id,
      biomarkerName: ExtractionReviewQueue.biomarkerName,
      valueText: ExtractionReviewQueue.valueText,
      unitText: ExtractionReviewQueue.unitText,
      collectedAtText: ExtractionReviewQueue.collectedAtText,
      labName: ExtractionReviewQueue.labName,
      confidenceScore: ExtractionReviewQueue.confidenceScore,
    })
    .from(ExtractionReviewQueue)
    .where(
      and(
        eq(ExtractionReviewQueue.uploadId, uploadId),
        eq(ExtractionReviewQueue.reason, "loinc_unresolved"),
        // Story 8.2 — drop already-resolved fields from the detail view.
        isNull(ExtractionReviewQueue.resolvedAt),
      ),
    )
    .orderBy(asc(ExtractionReviewQueue.createdAt));

  return rows.map((row) => ({
    id: row.id,
    biomarkerName: row.biomarkerName,
    valueText: row.valueText,
    unitText: row.unitText,
    collectedAtText: row.collectedAtText,
    labName: row.labName,
    confidenceScore: coerceConfidence(row.confidenceScore),
  }));
}
