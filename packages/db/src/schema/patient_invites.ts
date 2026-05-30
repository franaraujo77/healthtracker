import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { Professionals } from "./professionals";
import { Users } from "./users";

/**
 * Story 6.4 — `patient_invites` table.
 *
 * **Doctor → patient acquisition surface.** Created by
 * `sharingRouter.createPatientInvite` when an activated doctor invites
 * a patient by email or Brazilian phone. The patient claims the invite
 * by signing up via `${WEB_APP_URL}/convite/<id>.<tokenHmac>`; the
 * `initializeProfile` mutation (Story 1.1, extended) flips
 * `resolved_user_id` + `status='resolved'` atomically with the
 * user-row INSERT.
 *
 * **Sibling table to `pending_invites`, NOT an extension** (AC3).
 * Lifecycle, RLS principal, and FK direction differ — see the spec for
 * the load-bearing rationale.
 *
 * **`onDelete: "set null"` on `resolved_user_id` — SECOND documented
 * exception to Story 5.6's cascade rule** (the first is
 * `pending_invites.resolved_user_id` in Story 6.3). When the patient
 * later deletes their account, the doctor's referral telemetry
 * survives but the linkage breaks. Cascading would silently delete the
 * doctor's history of who they invited, which is directionally wrong
 * (doctor-authored row deleted by patient action). Locked in by
 * `patient_invites_resolved_user_id_fk.rls.test.ts`.
 *
 * **Migration discipline (Story 6.4 scope):** no `supabase/migrations/*`
 * file ships in this story — production deploy lands in Story 6.6's
 * Epic 6 consolidated migration (mirrors Story 6.3).
 *
 * RLS lives in `packages/db/policies/custom_rls_patient_invites.sql`.
 */
export const patientInviteStatusEnum = pgEnum("patient_invite_status_enum", [
  "pending",
  "resolved",
  "expired",
  "revoked",
]);

export const PatientInvites = pgTable(
  "patient_invites",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    /** FK to professionals.user_id — doctor MUST be activated first (Story 6.3 gate). */
    professionalUserId: t
      .uuid("professional_user_id")
      .notNull()
      .references(() => Professionals.userId, { onDelete: "cascade" }),
    /** SHA-256 hex of normalised email (lowercased) or E.164 phone. */
    identifierHash: t.text("identifier_hash").notNull(),
    /** 'email' | 'phone' — discriminator for downstream UI. */
    identifierKind: t.text("identifier_kind").notNull(),
    /** Patient-supplied display name (doctor-entered; max 80; trimmed; nullable per AC2). */
    displayName: t.text("display_name"),
    /**
     * HMAC-SHA256 of the raw invite token; the URL carries inviteId +
     * tokenHmac, the patient-facing landing resolver re-verifies via
     * constant-time compare. SHARE_TOKEN_HMAC_SECRET is REUSED with
     * the `"patient_invite:"` domain prefix (AC8).
     */
    tokenHmac: t.text("token_hmac").notNull().unique(),
    /**
     * Patient's user_id once they sign up via the magic invite URL.
     * **FK cascade rule deviation #2 — `onDelete: "set null"`**.
     * See table-level docstring + AC4 + regression test.
     */
    resolvedUserId: t
      .uuid("resolved_user_id")
      .references(() => Users.id, { onDelete: "set null" }),
    status: patientInviteStatusEnum("status").notNull().default("pending"),
    /**
     * 7-day expiry, matching the SHARE_DURATION default. Renewable via
     * re-invite (idempotent UPSERT path — AC6). Soft-expiry: status
     * flip to `expired` is lazy (no background sweep for MVP); the
     * resolver filters via `expires_at <= now()`.
     */
    expiresAt: t
      .timestamp("expires_at", { mode: "date", withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    /** Soft-delete signal (revokePatientInvite mutation deferred). */
    revokedAt: t.timestamp("revoked_at", {
      mode: "date",
      withTimezone: true,
    }),
    /** Funnel step — populated on patient sign-up (AC7). */
    resolvedAt: t.timestamp("resolved_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: t
      .timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // AC6 — in-flight idempotency on (professional, identifier_hash).
    // Partial unique index WHERE status='pending': re-inviting the same
    // patient by the same doctor returns the existing pending row's id
    // rather than creating a duplicate. After expiry the partial index
    // releases — re-invite creates a NEW row (renewal flow).
    uniqueIndex("patient_invites_professional_identifier_active_uq")
      .on(table.professionalUserId, table.identifierHash)
      .where(sql`${table.status} = 'pending'`),
    // Listing (deferred — dashboard story).
    index("patient_invites_professional_created_idx").on(
      table.professionalUserId,
      sql`${table.createdAt} desc`,
    ),
    // Resolved-by-user lookup (Início referrer attribution — T5.6).
    index("patient_invites_resolved_user_idx").on(table.resolvedUserId),
    check(
      "patient_invites_identifier_kind_check",
      sql`${table.identifierKind} in ('email', 'phone')`,
    ),
  ],
);

export type PatientInvite = typeof PatientInvites.$inferSelect;
export type NewPatientInvite = typeof PatientInvites.$inferInsert;
