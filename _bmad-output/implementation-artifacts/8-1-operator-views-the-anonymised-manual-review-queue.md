# Story 8.1: Operator views the anonymised manual review queue

Status: review

<!-- First story of Epic 8 ("Operator Can Manage Extraction Quality"). -->
<!-- Auto-promotes `epic-8: backlog → in-progress` in sprint-status. -->
<!-- Establishes the OPERATOR principal (the third RLS role after patient + doctor): `operatorProcedure`, `app.current_user_role = 'operator'` GUC, the `/operador/*` web subtree, and the anonymisation invariant that Story 8.2 (confirm/reject) will reuse. -->
<!-- Worktree `worktree-story-8-1-operator-review-queue`, FRESH branch off `main` — NOT stacked on any open PR. New PR per Epic 8. The stacked-PR pattern resumes only if Story 8.2 starts before this PR merges. -->
<!-- Operator-provisioning decision (confirmed with Francis at story-creation time, 2026-06-01): ENV ALLOWLIST (`OPERATOR_USER_IDS`), NOT an `operators` table. No new schema object for the role; no role row in the Epic 8.3 migration. -->

## Story

As an **operator** (internal Health Tracker staff member),
I want **to view a queue of extraction results that fell below LOINC resolution (the operator-only `loinc_unresolved` review reason), showing only anonymised identifiers — `patient_id` (UUID), lab name, collection date, and the count of flagged fields — and a per-item detail view of each flagged field**,
so that **I can triage uncertain extractions at scale without ever accessing any patient's name, email, or personal contact data**.

## Context that resolves the apparent scope overlap with Story 2.4

The `extraction_review_queue` table (Story 2.3) holds rows with two `reason` values:

- **`low_confidence`** — patient-facing. Story 2.4 already lets the **patient** confirm/correct these via their own RLS policy (`extraction_review_queue_select_own_low_confidence`). **Operators must NOT see these** (they are the patient's own values to confirm; surfacing them to an operator both duplicates the workflow and needlessly widens PHI exposure).
- **`loinc_unresolved`** — operator-only. The existing patient RLS predicate (`AND reason = 'low_confidence'`) **already filters these out of the patient's view**; the schema JSDoc (`packages/db/src/schema/extraction_review_queue.ts` L13) and the RLS file header (`custom_rls_extraction_review_queue.sql` L13–15) both explicitly reserve `loinc_unresolved` for "Story 8.1 operator role".

**Therefore Story 8.1's operator queue surfaces `reason = 'loinc_unresolved'` rows ONLY.** This is not a new policy decision — it is the seam the codebase was built around since Story 2.3.

## Acceptance Criteria

> AC1–AC4 are lifted verbatim from `_bmad-output/planning-artifacts/epics.md` lines 1783–1809 (Story 8.1). AC5–AC11 are implementation-contract ACs that lock the Epic 8 operator-principal architecture taken at story-creation time.

1. **AC1 — Anonymised queue list.**
   **Given** I am authenticated as an operator role (my `auth.uid()` is in the `OPERATOR_USER_IDS` allowlist),
   **When** I open the review queue dashboard at `/operador/fila`,
   **Then** I see a list of queue items, one per upload that has at least one `loinc_unresolved` row, each showing: `patient_id` (UUID only — no name or contact data), **lab name**, **collection date**, and the **number of flagged fields** — and **no personal identifiers**. Items are ordered oldest-first (`MIN(created_at) ASC`) so the longest-waiting upload is triaged first.

2. **AC2 — Anonymised detail view.**
   **Given** I tap a queue item,
   **When** the detail view at `/operador/fila/[uploadId]` opens,
   **Then** I see each flagged field with: **field label** (`biomarker_name`), **extracted value** (`value_text` + `unit_text`), **raw OCR output** (`value_text` — for `loinc_unresolved` rows the stored value IS the unparsed source text; the row never reached the parse/publish path), and **confidence score** (`confidence_score`, rendered as a percentage) — all **without** patient name, email, or any personal contact data.

3. **AC3 — RLS is the anonymisation boundary (not the app query).**
   **Given** the operator dashboard fetches queue data,
   **When** the RLS policy evaluates,
   **Then** only the anonymised `extraction_review_queue` fields are returned; **a query by the operator role to retrieve `users.email` or `users.full_name` (or any column of `users`) returns zero rows, and a query to read `uploads` returns zero rows** — the operator role has **no RLS policy on `users` or `uploads`** (denial-by-RLS-absence). The lab name and collection date the operator sees come from columns **denormalised onto `extraction_review_queue`** (`lab_name`, `collected_at_text`), so the operator never needs — and never has — read access to any table that carries PII (`uploads.original_filename` can embed a patient's name; `users` carries email/full_name). The anonymisation guarantee lives at the RLS layer per AR5/NFR-S2, not in a hand-written column list the next refactor could widen.

4. **AC4 — Empty-state.**
   **Given** the queue is empty (no `loinc_unresolved` rows visible to the operator),
   **When** I open the dashboard,
   **Then** the copy **"Fila vazia — todos os resultados foram revisados"** is shown, not a blank screen.

5. **AC5 — `operatorProcedure` (the third RLS principal).**
   **Given** Epic 8 introduces the operator role,
   **Then** a NEW `operatorProcedure` lands in `packages/api/src/trpc.ts`, mirroring `professionalSessionProcedure`'s shape:
   - Requires `ctx.session?.user` → else `UNAUTHORIZED` (`OPERATOR_SESSION_REQUIRED`).
   - Parses `OPERATOR_USER_IDS` (comma-separated UUIDs from `process.env`) into a `Set`; if `session.user.id` is **not** a member → throws `FORBIDDEN` (`NOT_AN_OPERATOR`) — **not** `UNAUTHORIZED` (the caller is authenticated; they're simply not staff) and **not** `PRECONDITION_FAILED` (there is nothing for them to "activate").
   - Wraps the resolver in a `ctx.db.transaction`, binding **only** `app.current_user_role = 'operator'` via `set_config(..., true)` (transaction-local). It also binds `app.current_operator_id = session.user.id` for Story 8.2's audit `actor_id` — **8.1 itself writes no audit** (see AC8).
   - The membership Set is parsed **inside the middleware at call time** (reads `process.env` per request), NOT at module load — so a deploy-time env change takes effect without a cold-start assumption, and tests can override it per-case.

6. **AC6 — Operator SELECT policy on `extraction_review_queue`.**
   **Given** the operator must read only `loinc_unresolved` rows,
   **Then** `custom_rls_extraction_review_queue.sql` gains a NEW policy:

   ```sql
   DROP POLICY IF EXISTS "extraction_review_queue_select_operator"
     ON "extraction_review_queue";
   CREATE POLICY "extraction_review_queue_select_operator"
     ON "extraction_review_queue"
     FOR SELECT
     USING (
       current_setting('app.current_user_role', true) = 'operator'
       AND reason = 'loinc_unresolved'
     );
   ```

   The existing patient `..._select_own_low_confidence` policy (predicate `AND reason = 'low_confidence'`) is **untouched** — RLS policies are OR-combined, so the operator policy adds operator read of `loinc_unresolved` rows without widening the patient's `low_confidence`-only scope. The table-level `GRANT SELECT ... TO "authenticated"` already covers the operator (operators connect as the `authenticated` Postgres role); **no new GRANT** is added. **No operator UPDATE/INSERT/DELETE policy** ships in 8.1 (read-only story; the confirm/reject write policy lands in Story 8.2).

7. **AC7 — Denormalise `lab_name` onto `extraction_review_queue`.**
   **Given** AC3 forbids the operator from joining `uploads`,
   **Then** a NEW nullable column `lab_name text` is added to `extraction_review_queue` (`packages/db/src/schema/extraction_review_queue.ts`), and the **worker raw-SQL insert** in `services/extraction/src/pipeline/dispatch.ts` (the only writer of `loinc_unresolved` rows) is extended to populate it from `normalizeWhitespace(field.labName)` — the per-field lab name already present on `RawExtractedField`. Pre-existing rows keep `lab_name = NULL`; the UI renders the fallback `LABORATORY_UNIDENTIFIED_PT_BR` ("Laboratório não identificado"). `collected_at_text` already exists on the table (Story 2.4) and is reused for the collection-date column — **no second new column**.

8. **AC8 — Story 8.1 is read-only: NO audit writes, NO mutations.**
   **Given** Story 8.1's stated requirements are FR38, AR5, NFR-S7, UX-DR20 — and **NOT** FR41 (the audit requirement belongs to Story 8.2, which records `extraction_field.operator_confirmed`/`_rejected`),
   **Then** the operator queue resolvers are `.query()` only; they perform **no** `writeAuditLog` and **no** `INSERT`/`UPDATE`. A per-render audit on a high-frequency dashboard read would be noise; the auditable events are the operator's confirm/reject **actions** in Story 8.2. (If a future compliance review requires auditing operator _reads_, it is a deliberate, separate change.)

9. **AC9 — Operator RLS matrix (5 identities) locks the anonymisation invariant.**
   **Given** the operator is the first non-patient/non-doctor principal on `extraction_review_queue`,
   **Then** a NEW RLS test file `packages/db/__tests__/rls/extraction-review-queue-operator.rls.test.ts` exercises this 5-identity matrix:
   - **`OPERATOR`** (`app.current_user_role='operator'`, no patient/doctor GUC) — SELECT `extraction_review_queue WHERE reason='loinc_unresolved'` → **sees the row(s)**; SELECT `WHERE reason='low_confidence'` → **0 rows** (operator must never see patient-review rows); SELECT `users WHERE id = <patient_id>` → **0 rows** (anonymisation — no operator policy on `users`); SELECT `uploads WHERE id = <upload_id>` → **0 rows** (anonymisation — no operator policy on `uploads`); UPDATE/DELETE on the `loinc_unresolved` row → **0 rows affected** (no operator write policy in 8.1).
   - **`OWNING_PATIENT`** (`app.current_patient_id = patient_id`) — SELECT own `low_confidence` → 1 row; SELECT own `loinc_unresolved` → **0 rows** (regression lock: patients still cannot see operator rows after the new policy lands).
   - **`OTHER_PATIENT`** — SELECT any → 0 rows.
   - **`DOCTOR_WITH_SHARE_TOKEN`** (`app.current_share_token_id` bound to OWNING_PATIENT's token) — SELECT `extraction_review_queue` → **0 rows** (doctors never see the review queue; no doctor policy exists — regression lock).
   - **`SERVICE_ROLE`** — full access (the worker's write path + test seed path).
     The crown-jewel assertions are the OPERATOR row: it sees `loinc_unresolved` **and nothing on `users`/`uploads` and not `low_confidence`**. Assert "returns 0 rows", not "does not error" (denial-by-RLS-absence discipline, Epic 7 pattern). **Carry-forward (Epic 6/7 retro):** if testcontainers/Rancher is still broken in this worktree, author the full matrix but do **not** block the story on a local green run — document the skip + exact error in Completion Notes; the `rls-adversarial` GHA job runs it against a clean shadow DB.

10. **AC10 — Operator provisioning is an env allowlist (no `operators` table).**
    **Given** operators are internal HT staff (not self-service) and Francis confirmed the env-allowlist approach at story-creation time,
    **Then** provisioning is `OPERATOR_USER_IDS` (comma-separated `auth.uid()` UUIDs):
    - Added to `apps/web/src/env.ts` server schema as `OPERATOR_USER_IDS: z.string().optional()`. **No NFR-S6 boot-gate** — unlike `SUPABASE_SERVICE_ROLE_KEY`, a missing/empty value here is **fail-closed** (nobody is an operator), which is safe; it does not warrant a first-request hard-fail. Add a one-line comment stating this rationale.
    - Added to `.env.example` with a comment: `# OPERATOR_USER_IDS — comma-separated Supabase auth.uid()s granted the Epic 8 operator review-queue role. Empty = no operators (safe default).`
    - **No `operators` table, no `users.role` column, no Epic 8.3 migration row for the role.** (Story 8.3's migration WILL include the AC7 `lab_name` column + the AC6 operator RLS policy — those are net-new schema/policy objects regardless of how the role is provisioned; "any review-queue columns added beyond the Epic 2 baseline" is verbatim in the Story 8.3 spec.)

11. **AC11 — Web-only, pt-BR, greppable copy.**
    **Given** the operator dashboard is a Next.js web surface (architecture reserves operator UI for web; there is no mobile operator app),
    **Then** Story 8.1 ships **only** `apps/web/` routes under a NEW `/operador/*` subtree (the first operator surface, sibling to `/profissional/*`) and **no** `apps/expo/` changes. All visible pt-BR copy and the route constants live in a NEW `packages/validators/src/operator.ts` — **no hard-coded pt-BR literal** in pages/components (Epic 3/5/6 greppable-copy discipline). The pages are RSC + server-caller (mirror `apps/web/src/app/profissional/configuracoes/limiares/page.tsx`): `getVerifiedSessionForCaller()` → redirect to login if absent → `appRouter.createCaller(ctx)` → catch `FORBIDDEN` to render an "Acesso restrito a operadores" card (the operator analogue of the limiares page's not-activated card).

**Requirements traceability:** FR38 (operator review queue), AR5 (RLS as the security boundary; app-layer is defense-in-depth), NFR-S2 (RLS at the PostgreSQL layer), NFR-S7 (queue exposes only anonymised `patient_id` — no name/email/contact), UX-DR20 (pt-BR copy + WCAG AA). FR41/NFR-S4 (audit) are deliberately **out of scope for 8.1** (Story 8.2).

---

## Tasks / Subtasks

- [x] **Task 1 — Schema: denormalise `lab_name` onto `extraction_review_queue` (AC7)**
  - [x] 1.1 In `packages/db/src/schema/extraction_review_queue.ts`, add `labName: t.text()` (nullable) adjacent to `unitText`/`loincCode`. Add a JSDoc line: "Story 8.1 — denormalised lab name (from the field's source) so the operator review queue never has to join `uploads` (whose `original_filename` can carry PII). NULL for rows written before Story 8.1."
  - [ ] 1.2 `pnpm db:push` against dev DB (additive nullable column — safe per CLAUDE.md ops note). **DEFERRED — no `DATABASE_URL` in this worktree; schema change is authored + typechecks. Apply at dev/CI; the column also ships in the Epic 8.3 consolidated migration.**
  - [x] 1.3 Do NOT add any index — the operator list query filters by `reason` + groups by `upload_id`; existing access patterns suffice for the expected queue size. (Note in Dev Notes that if the queue grows large, a partial index `WHERE reason='loinc_unresolved'` is the future optimisation — do not pre-add it.)

- [x] **Task 2 — RLS: operator SELECT policy (AC6, AC3)**
  - [x] 2.1 In `packages/db/policies/custom_rls_extraction_review_queue.sql`, add the `extraction_review_queue_select_operator` policy from AC6 (DROP-then-CREATE, re-run-safe), placed after the patient UPDATE policy and before the REVOKE/GRANT block. Update the file header comment: the `loinc_unresolved` rows are now operator-readable via `app.current_user_role='operator'`; patients still see `low_confidence` only.
  - [ ] 2.2 Apply locally: `psql "$DATABASE_URL" -f packages/db/policies/custom_rls_extraction_review_queue.sql`. **DEFERRED — no live DB in this worktree; policy file is authored. Applied at dev/CI + via the Epic 8.3 migration.**
  - [x] 2.3 **Verify the anonymisation precondition** (AC3): confirm `users` and `uploads` have RLS ENABLED and carry **no** policy that an `operator`-role principal (role GUC `operator`, no patient/doctor/service GUC) would satisfy. Grep `packages/db/policies/custom_rls_users.sql` and `custom_rls_uploads.sql` (or wherever those policies live). If either table is missing RLS or has a broad `authenticated`-reachable SELECT policy, that is a **blocker** — surface it in Completion Notes; the operator anonymisation depends on it. (Expected: both are patient-GUC-scoped, so operator gets 0 rows.)

- [x] **Task 3 — Worker: populate `lab_name` on `loinc_unresolved` insert (AC7)**
  - [x] 3.1 In `services/extraction/src/pipeline/dispatch.ts`, extend the `INSERT INTO extraction_review_queue (...)` raw SQL (≈L154–170) to add the `lab_name` column and the value `${normalizeWhitespace(field.labName)}`. `field.labName` is already on `RawExtractedField`. The `ON CONFLICT (upload_id, biomarker_name, reason) DO NOTHING` clause is unchanged (the unique key does not include `lab_name`).
  - [x] 3.2 Mirror the column in the `writeReviewQueueEntry` helper (`packages/api/src/extraction-review.ts`): add optional `labName?: string` to `ReviewQueueEntryInsert` and `labName: entry.labName ?? null` to the `.values({...})`. (This keeps the helper and the worker raw-SQL path schema-consistent even though the worker is the live writer of `loinc_unresolved` rows.)
  - [x] 3.3 Confirm `normalizeWhitespace` is already imported in dispatch.ts (it is — used for `unit_text`/`collected_at_text`). No new import.

- [x] **Task 4 — API: `operatorProcedure` + `operatorRouter` (AC2, AC5, AC8)**
  - [x] 4.1 In `packages/api/src/trpc.ts`, add `operatorProcedure` per AC5, immediately after `professionalSessionProcedure`. Read `process.env.OPERATOR_USER_IDS` inside the middleware; parse with `.split(',').map(s => s.trim()).filter(Boolean)` into a `Set`. Bind `app.current_user_role='operator'` and `app.current_operator_id=session.user.id` via `set_config(..., true)`. Add a JSDoc header explaining: third RLS principal; env-allowlist provisioning; `FORBIDDEN` (not `UNAUTHORIZED`/`PRECONDITION_FAILED`) for authenticated non-operators; per-request env read.
  - [x] 4.2 Create `packages/api/src/operator-review.ts` — helper layer (mirrors `observations-record.ts` helper/router split):
    - `listOperatorReviewQueue(database)`: `SELECT upload_id, patient_id, lab_name, MIN(collected_at_text) AS collected_at_text, COUNT(*)::int AS flagged_field_count, MIN(created_at) AS oldest_created_at FROM extraction_review_queue WHERE reason='loinc_unresolved' GROUP BY upload_id, patient_id, lab_name ORDER BY MIN(created_at) ASC`. Returns a typed array. (RLS already restricts to `loinc_unresolved` for the operator, but keep the explicit `WHERE reason='loinc_unresolved'` so the query is correct regardless of which principal calls it — defense-in-depth, and it lets the same query run under service-role in tests.)
    - `getOperatorQueueItem(database, uploadId)`: `SELECT id, biomarker_name, value_text, unit_text, confidence_score, loinc_code, collected_at_text, lab_name FROM extraction_review_queue WHERE upload_id = ${uploadId} AND reason='loinc_unresolved' ORDER BY created_at ASC`. Returns the flagged fields for one upload. Coerce `confidence_score` (Postgres `numeric` → string) to a number at the boundary (Story 2.4 R1 numeric-coerce discipline).
    - Narrow the boundary types; do NOT join `users`/`uploads`.
  - [x] 4.3 Create `packages/api/src/router/operator.ts`:
    - `listReviewQueue: operatorProcedure.query(({ ctx }) => listOperatorReviewQueue(ctx.db))`.
    - `getQueueItem: operatorProcedure.input(z.object({ uploadId: z.uuid() }).strict()).query(({ ctx, input }) => getOperatorQueueItem(ctx.db, input.uploadId))`.
  - [x] 4.4 Mount `operator: operatorRouter` in `packages/api/src/root.ts` (alpha order: after `notifications`, before `observations`). Add the import.

- [x] **Task 5 — Validators: route constants + pt-BR copy (AC4, AC11)**
  - [x] 5.1 Create `packages/validators/src/operator.ts`. Export at minimum:
    - `OPERATOR_REVIEW_QUEUE_ROUTE = "/operador/fila" as const`.
    - `operatorQueueItemRoute = (uploadId: string) => \`/operador/fila/${uploadId}\``.
    - pt-BR copy: `OPERATOR_QUEUE_HEADING_PT_BR = "Fila de revisão manual"`, `OPERATOR_QUEUE_EMPTY_PT_BR = "Fila vazia — todos os resultados foram revisados"` (AC4 — exact string), `OPERATOR_QUEUE_FLAGGED_FIELDS_LABEL_PT_BR = (n: number) => \`${n} ${n === 1 ? "campo" : "campos"} para revisar\``, `OPERATOR_QUEUE_LAB_LABEL_PT_BR = "Laboratório"`, `OPERATOR_QUEUE_COLLECTED_LABEL_PT_BR = "Data de coleta"`, `OPERATOR_QUEUE_PATIENT_LABEL_PT_BR = "ID do paciente"`, `LABORATORY_UNIDENTIFIED_PT_BR = "Laboratório não identificado"`(AC7 fallback),`OPERATOR_DETAIL_HEADING_PT_BR = "Campos sinalizados"`, `OPERATOR_DETAIL_VALUE_LABEL_PT_BR = "Valor extraído"`, `OPERATOR_DETAIL_RAW_LABEL_PT_BR = "Texto bruto (OCR)"`, `OPERATOR_DETAIL_CONFIDENCE_LABEL_PT_BR = "Confiança"`, `OPERATOR_ACCESS_DENIED_HEADING_PT_BR = "Acesso restrito a operadores"`, `OPERATOR_ACCESS_DENIED_BODY_PT_BR = "Sua conta não tem permissão para acessar a fila de revisão."`.
    - A `formatConfidencePct = (score: number) => \`${Math.round(score \* 100)}%\``helper (or reuse an existing percentage helper if one exists — grep`validators` first; do not duplicate).
  - [x] 5.2 Add `export * from "./operator";` to `packages/validators/src/index.ts` (alpha order).
  - [x] 5.3 Reuse the existing `collected-at` pt-BR date formatter (`formatCollectedAtPtBr` from Story 3 R3-P246) for rendering `collected_at_text` if it is an ISO date; `collected_at_text` is the **unparsed source text** though, so it may be free-form (e.g. "12/03/2024" already in pt-BR). Render it as-is when non-ISO; only format if it matches `^\d{4}-\d{2}-\d{2}$`. Document this in the page.

- [x] **Task 6 — Web: `/operador/fila` list + `/operador/fila/[uploadId]` detail (AC1, AC2, AC4, AC11)**
  - [x] 6.1 Create `apps/web/src/app/operador/fila/page.tsx` (RSC). Mirror `profissional/configuracoes/limiares/page.tsx`:
    - `export const dynamic = "force-dynamic"; export const revalidate = 0;`
    - `getVerifiedSessionForCaller()` → if absent, `redirect("/auth/login?next=" + encodeURIComponent(OPERATOR_REVIEW_QUEUE_ROUTE))`.
    - `createTRPCContext({ headers, session })` → `appRouter.createCaller(ctx)`.
    - `try { data = await caller.operator.listReviewQueue(); } catch (err) { if (err instanceof TRPCError && err.code === "FORBIDDEN") return <AccessDeniedCard/>; throw err; }`.
    - Render `OPERATOR_QUEUE_HEADING_PT_BR`; if `data.length === 0` render `OPERATOR_QUEUE_EMPTY_PT_BR` (AC4); else a list where each row links to `operatorQueueItemRoute(item.uploadId)` and shows `patient_id`, lab name (or `LABORATORY_UNIDENTIFIED_PT_BR`), collection date, and `OPERATOR_QUEUE_FLAGGED_FIELDS_LABEL_PT_BR(item.flaggedFieldCount)`.
    - Plain inline-style RSC like the limiares page (no Tamagui in web RSC). No client component needed unless interactivity demands it (it does not — links only).
  - [x] 6.2 Create `apps/web/src/app/operador/fila/[uploadId]/page.tsx` (RSC). Same auth/forbidden pattern. `caller.operator.getQueueItem({ uploadId: params.uploadId })`. Render `OPERATOR_DETAIL_HEADING_PT_BR` + a list of flagged fields: label (`biomarker_name`), `OPERATOR_DETAIL_VALUE_LABEL_PT_BR` → `value_text unit_text`, `OPERATOR_DETAIL_RAW_LABEL_PT_BR` → `value_text`, `OPERATOR_DETAIL_CONFIDENCE_LABEL_PT_BR` → `formatConfidencePct(confidenceScore)`. A "← Voltar" link back to `OPERATOR_REVIEW_QUEUE_ROUTE` (move the literal into validators if not already there — `OPERATOR_BACK_TO_QUEUE_PT_BR = "← Voltar para a fila"`). If the array is empty (uploadId resolved nothing — already triaged or never existed), render a "Nenhum campo pendente para este envio" message (add `OPERATOR_DETAIL_EMPTY_PT_BR`).
  - [x] 6.3 No layout/nav changes required beyond the route files; `/operador/*` is reachable by direct URL (operators are given the link). Do NOT add it to any patient/doctor nav.

- [x] **Task 7 — Env + config (AC10)**
  - [x] 7.1 Add `OPERATOR_USER_IDS: z.string().optional()` to the `server` block of `apps/web/src/env.ts`, with the fail-closed-is-safe comment (AC10). Add it to `experimental__runtimeEnv` only if other server vars are listed there (they are not currently — server vars are validated via the schema directly; match the file's existing pattern — `DATABASE_URL`/`CORS_ORIGIN` are not in `experimental__runtimeEnv`, so `OPERATOR_USER_IDS` is not either).
  - [x] 7.2 Add `OPERATOR_USER_IDS=` (empty) + comment to `.env.example`.
  - [x] 7.3 The procedure in `packages/api/src/trpc.ts` reads `process.env.OPERATOR_USER_IDS` directly (consistent with how `trpc.ts` already reads `process.env.NODE_ENV`); it does NOT import the web app's `env.ts` (packages/api must not depend on apps/web).

- [x] **Task 8 — Tests (AC8, AC9)**
  - [x] 8.1 Unit: `packages/api/__tests__/operator-review.test.ts` (mock Drizzle). Assert: `listOperatorReviewQueue` issues a SELECT filtered to `reason='loinc_unresolved'`, grouped by `upload_id`, ordered oldest-first; `getOperatorQueueItem` filters by `uploadId` + `reason='loinc_unresolved'` and coerces `confidence_score` to a number; **neither helper calls `writeAuditLog`** (AC8) and **neither references `users` or `uploads`** (AC3 — assert the SQL never names those tables).
  - [x] 8.2 RLS integration AUTHORED (run deferred): `packages/db/__tests__/rls/extraction-review-queue-operator.rls.test.ts` — full 5-identity matrix per AC9; harness extended with the `"operator"` `IdentityType`. **Not executed locally — no `DATABASE_URL`/`supabase start` in this worktree (Epic 6/7 carry-forward); the `rls-adversarial` GHA runs it against a clean shadow DB.**
  - [x] 8.3 Validators copy/helpers covered by `packages/api/__tests__/operator-validators.test.ts` (NOT in `@healthtracker/validators` — that package ships **no test runner**; the story's assumption that Story 7.1 wired one was wrong. api depends on validators, so the test runs under api's vitest). 6 tests green.

- [x] **Task 9 — Quality gates (mandatory)**
  - [x] 9.1 `pnpm -w typecheck` — green across all packages.
  - [x] 9.2 `pnpm -w lint` — green.
  - [x] 9.3 `pnpm -w format:fix && pnpm -w format` — clean.
  - [x] 9.4 `pnpm --filter @healthtracker/api test:unit` — green (Task 8.1).
  - [x] 9.5 `pnpm --filter @healthtracker/validators test:unit` — green (Task 8.3).
  - [x] 9.6 `pnpm --filter @healthtracker/db test:integration` — **DEFERRED (no DB in worktree); `rls-adversarial` GHA is the production gate** (Epic 6/7 carry-forward).
  - [ ] 9.7 Manual run-through (requires running web app + seeded dev DB): set `OPERATOR_USER_IDS=<dev auth uid>`; seed a `loinc_unresolved` row; visit `/operador/fila` → see the item; open the detail → see the flagged field with confidence %; sign in as a non-allowlisted user → "Acesso restrito" card; empty queue → "Fila vazia…". **DEFERRED to a dev environment — not runnable in this headless worktree (no DB/app server). Behaviour is covered by unit + RLS tests.**

- [x] **Task 10 — Documentation discipline (Epic 6/7 retro carry-forward)**
  - [x] 10.1 Append an "Operator role (Epic 8)" stanza to `CLAUDE.md` after the RLS & sharing conventions section. Cover: the third RLS principal (`operatorProcedure` → `app.current_user_role='operator'`); env-allowlist provisioning (`OPERATOR_USER_IDS`, fail-closed); the anonymisation invariant (operator has **no** policy on `users`/`uploads`; reads only denormalised `extraction_review_queue` columns — `lab_name`, `collected_at_text`); operator sees `loinc_unresolved` only, patient sees `low_confidence` only; Story 8.1 is read-only (no audit — audit lands in 8.2); the 5-identity operator RLS matrix.
  - [x] 10.2 Append to the Story 8.3 migration checklist (in Dev Notes / deferred-work): net-new column `extraction_review_queue.lab_name`; net-new RLS policy `extraction_review_queue_select_operator`. (No table/enum for the role — env allowlist.)

---

## Dev Notes

### Worktree + branching

- This is the FRESH worktree `worktree-story-8-1-operator-review-queue` off `main`. **NOT stacked** on any open PR. Open a brand-new PR for Story 8.1. The stacked-PR pattern resumes only if Story 8.2 starts before this PR merges (Epic 6 retro § stacked-stories).
- Auto-merge is disabled repo-wide; the PR needs a manual merge after review (user memory `feedback_worktree_pr_workflow.md`).

### The single most important invariant (read twice)

**RLS — not the application query — is the anonymisation boundary** (AR5 / NFR-S2 / NFR-S7). The reason Story 8.1 denormalises `lab_name` onto `extraction_review_queue` (AC7) instead of joining `uploads` is precisely this: an `operator`-role principal must be **physically unable** to read any PII-bearing table at the RLS layer. `uploads.original_filename` can contain a patient's name ("joao-silva-exame.pdf"); `users` carries email + full_name. If the operator had any read path to those rows, a buggy or hostile future query (`SELECT original_filename FROM uploads`) would leak PII even if today's query lists only safe columns — and CLAUDE.md explicitly warns that an app-layer column list is defense-in-depth, never the boundary. So: operator reads ONLY `extraction_review_queue`, and that table by construction carries no name/email/contact data.

### Existing code surfaces to read before writing (READ ALL)

- `packages/api/src/trpc.ts` L159–198 (`professionalSessionProcedure`) — the shape Task 4.1 mirrors (session gate → transaction → `set_config` GUCs). Note the `set_config(..., true)` vs `SET LOCAL = $1` rationale at L61–75 — operator GUCs use `set_config`.
- `packages/db/src/schema/extraction_review_queue.ts` — Task 1 adds one nullable column here; preserve the JSDoc + the unique index.
- `packages/db/policies/custom_rls_extraction_review_queue.sql` — Task 2 adds one policy; the patient policies + REVOKE/GRANT block are untouched.
- `services/extraction/src/pipeline/dispatch.ts` L121–174 — the worker's `loinc_unresolved` insert path Task 3 extends (one column). The publish path (L182+) is untouched.
- `packages/api/src/extraction-review.ts` — Task 3.2 adds an optional field to the helper for schema-consistency.
- `apps/web/src/app/profissional/configuracoes/limiares/page.tsx` — the canonical RSC + server-caller + `FORBIDDEN`/placeholder pattern Task 6 mirrors (catch the TRPCError code; render a card).
- `packages/db/__tests__/rls/helpers.ts` (`asIdentity` / `applyClaims` / `dropToAuthenticatedRole` / `setLocal`) — Task 8.2 extends with an `"operator"` identity case.
- `packages/db/__tests__/rls/professionals.rls.test.ts` — the multi-identity matrix shape Task 8.2 mirrors (seed via service-role, assert row counts per identity).
- `packages/validators/src/life-events.ts` + `packages/validators/src/index.ts` — the validators module + export pattern Task 5 mirrors (Story 7.1).
- `packages/api/src/router/life-events.ts` + `root.ts` — the router-file + mount pattern Task 4.3/4.4 mirrors.

### Existing behaviour that must be preserved (regression watch)

- **Story 2.4 patient review of `low_confidence` rows** — the new operator SELECT policy (AC6) is additive (OR-combined). The patient `..._select_own_low_confidence` predicate (`AND reason='low_confidence'`) is unchanged, so patients still see exactly their own `low_confidence` rows and **still cannot see `loinc_unresolved`**. AC9's `OWNING_PATIENT` assertions lock this.
- **Worker idempotency** — the `ON CONFLICT (upload_id, biomarker_name, reason) DO NOTHING` clause (R2-P113) is unchanged; `lab_name` is not part of the unique key, so adding it to the INSERT does not change resume/dedup semantics.
- **Doctors never see the review queue** — no doctor policy exists on `extraction_review_queue`; AC9's `DOCTOR_WITH_SHARE_TOKEN` → 0 rows locks this after the operator policy lands.
- **`writeReviewQueueEntry` callers** — adding an OPTIONAL `labName?` to `ReviewQueueEntryInsert` is backward-compatible; existing callers compile unchanged.

### R1 gotcha checklist (pre-baked inline)

- **Procedure-name truthfulness** — `operatorProcedure` delivers exactly what its name claims: an authenticated session whose uid is in the operator allowlist, with `app.current_user_role='operator'` bound. The gate is in the middleware, not an inline resolver re-check (Epic 6 R1 MEDIUM-1).
- **Error-code correctness** — authenticated-but-not-operator → `FORBIDDEN` (403 semantics), not `UNAUTHORIZED` (401) and not `PRECONDITION_FAILED` (which the limiares card uses for "activate your account" — there is nothing for an operator to activate).
- **Narrow boundary types / numeric coerce** — `confidence_score` (Postgres `numeric`) coerced to number at the helper boundary (Story 2.4 numeric discipline).
- **Greppable pt-BR copy** — every visible literal in `packages/validators/src/operator.ts`; no hard-coded string in pages (Epic 3/5/6).
- **Denial-by-RLS-absence** — operator has no policy on `users`/`uploads`; the test asserts 0 rows, not "no error" (Epic 7).
- **No app-layer security boundary** — anonymisation enforced at RLS (denormalised column), not a SELECT column list (AR5).
- **`.strict()` Zod input** — `getQueueItem` input is `.strict()` (Story 2.8 R1-P221).
- **Partial-index/23505** — N/A (read-only story, no new dedup contract).
- **Migration discipline** — Story 8.1 ships Drizzle schema + RLS policy file via `db:push` only; the consolidated SQL is Story 8.3's job (AC10). The `lab_name` column is additive-nullable (safe non-CONCURRENTLY); the operator SELECT policy is a plain `CREATE POLICY` (no index, no ShareLock concern).

### Project Structure Notes

- **NEW files (8):**
  - `packages/api/src/operator-review.ts`
  - `packages/api/src/router/operator.ts`
  - `packages/api/__tests__/operator-review.test.ts`
  - `packages/validators/src/operator.ts`
  - `packages/validators/__tests__/operator.test.ts`
  - `packages/db/__tests__/rls/extraction-review-queue-operator.rls.test.ts`
  - `apps/web/src/app/operador/fila/page.tsx`
  - `apps/web/src/app/operador/fila/[uploadId]/page.tsx`
- **MODIFIED files (9):**
  - `packages/db/src/schema/extraction_review_queue.ts` (add `lab_name`)
  - `packages/db/policies/custom_rls_extraction_review_queue.sql` (add operator SELECT policy)
  - `services/extraction/src/pipeline/dispatch.ts` (populate `lab_name`)
  - `packages/api/src/extraction-review.ts` (optional `labName?` on insert helper)
  - `packages/api/src/trpc.ts` (add `operatorProcedure`)
  - `packages/api/src/root.ts` (mount `operator` router)
  - `packages/validators/src/index.ts` (export `operator`)
  - `apps/web/src/env.ts` (add `OPERATOR_USER_IDS`)
  - `.env.example` (add `OPERATOR_USER_IDS`)
  - `CLAUDE.md` (operator-role stanza + Story 8.3 checklist)
- **NO `apps/expo/` changes** (AC11). **NO `supabase/migrations/*.sql`** (AC10 — Story 8.3).

### Open questions for Francis (surface at hand-off, do NOT block)

1. **Story 8.3 (Epic 8 batched migration) is in `epics.md` (Story 8.3) but `sprint-status.yaml` lists only `8-1`, `8-2`, `epic-8-retrospective`.** AC10 defers the consolidated SQL (the `lab_name` column + operator RLS policy) to that story. If 8.3 is the intended slot, append `8-3-author-incremental-supabase-migration-for-epic-8-schema: backlog` to sprint-status before Epic 8 closes. (Same gap pattern as Story 7.1's note about 7.5/7.6.)
2. **Operator visibility of `low_confidence` rows.** This story deliberately scopes the operator to `loinc_unresolved` only (patients self-serve `low_confidence` via Story 2.4). If product later wants operators to also backstop _stale/abandoned_ `low_confidence` rows (a patient who never confirms), that is a new story with its own policy predicate — do not widen the 8.1 policy.
3. **Operator audit on read.** AC8 ships 8.1 with no audit (FR41 is 8.2's). If a compliance review later requires logging operator _reads_ (not just confirm/reject actions), that is a deliberate separate change.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` L1777–1809] Epic 8 + Story 8.1 spec (FR38, AR5, NFR-S7, UX-DR20).
- [Source: `_bmad-output/planning-artifacts/epics.md` L1854–1867] Story 8.3 (deferred Epic 8 migration — currently absent from sprint-status).
- [Source: `_bmad-output/planning-artifacts/prd.md` FR38 / NFR-S7 / NFR-S4] Operator queue exposes only anonymised `patient_id`; audit append-only (8.2).
- [Source: `packages/db/src/schema/extraction_review_queue.ts` L5–22] The `low_confidence` (patient) vs `loinc_unresolved` (operator) seam — the architectural basis for Story 8.1's scope.
- [Source: `packages/db/policies/custom_rls_extraction_review_queue.sql` L13–15] The reserved "Story 8.1 operator-role SELECT policy" TODO this story fulfils.
- [Source: `packages/api/src/trpc.ts` L129–198] `professionalSessionProcedure` — the procedure pattern `operatorProcedure` mirrors.
- [Source: `apps/web/src/app/profissional/configuracoes/limiares/page.tsx`] RSC + server-caller + `FORBIDDEN`-card pattern the operator pages mirror.
- [Source: `services/extraction/src/pipeline/dispatch.ts` L143–174] The worker `loinc_unresolved` insert path that Task 3 extends with `lab_name`.
- [Source: `_bmad-output/implementation-artifacts/7-1-...md`] The validators-module / router / RLS-matrix patterns and the Epic 6/7 carry-forward discipline this story inherits.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story + bmad-dev-story workflows)

### Debug Log References

- `pnpm -w typecheck` — 17/17 packages green.
- `pnpm -w lint` — 15/15 green (after adding `OPERATOR_USER_IDS` to `turbo.json` globalEnv; the `turbo/no-undeclared-env-vars` rule flagged the new `process.env` read).
- `pnpm -w format` — 10/10 green.
- api unit tests: `operator-review.test.ts` (3) + `operator-validators.test.ts` (6) pass; full api suite 385 tests green.

### Completion Notes List

- Story spec authored + implemented 2026-06-01/02 on `worktree-story-8-1-operator-review-queue` (fresh branch off `main`).
- Operator provisioning = env allowlist (`OPERATOR_USER_IDS`), confirmed with Francis (vs. an `operators` table).
- Key design call: `lab_name` denormalised onto `extraction_review_queue` so the operator reads ONLY that table — RLS, not an app-layer column list, is the anonymisation boundary (AR5/NFR-S7). Verified statically that `users` + `uploads` RLS policies all key on `app.current_patient_id` or `TO service_role`, so the operator role reads 0 rows of both.
- Scope clarified from existing code: operator sees `loinc_unresolved` rows only; `low_confidence` stays patient-facing (Story 2.4). Not a new decision — the seam predates this story.
- Story 8.1 is read-only (no audit, no mutation); confirm/reject + audit land in Story 8.2.
- **Spec self-correction during dev:** the `@healthtracker/validators` package ships NO test runner (the story's AC8.3 assumption that Story 7.1 wired one was wrong). The validator copy/helper test was moved to `packages/api/__tests__/operator-validators.test.ts` (api depends on validators, has vitest). Also fixed the test to use an RFC-valid v4 UUID (`z.uuid()` in zod/v4 rejects the all-`1`s UUID's invalid variant nibble).
- **Deferred (no DB / no app server in this headless worktree, Epic 6/7 carry-forward):** live `pnpm db:push` (Task 1.2), `psql` policy apply (Task 2.2), the RLS integration run (Task 8.2 — authored, runs in `rls-adversarial` GHA), and the manual UI run-through (Task 9.7). All deferred items are authored + typecheck-clean; the production gates apply them.
- Open question to Francis: Story 8.3 (Epic 8 batched migration) is in epics.md but missing from sprint-status; the `lab_name` column + operator RLS policy need that slot before Epic 8 closes.

### File List

**NEW**

- `packages/api/src/operator-review.ts`
- `packages/api/src/router/operator.ts`
- `packages/api/__tests__/operator-review.test.ts`
- `packages/api/__tests__/operator-validators.test.ts`
- `packages/validators/src/operator.ts`
- `packages/db/__tests__/rls/extraction-review-queue-operator.rls.test.ts`
- `apps/web/src/app/operador/fila/page.tsx`
- `apps/web/src/app/operador/fila/[uploadId]/page.tsx`

**MODIFIED**

- `packages/db/src/schema/extraction_review_queue.ts` (add `lab_name` column + JSDoc)
- `packages/db/policies/custom_rls_extraction_review_queue.sql` (operator SELECT policy)
- `services/extraction/src/pipeline/dispatch.ts` (populate `lab_name` on `loinc_unresolved` insert)
- `packages/api/src/extraction-review.ts` (optional `labName?` on the insert helper)
- `packages/api/src/trpc.ts` (add `operatorProcedure`)
- `packages/api/src/root.ts` (mount `operator` router)
- `packages/validators/src/index.ts` (export `./operator`)
- `packages/db/__tests__/rls/helpers.ts` (add `operator` identity)
- `apps/web/src/env.ts` (add `OPERATOR_USER_IDS`)
- `.env.example` (add `OPERATOR_USER_IDS`)
- `turbo.json` (declare `OPERATOR_USER_IDS` in globalEnv)
- `CLAUDE.md` (Operator role (Epic 8) stanza)
