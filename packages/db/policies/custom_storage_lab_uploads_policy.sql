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
