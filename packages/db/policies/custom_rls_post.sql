-- custom_rls_post.sql
-- Placeholder: shows RLS pattern. Real patient-data policies added per story.
--
-- WARNING: Do NOT apply this file to the DB without also adding the anon SELECT policy below.
-- The post_select_own policy blocks all reads where app.current_patient_id is not set,
-- which breaks publicProcedure endpoints (post.all, post.byId) that run without a SET LOCAL wrapper.
-- See deferred item D2 from Story 0.4 review.

ALTER TABLE "post" ENABLE ROW LEVEL SECURITY;

-- Allows authenticated patients to read their own posts via protectedProcedure (SET LOCAL).
CREATE POLICY "post_select_own" ON "post"
  FOR SELECT
  USING (
    current_setting('app.current_patient_id', true) IS NOT NULL
  );

-- Allows anon/public reads so publicProcedure endpoints remain functional.
-- Remove this policy once post.all and post.byId are gated behind protectedProcedure.
CREATE POLICY "post_select_anon" ON "post"
  FOR SELECT
  TO anon
  USING (true);
