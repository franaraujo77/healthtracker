# Story 5.6: Patient permanently deletes their account and all data

Status: ready-for-dev

> **Stacked on Stories 5.1 + 5.2 + 5.3 + 5.4 + 5.5 / PR #56.** Final patient-side story of Epic 5. LGPD Art. 18 right-to-erasure surface. Async pg-boss job + Supabase Auth admin API + audit-log pseudonymization (AR20 ADR). Adds `account_deletion_requests` table + RLS, `accountRouter.requestDeletion` + `getDeletionStatus` procedures, a new `account.delete.generate` pg-boss queue, a new `services/llm` consumer (despite the name — `services/llm` is now the generic durable worker pool; the consumer does NO LLM call), and a Configurações > Conta > Excluir conta screen with EXCLUIR magic-word + 30s visible cooldown.
>
> **Out of scope (per user direction):** Production migration still deferred to Story 5.7 (Epic 5 baseline). No new Supabase Storage bucket migration files.
>
> **ADR resolutions locked in this story (user-confirmed):**
>
> 1. **Async pg-boss + immediate "marked for deletion" UX.** `requestDeletion` enqueues the job, INSERTs a `account_deletion_requests` row with `status='queued'`, returns `{requestId}` and signs the patient out. Logout happens client-side immediately (no waiting on the worker). Worker pseudonymizes audit_log, removes Storage objects, runs cascade-delete on public tables, then deletes the Supabase Auth user. **No bytes / synchronous round-trip on the tRPC mutation.**
> 2. **SHA-256 pseudonymization with `ACCOUNT_DELETION_SALT`.** `actor_id` + `resource_id` UUIDs in `audit_log` rows owned by the deleted patient are replaced with `'pseudonymized-' || encode(sha256(patient_id::text || salt), 'hex')` (a deterministic, opaque, 64-character-hex-prefixed string). New env var `ACCOUNT_DELETION_SALT` (64-byte base64). Salt rotation invalidates linkability (acceptable trade-off; documented). Metadata JSONB scrubbed via regex for stray `patient_id` references.
> 3. **EXCLUIR magic-word + 30s visible cooldown.** Spec AC1 verbatim "type EXCLUIR to confirm" + Story 5.4's deferred-server-write pattern: after the final confirm tap, a 30s visible countdown shows "Excluindo em N segundos… Cancelar." If `Cancelar` is tapped, the mutation never fires (no DB row, no auth deletion). Mirrors Story 5.4 but with a longer window because the stakes are higher and irreversible.

## Story

**As a** patient,
**I want** to permanently delete my account and all associated health data,
**so that** I can exercise my LGPD Art. 18 right to erasure.

## Acceptance Criteria

1. **AC1 — Configurações > Conta > Excluir conta screen + EXCLUIR confirmation + 30s cooldown.** Given the patient navigates to `apps/expo/src/app/configuracoes/conta/excluir.tsx` (and web equivalent `apps/web/src/app/configuracoes/conta/excluir/page.tsx`), when the screen loads, then the patient sees:
   - A header: `"Excluir conta"` + sub-header `"Esta ação é irreversível. Todos os seus dados serão permanentemente apagados."` (constants `DELETE_ACCOUNT_HEADER_PT_BR`, `DELETE_ACCOUNT_IRREVERSIBLE_PT_BR`).
   - A summary card listing what will be deleted: observations, uploads, BIA entries, consent records, share tokens, exports, audit log (pseudonymized — see AC4 nuance), and the Supabase Auth account. Constant `DELETE_ACCOUNT_SUMMARY_LINES_PT_BR` (array of strings).
   - A text input field with placeholder `"Digite EXCLUIR para confirmar"`. The "Continuar" button is disabled until `input.trim().toUpperCase() === "EXCLUIR"` (case-insensitive on input; constant `DELETE_ACCOUNT_CONFIRM_WORD = "EXCLUIR"`).
   - Tier-2 "Continuar" button (UX-DR13 — destructive actions never Tier-1; muted `$accessLogRevoked` neutral, NOT red, mirrors `RevokeConfirmDialog` from Story 5.4).
   - On "Continuar" tap: the screen transitions to a 30s cooldown state. The card replaces inputs with `DELETE_ACCOUNT_COUNTDOWN_PT_BR_FN(secondsRemaining) = "Excluindo em ${N} segundos… Toque em Cancelar para abortar."`. A linear progress bar drains over the 30s (mirrors Story 5.4 `UndoToast` countdown but inline, not toast-anchored). A Tier-2 `"Cancelar"` button is the primary affordance.
   - On `Cancelar` tap during cooldown: clear the timer, reset to the input state, do NOT fire any mutation. Surface a non-blocking toast `DELETE_ACCOUNT_CANCELLED_TOAST_PT_BR = "Exclusão cancelada."` Story 5.4 R1 pattern (no `:undone:undone` loop — toast has `undoLabel={null}`).
   - On 30s timer expiry: call `accountRouter.requestDeletion.useMutation()`. On `onSuccess` → client immediately signs out (`supabase.auth.signOut()`) and navigates to `/auth/login`. On `onError` → surface `DELETE_ACCOUNT_FAILED_PT_BR` toast + reset to input state.
   - a11y: countdown announces every 5s via `accessibilityLiveRegion="polite"` (Expo) / `aria-live="polite"` (web). Cancelar button has `accessibilityLabel="Cancelar exclusão da conta"`.

2. **AC2 — `accountRouter.requestDeletion` mutation.** New `protectedProcedure.mutation`:
   - Input: `z.object({})` (empty — the patient identity is from `ctx.session.user.id`).
   - Output: `z.object({ requestId: z.string().uuid() })`.
   - Inside `ctx.db.transaction(async (tx) => ...)`:
     - INSERT into `account_deletion_requests` row with `patient_id = ctx.session.user.id`, `status='queued'`, `requested_at=now()` RETURNING id. Partial unique index `account_deletion_requests_active_uq ON (patient_id) WHERE status IN ('queued','processing')` enforces single-in-flight (mirrors Story 5.5 dedup pattern). On 23505 conflict, narrow-catch and SELECT the existing in-flight row to return its `requestId` (idempotent — same shape as Story 5.5 R1).
     - Outbox-enqueue pg-boss job `account.delete.generate` via raw INSERT into `pgboss.job` inside the tx (Story 5.2 pattern). Singleton key `account.delete.${patientId}` (per-patient is correct here — only one pending deletion per patient).
     - `writeAuditLog(tx, { actorId: patientId, actorType: 'patient', event: 'account.deletion_requested', resourceId: requestId, resourceType: 'account_deletion_request', metadata: { requestedAt: now-iso } })`. Constant `ACCOUNT_AUDIT_DELETION_REQUESTED = "account.deletion_requested"` in `packages/validators`.
     - Return `{ requestId }`.
   - **NO premium gate** (LGPD Art. 18 — same exemption as Story 5.5 exports).

3. **AC3 — Cascade-delete from public tables (worker side).** The consumer at `services/llm/src/consumers/generate-account-deletion.ts` executes deletion in this order within `deps.sql.begin(async (tx) => ...)`:
   1. **Pseudonymize audit_log FIRST** (AR20 — append-only invariant + LGPD erasure of identifiable links). UPDATE `audit_log` rows where `actor_id = $patient_id` OR (`resource_type` matches a patient-scoped type AND the resource cascade-removes below): set `actor_id = pseudonymizePatientId(patient_id)`. ALSO scrub `metadata` JSONB via `regexp_replace(metadata::text, $patient_id, $hash, 'g')::jsonb` for any embedded patient_id references (Story 5.1 audit metadata included `inviteId`, `doctorIdentifierHash`, etc. — verify all sharing audit shapes are covered; Story 5.3 access log resolves through these joins). **The audit rows survive; their identifying links don't.**
   2. **DELETE Storage objects** for the patient: `exports/{patient_id}/*` (Story 5.5), `lab_uploads/{patient_id}/*` (Story 2.x). Iterate via `supabase.storage.from(bucket).list(prefix)` + `remove(paths[])`. Best-effort — log + continue if a bucket is missing (e.g. testcontainer has no Supabase Storage).
   3. **DELETE public-schema rows** via cascade. `users(id)` is the parent for: `observations`, `uploads`, `consent_grants`, `consent_agreements`, `share_tokens` (→ `share_token_biomarkers`, `conversation_starter_cache`), `pending_invites`, `notification_preferences`, `push_tokens`, `letters`, `exports`, `account_deletion_requests`. Confirm all FK cascade chains in `packages/db/src/schema/index.ts` — any FK to `users(id)` without `onDelete: cascade` is a Story 5.6 blocker (file a deferred-work item OR add the cascade in this story; lean toward adding here since the cascade is required for AC2 spec verbatim).
   4. **DELETE `users(id)` row** (cascades fire).
   5. **DELETE Supabase Auth `auth.users(id)`** via `supabase.auth.admin.deleteUser(patientId)`. Service-role required.
   6. UPDATE `account_deletion_requests SET status='complete', completed_at=now()` for this request. (The request row is itself in `account_deletion_requests`, which cascades from `users` — so step 4 already removed it. **Fix:** the `account_deletion_requests` table needs `ON DELETE SET NULL` on `patient_id` OR the request status must update happen on a separate, non-cascading "completion ledger" table. Simpler: status update happens BEFORE step 4 — see ordering revision below.)
   - **Revised order (canonical):** 1 pseudonymize audit → 2 Storage delete → 3 status='processing' on `account_deletion_requests` → 4 cascade-delete public rows EXCEPT `account_deletion_requests` → 5 Supabase Auth admin delete → 6 status='complete' on `account_deletion_requests` (the row is preserved as the deletion ledger; `patient_id` column scrubbed to the pseudonym in step 6). The deletion-ledger row stays forever — proves to auditors that the deletion happened.
   - **Narrow catches** per Story 5.1 R1 / 5.4 R1 / 5.5 R1 discipline: PG errors, Supabase admin API errors (HTTP shape), Storage 404 (best-effort). Programmer errors (TypeError) rethrow. On the final pg-boss attempt (retrycount + 1 >= retryLimit=3), persist `account_deletion_requests.status='failed'` + `failure_reason` + emit `account.deletion_failed` audit. **The audit emit happens BEFORE auth.users delete so a partial failure on the auth side still surfaces in the log.**

4. **AC4 — Audit log pseudonymization (AR20 ADR).** Per AC3 step 1 — audit rows survive but lose identifying links. Implementation detail:
   - SQL helper `pseudonymize_patient_id(patient_id uuid, salt text) RETURNS text` returns `'pseudonymized-' || encode(sha256((patient_id::text || salt)::bytea), 'hex')`. Stored as a sql function via Drizzle (mirror Story 1.x audit-log helpers).
   - The salt comes from env var `ACCOUNT_DELETION_SALT` (64-byte base64 — same shape as `SHARE_TOKEN_HMAC_SECRET` from Story 5.1). Boot-time check in `services/llm/src/index.ts` rejects empty in production; dev/test falls back to a deterministic dev-only salt with a console warning (mirrors NFR-S6 pattern).
   - **Salt rotation invalidates linkability across the rotation boundary** — accepted limitation; documented in CLAUDE.md.
   - Metadata JSONB scrub: `regexp_replace(metadata::text, $patient_id_literal, $hash_literal, 'g')::jsonb`. Postgres rejects invalid JSONB; the regex replacement is shape-preserving (UUID → 64-hex-char string both fit JSON strings). Verify with an integration test that `share_token.created` audit metadata (Story 5.1) — which contains `inviteId`, `doctorIdentifierHash` (already hashed), and `biomarkerCount` — round-trips through pseudonymization unchanged for non-patient_id fields.

5. **AC5 — Storage object cleanup (worker side).** Per AC3 step 2. Buckets to clean:
   - `exports` (Story 5.5) — `list({prefix: ${patient_id}/})` + `remove(paths)`.
   - `lab_uploads` (Story 2.x) — same pattern, prefix `${patient_id}/`.
   - Document any other patient-scoped buckets in CLAUDE.md → "Account deletion checklist". Future stories that add a new patient-scoped bucket MUST add it to this list.
   - On per-object delete error (404, permission): log + continue. Best-effort — the public-schema cascade is the authoritative source of erasure; Storage residue without a row pointer is recoverable by a follow-up cleanup.
   - Concurrency: `localConcurrency: 1` on the worker for this queue. A deletion job can take seconds (Storage round-trips + cascades); serialization is fine.

6. **AC6 — Supabase Auth user deletion.** Per AC3 step 5. Uses `supabase.auth.admin.deleteUser(patientId)` via the existing service-role client (`services/llm/src/supabase.ts` from Story 5.5). This must happen AFTER public-schema cascade (so RLS-policy-driven cascading Supabase Auth triggers — if any — don't run against half-deleted state) and BEFORE the deletion-ledger row's status update (so a Supabase Auth admin failure is still surfaced via `account_deletion_requests.status='failed'`). On `admin.deleteUser` error (HTTP 404 → user already deleted; treat as success), narrow-catch.

7. **AC7 — Login after deletion returns "Conta não encontrada".** Spec AC4 verbatim. Supabase Auth's default error on a deleted user is `Invalid login credentials` (security-by-obscurity — doesn't distinguish non-existent vs wrong-password). For Story 5.6 we keep that default — making "Conta não encontrada" a distinct error class is an attack-surface expansion (account-enumeration). Document this deviation from the spec text in dev notes. The patient experiences this as their existing email/password no longer working, which IS the spec's intent.

8. **AC8 — `account_deletion_requests` schema + RLS.** New Drizzle table at `packages/db/src/schema/account.ts` (NEW file; the existing `users.ts` is auto-generated by Supabase — never hand-edit):

   ```
   account_deletion_requests (
     id uuid pk default gen_random_uuid(),
     patient_id uuid notNull,                  -- intentionally NO FK; the user row is deleted before this row's status flips to 'complete'
     status text notNull default 'queued' check in ('queued','processing','complete','failed'),
     requested_at timestamptz notNull default now(),
     completed_at timestamptz,
     failure_reason text
   )
   ```

   Composite/partial unique index `account_deletion_requests_active_uq ON (patient_id) WHERE status IN ('queued','processing')` enforces single-in-flight dedup.

   RLS policies (`packages/db/policies/custom_rls_account_deletion_requests.sql`):

   ```sql
   ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;

   DROP POLICY IF EXISTS "account_deletion_requests_select_own" ON "account_deletion_requests";
   CREATE POLICY "account_deletion_requests_select_own" ON "account_deletion_requests"
     FOR SELECT
     USING (patient_id::text = current_setting('app.current_patient_id', true));

   -- No INSERT/UPDATE/DELETE patient policies; service-role writes only.
   ```

   The patient can SELECT their own pre-deletion request (for the polling endpoint). Once the deletion completes and the auth user is removed, the patient cannot re-authenticate and cannot SELECT anything anyway. The row survives as a deletion ledger; access for compliance audit is via service-role only (no UI surface).

9. **AC9 — `getDeletionStatus` query (optional polling).** New `protectedProcedure.query`:
   - Input: `z.object({ requestId: z.string().uuid() })`.
   - Output: `z.object({ status: z.enum(['queued','processing','complete','failed']), requestedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(), failureReason: z.string().nullable() })`.
   - SELECT-own with NOT_FOUND on cross-patient (Story 5.1 discipline).
   - **In practice the client immediately signs out on `requestDeletion` success — they never call `getDeletionStatus`.** The endpoint exists for ops (e.g. an admin debugging a failed deletion via service-role direct DB query). Document this in dev notes.

10. **AC10 — Audit kinds enumerated.** Three new audit kinds (`packages/validators/src/account.ts` — NEW file mirroring `sharing.ts`):
    - `ACCOUNT_AUDIT_DELETION_REQUESTED = "account.deletion_requested"` (patient-actor, at resolver time).
    - `ACCOUNT_AUDIT_DELETION_COMPLETED = "account.deletion_completed"` (system-actor, at worker completion).
    - `ACCOUNT_AUDIT_DELETION_FAILED = "account.deletion_failed"` (system-actor, at worker final-attempt-failed).
    - **All three audit rows survive their owner's deletion** — they're written with the PSEUDONYMIZED `actor_id`/`resource_id` already (the worker's pseudonymize step runs in tx-step-1, then these rows are emitted at later steps with the hash). The deletion-requested audit at resolver time uses the raw `patient_id`; it gets pseudonymized retroactively in step 1 alongside all other audit rows.
    - Extend `ACCESS_LOG_EVENT_KINDS` (Story 5.3) to include `account.deletion_requested` — patient sees "Você solicitou exclusão de conta." in their pre-deletion access log read. (`deletion_completed`/`failed` are system events, NOT in the access log allowlist.)

11. **AC11 — FK cascade audit (cross-cutting prerequisite).** Inventory of FK references to `users(id)`:
    - `observations.patient_id` — Story 2.3 schema (verify `onDelete: cascade`).
    - `uploads.patient_id` — Story 2.1 (verify).
    - `consent_grants.patient_id` — Epic 1 (verify).
    - `consent_agreements.patient_id` — Epic 1 (verify).
    - `share_tokens.patient_id` — Story 5.1 schema confirms `onDelete: cascade`.
    - `share_token_biomarkers.share_token_id` — cascades from share_tokens (transitive).
    - `pending_invites.patient_id` — Story 5.1.
    - `notification_preferences.patient_id` — Epic 2.
    - `push_tokens.patient_id` — Story 2.5.
    - `letters.patient_id` — Story 4.1 (verify).
    - `exports.patient_id` — Story 5.5 confirms cascade.
    - `conversation_starter_cache.patient_id` — Story 5.2 confirms cascade.
    - `account_deletion_requests.patient_id` — **intentionally NO FK** (the ledger row outlives the user).
    - **For any FK that does NOT have `onDelete: cascade` today**, this story adds it (or files a Story 5.7 baseline-migration item if the change is fraught — schema changes through the Drizzle layer are safe for additive cascade definitions, but a careful audit is required).

12. **AC12 — Test coverage matrix.** Required test files:
    - `packages/db/__tests__/integration/account-deletion-schema.integration.test.ts` — `account_deletion_requests` table comes up; partial unique index rejects duplicate active rows.
    - `packages/db/__tests__/rls/account_deletion_requests.rls.test.ts` — 3-identity matrix (correctPatient, wrongPatient, serviceRole). No doctor principal.
    - `packages/api/__tests__/account/request-deletion.integration.test.ts` — `it.todo()` placeholders for testcontainer cases + synchronous audit-kind assertion.
    - `services/llm/__tests__/consumers/generate-account-deletion.test.ts` — happy path (pseudonymize → Storage cleanup → cascade → auth admin delete → status='complete'); failure paths (Storage error → log + continue; auth admin error → status='failed' + audit); idempotent retry (status='complete'/`'failed'` short-circuits). Stub Supabase client.
    - Validators unit tests for the new copy + audit constants.
    - UI snapshot scaffold for the Excluir conta screen states (input / cooldown / failed).

## Tasks / Subtasks

> **Plan:** 1) Schema + RLS → 2) FK cascade audit + fixes → 3) Validators + audit constants → 4) Router (request + getStatus) → 5) services/llm consumer (pseudonymize + cascade + Storage + auth delete) → 6) UI (screen + cooldown) → 7) Tests.

- [ ] **T1. Schema + RLS (AC8, AC11).** (AC: 8, 11)
  - [ ] T1.1 `packages/db/src/schema/account.ts` (NEW) — `accountDeletionRequests` table per AC8. Use `pgEnum` for `status` (mirror Story 5.5 `exportStatusEnum` pattern). Partial unique index `account_deletion_requests_active_uq`. Re-export from `packages/db/src/schema/index.ts`.
  - [ ] T1.2 `packages/db/policies/custom_rls_account_deletion_requests.sql` (NEW) — patient SELECT-own; no INSERT/UPDATE/DELETE patient policies. Service-role bypasses (consumer writes).
  - [ ] T1.3 Update testcontainer setup to load the new policy file.
  - [ ] T1.4 SQL helper `pseudonymize_patient_id(uuid, text) RETURNS text` via Drizzle `sql` migration (or a `custom_*.sql` companion). Document where it lives.
  - [ ] T1.5 **FK cascade audit (T2 below) MUST land here too** — any missing `onDelete: cascade` on FKs to `users(id)` is a Story 5.6 blocker. Add them as part of T1.

- [ ] **T2. FK cascade audit + fixes (AC11).** (AC: 11)
  - [ ] T2.1 Grep across `packages/db/src/schema/*.ts` for `references(() => Users.id` / `references: () => users.id`. For each, verify `onDelete: 'cascade'`. File a list of any non-cascading FKs.
  - [ ] T2.2 Add `onDelete: 'cascade'` to any FK that lacks it. Schema additive change — `pnpm db:push` will apply safely in dev. Story 5.7 baseline absorbs the change for prod.
  - [ ] T2.3 Verify `share_token_biomarkers` cascades from `share_tokens` (Story 5.1), `conversation_starter_cache` cascades from `share_tokens` (Story 5.2), `pending_invites` cascades from `users` (Story 5.1). Same for `exports` (Story 5.5).
  - [ ] T2.4 `account_deletion_requests.patient_id` deliberately has NO FK (ledger row outlives the user). Document this exception in the schema file with a comment.

- [ ] **T3. Validators + audit constants (AC1, AC10).** (AC: 1, 10)
  - [ ] T3.1 `packages/validators/src/account.ts` (NEW). Mirror `sharing.ts` structure.
    - `ACCOUNT_DELETION_STATUSES = ["queued","processing","complete","failed"] as const`.
    - `AccountDeletionStatus` type.
    - `requestDeletionInputSchema = z.object({})`, `requestDeletionOutputSchema = z.object({ requestId: z.string().uuid() })`.
    - `getDeletionStatusInputSchema`, `getDeletionStatusOutputSchema`.
    - `DELETE_ACCOUNT_HEADER_PT_BR = "Excluir conta"`.
    - `DELETE_ACCOUNT_IRREVERSIBLE_PT_BR = "Esta ação é irreversível. Todos os seus dados serão permanentemente apagados."`.
    - `DELETE_ACCOUNT_SUMMARY_LINES_PT_BR: readonly string[]` (observations, uploads, BIA, consents, share tokens, exports, audit log pseudonymized, Supabase Auth).
    - `DELETE_ACCOUNT_INPUT_PLACEHOLDER_PT_BR = "Digite EXCLUIR para confirmar"`.
    - `DELETE_ACCOUNT_CONFIRM_WORD = "EXCLUIR"`.
    - `DELETE_ACCOUNT_CONTINUE_BUTTON_PT_BR = "Continuar"`.
    - `DELETE_ACCOUNT_CANCEL_BUTTON_PT_BR = "Cancelar"`.
    - `DELETE_ACCOUNT_COUNTDOWN_PT_BR_FN(secondsRemaining) => string` returning `"Excluindo em ${N} segundos… Toque em Cancelar para abortar."`.
    - `DELETE_ACCOUNT_CANCELLED_TOAST_PT_BR = "Exclusão cancelada."`.
    - `DELETE_ACCOUNT_FAILED_PT_BR = "Não foi possível processar sua solicitação. Tente novamente."`.
    - `DELETE_ACCOUNT_CANCEL_A11Y_PT_BR = "Cancelar exclusão da conta"`.
    - `DELETE_ACCOUNT_COUNTDOWN_MS = 30_000`.
  - [ ] T3.2 Audit constants:
    - `ACCOUNT_AUDIT_DELETION_REQUESTED = "account.deletion_requested"`.
    - `ACCOUNT_AUDIT_DELETION_COMPLETED = "account.deletion_completed"`.
    - `ACCOUNT_AUDIT_DELETION_FAILED = "account.deletion_failed"`.
  - [ ] T3.3 Extend Story 5.3's `ACCESS_LOG_EVENT_KINDS` to include `"account.deletion_requested"`. Extend `ACCESS_LOG_EVENT_LABEL_PT_BR_FN` with a case: `"Você solicitou exclusão de conta."`.
  - [ ] T3.4 Re-export from `packages/validators/src/index.ts`.

- [ ] **T4. Router — `requestDeletion` + `getDeletionStatus` (AC2, AC9, AC10).** (AC: 2, 9, 10)
  - [ ] T4.1 `packages/api/src/router/account.ts` (NEW — verify the existing `account.ts` in `packages/api/src/router/`; if it already exists from Epic 1, extend it). Add `requestDeletion` `protectedProcedure.mutation` per AC2. Inside `ctx.db.transaction`: INSERT `account_deletion_requests` (catch 23505 narrow → SELECT existing), outbox-enqueue pg-boss `account.delete.generate` with singleton_key `account.delete.${patientId}`, write `account.deletion_requested` audit. Return `{ requestId }`.
  - [ ] T4.2 Add `getDeletionStatus` `protectedProcedure.query` per AC9. SELECT-own; 404 on cross-patient.
  - [ ] T4.3 Register the router in `packages/api/src/root.ts` (or confirm it's already registered).

- [ ] **T5. services/llm consumer + auth admin client (AC3, AC4, AC5, AC6, AC10).** (AC: 3, 4, 5, 6, 10)
  - [ ] T5.1 `services/llm/src/consumers/generate-account-deletion.ts` (NEW) — pg-boss handler per AC3 revised order. Worker steps inside `deps.sql.begin(async (tx) => ...)`:
    1. `status = 'processing'` (UPDATE; row-lock).
    2. Pseudonymize `audit_log` (AC4): UPDATE rows WHERE `actor_id = $patientId` OR (`resource_type IN (...)` AND resource cascades — verify exhaustive list); SET `actor_id = pseudonymize_patient_id($patientId, salt)`. Scrub metadata via `regexp_replace(metadata::text, $patientId_literal, $hash_literal, 'g')::jsonb`.
    3. **List + remove Storage objects** (AC5). OUTSIDE the SQL tx (Storage is a different system; best-effort + log).
    4. Cascade-DELETE: `DELETE FROM users WHERE id = $patientId` (everything else cascades via the FK chain audited in T2).
    5. Supabase Auth admin delete (AC6): `supabase.auth.admin.deleteUser(patientId)`. Narrow-catch HTTP 404 (already-deleted) as success.
    6. UPDATE `account_deletion_requests SET status = 'complete', completed_at = now()` for this `requestId` (this row still exists — no FK to users).
    7. Write `account.deletion_completed` audit (system-actor; `actor_id` = the pseudonym from step 2).
  - [ ] T5.2 Failure path: narrow catches (PG codes, Supabase admin HTTP errors, Storage errors); programmer errors rethrow. On final attempt (retrycount + 1 >= RETRY_LIMIT=3), persist `status='failed'`, `failure_reason`, write `account.deletion_failed` audit. **Crucially:** the audit emit happens BEFORE step 5 (auth admin delete) so a partial auth-side failure is still traced. Mirrors Story 5.5 R1 patch #2 pattern.
  - [ ] T5.3 `services/llm/src/index.ts` — register the new queue `account.delete.generate` with `retryLimit: 3, retryDelay: 30, retryBackoff: true, localConcurrency: 1`. Add `registerGenerateAccountDeletionConsumer(boss, { sql, supabase, salt })`. Eager `getAccountDeletionSalt()` at boot (fail-fast if unset in production).
  - [ ] T5.4 `services/llm/src/account-deletion.ts` (NEW) — pure helpers:
    - `pseudonymizePatientId(patientId, salt)` (mirrors the SQL function for round-trip tests).
    - `listAccountStorageObjects(supabase, patientId)` — lists `exports/${patientId}/*` + `lab_uploads/${patientId}/*`; returns flat array of paths grouped by bucket.
    - `removeAccountStorageObjects(supabase, patientId)` — wraps the above + per-bucket `remove(paths)`. Best-effort; returns counts.
  - [ ] T5.5 `services/llm/src/supabase.ts` — extend to expose `auth.admin` surface. Verify the existing service-role client (Story 5.5) has admin permissions. If a separate client init is required (the `@supabase/supabase-js` admin surface needs explicit instantiation), add it.
  - [ ] T5.6 `.env.example` — add `ACCOUNT_DELETION_SALT=<random 64-byte base64>`. CLAUDE.md required-vars list.

- [ ] **T6. UI — Excluir conta screen + cooldown component (AC1).** (AC: 1)
  - [ ] T6.1 `packages/ui/src/components/DeleteAccountConfirmationCard/DeleteAccountConfirmationCard.tsx` (NEW). Three internal states: `input` (text field + Continuar), `cooldown` (countdown progress bar + Cancelar), `failed` (error toast equivalent + reset). State machine lives in the component; the screen passes only the start/cancel callbacks.
  - [ ] T6.2 `apps/expo/src/app/configuracoes/conta/excluir.tsx` (NEW) — wires the card to `accountRouter.requestDeletion.useMutation()`. On `onSuccess` → `supabase.auth.signOut()` + `router.replace('/auth/login')`. On `onError` → resets to input state + shows `DELETE_ACCOUNT_FAILED_PT_BR` Toast.
  - [ ] T6.3 `apps/web/src/app/configuracoes/conta/excluir/page.tsx` (NEW) — web parity. Same flow; web uses `router.push('/auth/login')` (Next.js router).
  - [ ] T6.4 The card's countdown timer: `setInterval(50ms)` for the linear progress bar (mirror Story 5.4 `UndoToast` pattern); separate `setTimeout(DELETE_ACCOUNT_COUNTDOWN_MS)` for the mutation fire. The interval/timeout are cleared on `Cancelar` + on unmount.
  - [ ] T6.5 Snapshot scaffold at `packages/ui/src/components/DeleteAccountConfirmationCard/DeleteAccountConfirmationCard.test.tsx` (per Story 5.3/5.4/5.5 ui-package precedent).

- [ ] **T7. Tests across the seam.** (AC: all)
  - [ ] T7.1 Validator unit tests — `DELETE_ACCOUNT_CONFIRM_WORD === "EXCLUIR"`, copy functions, audit constant values.
  - [ ] T7.2 Schema integration test (T1 above).
  - [ ] T7.3 RLS test (T1 above).
  - [ ] T7.4 API integration test scaffold with `it.todo()` placeholders + synchronous audit-kind assertion.
  - [ ] T7.5 Consumer unit test (T5 above). Stub `sql` + `supabase` + `salt`. Test:
    - Happy path: pseudonymize → Storage cleanup → cascade → auth admin delete → status='complete' + audit.
    - Storage 404: continues to cascade; logs warning; final status='complete'.
    - Auth admin 404: treated as success (already deleted); status='complete'.
    - Auth admin 500 on final attempt: status='failed' + audit; rethrow for Sentry visibility.
    - Idempotent retry: status='complete'/'failed' short-circuits.
    - Final-attempt programmer error (TypeError): status='failed' + audit + rethrow.
  - [ ] T7.6 Pseudonymization round-trip test: SQL helper + JS helper produce identical hex for the same `(patient_id, salt)` input.

- [ ] **T8. Env + docs.**
  - [ ] T8.1 `.env.example` — `ACCOUNT_DELETION_SALT` (T5.6). CLAUDE.md required-vars list.
  - [ ] T8.2 CLAUDE.md — append "Account deletion discipline (Story 5.6)" paragraph: async pg-boss; pseudonymization (AR20); FK cascade audit; Storage cleanup checklist (any future patient-scoped bucket adds an entry here); 30s visible cooldown.
  - [ ] T8.3 `docs/rls-review-checklist.md` — add `account_deletion_requests` to the patient-only-RLS table list (consistent with Stories 5.1–5.5 precedent; skip if file structure doesn't match).

## Dev Notes

### Architecture references (authoritative)

- **LGPD Art. 18 right to erasure** — non-negotiable patient right; no premium gate (Story 5.5 precedent).
- **AR20 ADR**: audit_log rows for deleted patients are PSEUDONYMIZED (UPDATE actor_id/resource_id to a deterministic hash), NOT deleted. Append-only invariant (NFR-S4) preserved.
- **Story 5.5 async-job pattern** is the template: pg-boss queue in `services/llm`, outbox INSERT into `pgboss.job` inside the resolver tx, polling endpoint (rarely used; client signs out immediately).
- **Storage cleanup** — `exports` (Story 5.5) + `lab_uploads` (Story 2.x). Any future bucket adds itself to T5.4's helper.
- **Supabase Auth admin delete** — `supabase.auth.admin.deleteUser(id)` via service-role. The existing `services/llm/src/supabase.ts` from Story 5.5 may already expose this; verify in T5.5.

### UX references

- **EXCLUIR magic-word + 30s cooldown** — accommodates spec AC1 + adds Story 5.4's deferred-server-write safety net for an irreversible action. The 30s window is longer than 5.4's 5s because the stakes are higher.
- **Tier-2 styling on destructive actions** — UX-DR13. Muted neutral `$accessLogRevoked` token (NOT red). Mirrors Story 5.4 `RevokeConfirmDialog`.
- **No alarmist copy** — calm + factual. Patient agency is the framing.

### Patterns to copy (don't reinvent)

- **Async pg-boss queue + outbox INSERT** — Story 5.2 `conversation_starter.generate` + Story 5.5 `record.export.generate`. Same shape: singleton_key, retryLimit 3, retryBackoff true.
- **`getAccountDeletionSalt()` boot-fail-fast** — Story 5.5 R1 patch #8 (`getSupabaseClient` eager-invoke at services/llm boot).
- **`writeAuditLog(tx, ...)` in tx** — Story 5.1 R1.
- **Narrow catches** — Story 5.1/5.4/5.5 R1.
- **Partial unique index for in-flight dedup** — Story 5.5 R1 patch A (`exports_active_uq`). Same shape: `account_deletion_requests_active_uq`.
- **404 not 403** — Story 5.1 R1.
- **Validators-as-truth** — Story 5.3.
- **Tier-2 destructive button + muted neutral** — Story 5.4 `RevokeConfirmDialog`.
- **Cooldown with separate setInterval (progress bar) + setTimeout (fire)** — Story 5.4 `UndoToast`.
- **UndoToast `undoLabel: string | null`** — Story 5.4 R1 patch #3 fixes the `:undone:undone` loop; reuse the pattern if a cancellation Toast is needed (DELETE_ACCOUNT_CANCELLED_TOAST renders without an undo button — set `undoLabel={null}`).
- **Eager Supabase env check at boot** — Story 5.5 R1.

### Anti-patterns explicitly forbidden in 5.6

- Do **NOT** delete audit_log rows. AR20 + NFR-S4 — pseudonymize only.
- Do **NOT** make `account_deletion_requests.patient_id` an FK to `users(id)` with `onDelete: cascade` — the ledger row must outlive the user. Comment in the schema file.
- Do **NOT** premium-gate `requestDeletion`. LGPD Art. 18.
- Do **NOT** synchronously perform cascade-delete + Supabase Auth delete inside the tRPC mutation. Time-bounded by Vercel's serverless timeout (typically 60s).
- Do **NOT** return distinguishable "account not found" vs "wrong password" on login post-deletion. Account-enumeration risk; keep Supabase Auth's default ambiguous error.
- Do **NOT** broad-catch in the consumer. Narrow per Story 5.1/5.4/5.5.
- Do **NOT** skip the FK cascade audit. Missing `onDelete: cascade` on any FK to `users(id)` is a blocker — the deletion will leave orphan rows.
- Do **NOT** inline pt-BR. Validators only.
- Do **NOT** fire the deletion mutation immediately on Continuar tap. The 30s cooldown is the safety net.
- Do **NOT** use a red Tamagui token on the screen. Muted neutral; spec UX-DR13.
- Do **NOT** scrub `metadata` JSONB by replacing the whole field with `'{}'::jsonb`. Use regex replacement so non-patient_id fields survive (downstream analytics).
- Do **NOT** dismiss the cooldown progress bar on backdrop tap. Patient must explicitly Cancelar or wait (mirrors Story 5.4 `UndoToast`).

### Latest tech notes

- **`supabase.auth.admin.deleteUser(id)`** — `@supabase/supabase-js@2.x`. Returns `{ data, error }`. HTTP 404 in `error` if user already deleted; treat as success.
- **`@supabase/supabase-js` storage `list({prefix})`** — returns paginated; for a single patient's prefix the page size is fine (no patient has > 1000 files in either bucket). Document and add a page-size cap.
- **PG `regexp_replace(jsonb::text, ...)::jsonb`** — round-trips safely IF the replacement preserves the JSON shape. UUID → 64-char hex string both fit unescaped JSON strings. Verify with the integration test.
- **`Intl.NumberFormat("pt-BR")`** for the 30s countdown isn't needed — integer seconds render fine.

### Previous story intelligence

- **Story 5.1 R1**: narrow catches; audit-in-tx; validators-as-truth; 404 not 403; idempotency shield via partial unique index.
- **Story 5.2 R1**: SELECT FOR UPDATE for revoke; outbox INSERT into pgboss.job; nullable expires_at + RLS predicate parity.
- **Story 5.3 R1**: cursor pagination tuple compare; throttled refetch; suppressed-kind allowlist; FK fixture safety in RLS tests.
- **Story 5.4 R1**: onError surfaces toast on failure; UPDATE RETURNING for single-clock alignment; client/server enum split; cooldown component (UndoToast) with setInterval + setTimeout separation; cleanup on unmount fires pending; `undoLabel: string | null` fixes :undone:undone loop.
- **Story 5.5 R1**: partial unique index for in-flight dedup; expired-ready silent no-op fixed; programmer-error final-attempt persists failed; Storage orphan cleanup; lazy Supabase env-check → eager boot-fail-fast; cross-origin filename via createSignedUrl({download}).

### Project Structure Notes

All new file locations align with existing conventions:

- `packages/db/src/schema/account.ts` — NEW; auth-managed `users.ts` is auto-generated, so account-level tables get their own file.
- `packages/db/policies/custom_rls_account_deletion_requests.sql` — matches existing `custom_rls_<table>.sql` naming.
- `packages/api/src/router/account.ts` — extend existing if present (Epic 1's account router likely exists); otherwise NEW.
- `services/llm/src/consumers/generate-account-deletion.ts` + `services/llm/src/account-deletion.ts` helpers — mirror generate-letter / generate-export precedent.
- `apps/expo/src/app/configuracoes/conta/excluir.tsx` + web parity — extends the Configurações > Conta surface (verify the `conta/` route group exists; if not, create the layout).
- `packages/ui/src/components/DeleteAccountConfirmationCard/` — barrel directory.
- `packages/validators/src/account.ts` — NEW.

No structural conflicts.

### Testing standards summary

- **DB integration + RLS:** testcontainer; `account_deletion_requests` schema; 3-identity matrix.
- **API integration:** `it.todo()` placeholders; CI runs.
- **services/llm consumer:** unit-test the whole worker pipeline with stubbed sql + supabase + salt.
- **Pseudonymization round-trip:** SQL helper vs JS helper produce identical output.
- **UI snapshot:** scaffold per ui-package precedent.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.6 lines 1352–1382]
- [Source: _bmad-output/planning-artifacts/architecture.md#NFR-S4 append-only audit_log]
- [Source: _bmad-output/planning-artifacts/architecture.md#AR20 audit pseudonymization]
- [Source: _bmad-output/implementation-artifacts/5-1-...md — partial unique index + narrow catch idempotency]
- [Source: _bmad-output/implementation-artifacts/5-4-...md — destructive Tier-2 + deferred-server-write cooldown]
- [Source: _bmad-output/implementation-artifacts/5-5-...md — async pg-boss + Storage cleanup + eager env check]
- [Source: packages/api/src/audit.ts — writeAuditLog signature]
- [Source: services/llm/src/index.ts — queue registration pattern]
- [Source: services/llm/src/supabase.ts — service-role client (Story 5.5)]
- [Source: CLAUDE.md — narrow catches; validators-as-truth; tx-wrapping]

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Known infra blockers (out-of-code)

- **Production migration still deferred** to Story 5.7 (Epic 5 baseline). Story 5.6 adds `account_deletion_requests` + custom RLS policy + `pseudonymize_patient_id` SQL function + cascading FK definitions — Story 5.7 absorbs all of them.
- **`ACCOUNT_DELETION_SALT`** env var required at services/llm boot in production. Dev fallback OK.
- **Supabase Auth admin API permissions** — confirm `SUPABASE_SERVICE_ROLE_KEY` already grants `auth.admin.deleteUser` (it does by default for service-role; verify in dev).
- **Future patient-scoped Storage buckets** must be added to T5.4's `removeAccountStorageObjects` helper. Document in CLAUDE.md "Account deletion discipline".
- **`account_deletion_requests` cleanup** — ledger rows accumulate forever (no expires_at). Acceptable for compliance audit; flag for ops if it becomes a row-count concern.
- **Salt rotation invalidates linkability** across the rotation boundary — accepted limitation; documented in CLAUDE.md.
