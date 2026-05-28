import { sql } from "drizzle-orm";
import { pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Story 5.6 — `account_deletion_requests`. LGPD Art. 18 right-to-erasure
 * surface. Each row is one patient-initiated deletion ceremony. `status`
 * advances `queued → processing → complete` (or `→ failed`). The row
 * SURVIVES the deletion of its owning patient — it is the deletion
 * ledger (proves to auditors the deletion happened) — and therefore
 * the `patient_id` column INTENTIONALLY has no FK to `users(id)`.
 *
 * RLS lives in `packages/db/policies/custom_rls_account_deletion_requests.sql` —
 * patient SELECT-own only; no INSERT/UPDATE/DELETE patient policies
 * (the resolver + worker run service-role and bypass RLS).
 *
 * Partial unique index `account_deletion_requests_active_uq` on
 * `(patient_id) WHERE status IN ('queued','processing')` enforces
 * single-in-flight dedup. The `requestDeletion` resolver narrow-catches
 * `23505` and re-SELECTs the existing in-flight row's id (mirror of
 * Story 5.5 R1 `exports_active_uq` shape).
 */
export const accountDeletionStatusEnum = pgEnum(
  "account_deletion_status_enum",
  ["queued", "processing", "complete", "failed"],
);

export const AccountDeletionRequests = pgTable(
  "account_deletion_requests",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    /**
     * INTENTIONAL: no FK reference to `users(id)`. The deletion ledger
     * row outlives the user row that triggered it. After the worker
     * completes step 4 (`DELETE FROM users`), the `patient_id` value
     * stored here is a "tombstone" — it refers to a row that no
     * longer exists. Acceptable for compliance audit; do not "fix"
     * by adding `references(() => Users.id)`.
     */
    patientId: t.uuid().notNull(),
    status: accountDeletionStatusEnum("status").notNull().default("queued"),
    requestedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: t.timestamp({ mode: "date", withTimezone: true }),
    failureReason: t.text(),
  }),
  (table) => [
    // Single-in-flight dedup. The resolver narrow-catches 23505 and
    // re-SELECTs (Story 5.5 R1 idempotency-shield pattern).
    uniqueIndex("account_deletion_requests_active_uq")
      .on(table.patientId)
      .where(sql`${table.status} in ('queued', 'processing')`),
  ],
);

export type AccountDeletionRequestRow =
  typeof AccountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest =
  typeof AccountDeletionRequests.$inferInsert;
export type AccountDeletionStatus = AccountDeletionRequestRow["status"];
