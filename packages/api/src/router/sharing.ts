import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { ShareDuration } from "@healthtracker/validators";
import { and, desc, eq, gt, isNull, or, sql } from "@healthtracker/db";
import {
  ConversationStarterCache,
  PendingInvites,
  ShareTokenBiomarkers,
  ShareTokens,
} from "@healthtracker/db/schema";
import {
  configureBiomarkersInputSchema,
  createPendingInviteInputSchema,
  createShareTokenInputSchema,
  getDraftConfigInputSchema,
  SHARING_AUDIT_CONFIGURED,
  SHARING_AUDIT_CONVERSATION_STARTER_QUEUED,
  SHARING_AUDIT_PENDING_INVITE_CREATED,
  SHARING_AUDIT_TOKEN_CREATED,
} from "@healthtracker/validators";

import { writeAuditLog } from "../audit";
import { premiumProcedure } from "../middleware/entitlements";
import {
  buildShareUrl,
  generateShareToken,
  getDistinctCategoriesForPatient,
  hashIdentifier,
} from "../sharing";
import { protectedProcedure } from "../trpc";

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
      // Review 2026-05-26 Patch #6 — lowercase email-shaped identifiers
      // BEFORE hashing so AC7 idempotency survives mixed-case input.
      // CRMs (no `@`) keep their original case (uppercase convention).
      const normalizedIdentifier = input.identifier.includes("@")
        ? input.identifier.toLowerCase()
        : input.identifier;
      const identifierHash = hashIdentifier(normalizedIdentifier);

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
        // Review 2026-05-26 Patch #12 — standardize on
        // `doctorIdentifierHash` everywhere (Story 5.3 access-log
        // consumes one shape).
        metadata: { doctorIdentifierHash: identifierHash },
      });

      return { inviteId };
    }),

  /**
   * AC8 — creates the share_tokens row + pre-populates
   * share_token_biomarkers with one row per known biomarker
   * category for the patient (all `visible = true`). Default 7-day
   * expiry (Story 5.2 will add the duration picker).
   *
   * Review 2026-05-26 Patch #1 + #4: the token INSERT + biomarker
   * pre-pop + audit MUST live in a single tx (AC8 + T3.1). And
   * before the INSERT we short-circuit on an existing active token
   * for the same (patient_id, invite_id) — defends against the
   * Fast-Concluir re-mount race that would otherwise emit two
   * tokens per invite.
   *
   * TODO Story 5.2: trigger conversation-starter pre-generation here
   * (architecture.md lines 413–420).
   */
  createShareToken: premiumProcedure
    .input(createShareTokenInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        // Verify invite belongs to this patient (404, not 403 — AC2 of
        // Story 4.1 precedent: no enumeration oracle for cross-patient
        // resource probes).
        const inviteRows = await tx
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

        // Patch #4 — idempotency on `(patient_id, invite_id)`. If an
        // active (non-revoked, non-expired) token already exists for
        // this invite, short-circuit. Do NOT re-emit the audit row,
        // re-INSERT biomarker scope, or re-enqueue the conversation-
        // starter job (AC11 — duration is locked at first creation;
        // revoke-and-start-over is the path to change it, Story 5.4).
        //
        // Story 5.2 update: `expires_at` is now nullable; the active-
        // ness predicate becomes `(expires_at IS NULL OR > now())`.
        const existingToken = await tx
          .select({ id: ShareTokens.id })
          .from(ShareTokens)
          .where(
            and(
              eq(ShareTokens.patientId, patientId),
              eq(ShareTokens.inviteId, input.inviteId),
              isNull(ShareTokens.revokedAt),
              or(
                isNull(ShareTokens.expiresAt),
                gt(ShareTokens.expiresAt, new Date()),
              ),
            ),
          )
          .limit(1);
        if (existingToken.length > 0 && existingToken[0]) {
          const scope = await tx
            .select({
              category: ShareTokenBiomarkers.biomarkerCategory,
              visible: ShareTokenBiomarkers.visible,
            })
            .from(ShareTokenBiomarkers)
            .where(eq(ShareTokenBiomarkers.shareTokenId, existingToken[0].id));
          return {
            shareTokenId: existingToken[0].id,
            biomarkerScope: scope.map((s) => ({
              category: s.category,
              visible: s.visible,
            })),
          };
        }

        const { tokenHash, tokenHmac } = generateShareToken();
        // Story 5.2 AC3 — map the picker's duration enum to an
        // `expires_at` timestamp (or NULL for "Sem prazo"). No
        // server-side default; the picker screen owns the
        // default-selection of `"7d"` so a missing field surfaces
        // as a Zod validation error rather than being silently
        // coerced.
        const expiresAt = computeExpiresAt(input.duration);

        const categories = await getDistinctCategoriesForPatient(tx, patientId);

        // Story 5.2 review-fix Patch #3 — wrap INSERT in narrow 23505
        // catch. The partial unique index
        // `share_tokens_patient_invite_active_uq` defends against
        // concurrent calls that both passed the SELECT short-circuit.
        // On collision: re-SELECT the row the racing tx committed and
        // return its id+scope without re-enqueuing the cache job.
        let tokenRow: { id: string } | undefined;
        try {
          const inserted = await tx
            .insert(ShareTokens)
            .values({
              tokenHash,
              tokenHmac,
              patientId,
              inviteId: input.inviteId,
              expiresAt,
              duration: input.duration,
            })
            .returning({ id: ShareTokens.id });
          tokenRow = inserted[0];
        } catch (err) {
          if (isUniqueViolation(err)) {
            const raced = await tx
              .select({ id: ShareTokens.id })
              .from(ShareTokens)
              .where(
                and(
                  eq(ShareTokens.patientId, patientId),
                  eq(ShareTokens.inviteId, input.inviteId),
                  isNull(ShareTokens.revokedAt),
                ),
              )
              .limit(1);
            if (raced[0]) {
              const scope = await tx
                .select({
                  category: ShareTokenBiomarkers.biomarkerCategory,
                  visible: ShareTokenBiomarkers.visible,
                })
                .from(ShareTokenBiomarkers)
                .where(eq(ShareTokenBiomarkers.shareTokenId, raced[0].id));
              return {
                shareTokenId: raced[0].id,
                biomarkerScope: scope.map((s) => ({
                  category: s.category,
                  visible: s.visible,
                })),
              };
            }
          }
          throw err;
        }
        if (!tokenRow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "createShareToken: insert returned no row",
          });
        }

        const biomarkerScope = categories.map((entry) => ({
          category: entry.category,
          visible: true,
        }));

        if (categories.length > 0) {
          await tx.insert(ShareTokenBiomarkers).values(
            categories.map((entry) => ({
              shareTokenId: tokenRow.id,
              biomarkerCategory: entry.category,
              visible: true,
            })),
          );
        }

        await writeAuditLog(tx, {
          actorId: patientId,
          actorType: "patient",
          event: SHARING_AUDIT_TOKEN_CREATED,
          resourceId: tokenRow.id,
          resourceType: "share_token",
          metadata: {
            inviteId: input.inviteId,
            // Story 5.2 AC9 — include the chosen duration in audit
            // metadata; Story 5.3 Access Log renders e.g. "por 7 dias".
            duration: input.duration,
            // `null` when `no_expiry` — preserves the audit history
            // distinction between "we set a 7d window" and "no expiry".
            defaultExpiresAt: expiresAt ? expiresAt.toISOString() : null,
            biomarkerCount: categories.length,
          },
        });

        // Story 5.2 AC3 + AC5 — Conversation Starter pre-gen.
        // Insert one cache row in `queued` status inheriting the
        // share-token's expiry, then enqueue the pg-boss job inside
        // the same tx via the outbox pattern (direct INSERT into
        // `pgboss.job` — pg-boss `send()` opens its own connection
        // and is NOT tx-aware against the Drizzle `tx` handle; the
        // same precedent is in `services/extraction/src/notifications/emit.ts`
        // and `services/llm/src/consumers/generate-letter.ts`). On a
        // crash between this INSERT and the tx commit, the whole tx
        // rolls back — no orphan cache row, no orphan job.
        await tx.insert(ConversationStarterCache).values({
          shareTokenId: tokenRow.id,
          patientId,
          status: "queued",
        });

        const conversationStarterJob = {
          jobId: crypto.randomUUID(),
          patientId,
          correlationId: tokenRow.id,
          payload: { shareTokenId: tokenRow.id },
          createdAt: new Date().toISOString(),
        };
        // Story 5.2 review-fix Patch #11 — append a generation counter
        // to the singleton_key. pg-boss treats `singleton_key` as a
        // dedupe-for-lifetime constraint, which blocks future
        // re-enqueues even after the original job completes/archives.
        // The recovery path (Story 5.x — invalidate-and-regen on a
        // fresh draw) bumps `retry_generation`. We start at v0.
        const retryGeneration = 0;
        const singletonKey = `conversation_starter.${tokenRow.id}.v${retryGeneration}`;
        await tx.execute(sql`
          INSERT INTO pgboss.job
            (name, data, retry_limit, retry_delay, retry_backoff, singleton_key)
          VALUES (
            'conversation_starter.generate',
            ${JSON.stringify(conversationStarterJob)}::jsonb,
            3, 30, true,
            ${singletonKey}
          )
          ON CONFLICT DO NOTHING
        `);

        await writeAuditLog(tx, {
          actorId: patientId,
          actorType: "patient",
          event: SHARING_AUDIT_CONVERSATION_STARTER_QUEUED,
          resourceId: tokenRow.id,
          resourceType: "share_token",
          metadata: { shareTokenId: tokenRow.id },
        });

        return { shareTokenId: tokenRow.id, biomarkerScope };
      });
    }),

  /**
   * AC2 / AC4 / AC9 / AC10 — UPSERT batch + single audit row carrying
   * the full new-scope diff. Narrow catch for `23505` only (defensive
   * against partial-unique-index race; ON CONFLICT should preclude
   * this in practice).
   *
   * Review 2026-05-26 Patch #2 + #5 + #7: the share-token validity
   * check, the UPSERT, and the audit row all live in one tx. The
   * share_tokens row is SELECT ... FOR UPDATE-locked inside the tx
   * to close the TOCTOU window against concurrent revoke. Unknown
   * biomarker categories (not in the seeded set for this token) are
   * rejected with BAD_REQUEST / UNKNOWN_BIOMARKER_CATEGORY.
   */
  configureBiomarkers: premiumProcedure
    .input(configureBiomarkersInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        // 404 on cross-patient or revoked share token (no enumeration
        // oracle). `FOR UPDATE` locks the row for the rest of the tx
        // so a concurrent revoke can't land between this check and
        // the UPSERT (TOCTOU close).
        const tokenRows = await tx.execute<{
          id: string;
          invite_id: string;
        }>(sql`
          SELECT id, invite_id
          FROM ${ShareTokens}
          WHERE ${ShareTokens.id} = ${input.shareTokenId}
            AND ${ShareTokens.patientId} = ${patientId}
            AND ${ShareTokens.revokedAt} IS NULL
            AND (${ShareTokens.expiresAt} IS NULL OR ${ShareTokens.expiresAt} > now())
          FOR UPDATE
        `);
        const tokenRow = tokenRows[0];
        if (!tokenRow) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Patch #7 — validate every incoming category was in the
        // seeded set for this share token. Buggy / malicious clients
        // can't poison the table with arbitrary strings.
        const seededRows = await tx
          .select({
            biomarkerCategory: ShareTokenBiomarkers.biomarkerCategory,
          })
          .from(ShareTokenBiomarkers)
          .where(eq(ShareTokenBiomarkers.shareTokenId, tokenRow.id));
        const seededSet = new Set(seededRows.map((r) => r.biomarkerCategory));
        for (const entry of input.scope) {
          if (!seededSet.has(entry.biomarkerCategory)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "UNKNOWN_BIOMARKER_CATEGORY",
            });
          }
        }

        // Pull the invite for the audit metadata (AC9 — doctorIdentifierHash).
        const inviteRows = await tx
          .select({ identifierHash: PendingInvites.identifierHash })
          .from(PendingInvites)
          .where(eq(PendingInvites.id, tokenRow.invite_id))
          .limit(1);
        const identifierHash = inviteRows[0]?.identifierHash ?? null;

        const rows = input.scope.map((entry) => ({
          shareTokenId: tokenRow.id,
          biomarkerCategory: entry.biomarkerCategory,
          visible: entry.visible,
        }));

        try {
          await tx
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

        await writeAuditLog(tx, {
          actorId: patientId,
          actorType: "patient",
          event: SHARING_AUDIT_CONFIGURED,
          resourceId: tokenRow.id,
          resourceType: "share_token",
          metadata: {
            inviteId: tokenRow.invite_id,
            doctorIdentifierHash: identifierHash,
            biomarkerCategories: input.scope.map((entry) => ({
              category: entry.biomarkerCategory,
              visible: entry.visible,
            })),
            configuredAt: new Date().toISOString(),
          },
        });

        return { ok: true as const };
      });
    }),

  /**
   * Read-side for hydrating the per-biomarker screen on re-entry.
   * 404 on cross-patient or revoked share token (mirrors Story 4.1
   * AC6 — no enumeration oracle).
   */
  // Story 5.2 review-fix Patch #10 — both read-paths on the resumo
  // screen (`getDraftConfig` + `getShareUrl`) use `protectedProcedure`.
  // The premium gate already fired at create-time; re-gating on
  // retrieval would cause a confusing split where one query 412s
  // while the other 200s if the patient's tier briefly downgrades.
  getDraftConfig: protectedProcedure
    .input(getDraftConfigInputSchema)
    .query(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      const rows = await ctx.db
        .select({
          tokenId: ShareTokens.id,
          expiresAt: ShareTokens.expiresAt,
          duration: ShareTokens.duration,
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

      // Patch #11 — surface a separate human-readable `label` per
      // scope row so the UI can render "Hemoglobina" instead of
      // "718-7". The category key remains the stable LOINC-preferred
      // id used as the UPSERT join key.
      const labelRows = await getDistinctCategoriesForPatient(
        ctx.db,
        patientId,
      );
      const labelByCategory = new Map(
        labelRows.map((r) => [r.category, r.label]),
      );

      return {
        shareToken: {
          id: row.tokenId,
          expiresAt: row.expiresAt,
          // Story 5.2 review-fix Decision A — duration is the
          // persisted enum the patient picked. Resumo screen reads
          // this directly (no lossy bucket math from `expires_at`).
          duration: row.duration,
        },
        doctor: { displayName: row.displayName },
        biomarkerScope: scopeRows.map((s) => ({
          category: s.biomarkerCategory,
          label:
            labelByCategory.get(s.biomarkerCategory) ?? s.biomarkerCategory,
          visible: s.visible,
        })),
      };
    }),

  /**
   * Story 5.2 AC7 / T7.1 — composes the deliverable share URL the
   * resumo screen passes to the native share-sheet. `protectedProcedure`
   * is sufficient (the patient already cleared the premium gate when
   * `createShareToken` succeeded; re-gating on retrieval would just
   * surface confusing PRECONDITION_FAILED errors if the patient's
   * tier briefly downgrades between create and send). Verifies
   * ownership and 404s on mismatch — no enumeration oracle (Story
   * 5.1 R1 discipline).
   *
   * Returns the URL only; this resolver does NOT emit a new audit
   * row (share-URL retrieval is an internal patient action; only the
   * doctor's eventual access fires audit — Epic 6).
   */
  getShareUrl: protectedProcedure
    .input(z.object({ shareTokenId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      // Story 5.2 review-fix Patch #2 — filter on expiry. A patient
      // who comes back to the resumo screen after the window closed
      // MUST NOT pull a usable HMAC URL. The doctor-side magic-link
      // route enforces this too (Epic 6), but the patient-facing
      // retrieval should 404 first.
      const rows = await ctx.db
        .select({
          id: ShareTokens.id,
          tokenHmac: ShareTokens.tokenHmac,
        })
        .from(ShareTokens)
        .where(
          and(
            eq(ShareTokens.id, input.shareTokenId),
            eq(ShareTokens.patientId, patientId),
            isNull(ShareTokens.revokedAt),
            or(
              isNull(ShareTokens.expiresAt),
              gt(ShareTokens.expiresAt, sql`now()`),
            ),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return { url: buildShareUrl(row.id, row.tokenHmac) };
    }),

  /** Compartilhar-tab listing (Story 5.4 extends with revoke action). */
  listShares: premiumProcedure.query(async ({ ctx }) => {
    const patientId = ctx.session.user.id;

    // Review 2026-05-26 decision B — count ALL biomarker rows in the
    // share (not visible-only). UI copy "X biomarcadores" describes
    // the share's total scope; the visible/hidden split lives per-row
    // on the detail screen.
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

/**
 * Story 5.2 — duration enum → `expires_at` timestamp (or NULL for
 * "Sem prazo"). Pure; no Date.now() injection because the resolver
 * runs inside the same Node task as the INSERT and we don't want to
 * leak a test-only seam into the resolver signature. The unit test
 * uses `vi.useFakeTimers()` to lock now().
 */
export function computeExpiresAt(duration: ShareDuration): Date | null {
  switch (duration) {
    case "24h":
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    case "no_expiry":
      return null;
  }
}
