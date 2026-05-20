import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { and, desc, eq, isNull } from "@healthtracker/db";
import { ConsentGrants } from "@healthtracker/db/schema";
import {
  ConsentDeclineInputSchema,
  ConsentGrantInputSchema,
} from "@healthtracker/validators";

import { writeAuditLog } from "../audit";
import { writeConsentGrantIfAbsent } from "../consent";
import { protectedProcedure } from "../trpc";

export const consentRouter = {
  /**
   * Records a patient's "Concordo" tap for a given consent type + version.
   *
   * Race-safe idempotency: a single INSERT with `ON CONFLICT DO NOTHING`
   * against the `consent_grants_active_unique` partial index (Story 1.2
   * schema). Concurrent calls both reach INSERT, but only one creates a
   * row; the loser sees an empty `RETURNING` and falls through to the
   * lookup. The audit event is emitted only on the actual insert, so
   * `consent.granted` never duplicates.
   */
  grant: protectedProcedure
    .input(ConsentGrantInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      const insertedRow = await writeConsentGrantIfAbsent(ctx.db, {
        patientId,
        consentType: input.consentType,
        version: input.version,
      });
      if (insertedRow) {
        await writeAuditLog(ctx.db, {
          actorId: patientId,
          actorType: "patient",
          event: "consent.granted",
          resourceId: insertedRow.id,
          resourceType: "consent_grant",
          metadata: {
            consentType: input.consentType,
            version: input.version,
            actor: "self",
          },
        });
        return { grantId: insertedRow.id, created: true };
      }

      // Conflict path — the active row already exists. Look it up so the
      // caller still receives a grantId.
      const existing = await ctx.db
        .select({ id: ConsentGrants.id })
        .from(ConsentGrants)
        .where(
          and(
            eq(ConsentGrants.patientId, patientId),
            eq(ConsentGrants.consentType, input.consentType),
            eq(ConsentGrants.version, input.version),
            isNull(ConsentGrants.revokedAt),
          ),
        )
        .limit(1);

      const existingRow = existing[0];
      if (!existingRow) {
        // Defensive: ON CONFLICT matched but the row vanished before the
        // follow-up SELECT — only possible under highly unusual concurrent
        // revocation interleaving. Surface as an internal error rather
        // than silently inventing an id.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "CONSENT_GRANT_CONFLICT_RESOLUTION_FAILED",
        });
      }
      return { grantId: existingRow.id, created: false };
    }),

  /**
   * Records a patient's "Pular por agora" tap. No row is written to
   * `consent_grants` (the absence is the negative state) but the decision
   * is logged to the audit trail for FR33 traceability.
   */
  decline: protectedProcedure
    .input(ConsentDeclineInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      await writeAuditLog(ctx.db, {
        actorId: patientId,
        actorType: "patient",
        event: "consent.declined",
        resourceId: patientId,
        resourceType: "consent_grant",
        metadata: {
          consentType: input.consentType,
          version: input.version,
          actor: "self",
        },
      });

      return { acknowledged: true as const };
    }),

  /**
   * Returns the patient's currently-active grants, one per `consentType`
   * (most recent `grantedAt` wins, with `createdAt` and `id` as
   * deterministic tiebreakers so dedup is stable across queries).
   * Consumed by Story 1.4 (consent management) and by the onboarding
   * deep-link callbacks to detect a consent-incomplete patient.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: ConsentGrants.id,
        consentType: ConsentGrants.consentType,
        version: ConsentGrants.version,
        grantedAt: ConsentGrants.grantedAt,
      })
      .from(ConsentGrants)
      .where(
        and(
          eq(ConsentGrants.patientId, ctx.session.user.id),
          isNull(ConsentGrants.revokedAt),
        ),
      )
      .orderBy(
        desc(ConsentGrants.grantedAt),
        desc(ConsentGrants.createdAt),
        desc(ConsentGrants.id),
      );

    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.consentType)) return false;
      seen.add(row.consentType);
      return true;
    });
  }),
} satisfies TRPCRouterRecord;
