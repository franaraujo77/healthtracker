-- custom_rls_post.sql
-- Placeholder: shows RLS pattern. Real patient-data policies added per story.
ALTER TABLE "post" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_select_own" ON "post"
  FOR SELECT
  USING (
    current_setting('app.current_patient_id', true) IS NOT NULL
  );
