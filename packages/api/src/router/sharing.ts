import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { and, desc, eq, isNull, sql } from "@healthtracker/db";
import {
  PendingInvites,
  ShareTokenBiomarkers,
  ShareTokens,
} from "@healthtracker/db/schema";
import {
  configureBiomarkersInputSchema,
  createPendingInviteInputSchema,
  createShareTokenInputSchema,
  getDraftConfigInputSchema,
  SHARE_DEFAULT_DURATION_DAYS,
  SHARING_AUDIT_CONFIGURED,
  SHARING_AUDIT_PENDING_INVITE_CREATED,
  SHARING_AUDIT_TOKEN_CREATED,
} from "@healthtracker/validators";

import { writeAuditLog } from "../audit";
import { premiumProcedure } from "../middleware/entitlements";
import {
  generateShareToken,
  getDistinctCategoriesForPatient,
  hashIdentifier,
} from "../sharing";

/**
 * Story 5.1 — `sharingRouter`. Patient-side sharing ceremony
 * procedures. All procedures are wrapped in `premiumProcedure`
 * (architecture.md §9) — sharing is a Premium-tier feature
 * (NFR-S3 gate). Free-tier patients see PRECONDITION_FAILED /
 * PREMIUM_REQUIRED.
 *
 * RLS context is set by the upstream `protectedProcedure` middleware
 * (which `premiumProcedure` composes over) — the resolver-issued
 * Drizzle transaction (`ctx.db`) already carries
 * `app.current_patient_id`.
 *
 * Audit pattern follows Story 4.1: every mutation appends one
 * `writeAuditLog()` row in the same transaction; the constants are
 * the `SHARING_AUDIT_*` exports from `@healthtracker/validators`.
 */
export const sharingRouter = {
  /**
   * AC7 — idempotent on `(patient_id, identifier_hash)`. Re-invoking
   * with the same identifier returns the existing row id; the
   * partial unique index `pending_invites_patient_identifier_uq`
   * enforces.
   */
  createPendingInvite: premiumProcedure
    .input(createPendingInviteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      const identifierHash = hashIdentifier(input.identifier);

      // Idempotent SELECT-then-INSERT: cheap SELECT, INSERT-on-miss.
      // The unique index is the source of truth on the race — we
      // narrow-catch `23505` and re-SELECT.
      const existing = await ctx.db
        .select({ id: PendingInvites.id })
        .from(PendingInvites)
        .where(
          and(
            eq(PendingInvites.patientId, patientId),
            eq(PendingInvites.identifierHash, identifierHash),
          ),
        )
        .limit(1);
      if (existing.length > 0 && existing[0]) {
        return { inviteId: existing[0].id };
      }

      let inviteId: string;
      try {
        const [row] = await ctx.db
          .insert(PendingInvites)
          .values({
            patientId,
            displayName: input.displayName,
            identifierHash,
          })
          .returning({ id: PendingInvites.id });
        if (!row) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "createPendingInvite: insert returned no row",
          });
        }
        inviteId = row.id;
      } catch (err) {
        // Narrow catch — only the unique-violation race is folded
        // back into the idempotent return path. Programmer errors
        // (TypeError / ReferenceError / SyntaxError) and every
        // other infra shape rethrow.
        if (isUniqueViolation(err)) {
          const reSelect = await ctx.db
            .select({ id: PendingInvites.id })
            .from(PendingInvites)
            .where(
              and(
                eq(PendingInvites.patientId, patientId),
                eq(PendingInvites.identifierHash, identifierHash),
              ),
            )
            .limit(1);
          if (reSelect[0]) return { inviteId: reSelect[0].id };
        }
        throw err;
      }

      await writeAuditLog(ctx.db, {
        actorId: patientId,
        actorType: "patient",
        event: SHARING_AUDIT_PENDING_INVITE_CREATED,
        resourceId: inviteId,
        resourceType: "pending_invite",
        metadata: { identifierHash },
      });

      return { inviteId };
    }),

  /**
   * AC8 — creates the share_tokens row + pre-populates
   * share_token_biomarkers with one row per known biomarker
   * category for the patient (all `visible = true`). Default 7-day
   * expiry (Story 5.2 will add the duration picker).
   *
   * TODO Story 5.2: trigger conversation-starter pre-generation here
   * (architecture.md lines 413–420).
   */
  createShareToken: premiumProcedure
    .input(createShareTokenInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      // Verify invite belongs to this patient (404, not 403 — AC2 of
      // Story 4.1 precedent: no enumeration oracle for cross-patient
      // resource probes).
      const inviteRows = await ctx.db
        .select({ id: PendingInvites.id })
        .from(PendingInvites)
        .where(
          and(
            eq(PendingInvites.id, input.inviteId),
            eq(PendingInvites.patientId, patientId),
          ),
        )
        .limit(1);
      if (inviteRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { tokenHash, tokenHmac } = generateShareToken();
      const expiresAt = new Date(
        Date.now() + SHARE_DEFAULT_DURATION_DAYS * 24 * 60 * 60 * 1000,
      );

      const categories = await getDistinctCategoriesForPatient(
        ctx.db,
        patientId,
      );

      const [tokenRow] = await ctx.db
        .insert(ShareTokens)
        .values({
          tokenHash,
          tokenHmac,
          patientId,
          inviteId: input.inviteId,
          expiresAt,
        })
        .returning({ id: ShareTokens.id });
      if (!tokenRow) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "createShareToken: insert returned no row",
        });
      }

      const biomarkerScope = categories.map((category) => ({
        category,
        visible: true,
      }));

      if (categories.length > 0) {
        await ctx.db.insert(ShareTokenBiomarkers).values(
          categories.map((category) => ({
            shareTokenId: tokenRow.id,
            biomarkerCategory: category,
            visible: true,
          })),
        );
      }

      await writeAuditLog(ctx.db, {
        actorId: patientId,
        actorType: "patient",
        event: SHARING_AUDIT_TOKEN_CREATED,
        resourceId: tokenRow.id,
        resourceType: "share_token",
        metadata: {
          inviteId: input.inviteId,
          defaultExpiresAt: expiresAt.toISOString(),
          biomarkerCount: categories.length,
        },
      });

      return { shareTokenId: tokenRow.id, biomarkerScope };
    }),

  /**
   * AC2 / AC4 / AC9 / AC10 — UPSERT batch + single audit row carrying
   * the full new-scope diff. Narrow catch for `23505` only (defensive
   * against partial-unique-index race; ON CONFLICT should preclude
   * this in practice).
   */
  configureBiomarkers: premiumProcedure
    .input(configureBiomarkersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      // 404 on cross-patient or revoked share token (no enumeration
      // oracle).
      const tokenRows = await ctx.db
        .select({
          id: ShareTokens.id,
          inviteId: ShareTokens.inviteId,
        })
        .from(ShareTokens)
        .where(
          and(
            eq(ShareTokens.id, input.shareTokenId),
            eq(ShareTokens.patientId, patientId),
            isNull(ShareTokens.revokedAt),
          ),
        )
        .limit(1);
      if (tokenRows.length === 0 || !tokenRows[0]) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const tokenRow = tokenRows[0];

      // Pull the invite for the audit metadata (AC9 — doctorIdentifierHash).
      const inviteRows = await ctx.db
        .select({ identifierHash: PendingInvites.identifierHash })
        .from(PendingInvites)
        .where(eq(PendingInvites.id, tokenRow.inviteId))
        .limit(1);
      const identifierHash = inviteRows[0]?.identifierHash ?? null;

      const rows = input.scope.map((entry) => ({
        shareTokenId: tokenRow.id,
        biomarkerCategory: entry.biomarkerCategory,
        visible: entry.visible,
      }));

      try {
        await ctx.db
          .insert(ShareTokenBiomarkers)
          .values(rows)
          .onConflictDoUpdate({
            target: [
              ShareTokenBiomarkers.shareTokenId,
              ShareTokenBiomarkers.biomarkerCategory,
            ],
            set: {
              visible: sql`excluded.visible`,
              updatedAt: sql`now()`,
            },
          });
      } catch (err) {
        // AC10 — narrow to `23505` (extremely unlikely given the
        // ON CONFLICT clause; defensive). Programmer errors and
        // every other shape rethrow per CLAUDE.md §"Narrow catches".
        if (isUniqueViolation(err)) {
          console.warn(
            "[configureBiomarkers] 23505 despite ON CONFLICT — continuing",
          );
        } else {
          throw err;
        }
      }

      await writeAuditLog(ctx.db, {
        actorId: patientId,
        actorType: "patient",
        event: SHARING_AUDIT_CONFIGURED,
        resourceId: tokenRow.id,
        resourceType: "share_token",
        metadata: {
          inviteId: tokenRow.inviteId,
          doctorIdentifierHash: identifierHash,
          biomarkerCategories: input.scope.map((entry) => ({
            category: entry.biomarkerCategory,
            visible: entry.visible,
          })),
          configuredAt: new Date().toISOString(),
        },
      });

      return { ok: true as const };
    }),

  /**
   * Read-side for hydrating the per-biomarker screen on re-entry.
   * 404 on cross-patient or revoked share token (mirrors Story 4.1
   * AC6 — no enumeration oracle).
   */
  getDraftConfig: premiumProcedure
    .input(getDraftConfigInputSchema)
    .query(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      const rows = await ctx.db
        .select({
          tokenId: ShareTokens.id,
          expiresAt: ShareTokens.expiresAt,
          inviteId: ShareTokens.inviteId,
          displayName: PendingInvites.displayName,
        })
        .from(ShareTokens)
        .innerJoin(PendingInvites, eq(PendingInvites.id, ShareTokens.inviteId))
        .where(
          and(
            eq(ShareTokens.id, input.shareTokenId),
            eq(ShareTokens.patientId, patientId),
            isNull(ShareTokens.revokedAt),
          ),
        )
        .limit(1);
      if (rows.length === 0 || !rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const row = rows[0];

      const scopeRows = await ctx.db
        .select({
          biomarkerCategory: ShareTokenBiomarkers.biomarkerCategory,
          visible: ShareTokenBiomarkers.visible,
        })
        .from(ShareTokenBiomarkers)
        .where(eq(ShareTokenBiomarkers.shareTokenId, row.tokenId));

      return {
        shareToken: { id: row.tokenId, expiresAt: row.expiresAt },
        doctor: { displayName: row.displayName },
        biomarkerScope: scopeRows.map((s) => ({
          category: s.biomarkerCategory,
          visible: s.visible,
        })),
      };
    }),

  /** Compartilhar-tab listing (Story 5.4 extends with revoke action). */
  listShares: premiumProcedure.query(async ({ ctx }) => {
    const patientId = ctx.session.user.id;

    const rows = await ctx.db
      .select({
        id: ShareTokens.id,
        displayName: PendingInvites.displayName,
        expiresAt: ShareTokens.expiresAt,
        revokedAt: ShareTokens.revokedAt,
        createdAt: ShareTokens.createdAt,
        biomarkerCount: sql<number>`(
          SELECT count(*)::int FROM ${ShareTokenBiomarkers}
          WHERE ${ShareTokenBiomarkers.shareTokenId} = ${ShareTokens.id}
            AND ${ShareTokenBiomarkers.visible} = true
        )`,
      })
      .from(ShareTokens)
      .innerJoin(PendingInvites, eq(PendingInvites.id, ShareTokens.inviteId))
      .where(eq(ShareTokens.patientId, patientId))
      .orderBy(desc(ShareTokens.createdAt));

    return { shares: rows };
  }),
} satisfies TRPCRouterRecord;

/**
 * Postgres unique-constraint violation. Drizzle surfaces these via
 * `postgres` driver errors with `code = "23505"`. Narrow predicate so
 * the rest of the error space rethrows.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "23505"
  );
}
