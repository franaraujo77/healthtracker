--
-- Story 6.6 — Epic 6 consolidated migration: doctor accounts +
-- doctor→patient invites + per-doctor staleness threshold configuration.
--
-- Captures the net-new schema introduced by:
--   * Story 6.3 — `professionals` table + `professional_category_enum`
--     + FK declaration on the long-deferred `pending_invites.resolved_user_id`
--     column (column itself shipped in Story 5.1).
--   * Story 6.4 — `patient_invites` table + `patient_invite_status_enum`
--     + supporting indexes + CHECK constraint. The partial unique index
--     `patient_invites_professional_identifier_active_uq` is split into
--     the companion file
--     `supabase/migrations-postapply/0007_epic_6_patient_invites_active_uq.sql`
--     so it can be applied via `psql` with `CREATE … CONCURRENTLY`
--     outside Supabase's per-migration implicit transaction
--     (`CREATE INDEX CONCURRENTLY` inside the implicit tx fails with
--     SQLSTATE 25001). The `supabase-deploy` GitHub Actions workflow
--     was extended (Story 6.6 R1 H1 patch) to iterate every file
--     under `supabase/migrations-postapply/` via `psql` after
--     `supabase db push` completes.
--   * Story 6.5 — `staleness_thresholds` table with composite PRIMARY
--     KEY (`professional_user_id`, `biomarker_category`), CHECK on
--     range, listing index. NO synthetic id; composite PK is the
--     symbol the `ON CONFLICT (professional_user_id, biomarker_category)`
--     UPSERT path targets (Story 6.5 R1-followup MEDIUM-3 — converted
--     from `uniqueIndex` to real `primaryKey()`).
--
-- Mirrors the Drizzle schema files byte-for-byte:
--   * `packages/db/src/schema/professionals.ts`
--   * `packages/db/src/schema/patient_invites.ts`
--   * `packages/db/src/schema/staleness_thresholds.ts`
--   * `packages/db/src/schema/sharing.ts` (pending_invites FK only)
--
-- RLS policy bodies copied verbatim from:
--   * `packages/db/policies/custom_rls_professionals.sql`
--   * `packages/db/policies/custom_rls_patient_invites.sql`
--   * `packages/db/policies/custom_rls_staleness_thresholds.sql`
--
-- Every CREATE / ALTER statement is guarded for idempotent re-apply
-- against a database where Drizzle's `pnpm db:push` has already
-- created the objects (mirrors `0003_epic_4_letters_schema.sql`).
--

--
-- Name: professional_category_enum; Type: TYPE; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'professional_category_enum'
    ) THEN
        CREATE TYPE public.professional_category_enum AS ENUM (
            'endocrinologista',
            'cardiologista',
            'medicina_esportiva',
            'nutrologo',
            'nutricionista',
            'clinico_geral',
            'outro'
        );
    END IF;
END $$;

--
-- Name: patient_invite_status_enum; Type: TYPE; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'patient_invite_status_enum'
    ) THEN
        CREATE TYPE public.patient_invite_status_enum AS ENUM (
            'pending',
            'resolved',
            'expired',
            'revoked'
        );
    END IF;
END $$;

--
-- Name: professionals; Type: TABLE; Schema: public; Owner: -
--
CREATE TABLE IF NOT EXISTS public.professionals (
    user_id uuid NOT NULL,
    display_name text NOT NULL,
    category public.professional_category_enum NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: professionals professionals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'professionals_pkey'
    ) THEN
        ALTER TABLE ONLY public.professionals
            ADD CONSTRAINT professionals_pkey PRIMARY KEY (user_id);
    END IF;
END $$;

--
-- Name: professionals professionals_user_id_users_id_fk; Type: FK CONSTRAINT
--
-- FK to users(id) ON DELETE CASCADE — Story 5.6 default rule for every
-- new FK to `users(id)`. When the doctor deletes their account, their
-- `professionals` row goes too (LGPD-erasure compliance).
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'professionals_user_id_users_id_fk'
    ) THEN
        ALTER TABLE ONLY public.professionals
            ADD CONSTRAINT professionals_user_id_users_id_fk
            FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END $$;

--
-- Name: pending_invites pending_invites_resolved_user_id_users_id_fk;
-- Type: FK CONSTRAINT (Story 6.3 — column itself shipped in Story 5.1).
--
-- **`ON DELETE SET NULL`** — the FIRST of TWO documented exceptions to
-- Story 5.6's "every new FK to `users(id)` MUST use cascade" rule.
-- Rationale: the `pending_invites` row encodes the PATIENT's intent
-- ("I wanted to share with Dr. X"). If Dr. X later deletes their
-- account, the patient's intent should survive — the row simply
-- orphans back to "unresolved". Cascading would silently delete
-- patient-authored data on a third-party (doctor) action.
-- Regression: `pending_invites_resolved_user_id_fk.rls.test.ts`.
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pending_invites_resolved_user_id_users_id_fk'
    ) THEN
        ALTER TABLE ONLY public.pending_invites
            ADD CONSTRAINT pending_invites_resolved_user_id_users_id_fk
            FOREIGN KEY (resolved_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END $$;

--
-- Name: patient_invites; Type: TABLE; Schema: public; Owner: -
--
CREATE TABLE IF NOT EXISTS public.patient_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    professional_user_id uuid NOT NULL,
    identifier_hash text NOT NULL,
    identifier_kind text NOT NULL,
    display_name text,
    token_hmac text NOT NULL,
    resolved_user_id uuid,
    status public.patient_invite_status_enum DEFAULT 'pending'::public.patient_invite_status_enum NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + interval '7 days') NOT NULL,
    revoked_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: patient_invites patient_invites_pkey; Type: CONSTRAINT
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'patient_invites_pkey'
    ) THEN
        ALTER TABLE ONLY public.patient_invites
            ADD CONSTRAINT patient_invites_pkey PRIMARY KEY (id);
    END IF;
END $$;

--
-- Name: patient_invites patient_invites_token_hmac_unique; Type: CONSTRAINT
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'patient_invites_token_hmac_unique'
    ) THEN
        ALTER TABLE ONLY public.patient_invites
            ADD CONSTRAINT patient_invites_token_hmac_unique UNIQUE (token_hmac);
    END IF;
END $$;

--
-- Name: patient_invites patient_invites_identifier_kind_check; Type: CHECK CONSTRAINT
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'patient_invites_identifier_kind_check'
    ) THEN
        ALTER TABLE ONLY public.patient_invites
            ADD CONSTRAINT patient_invites_identifier_kind_check
            CHECK ((identifier_kind = ANY (ARRAY['email'::text, 'phone'::text])));
    END IF;
END $$;

--
-- Name: patient_invites patient_invites_professional_user_id_professionals_user_id_fk;
-- Type: FK CONSTRAINT (ON DELETE CASCADE — Story 5.6 rule).
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'patient_invites_professional_user_id_professionals_user_id_fk'
    ) THEN
        ALTER TABLE ONLY public.patient_invites
            ADD CONSTRAINT patient_invites_professional_user_id_professionals_user_id_fk
            FOREIGN KEY (professional_user_id) REFERENCES public.professionals(user_id) ON DELETE CASCADE;
    END IF;
END $$;

--
-- Name: patient_invites patient_invites_resolved_user_id_users_id_fk;
-- Type: FK CONSTRAINT.
--
-- **`ON DELETE SET NULL`** — the SECOND of TWO documented exceptions
-- to Story 5.6's cascade rule. When the patient later deletes their
-- account, the doctor's referral telemetry survives but the linkage
-- breaks. Cascading would silently delete the doctor's history of who
-- they invited via patient-side action.
-- Regression: `patient_invites_resolved_user_id_fk.rls.test.ts`.
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'patient_invites_resolved_user_id_users_id_fk'
    ) THEN
        ALTER TABLE ONLY public.patient_invites
            ADD CONSTRAINT patient_invites_resolved_user_id_users_id_fk
            FOREIGN KEY (resolved_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END $$;

--
-- Name: patient_invites_professional_created_idx; Type: INDEX
--
-- Listing index for the doctor's invite dashboard (deferred — Story
-- 6.4 surface only writes; read surface lands later). DESC ordering
-- mirrors the Drizzle definition; Postgres can scan B-trees backwards
-- so direction is largely cosmetic but kept for symbol parity.
--
CREATE INDEX IF NOT EXISTS patient_invites_professional_created_idx
    ON public.patient_invites USING btree (professional_user_id, created_at DESC);

--
-- Name: patient_invites_resolved_user_idx; Type: INDEX
--
-- Início referrer-attribution read path (T5.6) — given a patient
-- user_id, find the inviting doctor's row.
--
CREATE INDEX IF NOT EXISTS patient_invites_resolved_user_idx
    ON public.patient_invites USING btree (resolved_user_id);

--
-- NOTE: the partial unique index
-- `patient_invites_professional_identifier_active_uq` ships in the
-- post-apply companion file
-- `supabase/migrations-postapply/0006_epic_6_patient_invites_active_uq.sql`
-- so it can be applied with `CREATE … CONCURRENTLY` outside
-- Supabase's per-migration implicit transaction. The deploy
-- workflow's `psql` post-apply step (R1 H1 patch) handles it. See
-- AC3 / AC8 in the story spec and the CLAUDE.md ops note
-- (Migration discipline / Epic 6).
--

--
-- Name: staleness_thresholds; Type: TABLE; Schema: public; Owner: -
--
CREATE TABLE IF NOT EXISTS public.staleness_thresholds (
    professional_user_id uuid NOT NULL,
    biomarker_category text NOT NULL,
    threshold_days integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: staleness_thresholds staleness_thresholds_pk; Type: CONSTRAINT
--
-- Composite PRIMARY KEY (`professional_user_id`, `biomarker_category`).
-- Story 6.5 R1-followup MEDIUM-3 converted this from a `uniqueIndex`
-- to a real `primaryKey()` so the symbol target of the upsert
-- `ON CONFLICT (professional_user_id, biomarker_category)` is
-- explicit. No synthetic id on this table.
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'staleness_thresholds_pk'
    ) THEN
        ALTER TABLE ONLY public.staleness_thresholds
            ADD CONSTRAINT staleness_thresholds_pk
            PRIMARY KEY (professional_user_id, biomarker_category);
    END IF;
END $$;

--
-- Name: staleness_thresholds staleness_thresholds_days_range_check;
-- Type: CHECK CONSTRAINT (defense-in-depth — service-role writes
-- bypass the Zod resolver; the CHECK still rejects out-of-range).
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'staleness_thresholds_days_range_check'
    ) THEN
        ALTER TABLE ONLY public.staleness_thresholds
            ADD CONSTRAINT staleness_thresholds_days_range_check
            CHECK ((threshold_days >= 1 AND threshold_days <= 3650));
    END IF;
END $$;

--
-- Name: staleness_thresholds staleness_thresholds_user_id_fk;
-- Type: FK CONSTRAINT (ON DELETE CASCADE — doctor's preference rows
-- do not outlive the doctor's account semantically).
--
-- Story 6.6 R1 M2 fix: the constraint was originally declared in
-- Drizzle without an explicit name; Drizzle generated
-- `staleness_thresholds_professional_user_id_professionals_user_id_fk`
-- (67 chars). PostgreSQL's NAMEDATALEN=63 silently truncates it to
-- `staleness_thresholds_professional_user_id_professionals_user_id`,
-- which breaks idempotent `IF NOT EXISTS` guards that test the full
-- name. The schema was patched to name the constraint
-- `staleness_thresholds_user_id_fk` (30 chars) via the
-- `foreignKey()` table-builder. This migration handles both fresh
-- DBs (where it just CREATEs under the new name) and DBs that
-- already received the constraint under the truncated 63-char name
-- via `pnpm db:push` (where it RENAMEs first, then the IF NOT
-- EXISTS guard sees the new name and skips the CREATE).
--
DO $$
BEGIN
    -- Idempotent rename: only fires on DBs that received the
    -- pre-fix Drizzle auto-name (truncated to 63 chars).
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'staleness_thresholds_professional_user_id_professionals_user_id'
          AND conrelid = 'public.staleness_thresholds'::regclass
    ) THEN
        ALTER TABLE public.staleness_thresholds
            RENAME CONSTRAINT staleness_thresholds_professional_user_id_professionals_user_id
            TO staleness_thresholds_user_id_fk;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'staleness_thresholds_user_id_fk'
          AND conrelid = 'public.staleness_thresholds'::regclass
    ) THEN
        ALTER TABLE ONLY public.staleness_thresholds
            ADD CONSTRAINT staleness_thresholds_user_id_fk
            FOREIGN KEY (professional_user_id) REFERENCES public.professionals(user_id) ON DELETE CASCADE;
    END IF;
END $$;

--
-- Name: staleness_thresholds_professional_idx; Type: INDEX
--
-- Listing index for the doctor's settings page render.
--
CREATE INDEX IF NOT EXISTS staleness_thresholds_professional_idx
    ON public.staleness_thresholds USING btree (professional_user_id);

--
-- =====================================================================
-- Row Level Security — bodies copied verbatim from the policy files
-- under `packages/db/policies/`. `DROP POLICY IF EXISTS` + `CREATE
-- POLICY` mirrors the policy-file idiom so a manual re-apply against
-- a database that already loaded the policy files is idempotent.
-- =====================================================================
--

--
-- Name: professionals; Type: ROW SECURITY; Schema: public; Owner: -
--
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;

--
-- Name: professionals professionals_select_own; Type: POLICY
--
-- Doctor reads own row. The principal `app.current_doctor_user_id`
-- is set by `doctorProcedure` middleware to the verified Supabase
-- session uid (Story 6.3). NO UPDATE / DELETE policies — display-name
-- edits are deferred; deletion piggybacks on the `users` cascade FK.
--
DROP POLICY IF EXISTS professionals_select_own ON public.professionals;
CREATE POLICY professionals_select_own ON public.professionals
    FOR SELECT
    USING ((user_id::text = current_setting('app.current_doctor_user_id'::text, true)));

DROP POLICY IF EXISTS professionals_insert_own ON public.professionals;
CREATE POLICY professionals_insert_own ON public.professionals
    FOR INSERT
    WITH CHECK ((user_id::text = current_setting('app.current_doctor_user_id'::text, true)));

DROP POLICY IF EXISTS professionals_service_role_all ON public.professionals;
CREATE POLICY professionals_service_role_all ON public.professionals
    FOR ALL
    USING ((current_setting('app.current_user_role'::text, true) = 'service_role'::text))
    WITH CHECK ((current_setting('app.current_user_role'::text, true) = 'service_role'::text));

--
-- Name: patient_invites; Type: ROW SECURITY; Schema: public; Owner: -
--
ALTER TABLE public.patient_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_invites patient_invites_select_own; Type: POLICY
--
-- Doctor reads own rows. NO patient SELECT policy — the patient
-- claim-flow rides only on the UPDATE policy's second clause.
--
DROP POLICY IF EXISTS patient_invites_select_own ON public.patient_invites;
CREATE POLICY patient_invites_select_own ON public.patient_invites
    FOR SELECT
    USING ((professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)));

DROP POLICY IF EXISTS patient_invites_insert_own ON public.patient_invites;
CREATE POLICY patient_invites_insert_own ON public.patient_invites
    FOR INSERT
    WITH CHECK ((professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)));

--
-- UPDATE: either the doctor (revoke flow, deferred) OR the
-- claiming-patient (inside initializeProfile). The patient branch
-- requires the invite to still be `pending`, not revoked, and not
-- expired (race-safe vs. concurrent revoke).
--
DROP POLICY IF EXISTS patient_invites_update_own_or_resolving_patient ON public.patient_invites;
CREATE POLICY patient_invites_update_own_or_resolving_patient ON public.patient_invites
    FOR UPDATE
    USING (
        professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)
        OR (
            status = 'pending'
            AND revoked_at IS NULL
            AND expires_at > now()
        )
    )
    WITH CHECK (
        professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)
        OR (
            status = 'resolved'
            AND resolved_user_id::text = current_setting('app.current_patient_id'::text, true)
        )
    );

DROP POLICY IF EXISTS patient_invites_service_role_all ON public.patient_invites;
CREATE POLICY patient_invites_service_role_all ON public.patient_invites
    FOR ALL
    USING ((current_setting('app.current_user_role'::text, true) = 'service_role'::text))
    WITH CHECK ((current_setting('app.current_user_role'::text, true) = 'service_role'::text));

--
-- Name: staleness_thresholds; Type: ROW SECURITY; Schema: public; Owner: -
--
ALTER TABLE public.staleness_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staleness_thresholds_select_own ON public.staleness_thresholds;
CREATE POLICY staleness_thresholds_select_own ON public.staleness_thresholds
    FOR SELECT
    USING ((professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)));

DROP POLICY IF EXISTS staleness_thresholds_insert_own ON public.staleness_thresholds;
CREATE POLICY staleness_thresholds_insert_own ON public.staleness_thresholds
    FOR INSERT
    WITH CHECK ((professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)));

DROP POLICY IF EXISTS staleness_thresholds_update_own ON public.staleness_thresholds;
CREATE POLICY staleness_thresholds_update_own ON public.staleness_thresholds
    FOR UPDATE
    USING ((professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)))
    WITH CHECK ((professional_user_id::text = current_setting('app.current_doctor_user_id'::text, true)));

-- NO DELETE policy on `staleness_thresholds` — intentional omission
-- (Story 6.5 AC4 deletion-semantics decision). PostgreSQL defaults
-- to "deny" when no policy matches; a future "reset to default" UI
-- story would add this policy then. A defensive
-- `FOR DELETE USING (false)` would BLOCK service_role too without
-- an explicit OR clause; the cleanest answer is no policy at all.

DROP POLICY IF EXISTS staleness_thresholds_service_role_all ON public.staleness_thresholds;
CREATE POLICY staleness_thresholds_service_role_all ON public.staleness_thresholds
    FOR ALL
    USING ((current_setting('app.current_user_role'::text, true) = 'service_role'::text))
    WITH CHECK ((current_setting('app.current_user_role'::text, true) = 'service_role'::text));
