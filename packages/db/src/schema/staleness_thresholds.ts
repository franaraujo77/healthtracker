import { sql } from "drizzle-orm";
import { check, index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { Professionals } from "./professionals";

/**
 * Story 6.5 — `staleness_thresholds`.
 *
 * Doctor preference: per-biomarker-category maximum age (in days)
 * before the BiomarkerCard renders a "Resultado antigo" chip in the
 * Conversation Starter view.
 *
 * Per-(professional_user_id, biomarker_category) — composite primary
 * key via the unique index. Absent row → AC5 default (180 days)
 * applied at READ time, NEVER persisted as a row (avoids row-bloat
 * for every doctor × every category × every save).
 *
 * **FK cascade rule (Story 5.6):** `onDelete: cascade` on the FK to
 * `professionals.user_id` (which itself cascades from `users.id`).
 * When the doctor deletes their account, their preference rows go
 * too. No exception here — the row encodes doctor preference only;
 * it does not outlive the doctor's account semantically.
 *
 * RLS policies live in `custom_rls_staleness_thresholds.sql`:
 * select/insert/update OWN rows only (NO patient principal —
 * patients have no view of doctor preferences). NO DELETE policy
 * — the application layer does not expose a delete path (AC4
 * deletion-semantics decision); reserve for a future "reset to
 * default" UI story.
 *
 * **Migration discipline (Story 6.5 scope):** no `supabase/migrations/*`
 * file ships in this story — Story 6.6 owns Epic 6 consolidated deploy.
 */
export const StalenessThresholds = pgTable(
  "staleness_thresholds",
  (t) => ({
    professionalUserId: t
      .uuid("professional_user_id")
      .notNull()
      .references(() => Professionals.userId, { onDelete: "cascade" }),
    /**
     * The DISTINCT category string from `loinc_ref.category`. NOT
     * an FK to a categories table (no such table exists; category
     * is a denormalized text column on loinc_ref). The application
     * layer validates the value against `SELECT DISTINCT category
     * FROM loinc_ref` on every write. UNKNOWN values are rejected
     * with `BAD_REQUEST`.
     */
    biomarkerCategory: t.text("biomarker_category").notNull(),
    /**
     * Staleness threshold in calendar days. Domain: 1..3650 (10y).
     * Enforced both by Zod (AC4 input schema) and by the CHECK
     * constraint below (defense-in-depth — service-role writes
     * would otherwise bypass the resolver).
     */
    thresholdDays: t.integer("threshold_days").notNull(),
    createdAt: t
      .timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // Composite primary key (uniqueness contract for ON CONFLICT).
    uniqueIndex("staleness_thresholds_pk").on(
      table.professionalUserId,
      table.biomarkerCategory,
    ),
    // Listing index for the settings page render.
    index("staleness_thresholds_professional_idx").on(table.professionalUserId),
    check(
      "staleness_thresholds_days_range_check",
      sql`${table.thresholdDays} >= 1 AND ${table.thresholdDays} <= 3650`,
    ),
  ],
);

export type StalenessThreshold = typeof StalenessThresholds.$inferSelect;
export type NewStalenessThreshold = typeof StalenessThresholds.$inferInsert;
