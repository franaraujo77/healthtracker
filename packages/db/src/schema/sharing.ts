import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * Story 5.1 — Epic 5 sharing schema. Three tables land here:
 *
 *   - `pending_invites`: patient-side intent to share with a named
 *     doctor. `resolved_user_id` stays NULL until Epic 6's
 *     `claimInviteByDoctor` flips it when the doctor signs up.
 *     Identifier (email or CRM) is stored as a SHA-256 hex hash
 *     (`identifier_hash`) — never the raw value (PII hygiene).
 *
 *   - `share_tokens`: opaque share links. Stores the SHA-256 hash of
 *     the raw token plus the HMAC signature. Default 7-day expiry
 *     (Story 5.2 will add a duration picker). `revoked_at` is the
 *     soft-delete signal — RLS predicates reference it; physical
 *     deletion is forbidden (AC11).
 *
 *   - `share_token_biomarkers`: per-(share_token, biomarker_category)
 *     visibility junction. Composite PK enforces idempotent UPSERT;
 *     `visible = false` is the LGPD per-biomarker scope guarantee
 *     (NFR-S3).
 *
 * RLS lives in three companion `custom_rls_share_*.sql` policy files
 * under `packages/db/policies/`. The doctor principal sets
 * `app.current_share_token_id` (mirrors the existing
 * `app.current_patient_id` pattern); see `packages/api/src/trpc.ts`
 * `doctorProcedure`.
 *
 * **Migration note (Story 5.1 scope):** no `supabase/migrations/0005_*.sql`
 * file ships in this story — the production migration is batched into
 * the final story of Epic 5 (mirrors Story 3.5 / Story 4.4 pattern).
 * Dev applies via `pnpm db:push` (additive, safe per CLAUDE.md ops
 * note); testcontainer integration tests apply via `drizzle-kit push
 * --force` + the policy files via `psql -f` in setup.
 *
 * **`resolved_user_id` FK note:** declared as a plain `uuid` column
 * here (no `.references(Users.id)` yet). The Epic 6 doctor-account
 * flow will land the FK + ON DELETE SET NULL semantics when the
 * doctor surface ships.
 */

export const PendingInvites = pgTable(
  "pending_invites",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    /** Patient-chosen friendly label (e.g. "Dra. Renata"). */
    displayName: t.text().notNull(),
    /** SHA-256 hex of the doctor's email or CRM. Never store raw. */
    identifierHash: t.text().notNull(),
    /**
     * Filled by Epic 6's `claimInviteByDoctor` when the doctor signs
     * up. FK to `users(id)` deferred to Epic 6 (doctor-account surface).
     */
    resolvedUserId: t.uuid(),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // AC7 — idempotency on re-invite of the same doctor by the same patient.
    uniqueIndex("pending_invites_patient_identifier_uq").on(
      table.patientId,
      table.identifierHash,
    ),
  ],
);

export const ShareTokens = pgTable(
  "share_tokens",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    /** SHA-256 hex of the raw token (lookup key for the doctor side). */
    tokenHash: t.text().notNull().unique(),
    /** HMAC-SHA256 signature of the raw token. Never log; never cache client-side. */
    tokenHmac: t.text().notNull(),
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    inviteId: t
      .uuid()
      .notNull()
      .references(() => PendingInvites.id, { onDelete: "cascade" }),
    expiresAt: t.timestamp({ mode: "date", withTimezone: true }).notNull(),
    /** AC11 — soft-delete signal owned by Story 5.4 revoke flow. */
    revokedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // Compartilhar tab listing (Story 5.4 reuse).
    index("share_tokens_patient_created_idx").on(
      table.patientId,
      sql`${table.createdAt} desc`,
    ),
    index("share_tokens_invite_idx").on(table.inviteId),
    // Patch #4 — DB-level idempotency on (invite_id) WHERE not revoked.
    // Mirrors the SELECT-then-INSERT guard inside `createShareToken`
    // and defends against tab-refresh races where the application
    // check would miss a concurrent INSERT.
    uniqueIndex("share_tokens_invite_active_uq")
      .on(table.inviteId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export const ShareTokenBiomarkers = pgTable(
  "share_token_biomarkers",
  (t) => ({
    shareTokenId: t
      .uuid()
      .notNull()
      .references(() => ShareTokens.id, { onDelete: "cascade" }),
    /**
     * Biomarker category identifier (LOINC code or canonical biomarker
     * name). Stored as text for schema flexibility — Epic 5 does not
     * pin an enum.
     */
    biomarkerCategory: t.text().notNull(),
    visible: t.boolean().notNull().default(true),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    primaryKey({
      name: "share_token_biomarkers_pk",
      columns: [table.shareTokenId, table.biomarkerCategory],
    }),
  ],
);

// Inferred row types for downstream consumers.
export type PendingInvite = typeof PendingInvites.$inferSelect;
export type NewPendingInvite = typeof PendingInvites.$inferInsert;
export type ShareToken = typeof ShareTokens.$inferSelect;
export type NewShareToken = typeof ShareTokens.$inferInsert;
export type ShareTokenBiomarker = typeof ShareTokenBiomarkers.$inferSelect;
export type NewShareTokenBiomarker = typeof ShareTokenBiomarkers.$inferInsert;
