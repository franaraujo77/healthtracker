import { TRPCError } from "@trpc/server";

import type { AttachVoiceMemoInput } from "@healthtracker/validators";
import { and, eq } from "@healthtracker/db";
import { Uploads, VoiceMemos } from "@healthtracker/db/schema";
import {
  isOwnVoiceMemoStoragePath,
  VOICE_MEMOS_STORAGE_BUCKET,
} from "@healthtracker/validators";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";
import { getSupabaseAdminClient } from "./storage";

/**
 * Story 7.4 — voice memo attach helper.
 *
 * Validates (in order): upload ownership, storage-path prefix,
 * storage-object existence, then INSERTs the row with a narrow 23505
 * idempotency shield on the `(upload_id)` UNIQUE. Audit metadata
 * carries `{uploadId, durationMs}` — `storagePath` is deliberately
 * omitted (patient-private content; mirrors Story 7.1 / 7.2 PII
 * discipline).
 */
export interface VoiceMemoRow {
  id: string;
  patientId: string;
  uploadId: string;
  storagePath: string;
  durationMs: number;
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

export async function attachVoiceMemoToUpload(
  database: AuditDb,
  patientId: string,
  input: AttachVoiceMemoInput,
): Promise<VoiceMemoRow> {
  // R1-H2 carry-forward — upload ownership precondition.
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

  // AC5 — path-prefix validation. Defense-in-depth against a forged
  // input that would otherwise INSERT a row pointing at a foreign
  // patient's folder.
  if (!isOwnVoiceMemoStoragePath(input.storagePath, patientId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "INVALID_STORAGE_PATH",
    });
  }

  // AC5 — storage-object existence probe. Service-role client because
  // the RLS-bound patient client may not always be the caller (e.g.
  // background re-attach jobs). Treats a missing bucket as the same
  // STORAGE_OBJECT_MISSING error per AC11.
  const supabase = getSupabaseAdminClient();
  // `storagePath` shape is `<patientId>/<voiceMemoId>.m4a`. The Storage
  // `list` API requires the directory + a filename filter.
  const slashIdx = input.storagePath.indexOf("/");
  const dir = slashIdx >= 0 ? input.storagePath.slice(0, slashIdx) : "";
  const basename =
    slashIdx >= 0 ? input.storagePath.slice(slashIdx + 1) : input.storagePath;
  const { data: listed, error: listErr } = await supabase.storage
    .from(VOICE_MEMOS_STORAGE_BUCKET)
    .list(dir, { search: basename, limit: 5 });
  if (listErr || listed.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "STORAGE_OBJECT_MISSING",
    });
  }
  // R1-H4 — Supabase Storage `search` is fuzzy (substring `ILIKE`),
  // not equality. Assert at least one returned name matches the
  // requested basename exactly.
  const exactMatch = listed.some((obj) => obj.name === basename);
  if (!exactMatch) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "STORAGE_OBJECT_MISSING",
    });
  }

  let row: VoiceMemoRow | undefined;

  try {
    const inserted = await database
      .insert(VoiceMemos)
      .values({
        patientId,
        uploadId: input.uploadId,
        storagePath: input.storagePath,
        durationMs: input.durationMs,
      })
      .returning({
        id: VoiceMemos.id,
        patientId: VoiceMemos.patientId,
        uploadId: VoiceMemos.uploadId,
        storagePath: VoiceMemos.storagePath,
        durationMs: VoiceMemos.durationMs,
        privacyFlag: VoiceMemos.privacyFlag,
        createdAt: VoiceMemos.createdAt,
      });

    row = inserted[0];
    if (!row) {
      throw new Error("voice_memos insert returned no row");
    }
  } catch (error) {
    // AC9 — narrow 23505 catch on the `(upload_id)` UNIQUE. Idempotent
    // double-tap returns the existing row; no second audit row.
    if (
      !isUniqueViolation(error) ||
      (error.constraint && error.constraint !== "voice_memos_upload_unique")
    ) {
      throw error;
    }

    const existing = await database
      .select({
        id: VoiceMemos.id,
        patientId: VoiceMemos.patientId,
        uploadId: VoiceMemos.uploadId,
        storagePath: VoiceMemos.storagePath,
        durationMs: VoiceMemos.durationMs,
        privacyFlag: VoiceMemos.privacyFlag,
        createdAt: VoiceMemos.createdAt,
      })
      .from(VoiceMemos)
      .where(
        and(
          eq(VoiceMemos.patientId, patientId),
          eq(VoiceMemos.uploadId, input.uploadId),
        ),
      )
      .limit(1);

    const existingRow = existing[0];
    if (!existingRow) {
      throw error;
    }
    return existingRow;
  }

  // AC5 / AC6 — single audit row inside the protectedProcedure tx.
  // `storagePath` deliberately omitted from metadata (PII discipline).
  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: "voice_memo.recorded",
    resourceId: row.id,
    resourceType: "voice_memo",
    metadata: { uploadId: row.uploadId, durationMs: row.durationMs },
  });

  return row;
}
