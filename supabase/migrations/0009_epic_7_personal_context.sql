--
-- Story 7.6 — Epic 7 consolidated migration: patient personal context.
--
-- Captures the net-new schema introduced by:
--   * Story 7.1 — `life_events` table + `life_event_category_enum`
--     + `life_event_privacy_flag_enum` (single-value `patient_only`)
--     + listing index on (patient_id, event_date)
--     + description-length CHECK constraint
--     + 2 patient RLS policies (SELECT/INSERT own)
--     verbatim mirror of packages/db/policies/custom_rls_life_events.sql.
--   * Story 7.2 — `emotional_checkins` table + 3 enums
--     (`emotional_checkin_state_enum`, `_type_enum`, `_privacy_enum`)
--     + UNIQUE (upload_id, type) idempotency shield
--     + listing index on (patient_id, created_at DESC)
--     + `ALTER TABLE uploads ADD COLUMN viewed_at TIMESTAMPTZ` for the
--     first-view gate (additive, nullable, no default — NULL is the
--     "never viewed" default per Story 7.2 AC12; no backfill).
--     + 2 patient RLS policies verbatim mirror of
--     packages/db/policies/custom_rls_emotional_checkins.sql.
--   * Story 7.3 — no schema changes (extends 7.2's enum with `type='post'`
--     which was already in the enum definition).
--   * Story 7.4 — `voice_memos` table + `voice_memo_privacy_enum`
--     + UNIQUE (upload_id) idempotency shield
--     + duration CHECK constraint (1..30000 ms)
--     + listing index on (patient_id, created_at DESC)
--     + 2 patient RLS policies verbatim mirror of
--     packages/db/policies/custom_rls_voice_memos.sql
--     + private Supabase Storage bucket `voice_memos` + 2 Storage RLS
--     policies scoped to `<patient_id>/...` paths via
--     `storage.foldername(name)[1]`.
--   * Story 7.5 — no schema changes (native date picker is UI-only).
--
-- Mirrors the Drizzle schema files byte-for-byte:
--   * packages/db/src/schema/life_events.ts
--   * packages/db/src/schema/emotional_checkins.ts
--   * packages/db/src/schema/voice_memos.ts
--   * packages/db/src/schema/uploads.ts (only the `viewed_at` column add)
--
-- **AC6 — Privacy enums NOT unified.** Stories 7.2 and 7.4 deliberately
-- shipped separate `_privacy_enum` types per their AC10 deviation
-- (keeping PR #59's reviewed surface untouched). This migration ships
-- all three separate enums as authored. Unification into
-- `personal_context_privacy_enum` is deferred to a future cleanup
-- story; performing the rename here would couple 7.6 to a Drizzle
-- source refactor that this batched-migration delivery should not own.
--
-- **CONCURRENTLY discipline.** Epic 7 ships zero partial unique indexes.
-- All UNIQUE/index DDL fits the standard `supabase db push` path; no
-- `supabase/migrations-postapply/` companion file is needed (the
-- SQLSTATE 25001 carve-out documented in CLAUDE.md fires only for
-- `CREATE INDEX CONCURRENTLY` inside Supabase's implicit per-migration
-- transaction).
--
-- **Audit kinds.** `life_event.created`, `emotional_checkin.recorded`,
-- `voice_memo.recorded` are runtime string values written into
-- `audit_log.event` (TEXT NOT NULL per Epic 1 baseline). No enum
-- widening needed (AC7).
--
-- Apply: standard `supabase db push` via the supabase-deploy GHA workflow.
--

-- ============================================================================
-- SECTION 1: Enums
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'life_event_category_enum') THEN
    CREATE TYPE public.life_event_category_enum AS ENUM (
      'health',
      'lifestyle',
      'travel',
      'stress',
      'medication',
      'other'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'life_event_privacy_flag_enum') THEN
    CREATE TYPE public.life_event_privacy_flag_enum AS ENUM (
      'patient_only'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'emotional_checkin_state_enum') THEN
    CREATE TYPE public.emotional_checkin_state_enum AS ENUM (
      'hopeful',
      'worried',
      'curious',
      'exhausted',
      'unsure'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'emotional_checkin_type_enum') THEN
    CREATE TYPE public.emotional_checkin_type_enum AS ENUM (
      'pre',
      'post'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'emotional_checkin_privacy_enum') THEN
    CREATE TYPE public.emotional_checkin_privacy_enum AS ENUM (
      'patient_only'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voice_memo_privacy_enum') THEN
    CREATE TYPE public.voice_memo_privacy_enum AS ENUM (
      'patient_only'
    );
  END IF;
END $$;

-- ============================================================================
-- SECTION 2: Tables
-- ============================================================================

-- Story 7.1 — life_events
CREATE TABLE IF NOT EXISTS public.life_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  description text NOT NULL,
  category public.life_event_category_enum,
  privacy_flag public.life_event_privacy_flag_enum NOT NULL DEFAULT 'patient_only',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT life_events_description_length_check
    CHECK (char_length(description) BETWEEN 1 AND 140)
);

-- Story 7.2 — emotional_checkins
CREATE TABLE IF NOT EXISTS public.emotional_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  state public.emotional_checkin_state_enum NOT NULL,
  type public.emotional_checkin_type_enum NOT NULL,
  privacy_flag public.emotional_checkin_privacy_enum NOT NULL DEFAULT 'patient_only',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Story 7.4 — voice_memos
CREATE TABLE IF NOT EXISTS public.voice_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  duration_ms integer NOT NULL,
  privacy_flag public.voice_memo_privacy_enum NOT NULL DEFAULT 'patient_only',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT voice_memos_duration_ms_check
    CHECK (duration_ms > 0 AND duration_ms <= 30000)
);

-- ============================================================================
-- SECTION 3: Column ADDs on existing tables
-- ============================================================================

-- Story 7.2 — uploads.viewed_at first-view marker. Additive, nullable,
-- no default; NULL means "patient has never opened the detail screen
-- for this upload" (gates the pre-results emotional check-in sheet).
ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS viewed_at timestamp with time zone;

-- ============================================================================
-- SECTION 4: Indexes
-- ============================================================================

-- Story 7.1 — life_events Fingerprint marker query: WHERE patient_id = ?
-- AND event_date BETWEEN ? AND ?.
CREATE INDEX IF NOT EXISTS life_events_patient_event_date_idx
  ON public.life_events (patient_id, event_date);

-- Story 7.2 / 7.3 — one (pre|post) check-in per upload. Non-partial; both
-- `type` values are valid. The narrow 23505 idempotency shield in the
-- resolver catches violations on double-tap.
CREATE UNIQUE INDEX IF NOT EXISTS emotional_checkins_upload_type_unique
  ON public.emotional_checkins (upload_id, type);

-- Story 7.2 listing index for the future personal-history view + the
-- Story 7.3 listPairs JOIN. R1-L1: explicit DESC on created_at so the
-- planner uses a forward scan for the most-common ORDER BY pattern.
CREATE INDEX IF NOT EXISTS emotional_checkins_patient_created_idx
  ON public.emotional_checkins (patient_id, created_at DESC);

-- Story 7.4 — one voice memo per upload.
CREATE UNIQUE INDEX IF NOT EXISTS voice_memos_upload_unique
  ON public.voice_memos (upload_id);

-- Story 7.4 listing index for the future personal-history view.
CREATE INDEX IF NOT EXISTS voice_memos_patient_created_idx
  ON public.voice_memos (patient_id, created_at DESC);

-- ============================================================================
-- SECTION 5: RLS — Patient-side policies (denial-by-RLS-absence for doctors)
-- ============================================================================
-- Each personal-context table ships SELECT-own + INSERT-own ONLY. The
-- absence of a doctor policy IS the defense; `privacy_flag` is
-- metadata for a future explicit-consent surface. Bodies mirror
-- packages/db/policies/custom_rls_{life_events,emotional_checkins,voice_memos}.sql
-- byte-for-byte so the testcontainer integration suite and production
-- evaluate the same predicates.

ALTER TABLE public.life_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS life_events_select_own ON public.life_events;
CREATE POLICY life_events_select_own ON public.life_events
  FOR SELECT
  USING (patient_id::text = current_setting('app.current_patient_id', true));

DROP POLICY IF EXISTS life_events_insert_own ON public.life_events;
CREATE POLICY life_events_insert_own ON public.life_events
  FOR INSERT
  WITH CHECK (patient_id::text = current_setting('app.current_patient_id', true));

ALTER TABLE public.emotional_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emotional_checkins_select_own ON public.emotional_checkins;
CREATE POLICY emotional_checkins_select_own ON public.emotional_checkins
  FOR SELECT
  USING (patient_id::text = current_setting('app.current_patient_id', true));

DROP POLICY IF EXISTS emotional_checkins_insert_own ON public.emotional_checkins;
CREATE POLICY emotional_checkins_insert_own ON public.emotional_checkins
  FOR INSERT
  WITH CHECK (patient_id::text = current_setting('app.current_patient_id', true));

ALTER TABLE public.voice_memos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_memos_select_own ON public.voice_memos;
CREATE POLICY voice_memos_select_own ON public.voice_memos
  FOR SELECT
  USING (patient_id::text = current_setting('app.current_patient_id', true));

DROP POLICY IF EXISTS voice_memos_insert_own ON public.voice_memos;
CREATE POLICY voice_memos_insert_own ON public.voice_memos
  FOR INSERT
  WITH CHECK (patient_id::text = current_setting('app.current_patient_id', true));

-- ============================================================================
-- SECTION 6: Supabase Storage — voice_memos bucket + RLS
-- ============================================================================
-- Story 7.4 AC11 deferred bucket creation to this story. The patient
-- uploads audio directly via the supabase-js client; Storage RLS
-- scopes both SELECT and INSERT to the patient's own folder
-- (`<patient_id>/...`) via `storage.foldername(name)[1]`.

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice_memos', 'voice_memos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS voice_memos_storage_select_own ON storage.objects;
CREATE POLICY voice_memos_storage_select_own ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'voice_memos'
    -- R1-MED — Supabase docs recommend wrapping `auth.uid()` in a
    -- SELECT subquery so the helper is evaluated once per statement
    -- rather than per row (Storage RLS performance pattern).
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS voice_memos_storage_insert_own ON storage.objects;
CREATE POLICY voice_memos_storage_insert_own ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'voice_memos'
    -- R1-MED — Supabase docs recommend wrapping `auth.uid()` in a
    -- SELECT subquery so the helper is evaluated once per statement
    -- rather than per row (Storage RLS performance pattern).
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );
