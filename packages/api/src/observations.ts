import { Observations } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

export interface ObservationInsert {
  patientId: string;
  uploadId: string;
  /**
   * Story 2.3 R1-P102 — NULLABLE. The pipeline routes LOINC-unresolved
   * fields to `extraction_review_queue` so `observations` rows
   * typically have a resolved code; future patient-corrected paths
   * (Story 2.4) may insert with NULL.
   */
  loincCode?: string;
  biomarkerName: string;
  valueNumeric: number;
  unitUcum: string;
  referenceRangeLow?: number;
  referenceRangeHigh?: number;
  labName?: string;
  collectedAt: Date;
  confidenceScore: number;
  source: "extracted" | "manual_bia" | "patient_corrected";
}

/**
 * Story 2.3 — single sanctioned write path for `observations` rows.
 *
 * Mirrors `writeAuditLog` / `writeUpload` / `writeConsentGrant`:
 * every INSERT goes through this function so cross-cutting concerns
 * (telemetry, idempotency variants) live in one place.
 *
 * Idempotent on the
 * `(patient_id, upload_id, loinc_code, collected_at)` UNIQUE seam
 * — re-processing the same document doesn't duplicate observations.
 * Returns null on conflict (caller treats as no-op / skipped duplicate).
 */
export async function writeObservation(
  database: AuditDb,
  entry: ObservationInsert,
): Promise<{ id: string } | null> {
  // Story 2.3 R1-P108 — validate finite numerics + valid Date.
  if (!Number.isFinite(entry.valueNumeric)) {
    throw new Error(
      `writeObservation: valueNumeric must be finite, got ${entry.valueNumeric}`,
    );
  }
  if (!Number.isFinite(entry.confidenceScore)) {
    throw new Error(
      `writeObservation: confidenceScore must be finite, got ${entry.confidenceScore}`,
    );
  }
  if (Number.isNaN(entry.collectedAt.getTime())) {
    throw new Error("writeObservation: collectedAt is Invalid Date");
  }

  const [row] = await database
    .insert(Observations)
    .values({
      patientId: entry.patientId,
      uploadId: entry.uploadId,
      loincCode: entry.loincCode ?? null,
      biomarkerName: entry.biomarkerName,
      valueNumeric: String(entry.valueNumeric),
      unitUcum: entry.unitUcum,
      referenceRangeLow:
        entry.referenceRangeLow !== undefined
          ? String(entry.referenceRangeLow)
          : null,
      referenceRangeHigh:
        entry.referenceRangeHigh !== undefined
          ? String(entry.referenceRangeHigh)
          : null,
      labName: entry.labName ?? null,
      collectedAt: entry.collectedAt.toISOString().slice(0, 10),
      confidenceScore: String(entry.confidenceScore),
      source: entry.source,
    })
    .onConflictDoNothing({
      target: [
        Observations.patientId,
        Observations.uploadId,
        Observations.loincCode,
        Observations.collectedAt,
      ],
    })
    .returning({ id: Observations.id });
  return row ?? null;
}
