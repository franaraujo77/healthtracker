import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * Story 1.5 — `uploads` schema.
 *
 * The patient-facing entry point of the extraction state machine
 * (architecture.md L117). Story 1.5 only writes the initial `'queued'`
 * state from the onboarding "Enviar resultados anteriores" flow; Epic 2
 * (Story 2.3) builds the worker that transitions queued → processing →
 * pending_review / complete / failed.
 *
 * Append-only at the patient layer:
 *   - SELECT own (RLS, custom_rls_uploads.sql)
 *   - INSERT own (RLS WITH CHECK)
 *   - NO UPDATE / DELETE policy yet — Epic 2 will add a narrow
 *     service-role UPDATE policy for state transitions.
 *
 * `idempotency_key` is the seam for FR8 offline-retry: the Expo offline
 * queue resends the same key on retry, and the UNIQUE constraint
 * collapses duplicates without enqueueing a second extraction job.
 */
export const uploadStatusEnum = pgEnum("upload_status_enum", [
  "queued",
  "processing",
  "pending_review",
  "complete",
  "failed",
]);

/**
 * `source` distinguishes onboarding imports from post-onboarding uploads
 * so audit / analytics can tell where in the funnel a row came from.
 * Story 1.5 writes only `'onboarding_import'`; Epic 2 will write
 * `'post_onboarding'`.
 */
export const uploadSourceEnum = pgEnum("upload_source_enum", [
  "onboarding_import",
  "post_onboarding",
]);

export const Uploads = pgTable(
  "uploads",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Story 5.6 FK cascade audit.
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    idempotencyKey: t.text().notNull(),
    storagePath: t.text().notNull(),
    mimeType: t.text().notNull(),
    sizeBytes: t.integer().notNull(),
    originalFilename: t.text().notNull(),
    // Review P46 — no default: every writer must choose the source
    // explicitly. The original default of `"post_onboarding"` was the
    // opposite of Story 1.5's only writer (`onboarding_import`), which
    // would have silently mislabeled funnel-analytics rows on any
    // future writer that forgot to pass the value.
    source: uploadSourceEnum("source").notNull(),
    status: uploadStatusEnum("status").notNull().default("queued"),
    processingStartedAt: t.timestamp({ mode: "date", withTimezone: true }),
    processingCompletedAt: t.timestamp({ mode: "date", withTimezone: true }),
    // Story 7.2 — first-view marker. NULL = patient has never opened
    // the detail screen for this upload. Set to `now()` by the
    // `uploads.markUploadViewed` mutation when the patient opens (or
    // skips) the pre-results emotional check-in sheet. The
    // `WHERE viewed_at IS NULL` guard in the UPDATE makes second
    // calls idempotent; AC12. No audit write on the mark (render
    // path is high-frequency).
    viewedAt: t.timestamp({ mode: "date", withTimezone: true }),
    metadata: t.jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // Epic 2 retro F141 — most-common lab name across this upload's
    // published observations, populated by the extraction worker at
    // dispatch time. Lets the push-notification consumer body the
    // notification by lab name (AC2 of Story 2.5) via a direct
    // `SELECT u.lab_name` instead of a correlated subquery on
    // `observations`. Nullable: still NULL during `queued` /
    // `processing` and for `failed` / `pending_review` uploads that
    // never published a publishable extracted field.
    labName: t.text(),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // FR8 / architecture.md L154 — idempotency seam for offline-retry.
    // Review P41 — UNIQUE is scoped to (patient_id, idempotency_key)
    // so a vanishingly-improbable v4 collision across patients is
    // also explicitly impossible by schema, AND a hostile client
    // cannot "poison" another patient's idempotency key to cause a
    // denial-of-confirm via ON CONFLICT collapse.
    uniqueIndex("uploads_patient_idempotency_unique").on(
      table.patientId,
      table.idempotencyKey,
    ),
    // Anticipated by Epic 2's "my uploads" list query.
    index("uploads_patient_created_idx").on(
      table.patientId,
      sql`${table.createdAt} desc`,
    ),
  ],
);
