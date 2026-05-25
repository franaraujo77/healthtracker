-- supabase: no-transaction
-- =============================================================================
-- 0004_epic_4_audit_index_letter_queued.sql
-- =============================================================================
--
-- Swaps the WHERE clause of the partial unique index
-- `audit_log_notification_event_unique` to include `'letter.queued'` —
-- closing the TOCTOU race between the two Epic 4 enqueue sites (the
-- patient-confirm path in `packages/api/src/uploads-review.ts` and the
-- worker-direct path in `services/extraction/src/consumers/document.ts`).
--
-- Per CLAUDE.md "Ops note (Epic 2 retro / Story 2.7 R2-P213)", a
-- WHERE-clause change on a partial unique index is NOT safe via
-- `pnpm db:push` against a populated production database: the underlying
-- DDL is `DROP INDEX` + `CREATE UNIQUE INDEX` (non-CONCURRENTLY), which
-- takes a ShareLock and opens a window during which a concurrent INSERT
-- can violate the new constraint. The safe shape uses
-- `CREATE UNIQUE INDEX CONCURRENTLY` + `DROP INDEX CONCURRENTLY`, both
-- of which require running OUTSIDE a transaction.
--
-- The `-- supabase: no-transaction` directive at the top of this file
-- disables the implicit transaction Supabase normally wraps around
-- migration files. Each statement below runs as its own implicit tx.
-- A failed `CREATE INDEX CONCURRENTLY` leaves an INVALID index that the
-- operator must drop manually before retrying — accept this trade-off
-- (Supabase migrations are operator-supervised, not automated rollback).
--
-- Step order is load-bearing:
--   1. CREATE the new partial unique index under a *_v2 name. This
--      is a tail-additive operation — Postgres can have both indexes
--      coexisting during the transition; concurrent INSERTs are
--      validated against BOTH constraints.
--   2. DROP the original index by its current name.
--   3. RENAME the _v2 to the canonical name. The application reads the
--      constraint by name (`ON CONFLICT ON CONSTRAINT
--      audit_log_notification_event_unique`) in
--      `services/extraction/src/notifications/emit.ts`, so the symbol
--      MUST be preserved across the swap.
--
-- Lineage: Story 2.5 R2-P172 introduced the original 3-event index;
-- Story 4.1 widened the schema-side WHERE clause; this migration
-- propagates the change to production. The companion `letters` table
-- ships in `0003_epic_4_letters_schema.sql`.

-- Step 1 — create the new partial unique index alongside the original.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS audit_log_notification_event_unique_v2
    ON public.audit_log USING btree (resource_id, event)
    WHERE (event = ANY (ARRAY[
        'notification.upload_complete'::text,
        'notification.upload_pending_review'::text,
        'notification.upload_failed'::text,
        'letter.queued'::text
    ]));

-- Step 2 — drop the original (narrower) partial unique index.
DROP INDEX CONCURRENTLY IF EXISTS public.audit_log_notification_event_unique;

-- Step 3 — rename the new index to the canonical name so
-- `ON CONFLICT ON CONSTRAINT audit_log_notification_event_unique` in
-- `services/extraction/src/notifications/emit.ts` keeps resolving.
ALTER INDEX public.audit_log_notification_event_unique_v2
    RENAME TO audit_log_notification_event_unique;
