import { pgTable } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * Story 2.8 — per-patient push-notification preferences.
 *
 * One row per patient; `patient_id` is the primary key. The worker
 * (`services/extraction/src/consumers/notifications.ts`) looks the row
 * up at dispatch time and skips the Expo Push POST when the matching
 * column is `false`. Missing rows (first-time patient) are treated as
 * all-true by both the API helper and the worker (defense-in-depth).
 *
 * RLS: see `custom_rls_notification_preferences.sql`. Patient
 * SELECT/INSERT/UPDATE own; worker reads via service-role bypass.
 *
 * No audit-log emission on preference toggle — these are per-patient
 * settings, not data writes (matches Story 2.5's push-token decision).
 */
export const NotificationPreferences = pgTable(
  "notification_preferences",
  (t) => ({
    // Story 5.6 FK cascade audit — also the primary key (one row per patient).
    patientId: t
      .uuid()
      .notNull()
      .primaryKey()
      .references(() => Users.id, { onDelete: "cascade" }),
    /** AC1 — Resultados prontos (extraction complete + extraction failed). */
    resultsReady: t.boolean().notNull().default(true),
    /** AC1 — Cartas prontas (Epic 4's narrative letters). */
    lettersReady: t.boolean().notNull().default(true),
    /** AC1 — Acesso ao histórico (Story 5.3 doctor-view audit). */
    recordAccess: t.boolean().notNull().default(true),
    /** AC1 — Confirmação necessária (pending_review uploads). */
    reviewRequired: t.boolean().notNull().default(true),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
);
