import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { Uploads } from "./uploads";
import { Users } from "./users";

/**
 * Story 7.2 — `emotional_checkins` schema (pre-results check-in).
 *
 * Patient-authored personal context — one row per `(upload_id, type)`.
 * Story 7.2 writes `type = 'pre'`; Story 7.3 will add `type = 'post'`
 * against the same table. Both write paths share the
 * `(upload_id, type)` UNIQUE constraint (AC11), so a double-tap from
 * either flow collapses to an idempotent no-op via narrow-23505 catch
 * in the resolver helper.
 *
 * **Doctor-zero-rows invariant.** No doctor RLS policy ships with this
 * table — mirrors Story 7.1's `life_events`. The privacy backbone is
 * the absence of a policy, NOT a `privacy_flag` predicate.
 *
 * **AC10 (deferred unification).** A separate `_privacy_enum` ships
 * here (single value `patient_only`) to keep PR #59's reviewed
 * surface untouched. Story 7.6 collapses both Epic-7 privacy enums
 * via `ALTER TYPE … RENAME TO personal_context_privacy_enum`.
 */

export const emotionalCheckinStateEnum = pgEnum(
  "emotional_checkin_state_enum",
  ["hopeful", "worried", "curious", "exhausted", "unsure"],
);

export const emotionalCheckinTypeEnum = pgEnum("emotional_checkin_type_enum", [
  "pre",
  "post",
]);

export const emotionalCheckinPrivacyEnum = pgEnum(
  "emotional_checkin_privacy_enum",
  ["patient_only"],
);

export const EmotionalCheckins = pgTable(
  "emotional_checkins",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Story 5.6 FK cascade audit — patient deletion cascades.
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    // FK cascade — if the draw is deleted, its check-ins go too.
    uploadId: t
      .uuid()
      .notNull()
      .references(() => Uploads.id, { onDelete: "cascade" }),
    state: emotionalCheckinStateEnum("state").notNull(),
    type: emotionalCheckinTypeEnum("type").notNull(),
    privacyFlag: emotionalCheckinPrivacyEnum("privacy_flag")
      .notNull()
      .default("patient_only"),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // AC11 — idempotency shield: one pre + one post per upload.
    // Non-partial: both `type` values are valid; Story 7.3 will write
    // `post` rows under the same constraint.
    uniqueIndex("emotional_checkins_upload_type_unique").on(
      table.uploadId,
      table.type,
    ),
    // Listing index for the future personal-history view (Story 7.3
    // AC3 reads pairs via patient_id; created_at desc orders newest
    // first). R1-L1 — DESC ordering on the second column matches the
    // expected query plan; without it Postgres can still use a
    // backward scan but the explicit ordering is more reliable.
    index("emotional_checkins_patient_created_idx").on(
      table.patientId,
      sql`${table.createdAt} desc`,
    ),
  ],
);
