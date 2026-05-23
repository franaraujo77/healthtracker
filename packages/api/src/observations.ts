import type { BiaSubmissionInput } from "@healthtracker/validators";
import { and, eq, isNull, sql } from "@healthtracker/db";
import { Observations } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";

/** BIA top-3 LOINC + UCUM mapping (mirrors `packages/db/seed/loinc-ref.ts`). */
const BIA_BIOMARKERS = [
  {
    field: "visceralFatAreaCm2" as const,
    loincCode: "73711-2",
    unitUcum: "cm2",
    biomarkerName: "Área de gordura visceral",
  },
  {
    field: "skeletalMuscleMassKg" as const,
    loincCode: "73964-7",
    unitUcum: "kg",
    biomarkerName: "Massa muscular esquelética",
  },
  {
    field: "bodyFatPercentage" as const,
    loincCode: "41982-0",
    unitUcum: "%",
    biomarkerName: "Percentual de gordura corporal",
  },
];

export interface ObservationInsert {
  patientId: string;
  /**
   * Epic 2 retro F162 — nullable. Manual BIA submissions (Story 2.7)
   * pass `null` since there is no source upload; extraction-pipeline
   * inserts pass the real upload UUID.
   */
  uploadId: string | null;
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
      uploadId: entry.uploadId ?? null,
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
    // R1-P201 — explicit `where` so PG matches the partial unique
    // index `WHERE deleted_at IS NULL AND upload_id IS NOT NULL`.
    // Without it, the planner can't disambiguate which partial index
    // the ON CONFLICT targets when multiple cover the same columns.
    // Manual BIA inserts (upload_id IS NULL) never participate in
    // this conflict (F162); they have their own application-level
    // dedup in `writeBiaObservations`.
    .onConflictDoNothing({
      where: sql`${Observations.deletedAt} IS NULL AND ${Observations.uploadId} IS NOT NULL`,
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

export type BiaSubmissionResult =
  | {
      status: "created";
      observationIds: string[];
      overwroteObservationIds?: string[];
    }
  | { status: "duplicate"; existingObservationIds: string[] };

function deviceLabName(input: BiaSubmissionInput): string {
  const base =
    input.deviceName === "Outro"
      ? (input.deviceCustomName ?? "").trim()
      : input.deviceName;
  if (input.deviceModel && input.deviceModel.trim().length > 0) {
    return `${base} ${input.deviceModel.trim()}`;
  }
  return base;
}

/**
 * Story 2.7 — single sanctioned write path for manual BIA
 * submissions. Fans out to 3 `writeObservation` calls (one per
 * biomarker) inside the caller's transaction; emits one
 * `observation.write` audit per submission (AC2).
 *
 * AC3: when `overwrite !== true` and a `(patient, collected_at,
 * lab_name)` row already exists with `source = 'manual_bia'` and
 * `deleted_at IS NULL`, the helper returns `{ status: 'duplicate' }`
 * WITHOUT writing. The client renders the confirmation modal and
 * re-submits with `overwrite: true`, which soft-deletes the prior
 * rows and inserts the new ones inside the same transaction.
 */
export async function writeBiaObservations(
  database: AuditDb,
  args: { patientId: string; input: BiaSubmissionInput },
): Promise<BiaSubmissionResult> {
  const { patientId, input } = args;
  const labName = deviceLabName(input);
  if (labName.length === 0) {
    // Defense-in-depth — the Zod refinement already enforces this.
    throw new Error(
      "writeBiaObservations: deviceName resolved to empty string",
    );
  }
  const collectedAt = new Date(`${input.collectedAt}T00:00:00.000Z`);
  if (Number.isNaN(collectedAt.getTime())) {
    throw new Error("writeBiaObservations: collectedAt is unparseable");
  }
  const collectedAtIso = input.collectedAt;

  // AC3 — duplicate detection. Scope: same patient + same date +
  // same `lab_name` + `source = 'manual_bia'` + not soft-deleted.
  //
  // R1-P202 — `.for("update")` row-locks the matched rows so a
  // concurrent submission can't soft-delete them between this SELECT
  // and the UPDATE below. The lock is held until commit (the outer
  // `protectedProcedure` transaction).
  const existing = await database
    .select({ id: Observations.id })
    .from(Observations)
    .where(
      and(
        eq(Observations.patientId, patientId),
        eq(Observations.collectedAt, collectedAtIso),
        eq(Observations.labName, labName),
        eq(Observations.source, "manual_bia"),
        isNull(Observations.deletedAt),
      ),
    )
    .for("update");
  const existingIds = existing.map((r) => r.id);

  if (existingIds.length > 0 && input.overwrite !== true) {
    return { status: "duplicate", existingObservationIds: existingIds };
  }

  // Overwrite path — soft-delete the prior rows inside the same
  // transaction so the partial unique index frees the slot for the
  // new INSERTs.
  if (existingIds.length > 0) {
    await database
      .update(Observations)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(Observations.patientId, patientId),
          eq(Observations.collectedAt, collectedAtIso),
          eq(Observations.labName, labName),
          eq(Observations.source, "manual_bia"),
          isNull(Observations.deletedAt),
        ),
      );
  }

  // 3-way fan-out. Each insert goes through `writeObservation` (the
  // single sanctioned write path).
  //
  // R2-P211 — `writeObservation`'s `onConflictDoNothing` clause only
  // targets the non-manual partial index (the `where` excludes
  // `source='manual_bia'`), so a race with another concurrent
  // submission would raise PG's `unique_violation` (SQLSTATE 23505)
  // against the BIA partial index. Catch it explicitly and translate
  // to the same `duplicate` response the SELECT-FOR-UPDATE path
  // returns when a prior row was found — the client renders the
  // overwrite confirmation modal and the patient retries.
  const observationIds: string[] = [];
  try {
    for (const biomarker of BIA_BIOMARKERS) {
      const valueNumeric = input[biomarker.field];
      const row = await writeObservation(database, {
        patientId,
        // F162 — manual BIA has no source upload.
        uploadId: null,
        loincCode: biomarker.loincCode,
        biomarkerName: biomarker.biomarkerName,
        valueNumeric,
        unitUcum: biomarker.unitUcum,
        labName,
        collectedAt,
        confidenceScore: 1.0,
        source: "manual_bia",
      });
      if (!row) {
        // Defensive: `onConflictDoNothing` doesn't target the BIA
        // partial index, so this branch should never fire in
        // production. Keep the throw for visibility if the index
        // setup ever changes.
        throw new Error(
          "writeBiaObservations: ON CONFLICT after soft-delete — concurrent write?",
        );
      }
      observationIds.push(row.id);
    }
  } catch (err) {
    // R2-P211 — unique_violation against the BIA partial index ⇒
    // a concurrent submission won the race; surface as a duplicate
    // so the client renders the overwrite modal.
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code: unknown }).code
        : undefined;
    if (code === "23505") {
      console.warn(
        `[writeBiaObservations] 23505 race for patient=${patientId} date=${collectedAtIso} lab=${labName}`,
      );
      return {
        status: "duplicate",
        existingObservationIds: [],
      };
    }
    throw err;
  }

  // AC2 — single audit event per submission, with `observationIds`
  // in metadata for downstream fan-out.
  const firstId = observationIds[0];
  if (!firstId) {
    throw new Error("writeBiaObservations: zero observations written");
  }
  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: "observation.write",
    resourceId: firstId,
    resourceType: "observation",
    metadata: {
      source: "manual_bia",
      deviceName: input.deviceName,
      deviceCustomName: input.deviceCustomName,
      deviceModel: input.deviceModel,
      labName,
      observationIds,
      collectedAt: collectedAtIso,
      ...(existingIds.length > 0
        ? { overwroteObservationIds: existingIds }
        : {}),
    },
  });

  return existingIds.length > 0
    ? {
        status: "created",
        observationIds,
        overwroteObservationIds: existingIds,
      }
    : { status: "created", observationIds };
}

// Re-export `sql` use so the helper compiles even if Drizzle's eq/and
// imports change shape (defense against a Drizzle-major bump).
void sql;
