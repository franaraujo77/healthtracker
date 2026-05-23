-- =============================================================================
-- 0001_baseline_epics_0_to_3.sql
-- Baseline Supabase migration covering Epics 0–3 schema. ROUND-3 (idempotent +
-- single source of truth + queue rows seeded).
-- =============================================================================
--
-- WHAT
--   Initial schema baseline for an empty Supabase project. Four sections:
--     1. pg-boss `pgboss` schema (extracted from pg-boss@12.18.2's
--        `getConstructionPlans('pgboss')`, with idempotency patches and
--        explicit `BEGIN;`/`COMMIT;` stripped so Supabase's per-migration
--        transaction wraps the whole file). Lets `INSERT INTO pgboss.job`
--        in `packages/api/src/uploads.ts:123` and `notifications.ts:56`
--        succeed before the extraction worker boots.
--     2. pg-boss queue rows — seeded for `extraction.dead_letter`,
--        `extraction.smoke_test`, `extraction.document`, `notification.send`.
--        Without these rows, the API's direct `pgboss.job` INSERTs hit a
--        FK violation on `q_fkey -> pgboss.queue(name)`. The worker's
--        `boss.createQueue(...)` calls (services/extraction/src/index.ts)
--        are idempotent against these pre-seeded rows.
--     3. `public` schema — tables / enums / indexes / triggers / functions
--        from `pnpm db:push`, dumped via
--          pg_dump --schema-only --schema=public --no-owner --no-privileges
--                  --no-publications --no-subscriptions --no-comments
--        and post-processed for idempotency (every CREATE TABLE/INDEX uses
--        IF NOT EXISTS, enums and PK/UNIQUE constraints wrap in
--        pg_type/pg_constraint-guarded DO blocks, functions use
--        CREATE OR REPLACE, triggers preceded by DROP IF EXISTS). The
--        `rls_auto_enable()` dev-only orphan function is stripped. The
--        `consent_grants_revoke_only_revoked_at()` function and its
--        trigger are ALSO stripped from this section — single source of
--        truth lives in `custom_rls_consent_grants_zz_revoke.sql`
--        (Section 4), avoiding the double-definition drift hazard.
--     4. RLS policies + grants/revokes — concatenated verbatim from
--        `packages/db/policies/custom_*.sql` in `LC_ALL=C` glob order so
--        the production apply matches what CI's
--          `for f in packages/db/policies/custom_*.sql`
--        loop produces on Ubuntu (which uses C-equivalent collation).
--        Note: `custom_rls_consent_grants_zz_revoke.sql` was renamed
--        from `custom_rls_consent_grants_revoke.sql` so that its
--        concatenation order (which depends on the function it creates
--        existing only AFTER the base `custom_rls_consent_grants.sql`
--        runs to ENABLE ROW LEVEL SECURITY) is robust under both macOS
--        (where `_` < `.`) and Ubuntu/CI (where `.` < `_`) sort orders.
--
-- WHY
--   Epics 0–2 are `done` and Epic 3 is in-progress. Schema was historically
--   applied to dev (jhklzsdxlrvyprysfeku) via `pnpm db:push` only; production
--   (wkjwnwwzsulkfzpaihkp) has never been populated. This baseline ships the
--   same schema to production via the `supabase-deploy` GitHub Action on
--   merge to `main`, replacing ad-hoc push-based delivery.
--
-- EPIC → TABLE MAPPING
--   Epic 0 (Foundation):       pg-boss `pgboss` schema + seeded queue rows
--   Epic 1 (Account+Consent):  users, consent_grants, audit_log
--   Epic 2 (Upload+Review):    uploads, observations, loinc_ref,
--                              extraction_review_queue, push_tokens,
--                              notification_preferences
--   Epic 3 (Fingerprint):      no net-new tables (read-side queries;
--                              Story 3.4 cache is client-side TanStack)
--   Epic 5 (Sharing, backlog): `packages/db/src/schema/sharing.ts` exists
--                              in code but is NOT exported from
--                              `packages/db/src/schema/index.ts`. Sharing
--                              schema lands in Story 5.7's migration.
--
-- FILENAME CONVENTION
--   `0001_` numeric ordinal. Supabase CLI sorts lexically and accepts this
--   format (verified via `supabase migration list --linked`). Future epic
--   migrations: `0002_*`, `0003_*`, …
--
-- PARTIAL UNIQUE INDEX NOTE (CLAUDE.md ops note / Story 2.7 R2-P213)
--   Subsequent changes to a partial-index WHERE clause against a populated
--   production DB MUST use `CREATE UNIQUE INDEX CONCURRENTLY` + a separate
--   `DROP INDEX CONCURRENTLY` migration applied in a maintenance window.
--   For THIS baseline, the partial unique indexes below are created via
--   `CREATE UNIQUE INDEX IF NOT EXISTS` (no CONCURRENTLY) because the
--   baseline applies to an EMPTY production database — no concurrent
--   writers exist to race the ShareLock.
--
-- ROUND-3 REVIEW FIXES APPLIED (cumulative — round-1 and round-2 still in)
--   R3-#1 pg-boss BEGIN/COMMIT      — outer transaction control stripped
--                                     from Section 1 so Supabase's
--                                     per-migration tx wraps the whole
--                                     file. Restores "failure rolls back
--                                     everything" semantics.
--   R3-#2 queue rows seeded         — Section 2 inserts 4 queue rows so
--                                     the API's direct `pgboss.job` INSERTs
--                                     don't FK-violate when the web app
--                                     starts before the worker.
--   R3-#3 function dedup            — `consent_grants_revoke_only_revoked_at`
--                                     function + trigger removed from
--                                     Section 3's dump; sole source-of-truth
--                                     is `custom_rls_consent_grants_zz_revoke.sql`.
--   R3-#4 .gitignore narrowed       — only `packages/db/migrations/meta/`
--                                     is ignored now; `drizzle-kit check`
--                                     gate still functions for future
--                                     migration files.
--   R3-#5 policy file rename        — `custom_rls_consent_grants_revoke.sql`
--                                     → `custom_rls_consent_grants_zz_revoke.sql`
--                                     so glob ordering puts it after the
--                                     base file under both macOS and
--                                     Ubuntu/CI collations.
--   R3-#6 pg-boss pinned exact      — `services/extraction/package.json`
--                                     drops the caret on `pg-boss` (now
--                                     `"12.18.2"`, was `"^12.18.2"`).
--                                     Prevents drift between the runtime
--                                     library and the bundled DDL version.
--
-- =============================================================================

-- =============================================================================
-- Section 1: pg-boss schema (from pg-boss@12.18.2 getConstructionPlans,
-- idempotent + outer BEGIN/COMMIT stripped)
-- =============================================================================


    -- (BEGIN stripped — Supabase migration runner wraps this file in its own tx)
    SET LOCAL lock_timeout = 30000;
    SET LOCAL idle_in_transaction_session_timeout = 30000;
    SELECT pg_advisory_xact_lock(
      ('x' || encode(sha224((current_database() || '.pgboss.pgboss')::bytea), 'hex'))::bit(64)::bigint
  );
    CREATE SCHEMA IF NOT EXISTS pgboss;

    DO $job_state$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'pgboss' AND t.typname = 'job_state'
      ) THEN
        CREATE TYPE pgboss.job_state AS ENUM (
          'created',
          'retry',
          'active',
          'completed',
          'cancelled',
          'failed'
        );
      END IF;
    END
    $job_state$;

    CREATE TABLE IF NOT EXISTS pgboss.version (
      version int primary key,
      cron_on timestamp with time zone,
      bam_on timestamp with time zone
    )
  ;

    CREATE TABLE IF NOT EXISTS pgboss.queue (
      name text NOT NULL,
      policy text NOT NULL,
      retry_limit int NOT NULL,
      retry_delay int NOT NULL,
      retry_backoff bool NOT NULL,
      retry_delay_max int,
      expire_seconds int NOT NULL,
      retention_seconds int NOT NULL,
      deletion_seconds int NOT NULL,
      dead_letter text REFERENCES pgboss.queue (name) CHECK (dead_letter IS DISTINCT FROM name),
      partition bool NOT NULL,
      table_name text NOT NULL,
      deferred_count int NOT NULL default 0,
      queued_count int NOT NULL default 0,
      warning_queued int NOT NULL default 0,
      active_count int NOT NULL default 0,
      total_count int NOT NULL default 0,
      heartbeat_seconds int,
      singletons_active text[],
      monitor_on timestamp with time zone,
      maintain_on timestamp with time zone,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY (name)
    )
  ;

    CREATE TABLE IF NOT EXISTS pgboss.schedule (
      name text REFERENCES pgboss.queue ON DELETE CASCADE,
      key text not null DEFAULT '',
      cron text not null,
      timezone text,
      data jsonb,
      options jsonb,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY (name, key)
    )
  ;

    CREATE TABLE IF NOT EXISTS pgboss.subscription (
      event text not null,
      name text not null REFERENCES pgboss.queue ON DELETE CASCADE,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY(event, name)
    )
  ;

    CREATE TABLE IF NOT EXISTS pgboss.bam (
      id uuid PRIMARY KEY default gen_random_uuid(),
      name text NOT NULL,
      version int NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      queue text,
      table_name text NOT NULL,
      command text NOT NULL,
      error text,
      created_on timestamp with time zone NOT NULL DEFAULT now(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone
    )
  ;

    CREATE OR REPLACE FUNCTION pgboss.job_table_format(command text, table_name text)
    RETURNS text AS
    $$
      SELECT format(
        replace(
          replace(command, '.job', '.%1$I'),
          'job_i', '%1$s_i'
        ),
        table_name
      );
    $$
    LANGUAGE sql IMMUTABLE;
  ;

    CREATE OR REPLACE FUNCTION pgboss.job_table_run(command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    DECLARE
      tbl RECORD;
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        EXECUTE pgboss.job_table_format(command, tbl_name);
        RETURN;
      END IF;

      EXECUTE pgboss.job_table_format(command, 'job_common');

      FOR tbl IN SELECT table_name FROM pgboss.queue WHERE partition = true
      LOOP
        EXECUTE pgboss.job_table_format(command, tbl.table_name);
      END LOOP;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE OR REPLACE FUNCTION pgboss.job_table_run_async(command_name text, version int, command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
        VALUES (
          command_name,
          version,
          'pending',
          queue_name,
          tbl_name,
          pgboss.job_table_format(command, tbl_name)
        );
        RETURN;
      END IF;

      INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
      SELECT
        command_name,
        version,
        'pending',
        NULL,
        'job_common',
        pgboss.job_table_format(command, 'job_common')
      UNION ALL
      SELECT
        command_name,
        version,
        'pending',
        queue.name,
        queue.table_name,
        pgboss.job_table_format(command, queue.table_name)
      FROM pgboss.queue
      WHERE partition = true;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE TABLE IF NOT EXISTS pgboss.job (
      id uuid not null default gen_random_uuid(),
      name text not null,
      priority integer not null default(0),
      data jsonb,
      state pgboss.job_state not null default 'created',
      retry_limit integer not null default 2,
      retry_count integer not null default 0,
      retry_delay integer not null default 0,
      retry_backoff boolean not null default false,
      retry_delay_max integer,
      expire_seconds int not null default 900,
      deletion_seconds int not null default 604800,
      singleton_key text,
      singleton_on timestamp without time zone,
      group_id text,
      group_tier text,
      start_after timestamp with time zone not null default now(),
      created_on timestamp with time zone not null default now(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone,
      keep_until timestamp with time zone NOT NULL default now() + interval '1209600',
      output jsonb,
      dead_letter text,
      policy text,
      heartbeat_on timestamp with time zone,
      heartbeat_seconds int
    ) PARTITION BY LIST (name)
  ;
ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id);

    CREATE TABLE IF NOT EXISTS pgboss.job_common (LIKE pgboss.job INCLUDING GENERATED INCLUDING DEFAULTS);

    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX IF NOT EXISTS job_i5 ON pgboss.job (name, start_after) INCLUDE (priority, created_on, id) WHERE state < 'active'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX IF NOT EXISTS job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, 'job_common');

    ALTER TABLE pgboss.job ATTACH PARTITION pgboss.job_common DEFAULT;
  ;

    CREATE TABLE IF NOT EXISTS pgboss.warning (
      id uuid PRIMARY KEY default gen_random_uuid(),
      type text NOT NULL,
      message text NOT NULL,
      data jsonb,
      created_on timestamp with time zone NOT NULL DEFAULT now()
    )
  ;
CREATE INDEX IF NOT EXISTS warning_i1 ON pgboss.warning (created_on DESC);

    CREATE OR REPLACE FUNCTION pgboss.create_queue(queue_name text, options jsonb)
    RETURNS VOID AS
    $$
    DECLARE
      tablename varchar := CASE WHEN options->>'partition' = 'true'
                            THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                            ELSE 'job_common'
                            END;
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
        INSERT INTO pgboss.queue (
          name,
          policy,
          retry_limit,
          retry_delay,
          retry_backoff,
          retry_delay_max,
          expire_seconds,
          retention_seconds,
          deletion_seconds,
          warning_queued,
          dead_letter,
          partition,
          table_name,
          heartbeat_seconds
        )
        VALUES (
          queue_name,
          options->>'policy',
          COALESCE((options->>'retryLimit')::int, 2),
          COALESCE((options->>'retryDelay')::int, 0),
          COALESCE((options->>'retryBackoff')::bool, false),
          (options->>'retryDelayMax')::int,
          COALESCE((options->>'expireInSeconds')::int, 900),
          COALESCE((options->>'retentionSeconds')::int, 1209600),
          COALESCE((options->>'deleteAfterSeconds')::int, 604800),
          COALESCE((options->>'warningQueueSize')::int, 0),
          options->>'deadLetter',
          COALESCE((options->>'partition')::bool, false),
          tablename,
          (options->>'heartbeatSeconds')::int
        )
        ON CONFLICT DO NOTHING
        RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE IF NOT EXISTS pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', tablename);

      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);

      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX IF NOT EXISTS job_i5 ON pgboss.job (name, start_after) INCLUDE (priority, created_on, id) WHERE state < 'active'$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX IF NOT EXISTS job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, tablename);

      IF options->>'policy' = 'short' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, tablename);
      ELSIF options->>'policy' = 'singleton' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, tablename);
      ELSIF options->>'policy' = 'stately' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, tablename);
      ELSIF options->>'policy' = 'exclusive' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, tablename);
      ELSIF options->>'policy' = 'key_strict_fifo' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX IF NOT EXISTS job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, tablename);
      END IF;

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', tablename, queue_name);
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE OR REPLACE FUNCTION pgboss.delete_queue(queue_name text)
    RETURNS VOID AS
    $$
    DECLARE
      v_table varchar;
      v_partition bool;
    BEGIN
      SELECT table_name, partition
      FROM pgboss.queue
      WHERE name = queue_name
      INTO v_table, v_partition;

      IF v_partition THEN
        EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', v_table);
      ELSE
        EXECUTE format('DELETE FROM pgboss.%I WHERE name = %L', v_table, queue_name);
      END IF;

      DELETE FROM pgboss.queue WHERE name = queue_name;
    END;
    $$
    LANGUAGE plpgsql;
  ;
INSERT INTO pgboss.version(version) VALUES ('30') ON CONFLICT (version) DO NOTHING;
    -- (COMMIT stripped — outer Supabase tx commits at end of migration)
  

-- =============================================================================

-- Section 2: pg-boss queue rows seed
-- Pre-creates the 4 queues that worker would otherwise create on first
-- boss.start(). Allows the web app's direct INSERT INTO pgboss.job to
-- succeed before worker boots. Ordered so dead_letter queues exist before
-- queues that reference them via FK.
-- =============================================================================

INSERT INTO pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds, deletion_seconds, dead_letter, partition, table_name, heartbeat_seconds) VALUES ('extraction.dead_letter','standard',0,0,false,NULL,900,1209600,604800,NULL,false,'job_common',NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds, deletion_seconds, dead_letter, partition, table_name, heartbeat_seconds) VALUES ('notification.send','standard',5,30,true,NULL,900,1209600,604800,NULL,false,'job_common',NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds, deletion_seconds, dead_letter, partition, table_name, heartbeat_seconds) VALUES ('extraction.document','standard',3,60,true,NULL,900,1209600,604800,'extraction.dead_letter',false,'job_common',NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds, deletion_seconds, dead_letter, partition, table_name, heartbeat_seconds) VALUES ('extraction.smoke_test','standard',3,30,true,NULL,900,1209600,604800,'extraction.dead_letter',false,'job_common',NULL) ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- Section 3: public schema (tables, enums, indexes, functions, triggers)
-- Generated from dev project jhklzsdxlrvyprysfeku via
--   pg_dump --schema-only --schema=public --no-owner --no-privileges
--     --no-publications --no-subscriptions --no-comments
-- and post-processed for idempotency. The `rls_auto_enable()` and
-- `consent_grants_revoke_only_revoked_at()` functions (and the latter's
-- trigger) are stripped — sole source-of-truth is Section 4's policy files.
-- =============================================================================

--

--

--
-- Name: consent_type_enum; Type: TYPE; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'consent_type_enum'
  ) THEN
    CREATE TYPE public.consent_type_enum AS ENUM (
        'blood_test_results',
        'bioimpedance',
        'ai_narrative',
        'health_data_processing',
        'ai_extraction',
        'doctor_sharing',
        'llm_letter_generation'
    );
  END IF;
END $$;

--
-- Name: observation_source_enum; Type: TYPE; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'observation_source_enum'
  ) THEN
    CREATE TYPE public.observation_source_enum AS ENUM (
        'extracted',
        'manual_bia',
        'patient_corrected'
    );
  END IF;
END $$;

--
-- Name: review_reason_enum; Type: TYPE; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'review_reason_enum'
  ) THEN
    CREATE TYPE public.review_reason_enum AS ENUM (
        'low_confidence',
        'loinc_unresolved'
    );
  END IF;
END $$;

--
-- Name: upload_source_enum; Type: TYPE; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'upload_source_enum'
  ) THEN
    CREATE TYPE public.upload_source_enum AS ENUM (
        'onboarding_import',
        'post_onboarding'
    );
  END IF;
END $$;

--
-- Name: upload_status_enum; Type: TYPE; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'upload_status_enum'
  ) THEN
    CREATE TYPE public.upload_status_enum AS ENUM (
        'queued',
        'processing',
        'pending_review',
        'complete',
        'failed'
    );
  END IF;
END $$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid NOT NULL,
    actor_type text NOT NULL,
    event text NOT NULL,
    resource_id uuid NOT NULL,
    resource_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: consent_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.consent_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    consent_type public.consent_type_enum NOT NULL,
    version text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: extraction_review_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.extraction_review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    upload_id uuid NOT NULL,
    biomarker_name text NOT NULL,
    value_text text NOT NULL,
    unit_text text,
    loinc_code text,
    collected_at_text text,
    confidence_score numeric NOT NULL,
    reason public.review_reason_enum NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by_patient_id uuid,
    correction_metadata jsonb
);

--
-- Name: loinc_ref; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.loinc_ref (
    loinc_code text NOT NULL,
    biomarker_name_pt text NOT NULL,
    unit_ucum text NOT NULL,
    category text NOT NULL
);

--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    patient_id uuid NOT NULL,
    results_ready boolean DEFAULT true NOT NULL,
    letters_ready boolean DEFAULT true NOT NULL,
    record_access boolean DEFAULT true NOT NULL,
    review_required boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    upload_id uuid,
    loinc_code text,
    biomarker_name text NOT NULL,
    value_numeric numeric NOT NULL,
    unit_ucum text NOT NULL,
    reference_range_low numeric,
    reference_range_high numeric,
    lab_name text,
    collected_at date NOT NULL,
    confidence_score numeric NOT NULL,
    source public.observation_source_enum NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

--
-- Name: post; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.post (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(256) NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);

--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    device_id uuid NOT NULL,
    expo_token text NOT NULL,
    platform text NOT NULL,
    app_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);

--
-- Name: uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    original_filename text NOT NULL,
    source public.upload_source_enum NOT NULL,
    status public.upload_status_enum DEFAULT 'queued'::public.upload_status_enum NOT NULL,
    processing_started_at timestamp with time zone,
    processing_completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    lab_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.users (
    id uuid NOT NULL,
    subscription_tier text DEFAULT 'free'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'audit_log_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: consent_grants consent_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'consent_grants_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.consent_grants
    ADD CONSTRAINT consent_grants_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: extraction_review_queue extraction_review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'extraction_review_queue_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.extraction_review_queue
    ADD CONSTRAINT extraction_review_queue_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: loinc_ref loinc_ref_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'loinc_ref_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.loinc_ref
    ADD CONSTRAINT loinc_ref_pkey PRIMARY KEY (loinc_code)$sql$;
  END IF;
END $$;

--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'notification_preferences_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (patient_id)$sql$;
  END IF;
END $$;

--
-- Name: observations observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'observations_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: post post_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'post_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.post
    ADD CONSTRAINT post_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'push_tokens_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: uploads uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'uploads_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'users_pkey'
  ) THEN
    EXECUTE $sql$ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id)$sql$;
  END IF;
END $$;

--
-- Name: audit_log_actor_event_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS audit_log_actor_event_created_idx ON public.audit_log USING btree (actor_id, event, created_at DESC);

--
-- Name: audit_log_notification_event_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_notification_event_unique ON public.audit_log USING btree (resource_id, event) WHERE (event = ANY (ARRAY['notification.upload_complete'::text, 'notification.upload_pending_review'::text, 'notification.upload_failed'::text]));

--
-- Name: consent_grants_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS consent_grants_active_unique ON public.consent_grants USING btree (patient_id, consent_type, version) WHERE (revoked_at IS NULL);

--
-- Name: extraction_review_queue_upload_biomarker_reason_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS extraction_review_queue_upload_biomarker_reason_unique ON public.extraction_review_queue USING btree (upload_id, biomarker_name, reason);

--
-- Name: observations_manual_bia_patient_date_lab_loinc_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS observations_manual_bia_patient_date_lab_loinc_unique ON public.observations USING btree (patient_id, collected_at, lab_name, loinc_code) WHERE ((deleted_at IS NULL) AND (source = 'manual_bia'::public.observation_source_enum));

--
-- Name: observations_patient_collected_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS observations_patient_collected_idx ON public.observations USING btree (patient_id, collected_at DESC);

--
-- Name: observations_patient_upload_loinc_date_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS observations_patient_upload_loinc_date_unique ON public.observations USING btree (patient_id, upload_id, loinc_code, collected_at) WHERE ((deleted_at IS NULL) AND (upload_id IS NOT NULL));

--
-- Name: push_tokens_patient_device_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_patient_device_unique ON public.push_tokens USING btree (patient_id, device_id);

--
-- Name: uploads_patient_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS uploads_patient_created_idx ON public.uploads USING btree (patient_id, created_at DESC);

--
-- Name: uploads_patient_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uploads_patient_idempotency_unique ON public.uploads USING btree (patient_id, idempotency_key);

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_insert_own ON public.audit_log FOR INSERT WITH CHECK (((actor_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: audit_log audit_log_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select_own ON public.audit_log FOR SELECT USING (((actor_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: consent_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_grants consent_grants_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_grants_insert_own ON public.consent_grants FOR INSERT WITH CHECK (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: consent_grants consent_grants_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_grants_select_own ON public.consent_grants FOR SELECT USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: consent_grants consent_grants_update_revoke_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_grants_update_revoke_own ON public.consent_grants FOR UPDATE USING ((((patient_id)::text = current_setting('app.current_patient_id'::text, true)) AND (revoked_at IS NULL))) WITH CHECK ((((patient_id)::text = current_setting('app.current_patient_id'::text, true)) AND (revoked_at IS NOT NULL) AND (revoked_at >= (now() - '00:01:00'::interval)) AND (revoked_at <= (now() + '00:01:00'::interval))));

--
-- Name: extraction_review_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.extraction_review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: extraction_review_queue extraction_review_queue_select_own_low_confidence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY extraction_review_queue_select_own_low_confidence ON public.extraction_review_queue FOR SELECT USING ((((patient_id)::text = current_setting('app.current_patient_id'::text, true)) AND (reason = 'low_confidence'::public.review_reason_enum)));

--
-- Name: extraction_review_queue extraction_review_queue_update_own_low_confidence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY extraction_review_queue_update_own_low_confidence ON public.extraction_review_queue FOR UPDATE USING ((((patient_id)::text = current_setting('app.current_patient_id'::text, true)) AND (reason = 'low_confidence'::public.review_reason_enum))) WITH CHECK ((((patient_id)::text = current_setting('app.current_patient_id'::text, true)) AND (reason = 'low_confidence'::public.review_reason_enum)));

--
-- Name: loinc_ref; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loinc_ref ENABLE ROW LEVEL SECURITY;

--
-- Name: loinc_ref loinc_ref_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loinc_ref_select_public ON public.loinc_ref FOR SELECT USING (true);

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences notification_preferences_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_insert_own ON public.notification_preferences FOR INSERT WITH CHECK (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: notification_preferences notification_preferences_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_select_own ON public.notification_preferences FOR SELECT USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: notification_preferences notification_preferences_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_update_own ON public.notification_preferences FOR UPDATE USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true))) WITH CHECK (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;

--
-- Name: observations observations_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY observations_select_own ON public.observations FOR SELECT USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: post; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.post ENABLE ROW LEVEL SECURITY;

--
-- Name: post post_select_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY post_select_anon ON public.post FOR SELECT TO anon USING (true);

--
-- Name: post post_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY post_select_own ON public.post FOR SELECT USING ((current_setting('app.current_patient_id'::text, true) IS NOT NULL));

--
-- Name: push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: push_tokens push_tokens_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_tokens_insert_own ON public.push_tokens FOR INSERT WITH CHECK (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: push_tokens push_tokens_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_tokens_select_own ON public.push_tokens FOR SELECT USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: push_tokens push_tokens_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_tokens_update_own ON public.push_tokens FOR UPDATE USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true))) WITH CHECK (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: uploads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: uploads uploads_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uploads_insert_own ON public.uploads FOR INSERT WITH CHECK (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: uploads uploads_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uploads_select_own ON public.uploads FOR SELECT USING (((patient_id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: uploads uploads_service_role_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uploads_service_role_update ON public.uploads FOR UPDATE TO service_role USING (true) WITH CHECK (true);

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_self ON public.users FOR INSERT WITH CHECK (((id)::text = current_setting('app.current_patient_id'::text, true)));

--
-- Name: users users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own ON public.users FOR SELECT USING (((id)::text = current_setting('app.current_patient_id'::text, true)));

--

--


-- =============================================================================
-- Section 4: RLS policies + grants/revokes + storage bucket policies
-- Concatenated verbatim from packages/db/policies/custom_*.sql in
-- LC_ALL=C glob order — matches what CI's `for f in custom_*.sql` loop
-- produces on Ubuntu (which uses C-equivalent collation by default).
-- Each source file uses DROP IF EXISTS guards (round-1 review fix #1).
-- =============================================================================


-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_audit_log.sql
-- ----------------------------------------------------------------------------
-- custom_rls_audit_log.sql
-- RLS for the append-only `audit_log` table (Story 1.1, AR10 / NFR-S4).
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

-- A patient may write audit rows only for themselves as actor.
DROP POLICY IF EXISTS "audit_log_insert_own" ON "audit_log";
CREATE POLICY "audit_log_insert_own" ON "audit_log"
  FOR INSERT
  WITH CHECK (
    actor_id::text = current_setting('app.current_patient_id', true)
  );

-- A patient may read only their own audit rows (consumed by Story 1.4).
DROP POLICY IF EXISTS "audit_log_select_own" ON "audit_log";
CREATE POLICY "audit_log_select_own" ON "audit_log"
  FOR SELECT
  USING (
    actor_id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE or DELETE policy: the audit trail is append-only at the database
-- layer (NFR-S4). Absence of these policies denies both operations.

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_consent_grants.sql
-- ----------------------------------------------------------------------------
-- custom_rls_consent_grants.sql
-- RLS for the append-only `consent_grants` table (Story 1.2). Token-principal
-- model (AR5): access is granted only to the patient whose id matches the
-- SET LOCAL claim app.current_patient_id, set by protectedProcedure.
--
-- Append-only at the DB layer: revocation is a new row with `revoked_at`
-- set, never an UPDATE. The absence of UPDATE / DELETE policies denies
-- both operations (same NFR-S4 pattern Story 1.1's audit_log uses).
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

ALTER TABLE "consent_grants" ENABLE ROW LEVEL SECURITY;

-- A patient may read only their own consent rows.
DROP POLICY IF EXISTS "consent_grants_select_own" ON "consent_grants";
CREATE POLICY "consent_grants_select_own" ON "consent_grants"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- A patient may insert only their own consent rows. The WITH CHECK is the
-- enforcement seam for AC2 / AC3's "scope cannot be forged".
DROP POLICY IF EXISTS "consent_grants_insert_own" ON "consent_grants";
CREATE POLICY "consent_grants_insert_own" ON "consent_grants"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE or DELETE policy: append-only at the DB layer. Revocation goes
-- through a fresh INSERT with `revoked_at` populated.

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_consent_grants_zz_revoke.sql
-- ----------------------------------------------------------------------------
-- custom_rls_consent_grants_revoke.sql
-- Story 1.4 — narrow UPDATE policy on `consent_grants` that enables
-- LGPD Art. 18 revocation while preserving the spirit of the append-only
-- stance from Story 1.2.
--
-- Resolves Story 1.2 F37: the partial unique index
-- `consent_grants_active_unique` matches on (patient_id, consent_type,
-- version) WHERE revoked_at IS NULL. A "revocation = new row with
-- revoked_at set" insert would still leave the original active row
-- satisfying the partial index, blocking any future re-grant for the
-- same type+version. By UPDATEing `revoked_at` on the existing active
-- row instead, the row drops out of the partial index and a fresh
-- `consent.grant` for the same type/version can succeed.
--
-- The policy is deliberately narrow:
--
--   - `USING` filter ensures only the row's owner can be targeted AND
--     the row must currently be active (`revoked_at IS NULL`) — patients
--     cannot un-revoke an already-revoked row or touch a foreign row.
--   - `WITH CHECK` ensures the post-update row still belongs to the
--     same patient AND that `revoked_at` is now set — patients cannot
--     reassign ownership or clear `revoked_at` back to NULL.
--   - A trigger (`consent_grants_revoke_only_revoked_at`) hard-rejects
--     UPDATEs to any column other than `revoked_at`. The trigger is
--     belt-and-suspenders against a future RLS policy widening: even
--     if `WITH CHECK` were relaxed, the trigger blocks tampering with
--     `version`, `consent_type`, `granted_at`, `metadata`, `patient_id`,
--     `id`, or `created_at`.
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

-- Review P28 — idempotent re-application. The trigger below already uses
-- DROP IF EXISTS; mirror that here so a CI replay / drift recovery doesn't
-- fail with "policy already exists".
DROP POLICY IF EXISTS "consent_grants_update_revoke_own" ON "consent_grants";

CREATE POLICY "consent_grants_update_revoke_own" ON "consent_grants"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND revoked_at IS NULL
  )
  WITH CHECK (
    -- Review P29 — bound `revoked_at` to a ±1 minute window around the
    -- DB clock so a patient connecting directly with their session
    -- claim cannot backdate or future-date the revocation. The trigger
    -- below enforces this too as a defense-in-depth seam, so even a
    -- future policy widening inherits the time constraint.
    patient_id::text = current_setting('app.current_patient_id', true)
    AND revoked_at IS NOT NULL
    AND revoked_at >= NOW() - interval '1 minute'
    AND revoked_at <= NOW() + interval '1 minute'
  );

CREATE OR REPLACE FUNCTION consent_grants_revoke_only_revoked_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.consent_type IS DISTINCT FROM OLD.consent_type
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'consent_grants: only revoked_at may be UPDATEd'
      USING ERRCODE = '42501';
  END IF;
  -- Review round-2 P32 — reject "un-revoke" transitions even if a
  -- future RLS policy widening lets the UPDATE through. The append-only
  -- intent of `consent_grants` (architecture.md L1487) is that
  -- revocation moves the row out of the "active" partial index; we
  -- never allow the row back to active state via an UPDATE.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'consent_grants: revoked_at cannot transition back to NULL'
      USING ERRCODE = '42501';
  END IF;
  -- Review P29 — bound `revoked_at` to a narrow window around the DB
  -- clock so the policy-only path (or a future direct-SQL caller) can't
  -- backdate / future-date the revocation. The RLS WITH CHECK above is
  -- the primary seam; this is the defense-in-depth seam that survives
  -- a policy widening.
  IF NEW.revoked_at IS NOT NULL
     AND (NEW.revoked_at < NOW() - interval '1 minute'
          OR NEW.revoked_at > NOW() + interval '1 minute') THEN
    RAISE EXCEPTION 'consent_grants: revoked_at must be set to approximately NOW()'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS consent_grants_revoke_only_revoked_at_trg
  ON "consent_grants";

CREATE TRIGGER consent_grants_revoke_only_revoked_at_trg
  BEFORE UPDATE ON "consent_grants"
  FOR EACH ROW
  EXECUTE FUNCTION consent_grants_revoke_only_revoked_at();

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_extraction_review_queue.sql
-- ----------------------------------------------------------------------------
-- custom_rls_extraction_review_queue.sql
-- Story 2.3 / 2.4 — RLS for the `extraction_review_queue` table.
--
-- Patient layer (Story 2.4):
--   - SELECT own `low_confidence` rows.
--   - UPDATE own `low_confidence` rows — limited to the three
--     resolution columns (`resolved_at`, `resolved_by_patient_id`,
--     `correction_metadata`). Column-level GRANT below enforces this
--     in addition to the policy (defense-in-depth).
--   - NO INSERT, NO DELETE at the patient layer — the worker writes,
--     nobody deletes.
--
-- `loinc_unresolved` rows remain INVISIBLE to patients (the policy
-- predicate filters them out). Story 8.1 will add the operator-role
-- SELECT policy against an anonymized view (architecture.md L29).
--
-- Service-role bypasses RLS — that's what the worker uses.
--
-- Apply: `psql -f packages/db/policies/custom_rls_extraction_review_queue.sql`.

ALTER TABLE "extraction_review_queue" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "extraction_review_queue_select_own_low_confidence"
  ON "extraction_review_queue";
CREATE POLICY "extraction_review_queue_select_own_low_confidence"
  ON "extraction_review_queue"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND reason = 'low_confidence'
  );

DROP POLICY IF EXISTS "extraction_review_queue_update_own_low_confidence"
  ON "extraction_review_queue";
CREATE POLICY "extraction_review_queue_update_own_low_confidence"
  ON "extraction_review_queue"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND reason = 'low_confidence'
  )
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND reason = 'low_confidence'
  );

-- Column-level GRANT: the `authenticated` role (patient-facing) can
-- only mutate the three resolution columns. Even if a future policy
-- broadened the row scope, an UPDATE that touches any other column
-- would be rejected at the GRANT layer.
--
-- P134 — also strip `anon` and `PUBLIC` grants. The default search-path
-- inheritance from prior migrations can grant a row's access to
-- `PUBLIC`; a hostile unauthenticated PostgREST request would otherwise
-- inherit table-level read where the policy's `current_setting()`
-- predicate is forgiving.
REVOKE ALL ON "extraction_review_queue" FROM PUBLIC;
REVOKE ALL ON "extraction_review_queue" FROM "anon";
REVOKE ALL ON "extraction_review_queue" FROM "authenticated";
GRANT SELECT ON "extraction_review_queue" TO "authenticated";
GRANT UPDATE (
  "resolved_at",
  "resolved_by_patient_id",
  "correction_metadata"
) ON "extraction_review_queue" TO "authenticated";

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_loinc_ref.sql
-- ----------------------------------------------------------------------------
-- custom_rls_loinc_ref.sql
-- Story 2.3 — RLS for the `loinc_ref` table.
--
-- This is PUBLIC reference data — no PHI. Anyone (including
-- unauthenticated `anon` role) can SELECT. No INSERT/UPDATE/DELETE
-- policy — the table is seed-only via `pnpm db:seed`.
--
-- Apply: `psql -f packages/db/policies/custom_rls_loinc_ref.sql`.

ALTER TABLE "loinc_ref" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loinc_ref_select_public" ON "loinc_ref";
CREATE POLICY "loinc_ref_select_public" ON "loinc_ref"
  FOR SELECT
  USING (true);

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_notification_preferences.sql
-- ----------------------------------------------------------------------------
-- custom_rls_notification_preferences.sql
-- Story 2.8 — RLS for the `notification_preferences` table.
--
-- Patient layer:
--   - SELECT own
--   - INSERT own (first-time toggle UPSERTs the row)
--   - UPDATE own (subsequent toggles)
--   - NO DELETE — a patient who wants to "reset" toggles re-UPSERTs
--     the default-true values.
--
-- Service-role bypasses RLS; the worker reads preferences at
-- dispatch time to decide whether to skip the Expo Push POST.
--
-- Apply: `psql -f packages/db/policies/custom_rls_notification_preferences.sql`.

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_preferences_select_own"
  ON "notification_preferences";
CREATE POLICY "notification_preferences_select_own"
  ON "notification_preferences"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "notification_preferences_insert_own"
  ON "notification_preferences";
CREATE POLICY "notification_preferences_insert_own"
  ON "notification_preferences"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "notification_preferences_update_own"
  ON "notification_preferences";
CREATE POLICY "notification_preferences_update_own"
  ON "notification_preferences"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  )
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- Defense-in-depth: revoke broad grants; only `authenticated` gets
-- the narrow surface the policies above enforce.
REVOKE ALL ON "notification_preferences" FROM PUBLIC;
REVOKE ALL ON "notification_preferences" FROM "anon";
GRANT SELECT, INSERT, UPDATE ON "notification_preferences" TO "authenticated";

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_observations.sql
-- ----------------------------------------------------------------------------
-- custom_rls_observations.sql
-- Story 2.3 — RLS for the `observations` table.
--
-- Patient layer: SELECT own only.
-- Writes (INSERT / UPDATE / DELETE): NONE at the patient layer.
--   - INSERTs come from the extraction worker (`services/extraction/`)
--     via service-role connection — service-role bypasses RLS.
--   - UPDATEs are not expected (append-only; correction means a new
--     row with `source = 'patient_corrected'`).
--   - DELETEs: Story 5.6 patient-deletion path (service-role).
--
-- Apply: `psql -f packages/db/policies/custom_rls_observations.sql`
-- (the team's convention; `drizzle-kit check` ignores `custom_` policies).

ALTER TABLE "observations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "observations_select_own" ON "observations";
CREATE POLICY "observations_select_own" ON "observations"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_post.sql
-- ----------------------------------------------------------------------------
-- custom_rls_post.sql
-- Placeholder: shows RLS pattern. Real patient-data policies added per story.
--
-- WARNING: Do NOT apply this file to the DB without also adding the anon SELECT policy below.
-- The post_select_own policy blocks all reads where app.current_patient_id is not set,
-- which breaks publicProcedure endpoints (post.all, post.byId) that run without a SET LOCAL wrapper.
-- See deferred item D2 from Story 0.4 review.

ALTER TABLE "post" ENABLE ROW LEVEL SECURITY;

-- Allows authenticated patients to read their own posts via protectedProcedure (SET LOCAL).
DROP POLICY IF EXISTS "post_select_own" ON "post";
CREATE POLICY "post_select_own" ON "post"
  FOR SELECT
  USING (
    current_setting('app.current_patient_id', true) IS NOT NULL
  );

-- Allows anon/public reads so publicProcedure endpoints remain functional.
-- Remove this policy once post.all and post.byId are gated behind protectedProcedure.
DROP POLICY IF EXISTS "post_select_anon" ON "post";
CREATE POLICY "post_select_anon" ON "post"
  FOR SELECT
  TO anon
  USING (true);

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_push_tokens.sql
-- ----------------------------------------------------------------------------
-- custom_rls_push_tokens.sql
-- Story 2.5 — RLS for the `push_tokens` table.
--
-- Patient layer:
--   - SELECT own
--   - INSERT own (the registration mutation writes via the patient
--     connection; the WITH CHECK guards the patient_id field)
--   - UPDATE own (re-register updates expo_token + last_seen_at +
--     clears revoked_at)
--   - NO DELETE — use the `revoked_at` soft-delete column instead.
--
-- Service-role bypasses RLS; the worker reads tokens via service-role
-- to dispatch notifications.
--
-- Apply: `psql -f packages/db/policies/custom_rls_push_tokens.sql`.

ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_select_own" ON "push_tokens";
CREATE POLICY "push_tokens_select_own" ON "push_tokens"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "push_tokens_insert_own" ON "push_tokens";
CREATE POLICY "push_tokens_insert_own" ON "push_tokens"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "push_tokens_update_own" ON "push_tokens";
CREATE POLICY "push_tokens_update_own" ON "push_tokens"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  )
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- Defense-in-depth: revoke broad grants; only `authenticated` gets the
-- narrow surface the policies above enforce.
REVOKE ALL ON "push_tokens" FROM PUBLIC;
REVOKE ALL ON "push_tokens" FROM "anon";
GRANT SELECT, INSERT, UPDATE ON "push_tokens" TO "authenticated";

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_uploads.sql
-- ----------------------------------------------------------------------------
-- custom_rls_uploads.sql
-- Story 1.5 — RLS for the `uploads` table.
--
-- Token-principal model (AR5): access is granted only to the patient
-- whose id matches the SET LOCAL claim `app.current_patient_id`, set by
-- `protectedProcedure` in `packages/api/src/trpc.ts`.
--
-- Append-only at the patient layer: SELECT own + INSERT own only. Epic 2
-- (Story 2.3) will add a narrow service-role UPDATE policy for the
-- state-machine transitions performed by `services/extraction`. There
-- is no DELETE policy — patient-initiated deletion is the Story 5.6
-- service-role path.
--
-- The `custom_` prefix keeps `drizzle-kit check` from dropping these
-- policies on schema sync.

ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uploads_select_own" ON "uploads";
CREATE POLICY "uploads_select_own" ON "uploads"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "uploads_insert_own" ON "uploads";
CREATE POLICY "uploads_insert_own" ON "uploads"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE policy: a state-machine UPDATE happens only from the
-- extraction worker, which connects with the service role and bypasses
-- RLS. Patient UPDATEs are denied entirely at the policy layer.
--
-- No DELETE policy: patient-initiated deletion arrives with Story 5.6
-- and is a service-role-only operation.

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_uploads_service_update.sql
-- ----------------------------------------------------------------------------
-- custom_rls_uploads_service_update.sql
-- Story 2.3 — unblocks the extraction worker's state-machine UPDATEs.
--
-- Story 1.5 shipped `uploads` with SELECT own + INSERT own only — no
-- UPDATE policy. Story 2.1 added the `applyUploadTransition` helper
-- but left the policy gap documented. Story 2.3's worker is the first
-- real caller and needs to flip `uploads.status` from `queued` →
-- `processing` → `complete | pending_review | failed`.
--
-- The worker runs under service-role (direct Postgres connection,
-- no `app.current_patient_id` set). Service-role bypasses RLS by
-- default in Supabase, so technically no policy is required to make
-- the UPDATE land. However, defenses-in-depth: this policy exists
-- so if the bypass is ever tightened (Story 0.4-style hardening pass
-- with FORCE ROW LEVEL SECURITY) the worker's UPDATE still works.
--
-- The policy is narrow: only allows UPDATE on the columns the
-- state-machine touches. Story 5.6 (patient-initiated deletion) and
-- any other future service-role write paths will need their own
-- narrowed policies; do not widen this one.
--
-- Apply: `psql -f packages/db/policies/custom_rls_uploads_service_update.sql`.

DROP POLICY IF EXISTS "uploads_service_role_update" ON "uploads";
CREATE POLICY "uploads_service_role_update" ON "uploads"
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_rls_users.sql
-- ----------------------------------------------------------------------------
-- custom_rls_users.sql
-- RLS for the `users` table (Story 1.1). Token-principal model (AR5):
-- access is granted only to the patient whose id matches the SET LOCAL claim
-- app.current_patient_id, set by protectedProcedure.
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;

-- A patient may read only their own row.
DROP POLICY IF EXISTS "users_select_own" ON "users";
CREATE POLICY "users_select_own" ON "users"
  FOR SELECT
  USING (
    id::text = current_setting('app.current_patient_id', true)
  );

-- A patient may insert only their own row (id must equal their auth.uid()).
-- This is the registration insert performed by account.initializeProfile.
DROP POLICY IF EXISTS "users_insert_self" ON "users";
CREATE POLICY "users_insert_self" ON "users"
  FOR INSERT
  WITH CHECK (
    id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE or DELETE policy: profile mutation and account deletion are
-- introduced by later stories and are denied until then.

-- ----------------------------------------------------------------------------
-- packages/db/policies/custom_storage_lab_uploads_policy.sql
-- ----------------------------------------------------------------------------
-- custom_storage_lab_uploads_policy.sql
-- Story 1.5 — Supabase Storage bucket + RLS for `lab-uploads`.
--
-- Apply mechanism: run with `psql` against the `storage` schema as
-- superuser (or via the Supabase Dashboard SQL Editor). The team's
-- existing `custom_rls_*.sql` apply path targets the `public` schema;
-- this file targets `storage.*` and must be applied separately. Add to
-- the dev README + the post-deploy checklist.
--
-- Bucket convention: `lab-uploads` is a PRIVATE bucket. Access is
-- mediated entirely by signed URLs (`createSignedUploadUrl` /
-- `createSignedUrl`). No anonymous reads.
--
-- Path convention: `lab-uploads/<patient_id>/<idempotency_key>/<filename>`.
-- The patient-id prefix lets a single Storage RLS policy enforce
-- per-patient isolation: `(storage.foldername(name))[1] = auth.uid()::text`.
--
-- Out of scope this story: object lifecycle / retention rules
-- (LGPD Art. 16 retention; folded into Story 5.6 patient-initiated
-- deletion + Epic 5 ops surface).

INSERT INTO storage.buckets (id, name, public)
VALUES ('lab-uploads', 'lab-uploads', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "lab_uploads_insert_own"   ON storage.objects;
CREATE POLICY "lab_uploads_insert_own" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'lab-uploads'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "lab_uploads_select_own"   ON storage.objects;
CREATE POLICY "lab_uploads_select_own" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'lab-uploads'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- No UPDATE / DELETE policies for the patient role. The extraction
-- worker (service role) bypasses RLS for object reads. Patient-initiated
-- deletion is Story 5.6.
