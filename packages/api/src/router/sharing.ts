import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type {
  AccessLogEventKind,
  AccessLogItemRow,
  ServerAccessLogTokenStatus,
  ShareDuration,
} from "@healthtracker/validators";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "@healthtracker/db";
// Story 6.4 R1-M1 — bare service-role-bound `db` connection used by
// `createPatientInvite` to probe `auth.users` from outside the
// doctor's GUC-bound tx. Hoisted to a static top-level import (the
// previous `await import(...)` inside the resolver hot path paid a
// module-resolution cost on every call and hid the dependency from
// static analysis). Alias to `serviceRoleDb` so it's NEVER confused
// with `ctx.db` (the per-request tx-scoped Drizzle handle).
import { db as serviceRoleDb } from "@healthtracker/db/client";
import {
  ConversationStarterCache,
  Exports,
  PatientInvites,
  PendingInvites,
  Professionals,
  ShareTokenBiomarkers,
  ShareTokens,
} from "@healthtracker/db/schema";
import {
  ACCESS_LOG_EVENT_KINDS,
  activateProfessionalAccountInputSchema,
  activateProfessionalAccountOutputSchema,
  configureBiomarkersInputSchema,
  CONVERSATION_STARTER_FAILED_PT_BR,
  CONVERSATION_STARTER_PATIENT_FIRSTNAME_FALLBACK_PT_BR,
  conversationStarterPayloadSchema,
  createPatientInviteInputSchema,
  createPatientInviteOutputSchema,
  createPendingInviteInputSchema,
  createShareTokenInputSchema,
  EXPORT_DOWNLOAD_TTL_SECONDS,
  exportFilename,
  getActivationStatusInputSchema,
  getActivationStatusOutputSchema,
  getConversationStarterInputSchema,
  getConversationStarterOutputSchema,
  getDraftConfigInputSchema,
  getExportInputSchema,
  getExportOutputSchema,
  getPreAuthContextInputSchema,
  getPreAuthContextOutputSchema,
  INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR,
  isAccessLogEventKind,
  listAccessLogInputSchema,
  normalizePatientIdentifier,
  PATIENT_INVITE_SENT_AUDIT,
  PatientIdentifierInvalidError,
  PROFESSIONAL_ACCOUNT_ACTIVATED_AUDIT,
  requestExportInputSchema,
  requestExportOutputSchema,
  revokeShareTokenInputSchema,
  revokeShareTokenOutputSchema,
  SHARE_TOKEN_READ_PHASE_POST_AUTH,
  SHARE_TOKEN_READ_PHASE_PRE_AUTH,
  SHARE_TOKEN_UNKNOWN_SENTINEL,
  SHARING_AUDIT_CONFIGURED,
  SHARING_AUDIT_CONVERSATION_STARTER_QUEUED,
  SHARING_AUDIT_EXPORT_QUEUED,
  SHARING_AUDIT_PENDING_INVITE_CREATED,
  SHARING_AUDIT_TOKEN_CREATED,
  SHARING_AUDIT_TOKEN_REVOKED,
} from "@healthtracker/validators";

import type { AuditDb } from "../audit";
import { writeAuditLog } from "../audit";
import { isPremium, premiumProcedure } from "../middleware/entitlements";
import {
  buildPatientInviteUrl,
  buildShareUrl,
  computeAccessLogTokenStatus,
  constantTimeEqualHmac,
  decodeAccessLogCursor,
  encodeAccessLogCursor,
  generatePatientInviteToken,
  generateShareToken,
  getDistinctCategoriesForPatient,
  hashIdentifier,
  resolvePatientFirstName,
} from "../sharing";
import {
  createExportDownloadSignedUrl,
  getSupabaseAdminClient,
} from "../storage";
import { doctorProcedure, protectedProcedure, publicProcedure } from "../trpc";

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
   * Story 5.4 — `revokeShareToken` (AC4, AC10, AC11).
   *
   * Patient flips `share_tokens.revoked_at` and writes a
   * `share_token.revoked` audit row in the same tx. The 5-second
   * client-side undo window is a DEFERRED-SERVER-WRITE timer on the
   * Acessos screen — when the patient confirms in the dialog, the
   * screen starts a 5s `setTimeout` that fires this mutation. If the
   * patient taps "Desfazer" within the window, the timeout is
   * cancelled and this resolver is never called. Cancelled revokes
   * never hit the DB; no audit noise; no `unrevoke` mutation needed.
   *
   * `protectedProcedure` (not `premiumProcedure`) — a patient whose
   * subscription downgrades mid-window must still be able to revoke
   * their existing shares (LGPD: revoke is a control plane, not a
   * Premium feature). 404 (not 403) on cross-patient OR
   * already-revoked lookup (Story 5.1 R1 discipline). The
   * `revoked_at IS NULL` guard + `FOR UPDATE` row-lock together
   * close the TOCTOU window against concurrent re-revoke (the lock
   * serializes the two callers; the second sees the row already
   * `revoked_at`-set and 404s on the next iteration).
   */
  revokeShareToken: protectedProcedure
    .input(revokeShareTokenInputSchema)
    .output(revokeShareTokenOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        // SELECT FOR UPDATE — lock the row for the rest of the tx so
        // a concurrent revoke can't see "still active" and race the
        // UPDATE. The `revoked_at IS NULL` guard short-circuits
        // re-revocation: a second caller pre-empted by the first
        // will return 0 rows here and 404.
        const tokenRows = await tx.execute<{ id: string }>(sql`
          SELECT id
          FROM ${ShareTokens}
          WHERE ${ShareTokens.id} = ${input.shareTokenId}
            AND ${ShareTokens.patientId} = ${patientId}
            AND ${ShareTokens.revokedAt} IS NULL
          FOR UPDATE
        `);
        if (!tokenRows[0]) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Patch #2 + #6 (Story 5.4 review-fix) — UPDATE carries the
        // `revoked_at IS NULL` defense-in-depth predicate AND uses the
        // Postgres clock (`now()`) returned via `RETURNING`. The DB
        // column, audit metadata, and mutation output all come from
        // the same Postgres clock — no JS/DB drift. The `IS NULL`
        // guard means a future refactor that drops the SELECT FOR
        // UPDATE can't silently overwrite an already-revoked column.
        let revokedAt: Date;
        try {
          const updatedRows = await tx.execute<{ revoked_at: Date }>(sql`
            UPDATE ${ShareTokens}
            SET revoked_at = now()
            WHERE ${ShareTokens.id} = ${input.shareTokenId}
              AND ${ShareTokens.revokedAt} IS NULL
            RETURNING revoked_at
          `);
          const updated = updatedRows[0];
          if (!updated) {
            // 0 rows means the row was revoked between the SELECT FOR
            // UPDATE and the UPDATE (effectively impossible under the
            // row lock, but defense-in-depth aligned with the SELECT).
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          revokedAt = updated.revoked_at;
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          // Narrow catch — only the defensive 23505 path is folded.
          if (isUniqueViolation(err)) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "revokeShareToken: unexpected 23505 on UPDATE",
            });
          }
          throw err;
        }

        await writeAuditLog(tx, {
          actorId: patientId,
          actorType: "patient",
          event: SHARING_AUDIT_TOKEN_REVOKED,
          resourceId: input.shareTokenId,
          resourceType: "share_token",
          metadata: { revokedAt: revokedAt.toISOString() },
        });

        return {
          shareTokenId: input.shareTokenId,
          revokedAt: revokedAt.toISOString(),
        };
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

  /**
   * Story 5.5 AC6 — `requestExport`. Enqueues a record-export job.
   *
   * **NOT** wrapped in `premiumProcedure`. LGPD Art. 18 data-portability
   * is a non-negotiable right; gating it on subscription tier would
   * violate the law. This is the only sharing-related mutation that's
   * free-for-all. Documented in spec AC6 + CLAUDE.md anti-patterns.
   *
   * Tx wraps INSERT + outbox + audit per the Story 5.2 outbox pattern
   * (raw `INSERT INTO pgboss.job` so the enqueue and the row INSERT
   * commit atomically — `boss.send()` opens its own connection and is
   * not tx-aware against the Drizzle `tx` handle).
   *
   * Singleton key: `record.export.${exportId}` — unique per row so a
   * single export's job is dedup'd; we never re-enqueue the same id.
   *
   * Story 5.5 review-fix Decision A — partial unique index
   * `exports_active_uq` on `(patient_id) WHERE status IN
   * ('queued','generating')` enforces single-in-flight per patient at
   * the DB layer. The INSERT is wrapped in a narrow `23505` catch:
   * on collision we SELECT the active row and return its `exportId`
   * (skipping the outbox enqueue + audit since the original create
   * already did them). Mirrors `createShareToken` (Story 5.1 R1).
   */
  requestExport: protectedProcedure
    .input(requestExportInputSchema)
    .output(requestExportOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        let exportId: string;
        try {
          const inserted = await tx
            .insert(Exports)
            .values({
              patientId,
              format: input.format,
              status: "queued",
            })
            .returning({ id: Exports.id });
          const row = inserted[0];
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "requestExport: insert returned no row",
            });
          }
          exportId = row.id;
        } catch (err) {
          if (isUniqueViolation(err)) {
            // Concurrent double-tap raced past the in-memory guard —
            // the partial unique index pinned the first INSERT; this
            // one collides. Re-SELECT the racing active row and
            // return its id. Do NOT re-enqueue the job or re-write
            // the audit row (the winning tx already did both).
            const raced = await tx
              .select({ id: Exports.id })
              .from(Exports)
              .where(
                and(
                  eq(Exports.patientId, patientId),
                  inArray(Exports.status, ["queued", "generating"]),
                ),
              )
              .limit(1);
            if (raced[0]) {
              return { exportId: raced[0].id };
            }
          }
          throw err;
        }

        // Outbox: enqueue inside the same tx (Story 5.2 precedent).
        const jobPayload = {
          jobId: crypto.randomUUID(),
          patientId,
          correlationId: exportId,
          payload: { exportId },
          createdAt: new Date().toISOString(),
        };
        const singletonKey = `record.export.${exportId}`;
        await tx.execute(sql`
          INSERT INTO pgboss.job
            (name, data, retry_limit, retry_delay, retry_backoff, singleton_key)
          VALUES (
            'record.export.generate',
            ${JSON.stringify(jobPayload)}::jsonb,
            3, 30, true,
            ${singletonKey}
          )
          ON CONFLICT DO NOTHING
        `);

        await writeAuditLog(tx, {
          actorId: patientId,
          actorType: "patient",
          event: SHARING_AUDIT_EXPORT_QUEUED,
          resourceId: exportId,
          resourceType: "export",
          metadata: { format: input.format },
        });

        return { exportId };
      });
    }),

  /**
   * Story 5.5 AC7 — `getExport`. Polling endpoint. 404 on cross-patient
   * lookup (no enumeration oracle; Story 5.1 R1 discipline). When
   * `status === "ready"` AND not past `expires_at`, mints a fresh
   * Supabase Storage signed URL (1h TTL).
   *
   * NOT cached — every tap re-runs (CLAUDE.md anti-pattern).
   */
  getExport: protectedProcedure
    .input(getExportInputSchema)
    .output(getExportOutputSchema)
    .query(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      const rows = await ctx.db
        .select({
          status: Exports.status,
          format: Exports.format,
          objectPath: Exports.objectPath,
          requestedAt: Exports.requestedAt,
          completedAt: Exports.completedAt,
          expiresAt: Exports.expiresAt,
        })
        .from(Exports)
        .where(
          and(eq(Exports.id, input.exportId), eq(Exports.patientId, patientId)),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const now = new Date();
      // Story 5.5 review-fix Patch #1 — surface a separate `expired`
      // flag so the UI can render a stuck-link CTA instead of a
      // silent-no-op "Baixar" button.
      const expired = row.status === "ready" && row.expiresAt <= now;
      let downloadUrl: string | null = null;
      if (row.status === "ready" && row.objectPath !== null && !expired) {
        // Story 5.5 review-fix Patch #5 — pass `download: filename` so
        // the cross-origin Supabase Storage response carries
        // `Content-Disposition: attachment; filename=...`. The web
        // `<a download>` attribute is advisory for cross-origin URLs;
        // server-side header is authoritative.
        const filename = exportFilename(
          row.format,
          row.completedAt ?? row.expiresAt,
        );
        downloadUrl = await createExportDownloadSignedUrl(
          row.objectPath,
          EXPORT_DOWNLOAD_TTL_SECONDS,
          filename,
        );
      }

      return {
        status: row.status,
        format: row.format,
        requestedAt: row.requestedAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        expiresAt: row.expiresAt.toISOString(),
        downloadUrl,
        expired,
      };
    }),

  /**
   * Story 5.3 — paginated Access Log feed (AC1, AC4, AC5, AC11, AC12).
   *
   * `protectedProcedure` (NOT `premiumProcedure`) — AC5: free-tier
   * patients get a graceful empty-list + `upgradeRequired: true`
   * instead of a thrown `PRECONDITION_FAILED`. Story 4.1's
   * `premiumProcedure` middleware is the alternative shape; the
   * inline check is chosen here because the UX wants the upgrade
   * prompt to render inside the list view.
   *
   * Read-only. Deliberately does NOT emit an `access_log.viewed`
   * audit row (every Acessos tap would self-reference and create
   * runaway noise — CLAUDE.md philosophy).
   *
   * Row scoping is RLS-authoritative (the extended
   * `audit_log_select_own` policy added in this story shows the
   * patient both their own actor rows AND rows whose `resource_id`
   * points at one of their `share_tokens`). The resolver does NOT
   * re-filter on `actor_id` so a doctor-actor row scoped to the
   * patient's share is visible.
   *
   * Cursor: `{iso-ts}|{audit_log.id uuid}` — tuple compare against
   * `(created_at, id)` so pagination is stable even when multiple
   * audit rows land in the same millisecond (e.g. `createShareToken`
   * writes 3 audit rows in a single tx).
   */
  listAccessLog: protectedProcedure
    .input(listAccessLogInputSchema)
    .query(async ({ ctx, input }) => {
      // AC5 — premium gate (inline, non-throwing).
      if (!isPremium(ctx.session.user)) {
        return {
          items: [] as AccessLogItemRow[],
          nextCursor: null as string | null,
          upgradeRequired: true,
        };
      }

      const decoded = decodeAccessLogCursor(input.cursor);
      const allowlist = ACCESS_LOG_EVENT_KINDS as readonly string[];
      const limit = input.pageSize + 1; // +1 to detect has-more.

      // Tuple compare `(created_at, id) < (cursor_ts, cursor_id)`
      // when a cursor is present; otherwise return newest first.
      // The join goes audit_log -> share_tokens -> pending_invites
      // so `pending_invite.created` rows (no share_token yet) still
      // appear, just with `display_name = null` and the resolver
      // does a second lookup against `pending_invites` by
      // `resource_id` for those.
      const cursorCondition = decoded
        ? sql`(al.created_at, al.id) < (${decoded.createdAt.toISOString()}::timestamptz, ${decoded.id}::uuid)`
        : sql`TRUE`;

      const rawRows = await ctx.db.execute<{
        id: string;
        event: string;
        actor_id: string;
        actor_type: string;
        resource_id: string;
        resource_type: string;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        st_id: string | null;
        st_expires_at: Date | null;
        st_revoked_at: Date | null;
        st_display_name: string | null;
        pi_display_name: string | null;
      }>(sql`
        SELECT
          al.id              AS id,
          al.event           AS event,
          al.actor_id        AS actor_id,
          al.actor_type      AS actor_type,
          al.resource_id     AS resource_id,
          al.resource_type   AS resource_type,
          al.metadata        AS metadata,
          al.created_at      AS created_at,
          st.id              AS st_id,
          st.expires_at      AS st_expires_at,
          st.revoked_at      AS st_revoked_at,
          stpi.display_name  AS st_display_name,
          pi.display_name    AS pi_display_name
        FROM audit_log al
        LEFT JOIN share_tokens st
          ON al.resource_type = 'share_token'
         AND al.resource_id = st.id
        LEFT JOIN pending_invites stpi
          ON st.invite_id = stpi.id
        LEFT JOIN pending_invites pi
          ON al.resource_type = 'pending_invite'
         AND al.resource_id = pi.id
        WHERE al.event = ANY(${allowlist}::text[])
          AND ${cursorCondition}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ${limit}
      `);

      const now = new Date();
      const trimmed = rawRows.slice(0, input.pageSize);
      const hasMore = rawRows.length > input.pageSize;

      const items: AccessLogItemRow[] = trimmed.map((r) => {
        // AC11 — narrow `event` text to the discriminated union via
        // the allowlist guard. Rows that slip past the SQL filter
        // (shouldn't happen) fall back to the first kind so the type
        // narrowing holds; the guard short-circuits before then.
        const event: AccessLogEventKind = isAccessLogEventKind(r.event)
          ? r.event
          : "share_token.created";
        // Patch #3 (2026-05-26) — derive `hasJoinedToken` from the
        // joined `share_tokens.id` directly. Previously this fell
        // back to a `resource_type === 'share_token'` heuristic that
        // synthesized "sem prazo" for hard-deleted tokens.
        const hasJoinedToken = r.st_id !== null;
        const tokenStatus: ServerAccessLogTokenStatus | null = hasJoinedToken
          ? computeAccessLogTokenStatus(r.st_expires_at, r.st_revoked_at, now)
          : null;
        // `display_name` resolution: share-token-scoped rows pull
        // from the joined pending_invite; pending_invite.created rows
        // pull from their own resource row. Patch #5 — trim and fall
        // back when the stored value is empty / whitespace.
        const joined = r.st_display_name ?? r.pi_display_name ?? null;
        const trimmedDn = joined?.trim() ?? "";
        const displayName: string | null =
          trimmedDn.length > 0 ? trimmedDn : null;
        return {
          id: r.id,
          event,
          createdAt: r.created_at,
          displayName,
          shareTokenId:
            r.resource_type === "share_token" ? r.resource_id : null,
          tokenStatus,
          metadata: r.metadata ?? {},
        } satisfies AccessLogItemRow;
      });

      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last ? encodeAccessLogCursor(last.createdAt, last.id) : null;

      return { items, nextCursor, upgradeRequired: false };
    }),
  /**
   * Story 6.1 AC2 — pre-auth landing context resolver.
   *
   * **Intentionally `publicProcedure`** (NOT `doctorProcedure`). The
   * doctor has not yet authenticated at this point — there is no
   * `x-share-token` header — and we need to distinguish the three
   * dead-link states (expired / revoked / invalid) from the active
   * state. The doctor-side RLS predicate on `share_tokens` filters
   * `revoked_at IS NULL AND (expires_at IS NULL OR > now())`, so
   * running this resolver under `doctorProcedure` would collapse
   * every non-active state into `invalid` and erase the patient's
   * surveillance surface. The `share_token.read` audit row writes
   * MUST still fire for `revoked` / `expired` / `invalid` attempts
   * — that's the entire point of the Access Log here.
   *
   * Do NOT "fix" this back to `doctorProcedure` (RLS test file
   * `share_tokens_preauth.rls.test.ts` guards against this regression).
   *
   * Information disclosure: only the `active` branch returns the
   * patient-facing context (first name + timestamps). Expired /
   * revoked / invalid render generic copy with no patient hints.
   *
   * No transaction is opened — `publicProcedure` provides a bare
   * connection (no GUC). The SELECT + audit-INSERT are autonomous;
   * a narrow try/catch around the audit insert keeps a single
   * failed insert from 500-ing the landing page (the patient's
   * Access Log degrades by one row, the doctor's first impression
   * does not).
   */
  getPreAuthContext: publicProcedure
    .input(getPreAuthContextInputSchema)
    .output(getPreAuthContextOutputSchema)
    .query(async ({ ctx, input }) => {
      const truncatedUa =
        input.userAgent && input.userAgent.length > 0
          ? input.userAgent.slice(0, 200)
          : null;

      // No-RLS lookup — service-role connection, no GUC set. See
      // docblock above for why we deliberately bypass doctorProcedure.
      const rows = await ctx.db
        .select({
          id: ShareTokens.id,
          tokenHmac: ShareTokens.tokenHmac,
          patientId: ShareTokens.patientId,
          expiresAt: ShareTokens.expiresAt,
          revokedAt: ShareTokens.revokedAt,
          createdAt: ShareTokens.createdAt,
        })
        .from(ShareTokens)
        .where(eq(ShareTokens.id, input.shareTokenId))
        .limit(1);

      const row = rows[0];

      // Unknown shareTokenId. Same `invalid` discriminator as a bad
      // HMAC or a malformed segment — no enumeration oracle.
      // R1-M3 fix: use sentinel for BOTH actor and resource ids. The
      // URL-supplied uuid is Zod-shaped but unverified — could be any
      // random uuid. The sentinel collects every "no real row matched"
      // probe under one filterable bucket. Trade-off: the row is
      // service-role-visible only (no patient owns it). See the
      // `writePreAuthAudit` / `auditMalformedTokenProbe` docblocks
      // and CLAUDE.md "Pre-auth landing discipline" for the H1 trade-off.
      if (!row) {
        await writePreAuthAudit(ctx.db, {
          actorId: SHARE_TOKEN_UNKNOWN_SENTINEL,
          resourceId: SHARE_TOKEN_UNKNOWN_SENTINEL,
          status: "invalid",
          userAgent: truncatedUa,
        });
        return {
          status: "invalid" as const,
          patientFirstName: null,
          sharedAt: null,
          expiresAt: null,
        };
      }

      // Constant-time HMAC compare. Two persisted HMAC strings (URL
      // segment vs DB column) — use `constantTimeEqualHmac`, not
      // `verifyShareToken` (which is raw-vs-signature).
      const hmacOk = constantTimeEqualHmac(row.tokenHmac, input.tokenHmac);
      if (!hmacOk) {
        // R1-M3 fix: bad-HMAC against a REAL row IS attributable —
        // keep `resourceId = input.shareTokenId` so the owning patient
        // sees the probe in their Access Log (the RLS `audit_log_select_own`
        // policy joins through `share_tokens`). `actorId` uses the
        // sentinel because the doctor's identity is still unverified.
        await writePreAuthAudit(ctx.db, {
          actorId: SHARE_TOKEN_UNKNOWN_SENTINEL,
          resourceId: input.shareTokenId,
          status: "invalid",
          userAgent: truncatedUa,
        });
        return {
          status: "invalid" as const,
          patientFirstName: null,
          sharedAt: null,
          expiresAt: null,
        };
      }

      // Order matters: revoke is the more user-actionable state — a
      // token revoked yesterday and expired today should render as
      // `revoked` (Story 5.4 retro lesson).
      const now = new Date();
      let status: "active" | "expired" | "revoked";
      if (row.revokedAt !== null) {
        status = "revoked";
      } else if (
        row.expiresAt !== null &&
        row.expiresAt.getTime() <= now.getTime()
      ) {
        status = "expired";
      } else {
        status = "active";
      }

      let patientFirstName: string | null = null;
      if (status === "active") {
        // Defensive: `resolvePatientFirstName` is contracted not to
        // throw, but even if it did the audit row MUST still fire.
        // Narrow catch — programmer errors propagate.
        try {
          patientFirstName = await resolvePatientFirstName(
            getSupabaseAdminClient(),
            row.patientId,
          );
        } catch (err) {
          if (
            err instanceof TypeError ||
            err instanceof ReferenceError ||
            err instanceof SyntaxError
          ) {
            throw err;
          }
          patientFirstName = null;
        }
      }

      // active / expired / revoked: row is real, `shareTokenId` is
      // verified (HMAC matched). Owning patient sees this row via RLS.
      await writePreAuthAudit(ctx.db, {
        actorId: input.shareTokenId,
        resourceId: input.shareTokenId,
        status,
        userAgent: truncatedUa,
      });

      return {
        status,
        patientFirstName,
        sharedAt: status === "active" ? row.createdAt : null,
        expiresAt: status === "active" ? row.expiresAt : null,
      };
    }),

  /**
   * Story 6.2 AC4 / AC6 — `getConversationStarter`.
   *
   * **First production consumer of `doctorProcedure`.** The middleware
   * binds `app.current_share_token_id` from the `x-share-token` header
   * AND requires `ctx.session.user` (Story 6.2 T4 added the session
   * gate). Defense-in-depth: this resolver ALSO re-checks
   * `tokenHmac` via `constantTimeEqualHmac` — the GUC proves "client
   * claims share-token X", the HMAC proves "client holds the URL the
   * patient signed for X".
   *
   * The doctor-side RLS predicate on `share_tokens` filters non-active
   * rows automatically; a `NOT_FOUND` here is the union of {revoked,
   * expired, cross-token, unknown}. The calling RSC redirects the
   * doctor back to `/m/[token]` where Story 6.1's pre-auth resolver
   * (publicProcedure, no GUC) discriminates the dead-link state.
   *
   * **AC6 service-role bypass for the cache status lookup:** the
   * `conversation_starter_cache` RLS policy only surfaces `ready` rows
   * to the doctor principal. To render the `queued` / `failed` UI
   * states we need to read those rows too. We mint a service-role
   * client via `getSupabaseAdminClient()` (mirrors Story 5.5
   * `getExport`) AFTER the share-token check has already proven the
   * doctor is authorized. Operator-grade `failure_reason` strings
   * (`LLM_API_ERROR`, `LLM_NETWORK_ERROR`) are mapped to the SHORT
   * pt-BR `CONVERSATION_STARTER_FAILED_PT_BR` at this boundary — the
   * client NEVER sees the raw operator strings.
   *
   * **Audit (R1-H1 fix-up):** the resolver does NOT write the
   * `share_token.read post-auth` row anymore. The polling client
   * called this query every 2s while the cache was `queued`, which
   * spammed the patient's Access Log with up to 15 rows per cold-cache
   * view. Audit is now emitted by the sibling `markStarterViewed`
   * mutation, which the client fires ONCE on the rising edge of
   * `cacheStatus === "ready"`. Status-transition events (queued /
   * failed) are no longer audited per-tick; the patient's surveillance
   * surface still records the "doctor saw the report" event via the
   * one-shot mutation. The pre-auth `share_token.read` row from Story
   * 6.1 already records the doctor's first arrival on the link.
   */
  getConversationStarter: doctorProcedure
    .input(getConversationStarterInputSchema)
    .output(getConversationStarterOutputSchema)
    .query(async ({ ctx, input }) => {
      // AC4 — Defense-in-depth: middleware bound the GUC to the
      // header value; assert the resolver was called with the same
      // shareTokenId the client headers claimed.
      if (ctx.shareTokenId !== input.shareTokenId) {
        // Header / input mismatch — surface as NOT_FOUND (same shape
        // as RLS-hidden); never leak which one diverged.
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // RLS-scoped lookup (doctor principal). On the doctor side the
      // predicate filters revoked / expired rows out automatically, so
      // a 0-row result is the union of {revoked, expired, cross-token,
      // unknown}. We do NOT discriminate here — the calling RSC
      // redirects to `/m/[token]` for the publicProcedure-shaped
      // dead-link discriminator.
      const tokenRows = await ctx.db
        .select({
          id: ShareTokens.id,
          tokenHmac: ShareTokens.tokenHmac,
          patientId: ShareTokens.patientId,
          expiresAt: ShareTokens.expiresAt,
          createdAt: ShareTokens.createdAt,
        })
        .from(ShareTokens)
        .where(eq(ShareTokens.id, input.shareTokenId))
        .limit(1);
      const tokenRow = tokenRows[0];
      if (!tokenRow) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // AC4 — constant-time HMAC re-check above the middleware.
      const hmacOk = constantTimeEqualHmac(tokenRow.tokenHmac, input.tokenHmac);
      if (!hmacOk) {
        // Same NOT_FOUND shape as missing row — no enumeration oracle.
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // AC6 — service-role cache lookup. Resolver fired AFTER the
      // doctor-RLS share-token check, so authorization is already
      // proven. The service-role bypass lets us surface the
      // `queued` / `failed` UI branches whose rows the doctor-RLS
      // predicate would hide. Map operator-grade failure_reason
      // strings to a SHORT pt-BR client string at this boundary.
      const admin = getSupabaseAdminClient();
      const { data: cacheRows, error: cacheErr } = await admin
        .from("conversation_starter_cache")
        .select("status, payload, failure_reason")
        .eq("share_token_id", input.shareTokenId)
        .limit(1);
      if (cacheErr) {
        // Treat infra failure on the status read as a transient
        // `queued` so the client polls instead of dead-ending. This
        // is a UI-degrade, not a security-degrade.
        console.warn(
          "[sharing.getConversationStarter] cache lookup failed — degrading to queued",
          cacheErr,
        );
      }

      let cacheStatus: "queued" | "ready" | "failed" = "queued";
      let payload: ReturnType<
        typeof conversationStarterPayloadSchema.parse
      > | null = null;
      let failureReason: string | null = null;
      const cacheRow = cacheRows?.[0] as
        | {
            status: string;
            payload: unknown;
            failure_reason: string | null;
          }
        | undefined;
      if (cacheRow) {
        if (cacheRow.status === "ready") {
          // Zod-validate the JSONB payload — a worker bug that wrote a
          // bad shape into the row degrades to `queued` (so the doctor
          // sees the polling state) rather than throwing 500. Narrow
          // catch: programmer errors still propagate.
          try {
            payload = conversationStarterPayloadSchema.parse(cacheRow.payload);
            cacheStatus = "ready";
          } catch (err) {
            if (
              err instanceof TypeError ||
              err instanceof ReferenceError ||
              err instanceof SyntaxError
            ) {
              throw err;
            }
            console.warn(
              "[sharing.getConversationStarter] cache payload failed Zod — degrading to queued",
              err,
            );
            cacheStatus = "queued";
          }
        } else if (cacheRow.status === "failed") {
          cacheStatus = "failed";
          // Map operator-grade reason → SHORT pt-BR client string.
          // R1-M5: every `failed` row is collapsed to the same client
          // string regardless of the underlying `failure_reason`
          // (`LLM_API_ERROR` / `LLM_NETWORK_ERROR` /
          // `STUB_ADAPTER_IN_PRODUCTION` written by the consumer's
          // DPA-gate branch as `LLM_API_ERROR`). Operator distinction
          // intentionally lives ONLY in the `audit_log` row the
          // consumer emits (`conversation_starter.failed` with
          // `metadata.reason`), so the doctor surface never sees an
          // operator-shaped string. Forensics: `SELECT metadata
          // FROM audit_log WHERE event = 'conversation_starter.failed'
          // AND resource_id = $shareTokenId`.
          failureReason = CONVERSATION_STARTER_FAILED_PT_BR;
        } else {
          cacheStatus = "queued";
        }
      }

      // Resolve patient first-name via Supabase Auth admin. Never
      // throws (Story 6.1 N1 contract); fall back to `"Paciente"` on
      // the doctor surface (NOT `"Alguém"` — past the trust gate).
      let patientFirstName: string =
        CONVERSATION_STARTER_PATIENT_FIRSTNAME_FALLBACK_PT_BR;
      try {
        const resolved = await resolvePatientFirstName(
          admin,
          tokenRow.patientId,
        );
        if (resolved && resolved.length > 0) {
          patientFirstName = resolved;
        }
      } catch (err) {
        // Narrow: programmer errors propagate, network/admin failures
        // degrade to the fallback string.
        if (
          err instanceof TypeError ||
          err instanceof ReferenceError ||
          err instanceof SyntaxError
        ) {
          throw err;
        }
      }

      // R1-H1: audit was emitted here per-tick (every 2s while polling
      // `queued`). It now lives in the sibling `markStarterViewed`
      // mutation, fired once on the client's rising-edge ready
      // transition. This resolver is read-only.

      return {
        cacheStatus,
        payload,
        patientFirstName,
        sharedAt: tokenRow.createdAt,
        expiresAt: tokenRow.expiresAt,
        failureReason,
      };
    }),

  /**
   * Story 6.2 R1-H1 fix-up — one-shot audit emission on first `ready`.
   *
   * The polling `getConversationStarter` resolver no longer writes
   * audit. The client invokes this mutation exactly once per session
   * on the rising edge of `cacheStatus === "ready"`. The mutation is
   * bound by the same `doctorProcedure` two-gate (header + session) +
   * defense-in-depth `constantTimeEqualHmac` re-check as the query.
   *
   * Idempotency: the client-side rising-edge guard prevents duplicate
   * fires within one session; a re-mount (e.g. hard reload) will
   * legitimately emit a fresh row — by design, the patient's Access
   * Log wants to surface re-visits.
   */
  markStarterViewed: doctorProcedure
    .input(getConversationStarterInputSchema)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.shareTokenId !== input.shareTokenId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const tokenRows = await ctx.db
        .select({
          id: ShareTokens.id,
          tokenHmac: ShareTokens.tokenHmac,
        })
        .from(ShareTokens)
        .where(eq(ShareTokens.id, input.shareTokenId))
        .limit(1);
      const tokenRow = tokenRows[0];
      if (!tokenRow) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const hmacOk = constantTimeEqualHmac(tokenRow.tokenHmac, input.tokenHmac);
      if (!hmacOk) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const rawUserAgent = ctx.headers.get("user-agent") ?? "";
      const truncatedUa =
        rawUserAgent.length > 0 ? rawUserAgent.slice(0, 200) : null;
      try {
        await writeAuditLog(ctx.db, {
          actorId: ctx.session.user.id,
          actorType: "doctor",
          event: "share_token.read",
          resourceId: input.shareTokenId,
          resourceType: "share_token",
          metadata: {
            phase: SHARE_TOKEN_READ_PHASE_POST_AUTH,
            ...(truncatedUa !== null ? { userAgent: truncatedUa } : {}),
          },
        });
      } catch (err) {
        // Audit-write failure must not 500 the doctor's report; the
        // patient's surveillance surface degrades by one row. Narrow:
        // programmer errors propagate.
        if (
          err instanceof TypeError ||
          err instanceof ReferenceError ||
          err instanceof SyntaxError
        ) {
          throw err;
        }
        console.warn(
          "[sharing.markStarterViewed] audit write failed — continuing",
          err,
        );
      }
      return { ok: true as const };
    }),
  /**
   * Story 6.3 AC4 — `getActivationStatus`. Render-time existence check
   * for the doctor's `professionals` row.
   *
   * **No audit row** — this is a render-time existence check, not an
   * access event. Mirrors the Story 6.2 R1-H1 "one audit row per view,
   * never per render" invariant: the RSC may call this every report
   * load (and side-by-side with `getConversationStarter` via
   * `Promise.all` to keep NFR-P4 <3s intact), so emitting per-tap would
   * mean N rows per cold-cache polling window.
   *
   * **`auth.uid()`-scoped, NOT share-token-scoped** — a doctor activated
   * via patient A's token IS activated when viewing patient B's
   * report (Doctor Acquisition Loop closure). The RLS predicate
   * `current_setting('app.current_doctor_user_id', true) = user_id::text`
   * enforces this; the resolver does NOT re-filter.
   *
   * Never throws for the "no row" case — returns `activated:false`
   * with null fields. A throw would reject the RSC's `Promise.all`
   * and 500 the report.
   */
  getActivationStatus: doctorProcedure
    .input(getActivationStatusInputSchema)
    .output(getActivationStatusOutputSchema)
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          displayName: Professionals.displayName,
          category: Professionals.category,
        })
        .from(Professionals)
        .where(eq(Professionals.userId, ctx.session.user.id))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return {
          activated: false as const,
          displayName: null,
          category: null,
        };
      }
      return {
        activated: true as const,
        displayName: row.displayName,
        category: row.category,
      };
    }),

  /**
   * Story 6.3 AC3 / AC5 — `activateProfessionalAccount`. The
   * long-deferred `pending_invites.resolved_user_id` flip (Story 5.1
   * hand-off) lands here, alongside the `professionals` row insert.
   *
   * Critical ordering (atomic tx):
   *   1. SELECT share_tokens (RLS-bound to doctor principal) →
   *      NOT_FOUND on any failure (revoked / expired / cross-token /
   *      unknown — same shape; no enumeration oracle).
   *   2. `constantTimeEqualHmac` re-check — defense-in-depth above
   *      the GUC (mirrors `getConversationStarter`).
   *   3. SET LOCAL ROLE postgres → SELECT FOR UPDATE pending_invites →
   *      SET LOCAL ROLE NONE. The escalation is REQUIRED because the
   *      doctor principal has no SELECT policy on `pending_invites`
   *      (that surface is patient-side). The pair-bookend keeps the
   *      escalation scoped to the lock acquisition; RLS is restored
   *      before the INSERT below.
   *   4. Branch on `resolved_user_id`:
   *        - NULL → UPDATE (the canonical flip).
   *        - = doctor's uid → no-op (idempotent re-tap).
   *        - != doctor's uid → CONFLICT (cross-doctor invite race).
   *   5. INSERT professionals ON CONFLICT (user_id) DO NOTHING.
   *      `alreadyActivated` is true when RETURNING is empty (row
   *      pre-existed); the post-INSERT SELECT fetches the existing
   *      row's displayName + category.
   *   6. Conditional audit — emit ONE `professional_account.activated`
   *      row only when this call actually inserted (alreadyActivated
   *      = false). Mirrors Story 6.2 R1-H1 "one row per activation,
   *      ever" invariant.
   *
   * **Audit kind NOT in `ACCESS_LOG_EVENT_KINDS`** — doctor-side
   * identity binding, not patient-data access. The patient does NOT
   * see "Dr. X activated their account" in their Access Log.
   *
   * **Narrow catches:** the 23505 race on the `professionals.user_id`
   * PK folds into success via `ON CONFLICT DO NOTHING`; no explicit
   * catch needed for the INSERT. `CONFLICT` (cross-doctor) and
   * `NOT_FOUND` (token issues) are thrown explicitly; nothing else is
   * swallowed.
   */
  activateProfessionalAccount: doctorProcedure
    .input(activateProfessionalAccountInputSchema)
    .output(activateProfessionalAccountOutputSchema)
    .mutation(async ({ ctx, input }) => {
      if (ctx.shareTokenId !== input.shareTokenId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const doctorUserId = ctx.session.user.id;

      // RLS-bound SELECT — doctor principal sees only their bound
      // active share_token. Revoked / expired / cross-token / unknown
      // all collapse to NOT_FOUND (no enumeration oracle).
      const tokenRows = await ctx.db
        .select({
          id: ShareTokens.id,
          tokenHmac: ShareTokens.tokenHmac,
          patientId: ShareTokens.patientId,
          inviteId: ShareTokens.inviteId,
        })
        .from(ShareTokens)
        .where(eq(ShareTokens.id, input.shareTokenId))
        .limit(1);
      const tokenRow = tokenRows[0];
      if (!tokenRow) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (!constantTimeEqualHmac(tokenRow.tokenHmac, input.tokenHmac)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Atomic tx — role escalation, FOR UPDATE lock, branch decision,
      // INSERT, audit all commit-or-rollback together.
      return ctx.db.transaction(async (tx) => {
        // Step 3 + 4 — escalate ROLE briefly for BOTH the SELECT FOR
        // UPDATE lock acquisition AND the canonical UPDATE on
        // `pending_invites` (the doctor principal has no patient-side
        // RLS over this table). One escalated section bookended by a
        // single `finally { SET LOCAL ROLE NONE }` keeps the contract
        // minimal and audit-friendly: nothing else inside the block
        // touches the DB; the branch decision is pure JS on the
        // already-fetched row.
        //
        // R1-M2 clarification: `SET LOCAL ROLE NONE` is a
        // CODE-HYGIENE guardrail, NOT a security boundary. Postgres
        // auto-reverts the role at tx commit/rollback regardless
        // (`SET LOCAL` is tx-scoped); the explicit reset defends
        // against accidental later reads under the elevated role
        // that a future patch might add inside the same tx. The real
        // security boundary is the tx itself.
        //
        // R1-M1 consolidation: previously TWO separate escalation
        // blocks bracketed the SELECT and the UPDATE independently;
        // the structure was correct (row-lock holds across blocks)
        // but noisy and inviting future regressions. Reviewers MUST
        // keep this section MINIMAL — only `pending_invites`
        // operations, never grow it to cover the INSERT or audit
        // below.
        await tx.execute(sql`SET LOCAL ROLE postgres`);
        let inviteRow: { id: string; resolved_user_id: string | null };
        try {
          const inviteRows = await tx.execute<{
            id: string;
            resolved_user_id: string | null;
          }>(sql`
            SELECT id, resolved_user_id
            FROM ${PendingInvites}
            WHERE ${PendingInvites.id} = ${tokenRow.inviteId}
            FOR UPDATE
          `);
          const found = inviteRows[0];
          if (!found) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          inviteRow = found;

          // Step 4 — branch on resolved_user_id (pure-JS decision on
          // the already-fetched row; no DB touch until the UPDATE).
          if (inviteRow.resolved_user_id === null) {
            // Canonical flip. The `resolved_user_id IS NULL` predicate
            // is belt-and-braces — the FOR UPDATE lock above already
            // serializes, but a future maintainer reading the UPDATE
            // in isolation should see the guard explicitly.
            await tx.execute(sql`
              UPDATE ${PendingInvites}
              SET resolved_user_id = ${doctorUserId}::uuid
              WHERE ${PendingInvites.id} = ${tokenRow.inviteId}
                AND resolved_user_id IS NULL
            `);
          }
          // else: same-uid re-tap OR different-uid CONFLICT — the
          // CONFLICT throw happens AFTER de-escalation below so the
          // error surface runs under the normal RLS-bound role.
        } finally {
          // De-escalate before ANY subsequent statement runs — the
          // INSERT + audit writes below MUST run under the RLS-bound
          // role. `finally` guarantees the reset even if the SELECT
          // or UPDATE throws.
          await tx.execute(sql`SET LOCAL ROLE NONE`);
        }

        if (
          inviteRow.resolved_user_id !== null &&
          inviteRow.resolved_user_id !== doctorUserId
        ) {
          // Cross-doctor race — patient invited Dr. A by email, Dr. A
          // forwarded the link to a colleague Dr. B who also clicked.
          // First-to-activate wins; the loser sees the pt-BR conflict
          // copy. No professionals row written; no audit emitted.
          throw new TRPCError({
            code: "CONFLICT",
            message: INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR,
          });
        }
        // else: resolved_user_id === doctorUserId → idempotent re-tap,
        // no-op flip; fall through to the INSERT.

        // Step 5 — INSERT professionals (PK = user_id ⇒ at most one
        // row per Supabase user). RLS WITH CHECK on
        // `professionals_insert_own` enforces `user_id =
        // current_setting('app.current_doctor_user_id')`. Race on
        // double-tap collapses via ON CONFLICT.
        const inserted = await tx
          .insert(Professionals)
          .values({
            userId: doctorUserId,
            displayName: input.displayName,
            category: input.category,
          })
          .onConflictDoNothing({ target: Professionals.userId })
          .returning({
            userId: Professionals.userId,
            displayName: Professionals.displayName,
            category: Professionals.category,
          });

        let displayName: string;
        let category: typeof input.category;
        let alreadyActivated: boolean;
        if (inserted.length > 0 && inserted[0]) {
          displayName = inserted[0].displayName;
          category = inserted[0].category;
          alreadyActivated = false;
        } else {
          // Row pre-existed (ON CONFLICT DO NOTHING returned nothing).
          // Idempotent re-tap — SELECT the existing row to surface the
          // canonical displayName + category back to the modal.
          const existing = await tx
            .select({
              displayName: Professionals.displayName,
              category: Professionals.category,
            })
            .from(Professionals)
            .where(eq(Professionals.userId, doctorUserId))
            .limit(1);
          const row = existing[0];
          if (!row) {
            // Defense-in-depth: ON CONFLICT DO NOTHING returned empty
            // AND SELECT returned empty would mean the row was deleted
            // between the two statements (impossible under the tx
            // isolation level, but a 500 is safer than a silent lie).
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "activateProfessionalAccount: row vanished mid-tx",
            });
          }
          displayName = row.displayName;
          category = row.category;
          alreadyActivated = true;
        }

        // Step 6 — emit audit ONLY on the freshly-inserted branch.
        // Re-tap is silent (mirrors Story 6.2 R1-H1 audit-amplification
        // lesson — one row per activation, ever).
        if (!alreadyActivated) {
          await writeAuditLog(tx, {
            actorId: doctorUserId,
            actorType: "doctor",
            event: PROFESSIONAL_ACCOUNT_ACTIVATED_AUDIT,
            // Resource = the doctor themselves; activation is a
            // self-targeted identity-binding event. Forensic linkage
            // to the share-token / invite lives in `metadata`.
            resourceId: doctorUserId,
            resourceType: "professional",
            // R1-N3 forensic-intent note: `category` is duplicated
            // here from the `professionals` table on purpose. If a
            // future story lets the doctor change their category
            // (e.g. category-edit flow on `/inicio/configuracoes`),
            // the audit row MUST pin the activation-time category
            // — the audit_log is an append-only forensic ledger and
            // the value of "what they activated as" is exactly what
            // we want to preserve across later edits to the live
            // row. Resist the temptation to drop this field on the
            // grounds that it lives on the `professionals` table.
            metadata: {
              shareTokenId: input.shareTokenId,
              inviteId: tokenRow.inviteId,
              category: input.category,
            },
          });
        }

        return {
          activated: true as const,
          displayName,
          category,
          alreadyActivated,
        };
      });
    }),

  /**
   * Story 6.4 AC5 — `createPatientInvite`. Activated doctor invites a
   * patient (email or BR phone) to create a Health Tracker account.
   *
   * **Critical ordering (no audit on already-registered short-circuit):**
   *   1. Activation gate — SELECT professionals; missing → PRECONDITION_FAILED.
   *   2. Normalise identifier (email or BR phone). Throws → BAD_REQUEST.
   *   3. Hash the normalised value (PII hygiene — never store raw).
   *   4. AC11 — auth.users existence check via service-role admin
   *      client. Match → return `alreadyRegistered:true` with NO row
   *      written and NO audit emitted. Bounded enumeration oracle is
   *      accepted (doctors are authenticated, accountable, low-volume).
   *   5. Idempotent SELECT (active pending row for same doctor +
   *      identifier hash) — found → return its inviteId + URL.
   *   6. Generate raw token + HMAC (`signPatientInviteToken` applies
   *      the `"patient_invite:"` domain prefix per AC8).
   *   7. INSERT patient_invites + writeAuditLog in one tx.
   *   8. Narrow 23505 catch — partial-unique-index race folds into the
   *      idempotent return path (re-SELECT existing row).
   *
   * **`patient_invite.sent` is NOT in `ACCESS_LOG_EVENT_KINDS`** —
   * doctor-side acquisition surface; patient cannot access-log an
   * event from before they existed.
   *
   * **No new env vars** — SHARE_TOKEN_HMAC_SECRET + WEB_APP_URL reused
   * via the existing NFR-S6 boot-gates (`validateSharingEnv`).
   */
  createPatientInvite: doctorProcedure
    .input(createPatientInviteInputSchema)
    .output(createPatientInviteOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const doctorUserId = ctx.session.user.id;

      // Step 1 — activation gate. Defense-in-depth: the InvitePatientButton
      // only renders when `activationStatus.activated`, but a malicious
      // client bypassing the UI must be rejected here too.
      const activatedRows = await ctx.db
        .select({ userId: Professionals.userId })
        .from(Professionals)
        .where(eq(Professionals.userId, doctorUserId))
        .limit(1);
      if (activatedRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "DOCTOR_NOT_ACTIVATED",
        });
      }

      // Step 2 — normalize. The Zod schema accepted any non-empty
      // string; this is where we discriminate email vs phone.
      let kind: "email" | "phone";
      let normalized: string;
      try {
        ({ kind, normalized } = normalizePatientIdentifier(input.identifier));
      } catch (err) {
        if (err instanceof PatientIdentifierInvalidError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "PATIENT_IDENTIFIER_INVALID",
          });
        }
        throw err;
      }

      // Step 3 — hash. PII hygiene parity with Story 5.1.
      const identifierHash = hashIdentifier(normalized);

      // Step 4 — AC11 already-registered. The doctorProcedure tx runs
      // as the `authenticated` role and cannot SELECT auth.users; use
      // the bare service-role-bound `db` connection. Match → return
      // alreadyRegistered without writing any row or audit. The check
      // is auth.users-existence-only; no JOIN to sharing tables (no
      // cross-doctor existence leak). The bounded enumeration oracle
      // (doctors can probe whether ANY email is a HT user) is accepted
      // — doctors are authenticated, accountable, low-volume.
      let alreadyRegistered = false;
      try {
        // Use the bare `db` connection (`serviceRoleDb`, hoisted at
        // module scope — see import block) NOT `ctx.db` (that's the
        // tx-scoped Drizzle handle inside the doctorProcedure tx and
        // querying `auth.users` from inside the doctor's GUC-bound tx
        // is brittle if a future change drops privileges). The bare
        // connection rides on the service-role postgres user so the
        // SELECT on `auth.users` succeeds.
        //
        // Supabase stores `auth.users.phone` WITHOUT the leading `+`
        // (E.164-trimmed); strip it for the probe.
        const phoneProbe =
          kind === "phone" ? normalized.replace(/^\+/, "") : null;
        const probeRows = await serviceRoleDb.execute<{ one: number }>(sql`
          SELECT 1 AS one
          FROM auth.users
          WHERE ${kind === "email" ? sql`email = ${normalized}` : sql`phone = ${phoneProbe}`}
          LIMIT 1
        `);
        alreadyRegistered = probeRows.length > 0;
      } catch (err) {
        // Narrow catch — programmer errors propagate; infra failures
        // degrade to "treat as not-registered" so the doctor can still
        // attempt the invite (the partial-unique-index + 23505 narrow
        // catch downstream still prevents duplicate writes).
        if (
          err instanceof TypeError ||
          err instanceof ReferenceError ||
          err instanceof SyntaxError
        ) {
          throw err;
        }
        console.warn(
          "[createPatientInvite] auth.users existence probe failed — continuing",
          err,
        );
      }

      if (alreadyRegistered) {
        return {
          inviteId: null,
          inviteUrl: null,
          alreadyRegistered: true,
        };
      }

      // Step 5 + 7 + 8 — idempotent SELECT-then-INSERT + audit in one tx.
      return ctx.db.transaction(async (tx) => {
        // Story 6.4 — bind app.current_doctor_user_id is already set by
        // the doctorProcedure middleware on this tx; the
        // patient_invites_select_own policy filters to this doctor's rows.
        const existing = await tx
          .select({
            id: PatientInvites.id,
            tokenHmac: PatientInvites.tokenHmac,
          })
          .from(PatientInvites)
          .where(
            and(
              eq(PatientInvites.professionalUserId, doctorUserId),
              eq(PatientInvites.identifierHash, identifierHash),
              eq(PatientInvites.status, "pending"),
            ),
          )
          .limit(1);
        const existingRow = existing[0];
        if (existingRow) {
          return {
            inviteId: existingRow.id,
            inviteUrl: buildPatientInviteUrl(
              existingRow.id,
              existingRow.tokenHmac,
            ),
            alreadyRegistered: false,
          };
        }

        const { tokenHmac } = generatePatientInviteToken();
        let inviteId: string;
        try {
          const inserted = await tx
            .insert(PatientInvites)
            .values({
              professionalUserId: doctorUserId,
              identifierHash,
              identifierKind: kind,
              displayName: input.displayName,
              tokenHmac,
            })
            .returning({ id: PatientInvites.id });
          const row = inserted[0];
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "createPatientInvite: insert returned no row",
            });
          }
          inviteId = row.id;
        } catch (err) {
          if (isUniqueViolation(err)) {
            // The partial unique index pinned a concurrent INSERT for
            // the same (doctor, identifierHash). Re-SELECT and fold.
            const raced = await tx
              .select({
                id: PatientInvites.id,
                tokenHmac: PatientInvites.tokenHmac,
              })
              .from(PatientInvites)
              .where(
                and(
                  eq(PatientInvites.professionalUserId, doctorUserId),
                  eq(PatientInvites.identifierHash, identifierHash),
                  eq(PatientInvites.status, "pending"),
                ),
              )
              .limit(1);
            const racedRow = raced[0];
            if (racedRow) {
              return {
                inviteId: racedRow.id,
                inviteUrl: buildPatientInviteUrl(
                  racedRow.id,
                  racedRow.tokenHmac,
                ),
                alreadyRegistered: false,
              };
            }
          }
          throw err;
        }

        await writeAuditLog(tx, {
          actorId: doctorUserId,
          actorType: "doctor",
          event: PATIENT_INVITE_SENT_AUDIT,
          resourceId: inviteId,
          resourceType: "patient_invite",
          // Hash only — never log raw identifier (LGPD Art. 46).
          metadata: {
            identifierKind: kind,
            identifierHash,
          },
        });

        return {
          inviteId,
          inviteUrl: buildPatientInviteUrl(inviteId, tokenHmac),
          alreadyRegistered: false,
        };
      });
    }),
} satisfies TRPCRouterRecord;

/**
 * Story 6.1 — best-effort audit write for the pre-auth resolver.
 * The patient's surveillance surface is critical: every doctor
 * probe MUST be logged. But a single audit-row INSERT failure must
 * not 500 the doctor's first impression of the link. We log to
 * console and continue. The narrow catch leaves programmer errors
 * to propagate.
 *
 * **R1-H1 / R1-M3 visibility trade-off (`audit_log_select_own` RLS):**
 *   - `resourceId` = real `share_tokens.id` → owning patient sees
 *     the row via the policy's `EXISTS (SELECT 1 FROM share_tokens
 *     WHERE share_tokens.id = audit_log.resource_id AND patient_id
 *     = current_setting('app.current_patient_id'))` branch.
 *   - `resourceId` = `SHARE_TOKEN_UNKNOWN_SENTINEL` → NO patient
 *     owns the sentinel id, the EXISTS subquery returns FALSE, and
 *     the row is **service-role-only**. This is the honest answer
 *     for malformed-segment and unknown-id probes — the URL never
 *     pointed at any patient's share, so there is no patient to
 *     attribute the probe to. The row is still WRITTEN (forensic
 *     ledger preserved); it is just not surfaced to the Access Log.
 *
 * `actorType="doctor"` because the principal hitting `/m/[token]` is
 * always doctor-shaped — even when the URL is garbage.
 */
export async function writePreAuthAudit(
  db: AuditDb,
  args: {
    actorId: string;
    resourceId: string;
    status: "active" | "expired" | "revoked" | "invalid";
    userAgent: string | null;
  },
): Promise<void> {
  try {
    await writeAuditLog(db, {
      actorId: args.actorId,
      actorType: "doctor",
      event: "share_token.read",
      resourceId: args.resourceId,
      resourceType: "share_token",
      metadata: {
        phase: SHARE_TOKEN_READ_PHASE_PRE_AUTH,
        status: args.status,
        ...(args.userAgent !== null ? { userAgent: args.userAgent } : {}),
      },
    });
  } catch (err) {
    if (
      err instanceof TypeError ||
      err instanceof ReferenceError ||
      err instanceof SyntaxError
    ) {
      throw err;
    }
    console.warn(
      "[sharing.getPreAuthContext] audit write failed — continuing",
      err,
    );
  }
}

/**
 * Story 6.1 R1-M1 — narrow apps-facing wrapper. Lets
 * `apps/web/src/app/m/[token]/page.tsx` emit the malformed-segment
 * audit row without importing `@healthtracker/db/client` directly
 * (R1 reviewer concern: app-layer code grabbing a raw `db` handle
 * has previously caused RLS-on / RLS-off drift). This helper pulls
 * the bare connection internally and exposes only the narrow
 * malformed-segment contract.
 *
 * **Forensic-only ledger row** (see `writePreAuthAudit` docblock):
 * the sentinel `resourceId` is not in `share_tokens`, so the row is
 * NOT visible to any patient under `audit_log_select_own` RLS. The
 * row exists for operational forensics — service-role queries can
 * count + alert on `actorId = SHARE_TOKEN_UNKNOWN_SENTINEL`. This is
 * an intentional trade-off documented in CLAUDE.md "Pre-auth landing
 * discipline" and spec open-question #2.
 */
export async function auditMalformedTokenProbe(args: {
  userAgent: string | null;
}): Promise<void> {
  const { db } = await import("@healthtracker/db/client");
  await writePreAuthAudit(db, {
    actorId: SHARE_TOKEN_UNKNOWN_SENTINEL,
    resourceId: SHARE_TOKEN_UNKNOWN_SENTINEL,
    status: "invalid",
    userAgent: args.userAgent,
  });
}

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
