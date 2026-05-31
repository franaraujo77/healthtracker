import { and, eq, isNull, sql } from "@healthtracker/db";
import { Uploads } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

/**
 * Story 7.2 — `uploads.markUploadViewed` write helper.
 *
 * Sets `viewed_at = now()` on first open of the upload detail screen.
 * The `WHERE viewed_at IS NULL` guard makes second calls idempotent
 * (returns `{ marked: false }` on repeat). No audit row is written —
 * the render path is high-frequency and viewing one's own draw is
 * never a doctor-access-relevant event (AC12).
 *
 * The `patient_id` predicate is defense-in-depth alongside RLS so a
 * patient cannot mark another patient's upload viewed even through
 * a hostile SQL forge attempt.
 */
export async function markUploadViewed(
  database: AuditDb,
  patientId: string,
  uploadId: string,
): Promise<{ marked: boolean }> {
  const result = await database
    .update(Uploads)
    .set({ viewedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(Uploads.id, uploadId),
        eq(Uploads.patientId, patientId),
        isNull(Uploads.viewedAt),
      ),
    )
    .returning({ id: Uploads.id });

  return { marked: result.length > 0 };
}
