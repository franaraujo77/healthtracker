--
-- Story 6.6 retro addendum — Epic 5 baseline migration.
--
-- Captures the net-new public-schema objects introduced during Stories
-- 5.1–5.6 which had previously only landed in dev/prod via Drizzle
-- `pnpm db:push` (no production migration file shipped per the
-- batched-migration cadence). Without this file, any fresh-DB apply
-- (CI shadow-DB, new staging, prod recovery from baseline) fails at
-- `0006_epic_6_doctor_accounts.sql` with `relation "pending_invites"
-- does not exist` — the `pending_invites_resolved_user_id_users_id_fk`
-- ALTER references a table no migration creates.
--
-- The file mirrors `0003_epic_4_letters_schema.sql`'s style exactly:
--   - Idempotent guards on every CREATE / ALTER (DO-block `IF NOT
--     EXISTS` for enums + constraints; `CREATE TABLE IF NOT EXISTS`
--     for tables; `CREATE INDEX IF NOT EXISTS` for indexes;
--     `DROP POLICY IF EXISTS` + `CREATE POLICY` for RLS).
--   - Header → enums → tables → constraints → indexes → RLS.
--   - RLS bodies copied verbatim from the policy files under
--     `packages/db/policies/` (no paraphrasing).
--
-- Story coverage:
--   * Story 5.1 — `pending_invites`, `share_tokens`,
--     `share_token_biomarkers` + per-table RLS. Mirrors
--     `packages/db/src/schema/sharing.ts` and the three
--     `custom_rls_*` policy files (`pending_invites`,
--     `share_tokens`, `share_token_biomarkers`).
--   * Story 5.2 — `share_duration_enum`, `share_tokens.duration` /
--     `share_tokens.expires_at NULL` semantics, +
--     `conversation_starter_cache` table + RLS
--     (`custom_rls_conversation_starter_cache.sql`).
--   * Story 5.5 — `exports` table + `export_format_enum` /
--     `export_status_enum` + RLS (`custom_rls_exports.sql`) +
--     Supabase Storage bucket (`supabase_storage_exports.sql`).
--   * Story 5.6 — `account_deletion_requests` +
--     `account_deletion_status_enum` + RLS
--     (`custom_rls_account_deletion_requests.sql`) +
--     `pseudonymize_patient_id(uuid, text)` SECURITY-DEFINER-shaped
--     SQL helper for the worker's audit_log pseudonymization step.
--
-- **`pending_invites.resolved_user_id` FK NOT declared here** —
-- the column itself ships here, but the FK constraint
-- (`pending_invites_resolved_user_id_users_id_fk … ON DELETE SET
-- NULL`) ships in the Epic 6 migration `0006_epic_6_doctor_accounts.sql`
-- where it already lives. This file declares the column as a plain
-- nullable uuid; 0006 adds the FK after `professionals` exists.
--
-- **Partial-unique indexes split into post-apply companion file** —
-- four partial unique indexes (`share_tokens_invite_active_uq`,
-- `share_tokens_patient_invite_active_uq`, `exports_active_uq`,
-- `account_deletion_requests_active_uq`) are on patient-data write
-- paths where concurrent double-tap is a real risk. They ship in
-- `supabase/migrations-postapply/0008_epic_5_partial_uniques.sql`
-- with `CREATE … CONCURRENTLY` so the index build cannot race
-- in-flight writes. See CLAUDE.md "Migration discipline" stanza.
-- Non-CONCURRENTLY partial unique index
-- `pending_invites_patient_identifier_uq` is safe inside the
-- per-migration implicit tx (idempotency-only, low write volume).
--

-- =============================================================================
-- Section 1: Enums
-- =============================================================================

--
-- Name: share_duration_enum; Type: TYPE; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'share_duration_enum'
    ) THEN
        CREATE TYPE public.share_duration_enum AS ENUM (
            '24h',
            '7d',
            '30d',
            'no_expiry'
        );
    END IF;
END $$;

--
-- Name: export_format_enum; Type: TYPE; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'export_format_enum'
    ) THEN
        CREATE TYPE public.export_format_enum AS ENUM (
            'json',
            'pdf'
        );
    END IF;
END $$;

--
-- Name: export_status_enum; Type: TYPE; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'export_status_enum'
    ) THEN
        CREATE TYPE public.export_status_enum AS ENUM (
            'queued',
            'generating',
            'ready',
            'failed'
        );
    END IF;
END $$;

--
-- Name: account_deletion_status_enum; Type: TYPE; Schema: public; Owner: -
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'account_deletion_status_enum'
    ) THEN
        CREATE TYPE public.account_deletion_status_enum AS ENUM (
            'queued',
            'processing',
            'complete',
            'failed'
        );
    END IF;
END $$;

-- =============================================================================
-- Section 2: Tables (Story 5.1 — pending_invites, share_tokens,
-- share_token_biomarkers)
-- =============================================================================

--
-- Name: pending_invites; Type: TABLE; Schema: public; Owner: -
--
-- Patient-side intent to share with a named doctor. `resolved_user_id`
-- stays NULL until Epic 6's `claimInviteByDoctor` flips it. The FK
-- constraint on `resolved_user_id` ships in Epic 6's 0006 migration
-- (where `professionals` is created); the column itself is here.
--
CREATE TABLE IF NOT EXISTS public.pending_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    display_name text NOT NULL,
    identifier_hash text NOT NULL,
    resolved_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pending_invites_pkey'
    ) THEN
        ALTER TABLE ONLY public.pending_invites
            ADD CONSTRAINT pending_invites_pkey PRIMARY KEY (id);
    END IF;
END $$;

--
-- FK pending_invites.patient_id → users.id ON DELETE CASCADE.
--
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pending_invites_patient_id_users_id_fk'
    ) THEN
        ALTER TABLE ONLY public.pending_invites
            ADD CONSTRAINT pending_invites_patient_id_users_id_fk
            FOREIGN KEY (patient_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END $$;

--
-- AC7 — idempotency on re-invite of the same doctor by the same patient.
-- Not partial; non-CONCURRENTLY apply is safe.
--
CREATE UNIQUE INDEX IF NOT EXISTS pending_invites_patient_identifier_uq
    ON public.pending_invites USING btree (patient_id, identifier_hash);

--
-- Name: share_tokens; Type: TABLE; Schema: public; Owner: -
--
-- Opaque share links. `token_hash` is the SHA-256 of the raw token
-- (lookup key); `token_hmac` is the HMAC signature. `revoked_at` is
-- the soft-delete signal — physical deletion forbidden (AC11).
-- Story 5.2: `expires_at` is nullable (NULL = sem prazo); `duration`
-- persists the patient-selected enum for resumo-screen rendering.
--
CREATE TABLE IF NOT EXISTS public.share_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    token_hmac text NOT NULL,
    patient_id uuid NOT NULL,
    invite_id uuid NOT NULL,
    expires_at timestamp with time zone,
    duration public.share_duration_enum NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'share_tokens_pkey'
    ) THEN
        ALTER TABLE ONLY public.share_tokens
            ADD CONSTRAINT share_tokens_pkey PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'share_tokens_token_hash_unique'
    ) THEN
        ALTER TABLE ONLY public.share_tokens
            ADD CONSTRAINT share_tokens_token_hash_unique UNIQUE (token_hash);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'share_tokens_patient_id_users_id_fk'
    ) THEN
        ALTER TABLE ONLY public.share_tokens
            ADD CONSTRAINT share_tokens_patient_id_users_id_fk
            FOREIGN KEY (patient_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'share_tokens_invite_id_pending_invites_id_fk'
    ) THEN
        ALTER TABLE ONLY public.share_tokens
            ADD CONSTRAINT share_tokens_invite_id_pending_invites_id_fk
            FOREIGN KEY (invite_id) REFERENCES public.pending_invites(id) ON DELETE CASCADE;
    END IF;
END $$;

--
-- Compartilhar tab listing (Story 5.4 reuse).
--
CREATE INDEX IF NOT EXISTS share_tokens_patient_created_idx
    ON public.share_tokens USING btree (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS share_tokens_invite_idx
    ON public.share_tokens USING btree (invite_id);

-- NOTE: partial unique indexes `share_tokens_invite_active_uq` and
-- `share_tokens_patient_invite_active_uq` (both WHERE revoked_at IS
-- NULL) ship in `supabase/migrations-postapply/0008_epic_5_partial_uniques.sql`
-- with `CREATE … CONCURRENTLY`. See CLAUDE.md "Migration discipline".

--
-- Name: share_token_biomarkers; Type: TABLE; Schema: public; Owner: -
--
-- LGPD per-biomarker scope junction (NFR-S3 central guarantee). Composite
-- PK enforces idempotent UPSERT. `visible = false` is the per-biomarker
-- hide gate; the doctor-principal RLS predicate filters those out.
--
CREATE TABLE IF NOT EXISTS public.share_token_biomarkers (
    share_token_id uuid NOT NULL,
    biomarker_category text NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'share_token_biomarkers_pk'
    ) THEN
        ALTER TABLE ONLY public.share_token_biomarkers
            ADD CONSTRAINT share_token_biomarkers_pk
            PRIMARY KEY (share_token_id, biomarker_category);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'share_token_biomarkers_share_token_id_share_tokens_id_fk'
    ) THEN
        ALTER TABLE ONLY public.share_token_biomarkers
            ADD CONSTRAINT share_token_biomarkers_share_token_id_share_tokens_id_fk
            FOREIGN KEY (share_token_id) REFERENCES public.share_tokens(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =============================================================================
-- Section 3: conversation_starter_cache (Story 5.2)
-- =============================================================================

--
-- One row per share_token. Populated by the `conversation_starter.generate`
-- pg-boss worker. RLS doctor-principal SELECT requires `status = 'ready'`
-- AND the parent token non-revoked + non-expired — JOIN-back in the
-- RLS predicate (Story 5.2 review-fix Patch #14 removed the duplicate
-- cache-side `expires_at` column).
--
CREATE TABLE IF NOT EXISTS public.conversation_starter_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    share_token_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    status text DEFAULT 'queued' NOT NULL,
    payload jsonb,
    failure_reason text,
    generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'conversation_starter_cache_pkey'
    ) THEN
        ALTER TABLE ONLY public.conversation_starter_cache
            ADD CONSTRAINT conversation_starter_cache_pkey PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'conversation_starter_cache_share_token_id_share_tokens_id_fk'
    ) THEN
        ALTER TABLE ONLY public.conversation_starter_cache
            ADD CONSTRAINT conversation_starter_cache_share_token_id_share_tokens_id_fk
            FOREIGN KEY (share_token_id) REFERENCES public.share_tokens(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'conversation_starter_cache_patient_id_users_id_fk'
    ) THEN
        ALTER TABLE ONLY public.conversation_starter_cache
            ADD CONSTRAINT conversation_starter_cache_patient_id_users_id_fk
            FOREIGN KEY (patient_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'conversation_starter_cache_status_check'
    ) THEN
        ALTER TABLE ONLY public.conversation_starter_cache
            ADD CONSTRAINT conversation_starter_cache_status_check
            CHECK ((status = ANY (ARRAY['queued'::text, 'ready'::text, 'failed'::text])));
    END IF;
END $$;

-- Exactly one cache row per share token. Non-partial; safe inside tx.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_starter_cache_share_token_uq
    ON public.conversation_starter_cache USING btree (share_token_id);

-- =============================================================================
-- Section 4: exports (Story 5.5)
-- =============================================================================

--
-- LGPD Art. 18 data-portability surface. Artifact lives in Supabase
-- Storage at `exports/{patient_id}/{id}.{format}` and is never returned
-- in tRPC responses (signed URLs only). `exports_active_uq` partial
-- unique index (single-in-flight per patient) ships in the post-apply
-- companion file.
--
CREATE TABLE IF NOT EXISTS public.exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    format public.export_format_enum NOT NULL,
    status public.export_status_enum DEFAULT 'queued'::public.export_status_enum NOT NULL,
    object_path text,
    file_size_bytes integer,
    failure_reason text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + interval '24 hours') NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'exports_pkey'
    ) THEN
        ALTER TABLE ONLY public.exports
            ADD CONSTRAINT exports_pkey PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'exports_patient_id_users_id_fk'
    ) THEN
        ALTER TABLE ONLY public.exports
            ADD CONSTRAINT exports_patient_id_users_id_fk
            FOREIGN KEY (patient_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- AC5 — "previous exports" list ordering.
CREATE INDEX IF NOT EXISTS exports_patient_requested_idx
    ON public.exports USING btree (patient_id, requested_at DESC);

-- =============================================================================
-- Section 5: account_deletion_requests (Story 5.6)
-- =============================================================================

--
-- LGPD Art. 18 right-to-erasure ledger. Row SURVIVES deletion of its
-- owning patient — `patient_id` INTENTIONALLY has no FK to users(id).
-- After the worker step 4 (`DELETE FROM users`) the value here is a
-- tombstone. Do not "fix" by adding a FK reference.
--
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    status public.account_deletion_status_enum DEFAULT 'queued'::public.account_deletion_status_enum NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    failure_reason text
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'account_deletion_requests_pkey'
    ) THEN
        ALTER TABLE ONLY public.account_deletion_requests
            ADD CONSTRAINT account_deletion_requests_pkey PRIMARY KEY (id);
    END IF;
END $$;

--
-- pgcrypto needed by `pseudonymize_patient_id` (digest sha256).
-- Supabase enables it by default; idempotent.
--
CREATE EXTENSION IF NOT EXISTS pgcrypto;

--
-- pseudonymize_patient_id(uuid, text) → text. Worker calls this to
-- replace `actor_id` / `resource_id` on audit_log rows after the
-- patient row is deleted (Story 5.6 AR20 — pseudonymize, never delete).
-- `CREATE OR REPLACE` keeps re-apply idempotent.
--
CREATE OR REPLACE FUNCTION public.pseudonymize_patient_id(
    patient_id uuid,
    salt text
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT 'pseudonymized-' || encode(
        digest(patient_id::text || salt, 'sha256'),
        'hex'
    )
$$;

-- =============================================================================
-- Section 6: Supabase Storage bucket (Story 5.5)
-- =============================================================================

--
-- `exports` is a PRIVATE bucket. Access via signed URLs only
-- (`getExport` tRPC query → `createSignedUrl`). No anonymous reads.
-- No patient SELECT/INSERT/UPDATE/DELETE policies — service-role
-- writes only. Path: `exports/<patient_id>/<export_id>.<format>`.
--
INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Section 7: Row Level Security — bodies copied verbatim from the
-- policy files under `packages/db/policies/`. `DROP POLICY IF EXISTS`
-- + `CREATE POLICY` mirrors the policy-file idiom for idempotent
-- re-apply against DBs that already loaded the files.
-- =============================================================================

--
-- pending_invites — Story 5.1.
-- Source: packages/db/policies/custom_rls_pending_invites.sql
--
ALTER TABLE public.pending_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_invites_select_own" ON public.pending_invites;
CREATE POLICY "pending_invites_select_own" ON public.pending_invites
    FOR SELECT
    USING (
        patient_id::text = current_setting('app.current_patient_id', true)
    );

--
-- share_tokens — Story 5.1 (+ Story 5.2 nullable expires_at).
-- Source: packages/db/policies/custom_rls_share_tokens.sql
--
ALTER TABLE public.share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "share_tokens_select_own_patient" ON public.share_tokens;
CREATE POLICY "share_tokens_select_own_patient" ON public.share_tokens
    FOR SELECT
    USING (
        patient_id::text = current_setting('app.current_patient_id', true)
    );

DROP POLICY IF EXISTS "share_tokens_select_own_doctor" ON public.share_tokens;
CREATE POLICY "share_tokens_select_own_doctor" ON public.share_tokens
    FOR SELECT
    USING (
        id::text = current_setting('app.current_share_token_id', true)
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
    );

--
-- share_token_biomarkers — Story 5.1 (LGPD NFR-S3).
-- Source: packages/db/policies/custom_rls_share_token_biomarkers.sql
--
ALTER TABLE public.share_token_biomarkers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "share_token_biomarkers_select_own_patient" ON public.share_token_biomarkers;
CREATE POLICY "share_token_biomarkers_select_own_patient" ON public.share_token_biomarkers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM share_tokens
            WHERE share_tokens.id = share_token_biomarkers.share_token_id
                AND share_tokens.patient_id::text = current_setting('app.current_patient_id', true)
        )
    );

DROP POLICY IF EXISTS "share_token_biomarkers_select_own_doctor" ON public.share_token_biomarkers;
CREATE POLICY "share_token_biomarkers_select_own_doctor" ON public.share_token_biomarkers
    FOR SELECT
    USING (
        share_token_biomarkers.share_token_id::text = current_setting('app.current_share_token_id', true)
        AND share_token_biomarkers.visible = true
        AND EXISTS (
            SELECT 1 FROM share_tokens
            WHERE share_tokens.id = share_token_biomarkers.share_token_id
                AND share_tokens.revoked_at IS NULL
                AND (share_tokens.expires_at IS NULL OR share_tokens.expires_at > now())
        )
    );

--
-- conversation_starter_cache — Story 5.2.
-- Source: packages/db/policies/custom_rls_conversation_starter_cache.sql
--
ALTER TABLE public.conversation_starter_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_starter_cache_select_own_patient" ON public.conversation_starter_cache;
CREATE POLICY "conversation_starter_cache_select_own_patient" ON public.conversation_starter_cache
    FOR SELECT
    USING (
        patient_id::text = current_setting('app.current_patient_id', true)
    );

DROP POLICY IF EXISTS "conversation_starter_cache_select_own_doctor" ON public.conversation_starter_cache;
CREATE POLICY "conversation_starter_cache_select_own_doctor" ON public.conversation_starter_cache
    FOR SELECT
    USING (
        share_token_id::text = current_setting('app.current_share_token_id', true)
        AND status = 'ready'
        AND EXISTS (
            SELECT 1 FROM share_tokens
            WHERE share_tokens.id = conversation_starter_cache.share_token_id
                AND share_tokens.revoked_at IS NULL
                AND (share_tokens.expires_at IS NULL OR share_tokens.expires_at > now())
        )
    );

--
-- exports — Story 5.5.
-- Source: packages/db/policies/custom_rls_exports.sql
--
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exports_select_own" ON public.exports;
CREATE POLICY "exports_select_own" ON public.exports
    FOR SELECT
    USING (
        patient_id::text = current_setting('app.current_patient_id', true)
    );

--
-- account_deletion_requests — Story 5.6.
-- Source: packages/db/policies/custom_rls_account_deletion_requests.sql
--
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_deletion_requests_select_own"
    ON public.account_deletion_requests;
CREATE POLICY "account_deletion_requests_select_own"
    ON public.account_deletion_requests
    FOR SELECT
    USING (
        patient_id::text = current_setting('app.current_patient_id', true)
    );
