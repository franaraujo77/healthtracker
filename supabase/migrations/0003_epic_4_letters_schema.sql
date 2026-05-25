--
-- Story 4.4 — Epic 4 incremental schema: `letters` table + enum + RLS.
--
-- Captures the net-new schema introduced by Stories 4.1 (Letter SSE) and
-- consumed by 4.2 (re-read) and 4.3 (biomarker suggestion writes only
-- audit rows, no schema). Mirrors `packages/db/src/schema/letters.ts`
-- byte-for-byte: Drizzle's snake_case casing produces snake_case columns,
-- `defaultRandom()` maps to `gen_random_uuid()` (pgcrypto), `defaultNow()`
-- maps to `now()`.
--
-- Companion file `0004_epic_4_audit_index_letter_queued.sql` swaps the
-- `audit_log_notification_event_unique` partial-index WHERE clause to
-- include `'letter.queued'` — split into a separate file because the
-- CONCURRENTLY-shaped index swap cannot run inside the implicit
-- transaction Supabase wraps around migration files.
--

--
-- Name: letter_status_enum; Type: TYPE; Schema: public; Owner: -
--
-- DO-block IF NOT EXISTS guard for parity with the baseline migration's
-- enum-creation pattern (every CREATE TYPE in
-- `0001_baseline_epics_0_to_3.sql` is wrapped this way). Supabase's
-- `schema_migrations` table normally prevents re-runs, but a manual
-- re-apply against a DB where the enum was created via `pnpm db:push`
-- would otherwise fail with `type "letter_status_enum" already exists`.
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'letter_status_enum'
    ) THEN
        CREATE TYPE public.letter_status_enum AS ENUM (
            'queued',
            'generating',
            'complete',
            'failed'
        );
    END IF;
END $$;

--
-- Name: letters; Type: TABLE; Schema: public; Owner: -
--
CREATE TABLE IF NOT EXISTS public.letters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    upload_id uuid NOT NULL,
    status public.letter_status_enum DEFAULT 'queued'::public.letter_status_enum NOT NULL,
    body text,
    model text,
    tokens_used integer,
    failure_reason text,
    generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);

--
-- Name: letters letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'letters_pkey'
    ) THEN
        ALTER TABLE ONLY public.letters
            ADD CONSTRAINT letters_pkey PRIMARY KEY (id);
    END IF;
END $$;

--
-- Name: letters_patient_created_idx; Type: INDEX; Schema: public; Owner: -
--
-- Anticipated read path: Story 4.2's `getLetterForDraw` filters by
-- (patient_id) and tie-breaks by created_at DESC LIMIT 1. The index
-- works equally well in both directions because Postgres can scan
-- a B-tree backwards.
--
CREATE INDEX IF NOT EXISTS letters_patient_created_idx
    ON public.letters USING btree (patient_id, created_at);

--
-- Name: letters; Type: ROW SECURITY; Schema: public; Owner: -
--
ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;

--
-- Name: letters letters_select_own; Type: POLICY; Schema: public; Owner: -
--
-- Patients SELECT their own letters only. Writes (INSERT/UPDATE) come
-- exclusively from service-role connections (the `services/llm`
-- consumer transitions queued → generating → complete, and the
-- worker-direct enqueue path in `services/extraction/src/notifications/
-- letters-emit.ts`). No patient-facing INSERT / UPDATE / DELETE policy
-- — mirrors the Story 2.3 `observations` pattern.
--
CREATE POLICY letters_select_own ON public.letters
    FOR SELECT
    USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));
