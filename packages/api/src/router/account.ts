import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, inArray, sql } from "@healthtracker/db";
import {
  AccountDeletionRequests,
  PatientInvites,
  StalenessThresholds,
  Users,
} from "@healthtracker/db/schema";
import {
  ACCOUNT_AUDIT_DELETION_REQUESTED,
  biomarkerCategoryLabelPtBr,
  getDeletionStatusInputSchema,
  getDeletionStatusOutputSchema,
  getPatientInviteContextInputSchema,
  getPatientInviteContextOutputSchema,
  listStalenessThresholdsInputSchema,
  listStalenessThresholdsOutputSchema,
  PATIENT_INVITE_RESOLVED_AUDIT,
  requestDeletionInputSchema,
  requestDeletionOutputSchema,
  STALENESS_DEFAULT_DAYS,
  STALENESS_THRESHOLD_UPDATED_AUDIT,
  updateStalenessThresholdsInputSchema,
  updateStalenessThresholdsOutputSchema,
} from "@healthtracker/validators";

import type { AuditDb } from "../audit";
import { writeAuditLog } from "../audit";
import { constantTimeEqualHmac } from "../sharing";
import {
  professionalSessionProcedure,
  protectedProcedure,
  publicProcedure,
} from "../trpc";

/**
 * Postgres unique-constraint violation. Drizzle surfaces these via the
 * `postgres` driver with `code = "23505"`. Narrow predicate so the rest
 * of the error space rethrows. Same shape as
 * `sharingRouter`'s helper (Story 5.1 R1 / 5.5 R1 idempotency-shield
 * pattern).
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export const accountRouter = {
  /**
   * Creates the patient's application-domain `users` row after Supabase Auth
   * sign-up. The client performs `supabase.auth.signUp()` first; this runs in
   * the resulting authenticated session, so `ctx.session.user.id` is the new
   * `auth.uid()` and the RLS `SET LOCAL app.current_patient_id` is in place.
   *
   * Idempotent: a repeated call (e.g. after a client retry) inserts nothing
   * and writes no audit event.
   *
   * Story 6.4 — extended with an OPTIONAL `inviteId` parameter. When
   * present + valid + pending, atomically flips the `patient_invites`
   * row to `status='resolved'` and emits the `patient_invite.resolved`
   * audit row (NOT in `ACCESS_LOG_EVENT_KINDS` — doctor-side acquisition
   * surface). The original non-invite registration path is unchanged
   * (no `inviteId` → identical legacy behavior).
   *
   * **R1 reviewer guardrail:** the `inviteId` parameter MUST remain
   * optional. Promoting it to required is a breaking change to the
   * Story 1.1 register flow — CLAUDE.md "Patient invite discipline".
   */
  initializeProfile: protectedProcedure
    .input(
      z
        .object({
          inviteId: z.uuid().optional(),
          tokenHmac: z.string().min(1).max(256).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // `ctx.db` is already the protectedProcedure-opened transaction;
      // no need for an inner wrap (postgres-js doesn't support nested
      // tx and the existing mocked test harness doesn't expose one).

      const inserted = await ctx.db
        .insert(Users)
        .values({ id: userId })
        .onConflictDoNothing()
        .returning({ id: Users.id });

      const created = inserted.length > 0;

      if (created) {
        await writeAuditLog(ctx.db, {
          actorId: userId,
          actorType: "patient",
          event: "patient.created",
          resourceId: userId,
          resourceType: "user",
          metadata: { actor: "self" },
        });
      }

      // Story 6.4 — invite-resolution branch. Skipped when no
      // inviteId. The legacy non-invite path is structurally
      // unchanged (no SELECT, no UPDATE, no audit). Any failure
      // here is SILENT — registration must not fail because the
      // referrer-attribution glue had an issue (the patient is
      // already an HT user at this point, the referral telemetry
      // is operationally important but not gating).
      if (input?.inviteId && input.tokenHmac) {
        await resolvePatientInviteWithinTx(ctx.db, {
          inviteId: input.inviteId,
          tokenHmac: input.tokenHmac,
          patientUserId: userId,
        });
      }

      return { userId, created };
    }),

  /**
   * Story 6.4 AC7 — `getPatientInviteContext`. Public resolver invoked
   * by the `/convite/[inviteSegment]` RSC to render the landing card.
   * No session required; HMAC verify (with the `"patient_invite:"`
   * domain prefix) is the authorization boundary.
   *
   * Returns `valid:false` for missing / expired / revoked / bad-HMAC
   * cases — the calling RSC renders the generic expired-message card.
   * **No audit row written** — the patient identity doesn't exist yet
   * to actor.
   */
  getPatientInviteContext: publicProcedure
    .input(getPatientInviteContextInputSchema)
    .output(getPatientInviteContextOutputSchema)
    .query(async ({ ctx, input }) => {
      // Use bare service-role connection — public resolver, no RLS
      // bound on `ctx.db` (no protectedProcedure tx). The
      // patient_invites RLS forbids patient SELECT; we need a
      // non-gated read here. The `db` client is service-role.
      const rows = await ctx.db.execute<{
        token_hmac: string;
        status: string;
        expires_at: Date;
        revoked_at: Date | null;
        doctor_display_name: string;
      }>(sql`
        SELECT
          pi.token_hmac           AS token_hmac,
          pi.status::text         AS status,
          pi.expires_at           AS expires_at,
          pi.revoked_at           AS revoked_at,
          prof.display_name       AS doctor_display_name
        FROM patient_invites pi
        JOIN professionals prof ON prof.user_id = pi.professional_user_id
        WHERE pi.id = ${input.inviteId}::uuid
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) {
        return { valid: false, doctorDisplayName: null };
      }
      // Constant-time HMAC re-verify (sign with `"patient_invite:"`
      // domain-prefix; defense-in-depth above the URL-supplied half).
      // We persisted the HMAC of the raw token, and the URL carries
      // that same HMAC — compare directly via
      // `constantTimeEqualHmac` semantics: both halves are signatures.
      // We don't have the raw, so we delegate to length-checked
      // timingSafeEqual via the helper:
      const hmacOk = constantTimeEqualHmac(row.token_hmac, input.tokenHmac);
      if (!hmacOk) {
        return { valid: false, doctorDisplayName: null };
      }
      if (row.status !== "pending") {
        return { valid: false, doctorDisplayName: null };
      }
      if (row.revoked_at !== null) {
        return { valid: false, doctorDisplayName: null };
      }
      if (row.expires_at.getTime() <= Date.now()) {
        return { valid: false, doctorDisplayName: null };
      }
      return {
        valid: true,
        doctorDisplayName: row.doctor_display_name,
      };
    }),

  /**
   * Story 5.6 AC2 — `requestDeletion`. Enqueues an async account-
   * deletion ceremony. LGPD Art. 18 right to erasure — `protectedProcedure`
   * (NOT `premiumProcedure`); same exemption as Story 5.5 exports.
   *
   * Inside one tx:
   *   - INSERT `account_deletion_requests` (status='queued'). Partial
   *     unique index `account_deletion_requests_active_uq` enforces
   *     single-in-flight per patient. On 23505 narrow-catch → re-SELECT
   *     the existing active row and return its id (mirror of Story 5.5
   *     R1 idempotency-shield pattern).
   *   - Outbox INSERT into `pgboss.job` for the
   *     `account.delete.generate` queue (Story 5.2 / 5.5 pattern).
   *     `singleton_key = account.delete.${patientId}` — per-patient is
   *     correct because only one in-flight deletion per patient is
   *     allowed.
   *   - `writeAuditLog` patient-actor `account.deletion_requested`.
   *     The worker's step-1 audit_log pseudonymization scrub
   *     retroactively replaces this row's `actor_id` with the hash.
   *
   * The client signs out IMMEDIATELY on `onSuccess`. The worker runs
   * out-of-band; the actual cascade-delete + Supabase Auth admin
   * deletion happen seconds later. No premium gate.
   */
  requestDeletion: protectedProcedure
    .input(requestDeletionInputSchema)
    .output(requestDeletionOutputSchema)
    .mutation(async ({ ctx }) => {
      const patientId = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        let requestId: string;
        try {
          const inserted = await tx
            .insert(AccountDeletionRequests)
            .values({ patientId, status: "queued" })
            .returning({ id: AccountDeletionRequests.id });
          const row = inserted[0];
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "requestDeletion: insert returned no row",
            });
          }
          requestId = row.id;
        } catch (err) {
          if (isUniqueViolation(err)) {
            // Concurrent double-tap raced past the in-memory guard —
            // the partial unique index pinned the first INSERT; this
            // one collides. Re-SELECT the racing active row and
            // return its id. Do NOT re-enqueue the job or re-write
            // the audit row.
            const raced = await tx
              .select({ id: AccountDeletionRequests.id })
              .from(AccountDeletionRequests)
              .where(
                and(
                  eq(AccountDeletionRequests.patientId, patientId),
                  inArray(AccountDeletionRequests.status, [
                    "queued",
                    "processing",
                    // R1 fix — include 'complete'. If the worker is fast
                    // enough to flip the row to 'complete' in the
                    // milliseconds between the failed INSERT and this
                    // SELECT, return the existing requestId (idempotent:
                    // a completed deletion IS the requested outcome).
                    "complete",
                  ]),
                ),
              )
              .limit(1);
            if (raced[0]) {
              return { requestId: raced[0].id };
            }
          }
          throw err;
        }

        // Outbox: enqueue inside the same tx (Story 5.2 / 5.5 pattern).
        const jobPayload = {
          jobId: crypto.randomUUID(),
          patientId,
          correlationId: requestId,
          payload: { requestId, patientId },
          createdAt: new Date().toISOString(),
        };
        const singletonKey = `account.delete.${patientId}`;
        await tx.execute(sql`
          INSERT INTO pgboss.job
            (name, data, retry_limit, retry_delay, retry_backoff, singleton_key)
          VALUES (
            'account.delete.generate',
            ${JSON.stringify(jobPayload)}::jsonb,
            3, 30, true,
            ${singletonKey}
          )
          ON CONFLICT DO NOTHING
        `);

        await writeAuditLog(tx, {
          actorId: patientId,
          actorType: "patient",
          event: ACCOUNT_AUDIT_DELETION_REQUESTED,
          resourceId: requestId,
          resourceType: "account_deletion_request",
          metadata: { requestedAt: new Date().toISOString() },
        });

        return { requestId };
      });
    }),

  /**
   * Story 5.6 AC9 — `getDeletionStatus`. Polling endpoint. In practice
   * the client signs out immediately on `requestDeletion` success and
   * never calls this; it exists for ops (admin debugging via
   * service-role direct DB query). SELECT-own with 404 on cross-patient
   * (Story 5.1 R1 discipline).
   */
  getDeletionStatus: protectedProcedure
    .input(getDeletionStatusInputSchema)
    .output(getDeletionStatusOutputSchema)
    .query(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      const rows = await ctx.db
        .select({
          status: AccountDeletionRequests.status,
          requestedAt: AccountDeletionRequests.requestedAt,
          completedAt: AccountDeletionRequests.completedAt,
          failureReason: AccountDeletionRequests.failureReason,
        })
        .from(AccountDeletionRequests)
        .where(
          and(
            eq(AccountDeletionRequests.id, input.requestId),
            eq(AccountDeletionRequests.patientId, patientId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return {
        status: row.status,
        requestedAt: row.requestedAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        failureReason: row.failureReason ?? null,
      };
    }),
  /**
   * Story 6.5 AC4 — `updateStalenessThresholds`. Activated doctor
   * sets per-biomarker-category staleness thresholds.
   *
   * **Critical ordering (each step is load-bearing):**
   *   1. Activation gate — handled by `professionalSessionProcedure`
   *      itself (R1-followup MEDIUM-1). Missing professionals row →
   *      PRECONDITION_FAILED before this resolver body runs.
   *   2. Zod refine already rejected duplicate-by-category at the
   *      boundary; AC4 step 2 is satisfied by the input schema.
   *   3. Unknown-category cross-check vs `loinc_ref` distinct
   *      categories. Any input category not present → BAD_REQUEST
   *      (lists the unknown values — no PII).
   *   4. Transactional UPSERT batch via `onConflictDoUpdate`.
   *   5. Audit row inside the same tx (`staleness_threshold.updated`,
   *      NOT in `ACCESS_LOG_EVENT_KINDS`).
   *
   * **Empty array = no-op** (AC4 deletion-semantics): no rows
   * deleted, returns `updatedCount: 0`. Reserve a deletion path for
   * a future "reset to default" story.
   *
   * Session-only (`professionalSessionProcedure`) — no share-token in
   * context; surface lives at `/profissional/configuracoes/limiares`.
   */
  updateStalenessThresholds: professionalSessionProcedure
    .input(updateStalenessThresholdsInputSchema)
    .output(updateStalenessThresholdsOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const doctorUserId = ctx.session.user.id;

      // Step 3 — unknown-category cross-check. Only runs when there
      // are entries to validate (empty array = no-op short-circuit).
      if (input.thresholds.length > 0) {
        const inputCategories = input.thresholds.map(
          (t) => t.biomarkerCategory,
        );
        const knownRows = await ctx.db.execute<{ category: string }>(sql`
          SELECT DISTINCT category
          FROM loinc_ref
          WHERE category = ANY(${inputCategories}::text[])
        `);
        const known = new Set(
          (knownRows as unknown as { category: string }[]).map(
            (r) => r.category,
          ),
        );
        const unknown = inputCategories.filter((c) => !known.has(c));
        if (unknown.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `STALENESS_THRESHOLD_UNKNOWN_CATEGORIES:${unknown.join(",")}`,
          });
        }
      }

      // Step 4 — UPSERT batch + Step 5 — audit, atomic.
      return ctx.db.transaction(async (tx) => {
        let updatedCount = 0;
        if (input.thresholds.length > 0) {
          const rows = input.thresholds.map((entry) => ({
            professionalUserId: doctorUserId,
            biomarkerCategory: entry.biomarkerCategory,
            thresholdDays: entry.thresholdDays,
          }));
          const inserted = await tx
            .insert(StalenessThresholds)
            .values(rows)
            .onConflictDoUpdate({
              target: [
                StalenessThresholds.professionalUserId,
                StalenessThresholds.biomarkerCategory,
              ],
              set: {
                thresholdDays: sql`EXCLUDED.threshold_days`,
                updatedAt: sql`now()`,
              },
            })
            .returning({
              category: StalenessThresholds.biomarkerCategory,
            });
          updatedCount = inserted.length;
        }

        // Audit emits even on empty-array no-op (intent captured).
        await writeAuditLog(tx, {
          actorId: doctorUserId,
          actorType: "doctor",
          event: STALENESS_THRESHOLD_UPDATED_AUDIT,
          resourceId: doctorUserId,
          resourceType: "professional",
          metadata: {
            categories: input.thresholds.map((t) => t.biomarkerCategory),
          },
        });

        return { updatedCount };
      });
    }),

  /**
   * Story 6.5 AC7 — `listStalenessThresholds`. Renders the settings
   * page's per-category form. LEFT JOIN distinct `loinc_ref.category`
   * with the doctor's rows; absent rows surface as
   * `(thresholdDays = STALENESS_DEFAULT_DAYS, isDefault = true)`.
   *
   * Activation gate handled by `professionalSessionProcedure`
   * (R1-followup MEDIUM-1) — not-activated → PRECONDITION_FAILED.
   */
  listStalenessThresholds: professionalSessionProcedure
    .input(listStalenessThresholdsInputSchema)
    .output(listStalenessThresholdsOutputSchema)
    .query(async ({ ctx }) => {
      const doctorUserId = ctx.session.user.id;

      // LEFT JOIN — keep the server-side merge so the form's local
      // state is a simple array. The doctor-scoped SELECT on
      // `staleness_thresholds` is RLS-gated to own rows.
      const rows = await ctx.db.execute<{
        category: string;
        threshold_days: number | null;
      }>(sql`
        SELECT
          cats.category AS category,
          st.threshold_days AS threshold_days
        FROM (SELECT DISTINCT category FROM loinc_ref) cats
        LEFT JOIN staleness_thresholds st
          ON st.biomarker_category = cats.category
          AND st.professional_user_id = ${doctorUserId}::uuid
        ORDER BY cats.category ASC
      `);

      const categories = (
        rows as unknown as { category: string; threshold_days: number | null }[]
      ).map((r) => ({
        biomarkerCategory: r.category,
        labelPtBr: biomarkerCategoryLabelPtBr(r.category),
        thresholdDays: r.threshold_days ?? STALENESS_DEFAULT_DAYS,
        isDefault: r.threshold_days === null,
      }));

      return {
        categories,
        defaultDays: STALENESS_DEFAULT_DAYS,
      };
    }),
} satisfies TRPCRouterRecord;

/**
 * Story 6.4 AC7 — atomic invite-resolution helper invoked inside the
 * `initializeProfile` tx when the patient signed up through a
 * `/convite/<id>.<hmac>` link.
 *
 * Sequence (single tx, no separate RTTs vs the user-row INSERT):
 *   1. SELECT the invite row (status + hmac + expires + revoked).
 *   2. Constant-time HMAC re-verify above the URL-supplied half.
 *   3. UPDATE WHERE status='pending' AND id=$id — the racing-revoke
 *      safe predicate. If UPDATE returns zero rows (revoke / expiry /
 *      already-claimed race), registration STILL completes silently;
 *      no audit emission, no referrer attribution.
 *   4. Emit `patient_invite.resolved` audit (actorType='patient',
 *      metadata carries doctorUserId). NOT in `ACCESS_LOG_EVENT_KINDS`.
 *
 * **MUST NOT THROW** — registration must complete even if every
 * invite-resolution step fails. The patient is already a Health Tracker
 * user at this point; the referrer attribution is doctor-side
 * telemetry, not a registration prerequisite. Narrow catch: programmer
 * errors propagate.
 */
async function resolvePatientInviteWithinTx(
  tx: AuditDb,
  args: { inviteId: string; tokenHmac: string; patientUserId: string },
): Promise<void> {
  try {
    const rows = await tx
      .select({
        id: PatientInvites.id,
        tokenHmac: PatientInvites.tokenHmac,
        status: PatientInvites.status,
        expiresAt: PatientInvites.expiresAt,
        revokedAt: PatientInvites.revokedAt,
        professionalUserId: PatientInvites.professionalUserId,
      })
      .from(PatientInvites)
      .where(eq(PatientInvites.id, args.inviteId))
      .limit(1);
    const row = rows[0];
    if (!row) return;
    if (!constantTimeEqualHmac(row.tokenHmac, args.tokenHmac)) return;
    if (row.status !== "pending") return;
    if (row.revokedAt !== null) return;
    if (row.expiresAt.getTime() <= Date.now()) return;

    // UPDATE-WHERE-status='pending' is the racing-revoke safe gate
    // (Story 6.4 AC7). A concurrent revoke wins; the patient still
    // completes registration but goes unattributed.
    const updated = await tx
      .update(PatientInvites)
      .set({
        resolvedUserId: args.patientUserId,
        resolvedAt: sql`now()`,
        status: "resolved",
      })
      .where(
        and(
          eq(PatientInvites.id, args.inviteId),
          eq(PatientInvites.status, "pending"),
        ),
      )
      .returning({ id: PatientInvites.id });

    if (updated.length === 0) {
      // Race with revoke / concurrent claim. No audit, no error —
      // the patient's registration completes unattributed.
      return;
    }

    await writeAuditLog(tx, {
      actorId: args.patientUserId,
      actorType: "patient",
      event: PATIENT_INVITE_RESOLVED_AUDIT,
      resourceId: args.inviteId,
      resourceType: "patient_invite",
      metadata: { doctorUserId: row.professionalUserId },
    });
  } catch (err) {
    // **R1-M2 narrow catch.** Spec AC7 / T4.4 mandates "MUST NOT
    // THROW" — registration completes even if every invite-resolution
    // step fails. But the previous broad catch swallowed EVERY non-
    // programmer-error from the SELECT, the HMAC compare, and the
    // UPDATE — exactly the failure mode CLAUDE.md "Narrow catches"
    // warns against. We now articulate which error shapes we
    // intentionally swallow:
    //   - Postgres FK violation (23503) — patient_invites row was
    //     concurrently deleted (cascade from professionals delete).
    //   - Postgres unique violation (23505) — defense-in-depth; not
    //     expected on the resolved-flip UPDATE but harmless if seen
    //     (a parallel UPDATE already won the race).
    //   - Postgres serialization / deadlock (40001 / 40P01) — the
    //     racing-revoke window the spec explicitly accepts.
    //   - TRPCError shapes (writeAuditLog can emit these) — the
    //     audit is doctor-side telemetry, not a registration gate.
    // Everything else — including programmer errors (TypeError,
    // ReferenceError, SyntaxError) and unknown infra failures —
    // propagates so the initializeProfile mutation surfaces the
    // failure rather than silently fail-opening.
    if (isExpectedInviteResolutionError(err)) {
      console.warn(
        "[initializeProfile] patient_invite resolution failed — continuing",
        err,
      );
      return;
    }
    throw err;
  }
}

/**
 * Story 6.4 R1-M2 — narrow-catch predicate for
 * `resolvePatientInviteWithinTx`. Returns true only for the small set
 * of error shapes the spec mandates we swallow (see resolver
 * docstring). Everything else propagates.
 */
function isExpectedInviteResolutionError(err: unknown): boolean {
  if (err instanceof TRPCError) return true;
  if (typeof err !== "object" || err === null) return false;
  if (!("code" in err)) return false;
  const code = (err as { code?: unknown }).code;
  return (
    code === "23503" || // FK violation (concurrent delete cascade)
    code === "23505" || // unique violation (parallel resolved-flip won)
    code === "40001" || // serialization failure
    code === "40P01" //   deadlock detected
  );
}
