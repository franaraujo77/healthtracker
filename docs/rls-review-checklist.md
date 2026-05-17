# RLS Code Review Checklist

Use this checklist when reviewing any PR that touches tRPC procedures, Drizzle queries, Supabase RLS policies, or database migrations.

## tRPC Procedure Context

- [ ] `doctorProcedure` (and any role-specific procedure) does NOT spread `...ctx` into the next context object — spreading leaks the raw `Headers` object; reconstruct only the fields needed (`{ db, session, user, ... }`)
- [ ] No procedure passes `ctx.db` to a helper that runs outside the RLS transaction wrapper; helpers that query the DB must receive `tx` (the transaction client), not `ctx.db`
- [ ] `publicProcedure` endpoints are individually reviewed before a restrictive RLS policy is applied to the underlying table — public endpoints bypass the `SET LOCAL` transaction wrapper and will fail under row-level restrictions

## SET LOCAL / Transaction Scoping

- [ ] `SET LOCAL role` and `SET LOCAL request.jwt.claims` run inside the same transaction as all downstream Drizzle queries — confirm the transaction boundary wraps both the SET and the query
- [ ] Callers pass `tx` (transaction) not `db` into helpers so SET LOCAL scoping is preserved
- [ ] No `await db.execute(sql`SET LOCAL ...`)` call exists outside an explicit `db.transaction(async (tx) => { ... })` block

## Service Client

- [ ] `serviceClient` (admin Supabase client) construction throws if `SUPABASE_SERVICE_ROLE_KEY` is an empty string — it must not silently fall back to an unauthenticated client
- [ ] `serviceClient` is never imported in client-side code or returned to the browser

## RLS Policy Tests

- [ ] Every new table has test coverage for all 6 identity types:
  - `correctPatient` — owns the row, expects access
  - `wrongPatient` — different patient, expects denial
  - `doctorWithAccess` — granted access via consent, expects access
  - `doctorWithoutAccess` — no consent record, expects denial
  - `expiredToken` — JWT past `exp`, expects denial
  - `revokedToken` — token invalidated server-side, expects denial
- [ ] No test case is left as `it.todo(...)` — stubs must be implemented before merge
- [ ] Adversarial RLS tests use `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` (local Supabase) — tests must never run against the remote database

## Database Migrations

- [ ] Every `DROP TABLE`, `DROP COLUMN`, or `DROP POLICY` statement is accompanied by the comment `-- healthtracker-migration-safe: drop` on the same line; grep the diff for bare `DROP` without this comment
- [ ] Migration is idempotent (safe to re-run) or guarded with `IF EXISTS` / `IF NOT EXISTS`
- [ ] New RLS policies are tested with `EXPLAIN (ANALYZE, BUFFERS)` on realistic data volumes before merge

## General

- [ ] `pnpm db:push` is used for schema changes — no raw `drizzle-kit generate` + `migrate` workflow
- [ ] Connection string used in tests and local dev is session-mode pooler or direct connection — not transaction-mode PgBouncer (incompatible with `SET LOCAL`)
- [ ] No query bypasses RLS by switching to the service role unnecessarily — service role use requires explicit justification in the PR description
