-- supabase_storage_exports.sql
-- Story 5.5 — Supabase Storage bucket for the `exports/` artifact area.
--
-- Apply mechanism: `psql -f` against the `storage` schema as superuser
-- (or Supabase Dashboard SQL Editor) in dev. Prod folds this into the
-- Story 5.7 batched migration. The integration testcontainer setup
-- SKIPS `storage.*` policies — the bare postgres:16-alpine container
-- has no `storage` schema (Supabase-managed). Tests that need bucket
-- assertions belong in the `test:rls` suite which runs against
-- `supabase start`.
--
-- Bucket convention: `exports` is a PRIVATE bucket. Access is
-- mediated entirely by signed URLs (`createSignedUrl`) issued by the
-- `getExport` tRPC query. No anonymous reads. No public CDN.
--
-- Path convention: `exports/<patient_id>/<export_id>.<format>`. The
-- worker writes via the service-role client (RLS bypass); the
-- patient never writes directly. NO patient SELECT/INSERT/UPDATE/
-- DELETE policies — service-role-only is the entire surface area.
--
-- Out of scope this story: object lifecycle / retention. The schema
-- carries `exports.expires_at = now() + 24h` so a future cleanup job
-- (Story 5.x polish OR Supabase Storage lifecycle rule) can remove
-- the storage objects past that deadline. The audit `exports` rows
-- are preserved (audit trail integrity).

INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;
