import { and, asc, desc, eq, isNull } from "@healthtracker/db";
import { Observations } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";

/**
 * Story 3.1 — read-side helper for the longitudinal biomarker record
 * (`Histórico → Resultados`). Mirrors the `uploads-review.ts` split off
 * `uploads.ts`. Naming: this file uses `-record` (not `-review`)
 * because "review" is already taken by the low-confidence review
 * queue surface (Story 2.4 / Story 8.x).
 *
 * **Single SELECT, RLS-enforced, audit-logged.** RLS policy
 * `observations_select_own` (`packages/db/policies/custom_rls_observations.sql`)
 * is the security boundary; the app-layer `eq(patientId, ...)`
 * predicate is defense-in-depth (AR5, NFR-S2). The audit row is
 * appended inside the `protectedProcedure` transaction (`ctx.db` is
 * already a transaction handle — do not call `database.transaction(...)`
 * manually, postgres.js rejects nested transactions).
 *
 * **Soft-delete filter is non-negotiable** (Epic 2 retro § "Dependencies
 * on Epic 2"; Story 2.7 added `observations.deleted_at`). Every SELECT
 * here filters `WHERE deleted_at IS NULL`.
 *
 * **Draw grouping contract.** `observations` has no `draw_id` column —
 * a draw is implicit. Three ways the same logical draw can yield
 * multiple rows: extracted + patient-corrected (same upload), multi-
 * upload same date (different `upload_id`s), and manual BIA
 * (`upload_id IS NULL`, F162). The UX intent (UX spec line 826) is
 * one card per `(collectedAt, labName)`. Grouping happens in TS
 * (not SQL `GROUP BY`) because the detail view needs per-row fields.
 * Null `labName` is grouped under the `__null_lab__` sentinel so
 * null-labeled extracted rows don't collide with manual BIA rows
 * that always carry a device label.
 */

/** Single biomarker observation as exposed to the patient UI. */
export interface ObservationView {
  id: string;
  uploadId: string | null;
  loincCode: string | null;
  biomarkerName: string;
  valueNumeric: number;
  unitUcum: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
  labName: string | null;
  collectedAt: string; // ISO yyyy-mm-dd
  source:
    | "extracted"
    | "manual_bia"
    | "patient_corrected"
    | "operator_confirmed";
  confidenceScore: number;
}

/** A logical draw — one `(collectedAt, labName)` group. */
export interface DrawView {
  collectedAt: string;
  labName: string | null;
  observations: ObservationView[];
}

export interface RecordView {
  draws: DrawView[];
  drawCount: number;
  observationCount: number;
}

/**
 * Coerce a Drizzle PG-numeric column (typed as `string`) to a JS
 * `number`. Returns `null` when the input is null/undefined OR when
 * `Number.parseFloat` yields NaN — callers decide whether to skip the
 * row, render "—", etc. Narrow contract (no try/catch — parseFloat
 * never throws) per Epic 2 retro action item 2.
 */
function coerceNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const NULL_LAB_GROUP_KEY = "__null_lab__";

export async function getRecordForPatient(
  database: AuditDb,
  patientId: string,
): Promise<RecordView> {
  // Single SELECT — RLS narrows by patient_id; the app-layer eq() is
  // defense-in-depth (AR5). `isNull(deletedAt)` enforces the
  // soft-delete filter (Epic 2 retro). Sort: collected_at desc
  // (reverse chronological per AC1), then biomarker_name asc
  // (stable, human-readable secondary order). The index
  // `observations_patient_collected_idx` covers the primary sort.
  const rows = await database
    .select({
      id: Observations.id,
      uploadId: Observations.uploadId,
      loincCode: Observations.loincCode,
      biomarkerName: Observations.biomarkerName,
      valueNumeric: Observations.valueNumeric,
      unitUcum: Observations.unitUcum,
      referenceRangeLow: Observations.referenceRangeLow,
      referenceRangeHigh: Observations.referenceRangeHigh,
      labName: Observations.labName,
      collectedAt: Observations.collectedAt,
      source: Observations.source,
      confidenceScore: Observations.confidenceScore,
    })
    .from(Observations)
    .where(
      and(
        eq(Observations.patientId, patientId),
        isNull(Observations.deletedAt),
      ),
    )
    .orderBy(desc(Observations.collectedAt), asc(Observations.biomarkerName));

  // Group by (collectedAt, labName ?? sentinel). Use a Map to preserve
  // insertion order, which equals the desc(collectedAt) order from the
  // query — no re-sort needed.
  const drawMap = new Map<string, DrawView>();
  for (const row of rows) {
    const valueNumeric = coerceNumeric(row.valueNumeric);
    if (valueNumeric === null) {
      // Single-row data-quality issue — log + skip rather than crash
      // the whole fetch. The screen still renders the other rows.
      console.warn(
        `[getRecordForPatient] dropping row id=${row.id} — unparseable valueNumeric=${String(row.valueNumeric)}`,
      );
      continue;
    }
    // R1-P234 — `confidenceScore` is metadata (UI doesn't render it
    // this story; future stories may surface a confidence badge). A
    // bad value must NOT hide an otherwise-good biomarker reading.
    // Coerce defensively; fall back to 0 on NaN/null and log.
    let confidenceScore = coerceNumeric(row.confidenceScore);
    if (confidenceScore === null) {
      console.warn(
        `[getRecordForPatient] row id=${row.id} — unparseable confidenceScore=${String(row.confidenceScore)}; defaulting to 0`,
      );
      confidenceScore = 0;
    }

    const labKey = row.labName ?? NULL_LAB_GROUP_KEY;
    const key = `${row.collectedAt}|${labKey}`;
    let draw = drawMap.get(key);
    if (!draw) {
      draw = {
        collectedAt: row.collectedAt,
        labName: row.labName,
        observations: [],
      };
      drawMap.set(key, draw);
    }
    draw.observations.push({
      id: row.id,
      uploadId: row.uploadId,
      loincCode: row.loincCode,
      biomarkerName: row.biomarkerName,
      valueNumeric,
      unitUcum: row.unitUcum,
      referenceRangeLow: coerceNumeric(row.referenceRangeLow),
      referenceRangeHigh: coerceNumeric(row.referenceRangeHigh),
      labName: row.labName,
      collectedAt: row.collectedAt,
      source: row.source,
      confidenceScore,
    });
  }

  const draws = Array.from(drawMap.values());
  const observationCount = draws.reduce(
    (acc, d) => acc + d.observations.length,
    0,
  );
  const drawCount = draws.length;

  // AC4 — single audit row inside the protectedProcedure transaction.
  // `resourceId` is the patient id (the record fetch is patient-
  // scoped; there's no single observation id to attach). `metadata`
  // carries observation/draw counts so the audit trail can answer
  // "how much was read" without re-querying.
  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: "observation.read",
    resourceId: patientId,
    resourceType: "observation_record",
    metadata: { drawCount, observationCount },
  });

  return { draws, drawCount, observationCount };
}
