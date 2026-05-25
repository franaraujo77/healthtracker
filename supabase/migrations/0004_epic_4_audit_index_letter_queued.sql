-- =============================================================================
-- 0004_epic_4_audit_index_letter_queued.sql
-- =============================================================================
--
-- Widens the WHERE clause of the partial unique index
-- `audit_log_notification_event_unique` to include `'letter.queued'` —
-- closing the TOCTOU race between the two Epic 4 enqueue sites (the
-- patient-confirm path in `packages/api/src/uploads-review.ts` and the
-- worker-direct path in `services/extraction/src/consumers/document.ts`).
--
-- ## Why this file does NOT use CONCURRENTLY
--
-- This migration runs inside Supabase CLI's implicit transaction (the
-- runner wraps every file in a tx; there is no public directive to
-- disable that, contrary to community lore). `CREATE/DROP INDEX
-- CONCURRENTLY` cannot run inside a transaction (SQLSTATE 25001).
--
-- The CLAUDE.md ops note (Epic 2 retro / Story 2.7 R2-P213) warns that
-- non-CONCURRENTLY `DROP INDEX` + `CREATE UNIQUE INDEX` opens a brief
-- ShareLock window during which a concurrent INSERT can violate the
-- NEW constraint, leaving the index in an invalid state. That risk is
-- specific to changes that **narrow or shift** the WHERE clause.
--
-- This migration is a **strict superset widening**:
--   * Old WHERE: event IN ('notification.upload_complete',
--                          'notification.upload_pending_review',
--                          'notification.upload_failed')
--   * New WHERE: same 3 events + 'letter.queued'
--
-- For any row that lands during the ShareLock window:
--   1. If event is one of the 3 existing values — the row was already
--      validated against the old constraint; the wider new constraint
--      has the SAME dedup behaviour on this subset. No violation.
--   2. If event is 'letter.queued' — no application code in production
--      writes this event yet. Letter enqueue is entirely on PR #54 and
--      cannot run until this migration applies, the services/llm
--      service is deployed to Railway, the Anthropic DPA is signed,
--      and ANTHROPIC_API_KEY is set. None of those can race the swap.
--
-- Net: the widening is safe non-CONCURRENTLY in this specific file.
--
-- **DO NOT** copy this file as a template for a future WHERE-clause
-- change that NARROWS or SHIFTS the index. Those must use
-- `CREATE/DROP INDEX CONCURRENTLY` applied via `psql` directly,
-- bypassing Supabase CLI's transaction wrapper.
--
-- ## Operator sanity check (recommended pre-apply)
--
-- Before applying this migration, the operator should confirm no
-- `letter.queued` rows exist in production:
--
--   SELECT count(*) FROM audit_log WHERE event = 'letter.queued';
--
-- Expected: 0. If non-zero, those rows would still be accepted by
-- the new constraint (the widening guarantee above) — but the
-- non-zero count would indicate that someone applied this PR via
-- `pnpm db:push` directly, which means the migration is already
-- partially in effect.
--
-- ## Step ordering
--
-- Three steps, load-bearing:
--   1. CREATE the new index under a *_v2 name (so the original and
--      the new index coexist briefly — concurrent INSERTs are
--      validated against BOTH; the widening guarantee above keeps
--      this safe).
--   2. DROP the original by its current name.
--   3. RENAME _v2 → audit_log_notification_event_unique to preserve
--      the symbol that `services/extraction/src/notifications/
--      emit.ts` and `letters-emit.ts` read via
--      `ON CONFLICT ON CONSTRAINT audit_log_notification_event_unique`.
--
-- Lineage: Story 2.5 R2-P172 introduced the original 3-event index;
-- Story 4.1 widened the Drizzle source-of-truth WHERE clause; this
-- migration propagates the change to production. The companion
-- `letters` table ships in `0003_epic_4_letters_schema.sql`.

-- Step 1 — create the new (wider) partial unique index alongside the
-- original. During the brief window before Step 2 runs, both indexes
-- coexist; concurrent INSERTs are validated against both. Strict-
-- superset widening makes this safe.
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_notification_event_unique_v2
    ON public.audit_log USING btree (resource_id, event)
    WHERE (event = ANY (ARRAY[
        'notification.upload_complete'::text,
        'notification.upload_pending_review'::text,
        'notification.upload_failed'::text,
        'letter.queued'::text
    ]));

-- Step 2 — drop the original (narrower) partial unique index.
DROP INDEX IF EXISTS public.audit_log_notification_event_unique;

-- Step 3 — rename the new index to the canonical name so
-- `ON CONFLICT ON CONSTRAINT audit_log_notification_event_unique` in
-- `services/extraction/src/notifications/emit.ts` and `letters-emit.ts`
-- keeps resolving.
ALTER INDEX public.audit_log_notification_event_unique_v2
    RENAME TO audit_log_notification_event_unique;
