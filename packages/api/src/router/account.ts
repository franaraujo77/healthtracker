import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { and, eq, inArray, sql } from "@healthtracker/db";
import { AccountDeletionRequests, Users } from "@healthtracker/db/schema";
import {
  ACCOUNT_AUDIT_DELETION_REQUESTED,
  getDeletionStatusInputSchema,
  getDeletionStatusOutputSchema,
  requestDeletionInputSchema,
  requestDeletionOutputSchema,
} from "@healthtracker/validators";

import { writeAuditLog } from "../audit";
import { protectedProcedure } from "../trpc";

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
   */
  initializeProfile: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

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

    return { userId, created };
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
} satisfies TRPCRouterRecord;
