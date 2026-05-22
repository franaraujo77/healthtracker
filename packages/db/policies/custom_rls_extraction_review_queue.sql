-- custom_rls_extraction_review_queue.sql
-- Story 2.3 — RLS for the `extraction_review_queue` table.
--
-- Operator-only surface — no patient / doctor SELECT policy this
-- story. Story 8.1 will add the proper operator-role SELECT policy
-- against an anonymized view (architecture.md L29 — operator views
-- are anonymized at the query level, never raw row access).
--
-- With RLS enabled and ZERO policies, only the service-role bypass
-- can read/write — exactly what the extraction worker needs.
--
-- Apply: `psql -f packages/db/policies/custom_rls_extraction_review_queue.sql`.

ALTER TABLE "extraction_review_queue" ENABLE ROW LEVEL SECURITY;
