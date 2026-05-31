import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * Story 7.1 — `life_events` schema.
 *
 * Patient-authored timeline markers on the Fingerprint chart. The
 * security backbone for Epic 7 (FR47): every row is
 * `privacy_flag = 'patient_only'` by default and the doctor surface
 * has NO RLS policy at all — doctor-zero-rows invariant.
 *
 * Patient layer:
 *   - SELECT own (RLS, custom_rls_life_events.sql)
 *   - INSERT own — patients author their own rows directly via the
 *     `createLifeEvent` resolver (transaction-scoped GUC binds
 *     `patient_id` to `auth.uid()`).
 *   - UPDATE / DELETE — deferred (Story 7.x); not in 7.1 scope.
 *
 * `description` is the free-text body (1..140 chars enforced both in
 * Zod and via the SQL `CHECK` below — defense-in-depth against a
 * resolver that forgets to validate). `event_date` is a calendar
 * DATE (no time component); the retroactive-only refine lives in Zod
 * (`packages/validators/src/life-events.ts`).
 */

/**
 * AC1 — single-select category tag (optional). NULL when the patient
 * doesn't pick one. Kept narrow so the mobile UI can render a fixed
 * chip list without translating arbitrary strings.
 */
export const lifeEventCategoryEnum = pgEnum("life_event_category_enum", [
  "health",
  "lifestyle",
  "travel",
  "stress",
  "medication",
  "other",
]);

/**
 * AC2 — privacy flag. Story 7.1 ships `'patient_only'` only; enum is
 * forward-looking so a future explicit-consent surface can add
 * `'shared_with_doctor'` without a schema migration. **No doctor RLS
 * policy reads from this column today**; the doctor-zero-rows
 * invariant is enforced by absence of a policy, not by a predicate.
 */
export const lifeEventPrivacyFlagEnum = pgEnum("life_event_privacy_flag_enum", [
  "patient_only",
]);

export const LifeEvents = pgTable(
  "life_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Story 5.6 FK cascade audit — `users(id)` cascades through
    // `patient_id` (LGPD Art. 18 right-to-erasure). Mirrors the
    // pattern used by `observations.patient_id`.
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    eventDate: t.date().notNull(),
    description: t.text().notNull(),
    category: lifeEventCategoryEnum("category"),
    privacyFlag: lifeEventPrivacyFlagEnum("privacy_flag")
      .notNull()
      .default("patient_only"),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // AC3 — Fingerprint chart queries by `(patient_id, event_date)`
    // within a visible window. This index covers the
    // `listInWindow` resolver SELECT.
    index("life_events_patient_event_date_idx").on(
      table.patientId,
      table.eventDate,
    ),
    // Defense-in-depth — Zod enforces 1..140 chars after trim, the
    // CHECK enforces the same against a misbehaving resolver. The
    // trim semantics don't translate to SQL, so we check raw
    // `char_length` and trust the resolver to trim.
    check(
      "life_events_description_length_check",
      sql`char_length(${table.description}) BETWEEN 1 AND 140`,
    ),
  ],
);
