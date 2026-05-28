import { sql } from "drizzle-orm";
import { pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * `consent_type_enum` — the full vocabulary of consent surfaces.
 *
 * Hybrid scope: the architecture document defines four broad categories
 * (`health_data_processing`, `ai_extraction`, `doctor_sharing`,
 * `llm_letter_generation`) that future stories will consume. Story 1.2
 * also needs screen-specific values because the AC mandates three
 * distinct patient-facing consent screens. Keeping both vocabularies in
 * one enum avoids a later migration and matches the user-approved
 * decision recorded in the story's Clarifications.
 */
export const consentTypeEnum = pgEnum("consent_type_enum", [
  // Story 1.2 — per-screen grants written by the onboarding flow.
  "blood_test_results",
  "bioimpedance",
  "ai_narrative",
  // Architecture (architecture.md L1465-1487) — broader categories
  // consumed by Epic 4 (Letter) and Epic 5 (sharing). Listed here so the
  // DB enum is defined once.
  "health_data_processing",
  "ai_extraction",
  "doctor_sharing",
  "llm_letter_generation",
]);

/**
 * `consent_grants` — append-only ledger of patient consent decisions.
 *
 * Inserts only — revocation is a new row with `revoked_at` set, never an
 * UPDATE. No UPDATE or DELETE RLS policy exists, so the table is
 * append-only at the database layer (mirrors `audit_log`'s NFR-S4
 * pattern from Story 1.1).
 *
 * The partial unique index on `(patient_id, consent_type, version) WHERE
 * revoked_at IS NULL` is the race-safe seam for the grant resolver:
 * concurrent "Concordo" taps for the same screen can both reach INSERT
 * but only one row is created (the other hits `ON CONFLICT DO NOTHING`).
 */
export const ConsentGrants = pgTable(
  "consent_grants",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Story 5.6 FK cascade audit — `users(id)` is the parent. Account
    // deletion (Story 5.6) cascades through this column.
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    consentType: consentTypeEnum("consent_type").notNull(),
    version: t.text().notNull(),
    grantedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: t.timestamp({ mode: "date", withTimezone: true }),
    metadata: t.jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("consent_grants_active_unique")
      .on(table.patientId, table.consentType, table.version)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);
