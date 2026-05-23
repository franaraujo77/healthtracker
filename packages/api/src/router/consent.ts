import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { and, desc, eq, isNull } from "@healthtracker/db";
import { ConsentGrants } from "@healthtracker/db/schema";
import {
  ConsentDeclineInputSchema,
  ConsentGrantInputSchema,
  ConsentListInputSchema,
  ConsentRevokeInputSchema,
} from "@healthtracker/validators";

import { writeAuditLog } from "../audit";
import { writeConsentGrantIfAbsent, writeConsentRevocation } from "../consent";
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
   *
   * Story 1.4 — accepts an optional `surface` flag. When `surface ===
   * 'settings'` (i.e. the Meus Consentimentos screen fetched the list),
   * a single `consent.read` audit event is written (AC4 / FR33). The
   * default surface is `'callback'`, which matches the existing
   * onboarding-callback consumers (web `/auth/callback`, Expo
   * `_layout.tsx`) — those routing probes intentionally do NOT emit an
   * audit row so the FR33 ledger stays meaningful.
   */
  list: protectedProcedure
    .input(ConsentListInputSchema)
    .query(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      // `input` is always defined here: the Zod schema `.default({})`
      // converts `undefined` to `{}` before this resolver runs. The
      // `surface` field is still optional and defaults to 'callback'.
      const surface = input.surface ?? "callback";

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
            eq(ConsentGrants.patientId, patientId),
            isNull(ConsentGrants.revokedAt),
          ),
        )
        .orderBy(
          desc(ConsentGrants.grantedAt),
          desc(ConsentGrants.createdAt),
          desc(ConsentGrants.id),
        );

      const seen = new Set<string>();
      const deduped = rows.filter((row) => {
        if (seen.has(row.consentType)) return false;
        seen.add(row.consentType);
        return true;
      });

      if (surface === "settings") {
        await writeAuditLog(ctx.db, {
          actorId: patientId,
          actorType: "patient",
          event: "consent.read",
          resourceId: patientId,
          resourceType: "consent_grant",
          metadata: { surface: "settings", actor: "self" },
        });
      }

      return deduped;
    }),

  /**
   * Story 1.4 — revokes the patient's currently-active grant of
   * `consentType`. The narrow UPDATE policy in
   * `custom_rls_consent_grants_zz_revoke.sql` permits only this column
   * change, only by the row's owner, only on a currently active row.
   *
   * Idempotent: re-tapping "Retirar" on a row that was already revoked
   * returns `{ revoked: false }` with no audit emission — the absence
   * of a row revocation is not an event.
   */
  revoke: protectedProcedure
    .input(ConsentRevokeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      // Atomicity note (review P27 investigation): `protectedProcedure`
      // already wraps every resolver in `ctx.db.transaction(...)` so it
      // can `SET LOCAL app.current_patient_id` for RLS — see
      // `packages/api/src/trpc.ts`. `ctx.db` here IS the tx, and a
      // throw from `writeAuditLog` below will roll back the UPDATE
      // performed by `writeConsentRevocation`. FR33 atomicity is
      // already guaranteed by the outer wrap.
      const revokedRow = await writeConsentRevocation(ctx.db, {
        patientId,
        consentType: input.consentType,
      });

      if (!revokedRow) {
        // Idempotent path — no active grant to revoke. Surface as a
        // success so the client can collapse a double-tap into a single
        // UX outcome.
        return { revoked: false as const };
      }

      await writeAuditLog(ctx.db, {
        actorId: patientId,
        actorType: "patient",
        event: "consent.revoked",
        resourceId: revokedRow.id,
        resourceType: "consent_grant",
        metadata: {
          consentType: input.consentType,
          version: revokedRow.version,
          actor: "self",
        },
      });

      return {
        revoked: true as const,
        grantId: revokedRow.id,
        version: revokedRow.version,
      };
    }),
} satisfies TRPCRouterRecord;
