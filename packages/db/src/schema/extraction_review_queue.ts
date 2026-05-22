import { pgEnum, pgTable } from "drizzle-orm/pg-core";

/**
 * Story 2.3 — operator-only review queue for extracted fields that
 * fail the confidence gate (`< 0.85`) or fail LOINC resolution.
 *
 * RLS: enabled with ZERO patient/doctor policies — service-role-only.
 * Story 8.1 builds the operator UI + adds the operator-role SELECT
 * policy (anonymized view per architecture.md L29). Story 8.2 will
 * write `resolved_at` when an operator confirms or rejects.
 */
export const reviewReasonEnum = pgEnum("review_reason_enum", [
  "low_confidence",
  "loinc_unresolved",
]);

export const ExtractionReviewQueue = pgTable(
  "extraction_review_queue",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    patientId: t.uuid().notNull(),
    uploadId: t.uuid().notNull(),
    biomarkerName: t.text().notNull(),
    /** Original textual value from the source, NOT parsed. */
    valueText: t.text().notNull(),
    unitText: t.text(),
    loincCode: t.text(),
    confidenceScore: t.numeric().notNull(),
    reason: reviewReasonEnum("reason").notNull(),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: t.timestamp({ mode: "date", withTimezone: true }),
  }),
);
