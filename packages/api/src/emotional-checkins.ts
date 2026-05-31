import { TRPCError } from "@trpc/server";

import type {
  EmotionalCheckInPair,
  RecordEmotionalCheckInInput,
  RecordPostEmotionalCheckInInput,
} from "@healthtracker/validators";
import { alias, and, desc, eq } from "@healthtracker/db";
import { EmotionalCheckins, Uploads } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";

/**
 * Story 7.2 — pre-results emotional check-in write helper.
 *
 * Writes the row + the `emotional_checkin.recorded` audit entry inside
 * the `protectedProcedure` transaction (atomicity contract; Story 3.1
 * AC4 pattern). RLS (`custom_rls_emotional_checkins.sql`) is the
 * security boundary; the app-layer `eq(patientId, …)` predicate on the
 * idempotency SELECT is defense-in-depth.
 *
 * **AC11 — idempotency shield.** A 23505 on the
 * `(upload_id, type)` UNIQUE constraint is treated as "already
 * recorded" — return the existing row, do NOT write a second audit
 * entry. Any OTHER constraint violation re-throws.
 *
 * **AC6 — audit metadata.** `{uploadId, type, state}`. The state IS
 * in metadata (unlike Story 7.1's `description`-omitted convention):
 * a closed 5-value enum has no PII surface.
 */
export interface EmotionalCheckInRow {
  id: string;
  patientId: string;
  uploadId: string;
  state: "hopeful" | "worried" | "curious" | "exhausted" | "unsure";
  type: "pre" | "post";
  privacyFlag: "patient_only";
  createdAt: Date;
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

function isUniqueViolation(error: unknown): error is PgError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as PgError).code === "23505"
  );
}

export async function recordPreResultsEmotionalCheckIn(
  database: AuditDb,
  patientId: string,
  input: RecordEmotionalCheckInInput,
): Promise<EmotionalCheckInRow> {
  // R1-H2 — ownership precondition. The UNIQUE constraint on
  // `(upload_id, type)` is GLOBAL, so a caller who guesses another
  // patient's upload UUID would otherwise trip 23505 on cross-patient
  // collision and learn the upload has a `pre` check-in (existence
  // oracle). Mirror the defense `markUploadViewed` uses: verify the
  // upload belongs to the caller BEFORE the INSERT. RLS on `uploads`
  // already scopes SELECT to the patient principal — the explicit
  // `eq(patientId)` predicate is defense-in-depth.
  const [ownedUpload] = await database
    .select({ id: Uploads.id })
    .from(Uploads)
    .where(
      and(eq(Uploads.id, input.uploadId), eq(Uploads.patientId, patientId)),
    )
    .limit(1);

  if (!ownedUpload) {
    throw new TRPCError({ code: "NOT_FOUND", message: "UPLOAD_NOT_FOUND" });
  }

  let row: EmotionalCheckInRow | undefined;

  try {
    const inserted = await database
      .insert(EmotionalCheckins)
      .values({
        patientId,
        uploadId: input.uploadId,
        state: input.state,
        type: input.type,
        // privacyFlag defaults to 'patient_only' at the schema layer.
      })
      .returning({
        id: EmotionalCheckins.id,
        patientId: EmotionalCheckins.patientId,
        uploadId: EmotionalCheckins.uploadId,
        state: EmotionalCheckins.state,
        type: EmotionalCheckins.type,
        privacyFlag: EmotionalCheckins.privacyFlag,
        createdAt: EmotionalCheckins.createdAt,
      });

    row = inserted[0];
    if (!row) {
      throw new Error("emotional_checkins insert returned no row");
    }
  } catch (error) {
    // AC11 — narrow 23505 catch on the (upload_id, type) UNIQUE.
    // A redundant tap returns the existing row idempotently with no
    // additional audit write. Re-throw any other shape.
    if (
      !isUniqueViolation(error) ||
      (error.constraint &&
        error.constraint !== "emotional_checkins_upload_type_unique")
    ) {
      throw error;
    }

    const existing = await database
      .select({
        id: EmotionalCheckins.id,
        patientId: EmotionalCheckins.patientId,
        uploadId: EmotionalCheckins.uploadId,
        state: EmotionalCheckins.state,
        type: EmotionalCheckins.type,
        privacyFlag: EmotionalCheckins.privacyFlag,
        createdAt: EmotionalCheckins.createdAt,
      })
      .from(EmotionalCheckins)
      .where(
        and(
          eq(EmotionalCheckins.patientId, patientId),
          eq(EmotionalCheckins.uploadId, input.uploadId),
          eq(EmotionalCheckins.type, input.type),
        ),
      )
      .limit(1);

    const existingRow = existing[0];
    if (!existingRow) {
      // 23505 told us the row exists, but RLS may filter it from a
      // foreign-patient selector. Re-throw the original so the
      // boundary surfaces a generic INTERNAL — never reveal the
      // existence of a foreign-patient row.
      throw error;
    }
    return existingRow;
  }

  // AC6 — single audit row inside the protectedProcedure transaction.
  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: "emotional_checkin.recorded",
    resourceId: row.id,
    resourceType: "emotional_checkin",
    metadata: {
      uploadId: row.uploadId,
      type: row.type,
      state: row.state,
    },
  });

  return row;
}

/**
 * Story 7.3 — post-results check-in write helper.
 *
 * Mirrors the pre helper byte-for-byte except:
 *   1. Verifies a `type='pre'` row exists for the same
 *      `(uploadId, patientId)` BEFORE INSERT — AC5 / AC4
 *      defense-in-depth. The UI gate (CTA hidden when
 *      `hasPreEmotionalCheckIn === false`) is necessary but not
 *      sufficient; this precondition is the load-bearing contract.
 *   2. Audit metadata `type` is `'post'`.
 *
 * Same 23505 idempotency shield on the `(upload_id, type)` UNIQUE,
 * same upload-ownership precondition (R1-H2 carry-forward).
 */
export async function recordPostResultsEmotionalCheckIn(
  database: AuditDb,
  patientId: string,
  input: RecordPostEmotionalCheckInInput,
): Promise<EmotionalCheckInRow> {
  // R1-H2 — ownership precondition (same as pre).
  const [ownedUpload] = await database
    .select({ id: Uploads.id })
    .from(Uploads)
    .where(
      and(eq(Uploads.id, input.uploadId), eq(Uploads.patientId, patientId)),
    )
    .limit(1);

  if (!ownedUpload) {
    throw new TRPCError({ code: "NOT_FOUND", message: "UPLOAD_NOT_FOUND" });
  }

  // AC5 / AC4 — pre-existence precondition. An orphan post check-in
  // has no semantic anchor (the longitudinal pair is the product
  // value).
  const [preRow] = await database
    .select({ id: EmotionalCheckins.id })
    .from(EmotionalCheckins)
    .where(
      and(
        eq(EmotionalCheckins.uploadId, input.uploadId),
        eq(EmotionalCheckins.patientId, patientId),
        eq(EmotionalCheckins.type, "pre"),
      ),
    )
    .limit(1);

  if (!preRow) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "PRE_CHECKIN_REQUIRED",
    });
  }

  let row: EmotionalCheckInRow | undefined;

  try {
    const inserted = await database
      .insert(EmotionalCheckins)
      .values({
        patientId,
        uploadId: input.uploadId,
        state: input.state,
        type: input.type,
      })
      .returning({
        id: EmotionalCheckins.id,
        patientId: EmotionalCheckins.patientId,
        uploadId: EmotionalCheckins.uploadId,
        state: EmotionalCheckins.state,
        type: EmotionalCheckins.type,
        privacyFlag: EmotionalCheckins.privacyFlag,
        createdAt: EmotionalCheckins.createdAt,
      });

    row = inserted[0];
    if (!row) {
      throw new Error("emotional_checkins insert returned no row");
    }
  } catch (error) {
    if (
      !isUniqueViolation(error) ||
      (error.constraint &&
        error.constraint !== "emotional_checkins_upload_type_unique")
    ) {
      throw error;
    }

    const existing = await database
      .select({
        id: EmotionalCheckins.id,
        patientId: EmotionalCheckins.patientId,
        uploadId: EmotionalCheckins.uploadId,
        state: EmotionalCheckins.state,
        type: EmotionalCheckins.type,
        privacyFlag: EmotionalCheckins.privacyFlag,
        createdAt: EmotionalCheckins.createdAt,
      })
      .from(EmotionalCheckins)
      .where(
        and(
          eq(EmotionalCheckins.patientId, patientId),
          eq(EmotionalCheckins.uploadId, input.uploadId),
          eq(EmotionalCheckins.type, input.type),
        ),
      )
      .limit(1);

    const existingRow = existing[0];
    if (!existingRow) {
      throw error;
    }
    return existingRow;
  }

  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: "emotional_checkin.recorded",
    resourceId: row.id,
    resourceType: "emotional_checkin",
    metadata: {
      uploadId: row.uploadId,
      type: row.type,
      state: row.state,
    },
  });

  return row;
}

/**
 * Story 7.3 — `listPairs` query. Returns one row per upload that has
 * BOTH pre AND post `emotional_checkins` rows for the calling patient.
 * Self-JOINs the table on `(upload_id, patient_id)` with `type` as the
 * discriminator, LEFT JOINs `uploads` for `labName` +
 * `processingCompletedAt`. Ordered by the pre row's `createdAt desc`.
 *
 * NO audit write — this is a high-frequency read of patient-private
 * data; the patient reading their own context is not a doctor-access
 * event.
 */
export async function listEmotionalCheckInPairs(
  database: AuditDb,
  patientId: string,
): Promise<EmotionalCheckInPair[]> {
  // Self-JOIN via Drizzle's `alias` so the `type='pre'` and
  // `type='post'` rows for the same `upload_id` can be selected in one
  // round-trip. INNER JOIN naturally drops uploads that only have one
  // of the two rows.
  const preTable = alias(EmotionalCheckins, "pre");
  const postTable = alias(EmotionalCheckins, "post");

  const rows = await database
    .select({
      uploadId: preTable.uploadId,
      preState: preTable.state,
      postState: postTable.state,
      createdAtPre: preTable.createdAt,
      createdAtPost: postTable.createdAt,
      labName: Uploads.labName,
      completedAt: Uploads.processingCompletedAt,
    })
    .from(preTable)
    .innerJoin(
      postTable,
      and(
        eq(postTable.uploadId, preTable.uploadId),
        eq(postTable.patientId, preTable.patientId),
        eq(postTable.type, "post"),
      ),
    )
    // R1-H1 — also constrain `Uploads.patientId = caller`. RLS on
    // uploads already scopes this, but defense-in-depth ensures
    // labName cannot leak even if a future bug orphans an
    // emotional_checkins row to a foreign upload.
    .leftJoin(
      Uploads,
      and(eq(Uploads.id, preTable.uploadId), eq(Uploads.patientId, patientId)),
    )
    .where(and(eq(preTable.patientId, patientId), eq(preTable.type, "pre")))
    .orderBy(desc(preTable.createdAt));

  return rows;
}
