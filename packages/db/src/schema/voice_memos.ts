import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { Uploads } from "./uploads";
import { Users } from "./users";

/**
 * Story 7.4 — `voice_memos` schema.
 *
 * Patient-authored audio context attached to a specific upload. One
 * row per upload (`UNIQUE (upload_id)`); a re-record path is deferred
 * (a future story would expose a delete + re-attach).
 *
 * **Doctor-zero-rows invariant.** No doctor RLS policy ships. Mirrors
 * Stories 7.1's `life_events` and 7.2's `emotional_checkins`: the
 * privacy backbone is the absence of a doctor policy, NOT the
 * `privacy_flag` predicate.
 *
 * Storage: audio files live in the private Supabase Storage bucket
 * `voice_memos` at `<patient_id>/<voice_memo_id>.m4a`. Bucket
 * creation SQL is deferred to Story 7.6's batched migration.
 */

export const voiceMemoPrivacyEnum = pgEnum("voice_memo_privacy_enum", [
  "patient_only",
]);

/** AC3 — 30 second cap; mirrored in Zod and at the DB CHECK below. */
export const VOICE_MEMO_MAX_DURATION_MS = 30_000;

export const VoiceMemos = pgTable(
  "voice_memos",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Story 5.6 FK cascade audit.
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    // The memo lives or dies with its draw.
    uploadId: t
      .uuid()
      .notNull()
      .references(() => Uploads.id, { onDelete: "cascade" }),
    storagePath: t.text().notNull(),
    durationMs: t.integer().notNull(),
    privacyFlag: voiceMemoPrivacyEnum("privacy_flag")
      .notNull()
      .default("patient_only"),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // AC9 — one memo per upload (idempotency shield + UX invariant).
    uniqueIndex("voice_memos_upload_unique").on(table.uploadId),
    // Listing index for the future personal-history view.
    index("voice_memos_patient_created_idx").on(
      table.patientId,
      sql`${table.createdAt} desc`,
    ),
    // AC3 / AC9 — DB-layer mirror of the 30s cap.
    check(
      "voice_memos_duration_ms_check",
      sql`${table.durationMs} > 0 AND ${table.durationMs} <= 30000`,
    ),
  ],
);
