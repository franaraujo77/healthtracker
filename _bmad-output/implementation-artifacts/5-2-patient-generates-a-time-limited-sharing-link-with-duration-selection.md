# Story 5.2: Patient generates a time-limited sharing link with duration selection

Status: ready-for-dev

> **Stacked on Story 5.1.** This story finishes the sharing ceremony's first half: the duration picker, the "Sem prazo" confirmation, the share-token expiry logic, and the Conversation Starter pre-gen cache. It replaces Story 5.1's placeholder `duracao.tsx` (Expo + web) with the real picker and extends `createShareToken` to accept a duration. Stacks onto branch `worktree-story-5-1` / PR #56 (per the user's stacked-PR convention).
>
> **Out of scope (per user direction):** Production migration file is **still deferred** to the last story of Epic 5. Dev applies via `pnpm db:push` + `psql -f packages/db/policies/custom_rls_*.sql`.
>
> **ADR resolutions locked in this story (user-confirmed):**
>
> 1. `share_tokens.expires_at` becomes **nullable**; `NULL` = no expiry ("Sem prazo"). RLS predicates updated to `(expires_at IS NULL OR expires_at > now())`.
> 2. Conversation Starter pre-gen scope: **add `conversation_starter_cache` table + Drizzle schema + RLS + stub adapter**. Real LLM generation gated on `ANTHROPIC_API_KEY` non-empty (mirrors Story 4.1's empty-key→stub pattern). Doctor surface (Epic 6) reads from this cache.
> 3. Pre-gen fires at token-create time via a new pg-boss queue `conversation_starter.generate` hosted in `services/llm` (mirrors `letter.generate`).

## Story

**As a** patient,
**I want** to generate a shareable link with a chosen expiry duration,
**so that** access to my record is always time-bounded by default and I maintain control over how long it lasts.

## Acceptance Criteria

1. **AC1 — Duration picker UI + visual order.** Given the patient begins the sharing ceremony (after entering the doctor identifier in Story 5.1's `novo/identificacao.tsx`), when the duration picker screen at `apps/expo/src/app/(tabs)/compartilhar/novo/duracao.tsx` (and web equivalent) appears, then 4 options are rendered in this **exact visual order** via the new `DurationOption` component (`packages/ui/src/components/DurationOption/`):
   - `"24 horas"` (value: `"24h"`)
   - `"7 dias"` (value: `"7d"`, **pre-selected** — default)
   - `"30 dias"` (value: `"30d"`)
   - `"Sem prazo"` (value: `"no_expiry"`)

   Copy strings live in `packages/validators/src/sharing.ts` as `DURATION_OPTIONS` (a typed array of `{value: ShareDuration, label: string}`). The screen replaces Story 5.1's auto-fire placeholder. The screen does NOT call `createShareToken` until the patient taps "Continuar"; the duration value is held in local component state until then.

2. **AC2 — "Sem prazo" extra-confirmation modal.** Given the patient selects `"no_expiry"`, when the patient taps "Continuar", then a confirmation modal appears (Tamagui `Sheet` / native modal — `NoExpiryConfirmDialog` component in `packages/ui`) with body copy **verbatim**: `"Confirmar acesso sem prazo — o médico poderá ver seus dados até você revogar manualmente."` (constant `NO_EXPIRY_CONFIRM_BODY_PT_BR` — T5.1). The modal has two buttons: "Confirmar" (Tier 2, secondary) and "Voltar" (Tier 3, text-only). The patient MUST tap "Confirmar" before the ceremony proceeds to `createShareToken`. For the other three durations (`"24h"`, `"7d"`, `"30d"`), tapping "Continuar" advances directly without a modal. The modal is dismissible by tapping outside or "Voltar" — both equivalent to "do not proceed".

3. **AC3 — `createShareToken` accepts duration + atomic Conversation Starter pre-gen enqueue.** When `sharingRouter.createShareToken({inviteId, duration})` is called (input schema extended in T3.1), then inside the existing `ctx.db.transaction(async (tx) => ...)` block from Story 5.1:
   - `expires_at` is set per the duration mapping: `"24h"` → `now() + interval '24 hours'`; `"7d"` → `now() + interval '7 days'`; `"30d"` → `now() + interval '30 days'`; `"no_expiry"` → `NULL`.
   - The Drizzle schema column `share_tokens.expires_at` becomes **nullable** (T1.1).
   - The existing token insert + biomarker pre-pop + `share_token.created` audit continues unchanged.
   - **Additionally**, a row is inserted into `conversation_starter_cache` with `status = 'queued'`, `payload = NULL`, `expires_at = share_tokens.expires_at` (inherits — NULL if no_expiry).
   - **And** a pg-boss job `conversation_starter.generate` is enqueued via `boss.send(...)` carrying `{shareTokenId}` — also inside the tx (pg-boss `send` is tx-aware via the same `tx` handle if the boss instance was started with the same Postgres pool; verify in implementation — if not tx-aware, mirror Story 4.1's outbox-style helper from `services/extraction/src/notifications/emit.ts` and enqueue via a `pg_boss` schema-aware INSERT inside the tx).
   - Audit `conversation_starter.queued` is written in the same tx (new audit kind — T3.2).
   - Idempotency from Story 5.1's `share_tokens_invite_active_uq` still applies: if a non-revoked, non-expired token already exists for `(patient_id, invite_id)`, the procedure short-circuits and returns the existing id + scope — no second `conversation_starter_cache` row, no second enqueue.

4. **AC4 — `services/llm` Conversation Starter consumer + stub adapter.** A new consumer at `services/llm/src/consumers/generate-conversation-starter.ts` subscribes to the `conversation_starter.generate` queue (registered at `services/llm/src/index.ts:39–45`, mirroring `letter.generate`). The consumer:
   - Loads the `share_token` row + `share_token_biomarkers` (visible only) + patient observations scoped to those categories.
   - Calls `llm.generateConversationStarter({...})` on the same `LLMAdapter` interface. `createStubLLMAdapter()` (in `services/llm/src/adapters/anthropic.ts`) is extended with a new method that returns a canned JSONB payload: `{prompts: [{text: "Como evoluiu sua hemoglobina nos últimos 6 meses?"}, ...3 prompts], biomarkerCards: [{category, currentValue, previousValue, trendDirection, patientBaseline} per visible biomarker]}`. The real Anthropic adapter throws `Not Implemented` on this method for now (real prompt + system instruction is **Epic 6's territory** — a `// TODO Story 6.2: implement real Conversation Starter generation` marker is left in the Anthropic adapter).
   - On success: UPDATEs `conversation_starter_cache` set `status='ready'`, `payload=<jsonb>`, `generated_at=now()`. Writes `conversation_starter.generated` audit in the same tx.
   - On failure (after pg-boss retries exhausted at 3 attempts with `retryBackoff: true` — mirrors `letter.generate`): UPDATEs `status='failed'`, `failure_reason=<short code>`. Writes `conversation_starter.failed` audit. Story 6.2 will gracefully render an inline message when `status='failed'` (out of scope here).
   - **Narrow catches** — only catch known shapes (`Anthropic.APIError`, `ECONNRESET`); rethrow `TypeError`/`ReferenceError`/`SyntaxError` (Epic 2 retro discipline).

5. **AC5 — `conversation_starter_cache` schema + RLS.** New Drizzle schema in `packages/db/src/schema/sharing.ts`:

   ```
   conversation_starter_cache (
     id uuid pk default gen_random_uuid(),
     share_token_id uuid notNull references share_tokens(id) on delete cascade,
     patient_id uuid notNull references users(id) on delete cascade,
     status text notNull default 'queued' check in ('queued', 'ready', 'failed'),
     payload jsonb,
     failure_reason text,
     generated_at timestamptz,
     expires_at timestamptz,    -- inherits share_tokens.expires_at; NULL means no expiry
     created_at timestamptz notNull default now()
   )
   ```

   Composite unique index on `(share_token_id)` — exactly one cache row per share token (regenerate via UPDATE, not INSERT — Story 5.2 doesn't re-gen; that's Story 5.x territory when a new draw lands and invalidates).

   RLS policies (`packages/db/policies/custom_rls_conversation_starter_cache.sql`):
   - **Patient principal**: SELECT own rows only (`patient_id::text = current_setting('app.current_patient_id', true)`). No INSERT/UPDATE/DELETE.
   - **Doctor principal** (Epic 6 reads this): SELECT only if `share_token_id::text = current_setting('app.current_share_token_id', true)` AND `status = 'ready'` AND the parent share_token is non-revoked + non-expired (`expires_at IS NULL OR expires_at > now()`).
   - **`service_role`**: bypasses RLS (writes from `services/llm` consumer).

6. **AC6 — `share_tokens.expires_at` nullable + RLS predicate update.** The column flips from `notNull` to nullable in `packages/db/src/schema/sharing.ts` (T1.2). Two RLS files are updated (T2.2):
   - `packages/db/policies/custom_rls_share_tokens.sql` — doctor-principal SELECT predicate changes from `... AND expires_at > now()` to `... AND (expires_at IS NULL OR expires_at > now())`.
   - `packages/db/policies/custom_rls_share_token_biomarkers.sql` — same update on its embedded EXISTS subquery.

   Story 5.1's RLS test fixtures (`packages/db/__tests__/rls/helpers.ts`) gain a new identity: `doctorWithNoExpiryToken` (sets `app.current_share_token_id` to a token with `expires_at IS NULL` and `revoked_at IS NULL`) — must SELECT successfully.

7. **AC7 — Summary screen with Tier-2 "Enviar" (UX-DR13).** A new screen replaces Story 5.1's `[shareTokenId]/concluido.tsx` minimal stub with the real summary at `apps/expo/src/app/(tabs)/compartilhar/[shareTokenId]/resumo.tsx` (and web equivalent under `apps/web/src/app/compartilhar/[shareTokenId]/resumo/page.tsx`). The screen renders a plain-language summary using existing `sharingRouter.getDraftConfig` (Story 5.1) data plus the new `expires_at`:
   - One sentence: `"{Doctor display name} verá: {comma-separated visible biomarker labels} — {duration label or "sem prazo"}."` (function `SHARE_SUMMARY_PT_BR_FN` — T5.1)
   - Below: "Enviar" button rendered as **Tier 2** (`Button variant="secondary"` — outlined teal per UX spec line 1107). Tier-1 treatment is **forbidden** per UX-DR13.
   - The "Enviar" button generates the deliverable share URL (the HMAC-signed token string from Story 5.1's `signShareToken`) and shows a native share sheet (`expo-sharing` on mobile, `navigator.share` on web with `navigator.clipboard.writeText` fallback). Story 5.2 only renders the share-sheet; doctor-side magic-link delivery is Epic 6 territory.
   - The `[shareTokenId]/concluido.tsx` stub from Story 5.1 is **removed** (route deleted; sprint-status note in 5.1 referenced it — the resumo screen subsumes it).
   - Route order through the ceremony becomes: `compartilhar` (tab) → `novo/identificacao` → `novo/duracao` (real picker) → confirmation modal if no_expiry → `[shareTokenId]/biomarcadores` → `[shareTokenId]/resumo`.

8. **AC8 — Validators: duration enum + copy.** New exports in `packages/validators/src/sharing.ts`:
   - `ShareDuration = "24h" | "7d" | "30d" | "no_expiry"` (TS type).
   - `shareDurationSchema = z.enum(["24h", "7d", "30d", "no_expiry"])`.
   - `createShareTokenInputSchema` extended: `{inviteId: z.string().uuid(), duration: shareDurationSchema}`. The `duration` field is **required** (no default — the screen owns the default-selection of `"7d"`).
   - `DURATION_OPTIONS: readonly {value: ShareDuration, labelPtBr: string}[]` (the AC1 ordered array).
   - `DURATION_LABEL_PT_BR_FN: (d: ShareDuration) => string` (returns "24 horas" / "7 dias" / "30 dias" / "sem prazo").
   - `NO_EXPIRY_CONFIRM_BODY_PT_BR` (AC2 verbatim).
   - `NO_EXPIRY_CONFIRM_BUTTON_PT_BR = "Confirmar"`, `NO_EXPIRY_CONFIRM_CANCEL_PT_BR = "Voltar"`.
   - `SHARE_SUMMARY_PT_BR_FN: (doctorName: string, visibleCategories: string[], duration: ShareDuration) => string`.
   - `SHARE_SUBMIT_BUTTON_PT_BR = "Enviar"`.
   - **Remove** the now-stale `COMPARTILHAR_NUOVO_DURACAO_PROGRESS_PT_BR` constant from Story 5.1 (the new screen doesn't auto-fire so no progress copy is needed). Also remove `SHARE_DEFAULT_DURATION_DAYS` since the constant becomes ambiguous with the enum (the default-selection lives in the screen state instead).
   - Audit constants: add `SHARING_AUDIT_CONVERSATION_STARTER_QUEUED = "conversation_starter.queued"`, `SHARING_AUDIT_CONVERSATION_STARTER_GENERATED = "conversation_starter.generated"`, `SHARING_AUDIT_CONVERSATION_STARTER_FAILED = "conversation_starter.failed"`.

9. **AC9 — `share_token.created` audit metadata includes duration.** The audit row written by `createShareToken` is extended to include `duration` in metadata: `{inviteId, defaultExpiresAt, biomarkerCount, duration}` (line in `router/sharing.ts` writing the audit). This unblocks Story 5.3 Access Log to render "compartilhado por 7 dias" copy.

10. **AC10 — No `share_token.created` is allowed without a duration param.** Backwards compat note: every internal caller of `createShareToken` must pass `duration`. The only callers today are the two `duracao` screens (Expo + web, Story 5.1). They are both replaced in this story. No other consumers exist (verified by grep in T0). The default `"7d"` is the screen's local-state default, NOT a server-side fallback.

11. **AC11 — Idempotency carry-through.** If the patient is mid-ceremony, goes back, and re-enters the duration picker with the **same** `inviteId`, then they may pick a different duration. `createShareToken` short-circuits on the existing-active-token check (Story 5.1's idempotency) and returns the EXISTING token without changing `expires_at`. **This is the right call** — the duration is locked at first creation; the patient can revoke + start over if they want to change it. Add a TODO + dev-note: Story 5.4 (revoke) is the path to change duration; document this in the spec dev notes (and surface a UX nudge later if patients hit this).

12. **AC12 — Audit kinds enumerated.** Three new audit kinds: `conversation_starter.queued`, `conversation_starter.generated`, `conversation_starter.failed`. All `noun.verb` past-tense. Constants in `packages/validators` (T5.1).

## Tasks / Subtasks

> **Plan:** 1) Drizzle schema (expires_at nullable + conversation_starter_cache) → 2) RLS update + new policy file → 3) Router + duration + Conversation Starter enqueue → 4) services/llm consumer + stub method → 5) Duration picker UI + Sem-prazo modal + summary screen → 6) Validators + copy → 7) Tests across the seam.

- [ ] **T1. Drizzle schema (AC3, AC5, AC6).** (AC: 3, 5, 6)
  - [ ] T1.1 `packages/db/src/schema/sharing.ts` — flip `share_tokens.expires_at` from `.notNull()` to nullable. Update inferred types.
  - [ ] T1.2 Add `conversationStarterCache` table per AC5: id, share_token_id (FK cascade), patient_id (FK cascade), status (text + check constraint via `sql\`status in ('queued','ready','failed')\``), payload (jsonb), failure_reason (text), generated_at (timestamptz), expires_at (timestamptz nullable), created_at. Composite unique index on `(share_token_id)`named`conversation_starter_cache_share_token_uq`.
  - [ ] T1.3 Update barrel `packages/db/src/schema/index.ts` to re-export the new table + inferred types `ConversationStarterCacheRow`, `NewConversationStarterCache`.
  - [ ] T1.4 Integration test extension at `packages/db/__tests__/integration/sharing-schema.integration.test.ts` (existing from Story 5.1) — add assertions: (a) `share_tokens` accepts NULL `expires_at`; (b) `conversation_starter_cache` rejects status outside the check constraint; (c) `ON DELETE CASCADE` from `share_tokens` removes `conversation_starter_cache` rows.

- [ ] **T2. RLS policy updates (AC5, AC6).** (AC: 5, 6)
  - [ ] T2.1 `packages/db/policies/custom_rls_share_tokens.sql` — update the doctor-principal SELECT predicate from `... AND expires_at > now()` to `... AND (expires_at IS NULL OR expires_at > now())`. Keep patient-principal policy unchanged.
  - [ ] T2.2 `packages/db/policies/custom_rls_share_token_biomarkers.sql` — same update inside the embedded EXISTS subquery (Story 5.1's doctor-principal policy).
  - [ ] T2.3 `packages/db/policies/custom_rls_conversation_starter_cache.sql` (NEW). Patient SELECT (own rows). Doctor SELECT (`share_token_id::text = current_setting('app.current_share_token_id', true)` AND `status = 'ready'` AND parent token non-revoked + (expires NULL OR future)). No INSERT/UPDATE/DELETE patient policies. ENABLE ROW LEVEL SECURITY.
  - [ ] T2.4 Update the test setup loader (`packages/db/__tests__/integration/setup.ts` or equivalent) to apply the new policy file.
  - [ ] T2.5 Extend `packages/db/__tests__/rls/helpers.ts` — add `doctorWithNoExpiryToken` identity (fixture token with `expires_at IS NULL` and `revoked_at IS NULL`).
  - [ ] T2.6 Update RLS tests:
    - `packages/db/__tests__/rls/share_tokens.rls.test.ts` — add `doctorWithNoExpiryToken` case (must SELECT successfully).
    - `packages/db/__tests__/rls/share_token_biomarkers.rls.test.ts` — same.
    - NEW `packages/db/__tests__/rls/conversation_starter_cache.rls.test.ts` — 6-identity matrix (correctPatient / wrongPatient / serviceRole / doctorWithActiveTokenAndReadyCache / doctorWithActiveTokenAndQueuedCache (must see 0) / doctorWithRevokedToken / doctorWithExpiredToken). The doctor-with-`queued`-cache case proves `status = 'ready'` predicate works.

- [ ] **T3. Router + duration param + conversation_starter enqueue (AC3, AC9, AC10, AC12).** (AC: 3, 9, 10, 12)
  - [ ] T3.1 `packages/api/src/router/sharing.ts` `createShareToken`:
    - Update input schema to accept `duration: shareDurationSchema` (required, no server default).
    - Inside the existing `ctx.db.transaction`, compute `expiresAt` from the duration map:
      ```
      const expiresAt =
        duration === "24h" ? new Date(Date.now() + 24 * 60 * 60 * 1000) :
        duration === "7d"  ? new Date(Date.now() + 7  * 24 * 60 * 60 * 1000) :
        duration === "30d" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) :
        /* no_expiry */    null;
      ```
    - Include `duration` in the existing `share_token.created` audit metadata.
    - **Idempotency carry-through:** the existing-token short-circuit still returns the existing row without modifying expires_at (AC11). Don't re-enqueue the conversation_starter job either.
    - On a fresh create: INSERT one row into `conversation_starter_cache` with `status='queued'`, `share_token_id=<new>`, `patient_id`, `expires_at=<computed>`.
    - Enqueue pg-boss job `conversation_starter.generate` with `{shareTokenId}` payload. Use `boss.send(jobName, data, options)` — if the `boss` instance is shared with the router's `ctx`, pass the tx handle. If not, mirror `services/extraction/src/notifications/emit.ts` pattern (raw SQL INSERT into `pgboss.job` inside the tx). Confirm by reading `packages/api/src/trpc.ts` for boss wiring; if none, do raw-SQL outbox.
    - Write `conversation_starter.queued` audit (constant from T5.1) in same tx.
  - [ ] T3.2 Add audit constants to `packages/validators/src/audit.ts` (or wherever `LETTER_AUDIT_*` lives — verify): `SHARING_AUDIT_CONVERSATION_STARTER_QUEUED`, `_GENERATED`, `_FAILED`. Re-export from `packages/validators/src/index.ts`.
  - [ ] T3.3 No public router procedure for conversation_starter in 5.2 (Epic 6's territory — doctor-side `conversationStarterRouter.getForShare`). Just write-paths from the worker.

- [ ] **T4. `services/llm` Conversation Starter consumer (AC4).** (AC: 4)
  - [ ] T4.1 `services/llm/src/adapters/anthropic.ts` — extend `LLMAdapter` interface with `generateConversationStarter({shareTokenId, patientId, visibleBiomarkers}) → Promise<ConversationStarterPayload>`. `createStubLLMAdapter()` returns a deterministic canned payload (3 prompts, N biomarker cards mirroring the input). Real Anthropic adapter throws `Error("Not implemented — Story 6.2")` with a clear message.
  - [ ] T4.2 `services/llm/src/consumers/generate-conversation-starter.ts` (NEW) — pg-boss handler:
    - Receive `{shareTokenId}`.
    - Load share_token row + visible biomarkers + observations (filter by visible categories).
    - Call `llm.generateConversationStarter(...)`.
    - UPDATE `conversation_starter_cache SET status='ready', payload=<jsonb>, generated_at=now() WHERE share_token_id = ?`.
    - `writeAuditLog(... conversation_starter.generated ...)` — actor `system` for worker writes (mirror letter consumer's actor convention).
    - On failure (after retries exhausted): UPDATE `status='failed', failure_reason=<short>`. Audit `conversation_starter.failed`.
    - Narrow catches — `Anthropic.APIError`, `ECONNRESET`; rethrow others.
  - [ ] T4.3 `services/llm/src/index.ts` — register the new queue (`await boss.createQueue('conversation_starter.generate', {retryLimit: 3, retryDelay: 30, retryBackoff: true})`) and the consumer.
  - [ ] T4.4 `services/llm/__tests__/consumers/generate-conversation-starter.test.ts` (NEW) — stub adapter test: returns canned payload deterministically; consumer writes 'ready' + payload + audit. Failure-path test: adapter throws → 'failed' status + audit.

- [ ] **T5. Validators (AC8, AC2, AC7, AC12).** (AC: 8, 2, 7, 12)
  - [ ] T5.1 `packages/validators/src/sharing.ts`:
    - Add `ShareDuration` type + `shareDurationSchema` enum.
    - Update `createShareTokenInputSchema` to require `duration`.
    - Add `DURATION_OPTIONS` typed readonly array (AC1 order).
    - Add `DURATION_LABEL_PT_BR_FN`.
    - Add `NO_EXPIRY_CONFIRM_BODY_PT_BR`, `NO_EXPIRY_CONFIRM_BUTTON_PT_BR`, `NO_EXPIRY_CONFIRM_CANCEL_PT_BR`.
    - Add `SHARE_SUMMARY_PT_BR_FN` (composes doctor name + visible categories list + duration label).
    - Add `SHARE_SUBMIT_BUTTON_PT_BR = "Enviar"`.
    - Add `CONTINUE_BUTTON_PT_BR = "Continuar"` (for the picker's primary action).
    - **Remove** stale: `COMPARTILHAR_NUOVO_DURACAO_PROGRESS_PT_BR`, `SHARE_DEFAULT_DURATION_DAYS` (and audit-update any references).
    - Add the three audit constants from T3.2.
  - [ ] T5.2 Update Zod refinement tests under `packages/api/__tests__/sharing/configure-biomarkers-validators.test.ts` (or add a new file) to cover `createShareTokenInputSchema`: rejects missing duration, accepts all 4 valid values, rejects unknown strings.

- [ ] **T6. UI: Duration picker + Sem-prazo modal + Summary screen (AC1, AC2, AC4 (consumer side), AC7).** (AC: 1, 2, 7)
  - [ ] T6.1 `packages/ui/src/components/DurationOption/DurationOption.tsx` (NEW) — Tamagui radio-like card: large tap target, teal selected state via `$primaryAction`-family semantic token, secondary muted state for unselected. Props: `{value: ShareDuration, label: string, selected: boolean, onSelect: () => void}`. Accessibility: `accessibilityRole="radio"`, `accessibilityState={{selected}}`, `accessibilityLabel`. Barrel via `index.ts`.
  - [ ] T6.2 `packages/ui/src/components/NoExpiryConfirmDialog/NoExpiryConfirmDialog.tsx` (NEW) — Tamagui `Sheet` / native modal. Props: `{open: boolean, onConfirm: () => void, onCancel: () => void}`. Body uses `NO_EXPIRY_CONFIRM_BODY_PT_BR`. Confirm button is Tier 2; Cancel is Tier 3. Pressable backdrop = onCancel. Barrel via `index.ts`.
  - [ ] T6.3 `apps/expo/src/app/(tabs)/compartilhar/novo/duracao.tsx` — **REPLACE** the placeholder with the real picker. Local state: `selectedDuration` (default `"7d"`). Render 4 `DurationOption` rows in `DURATION_OPTIONS` order. Below: Tier-2 "Continuar" button. On press: if `selectedDuration === "no_expiry"`, open `NoExpiryConfirmDialog`. On confirm (or directly for non-no_expiry): call `sharingRouter.createShareToken.useMutation({...})` with `{inviteId, duration: selectedDuration}`. On success: `router.replace('/(tabs)/compartilhar/${shareTokenId}/biomarcadores')`. Handle error with Toast `BIOMARKER_TOGGLE_FAILED_PT_BR` (reuse existing constant).
  - [ ] T6.4 `apps/web/src/app/compartilhar/novo/duracao/page.tsx` — web parity. Same flow, same Zod schemas, same constants. Tamagui RNW renders the same components.
  - [ ] T6.5 `apps/expo/src/app/(tabs)/compartilhar/[shareTokenId]/resumo.tsx` (NEW; replaces `concluido.tsx`):
    - Fetch via `sharingRouter.getDraftConfig.useQuery({shareTokenId})` (existing Story 5.1 procedure — verify it returns `expires_at` and `doctor.displayName`; if not, extend in T3.1).
    - Render summary sentence using `SHARE_SUMMARY_PT_BR_FN(doctorName, visibleCategories, durationOrNoExpiry)`. Duration is derived from `expires_at` (NULL → "no_expiry"; else round-trip-compute from interval).
    - Tier-2 "Enviar" button. On press: generate share URL (call new helper `buildShareUrl(shareTokenId)` in `packages/api/src/sharing.ts` that signs the URL with the HMAC secret; or expose via tRPC procedure `sharingRouter.getShareUrl({shareTokenId}) → {url}`). Then invoke native share sheet:
      - Mobile: `await Sharing.shareAsync(url)` from `expo-sharing` (verify the package is present; if not, add).
      - Web: try `await navigator.share({url, title, text})`; fallback to `navigator.clipboard.writeText(url)` + Toast `SHARE_URL_COPIED_PT_BR`.
  - [ ] T6.6 `apps/web/src/app/compartilhar/[shareTokenId]/resumo/page.tsx` — web parity.
  - [ ] T6.7 **Delete** `apps/expo/src/app/(tabs)/compartilhar/[shareTokenId]/concluido.tsx` and `apps/web/src/app/compartilhar/[shareTokenId]/concluido/page.tsx`. Update any links/router pushes from Story 5.1 that pointed at `concluido` to point at `resumo` (verify in `biomarcadores.tsx` `onDone` handler).

- [ ] **T7. `sharingRouter.getShareUrl` procedure (AC7).** (AC: 7)
  - [ ] T7.1 `packages/api/src/router/sharing.ts` — new `protectedProcedure` (NOT `premiumProcedure` — generating the URL for an existing share is part of the ceremony; if `createShareToken` succeeded then the patient was already premium-gated): `getShareUrl({shareTokenId: z.string().uuid()}) → {url: string}`. Verifies `share_tokens.patient_id = ctx.session.user.id` (404 on mismatch — discipline from Story 5.1). Composes URL via `buildShareUrl(shareTokenId, tokenHmac)` helper in `packages/api/src/sharing.ts` (T7.2). Reads `tokenHmac` from the `share_tokens` row (never exposed outside this resolver). Does NOT emit a new audit — share-URL retrieval is an internal patient action; only the doctor's eventual access fires audit (Epic 6).
  - [ ] T7.2 `packages/api/src/sharing.ts` — new `buildShareUrl(shareTokenId, tokenHmac)` returning `${env.WEB_APP_URL}/m/${shareTokenId}.${tokenHmac}`. `/m/` is the magic-link route (Epic 6 owns the route; Story 5.2 generates the URL shape and `WEB_APP_URL` is a new env var). Document `WEB_APP_URL` in `.env.example` and CLAUDE.md.

- [ ] **T8. Tests (every AC).** (AC: all)
  - [ ] T8.1 Unit: `packages/api/__tests__/sharing/create-share-token-validators.test.ts` (extend existing or new) — duration enum accepts/rejects.
  - [ ] T8.2 Integration: extend `packages/api/__tests__/sharing/configure-biomarkers.integration.test.ts` (or create `packages/api/__tests__/sharing/create-share-token.integration.test.ts`) — `it.todo()` placeholders + at least one synchronous test for the duration → expires_at mapping. Cover: 24h / 7d / 30d / no_expiry → expected expires_at value (use `vi.useFakeTimers()` to lock now()).
  - [ ] T8.3 Integration: `packages/db/__tests__/integration/conversation-starter-cache.integration.test.ts` (NEW) — testcontainer fixture: schema comes up, check constraint rejects invalid status, ON DELETE CASCADE from share_tokens removes cache rows.
  - [ ] T8.4 RLS tests T2.6 above.
  - [ ] T8.5 `services/llm/__tests__/consumers/generate-conversation-starter.test.ts` — stub adapter produces deterministic payload; consumer writes 'ready' + audit; failure path writes 'failed' + audit.
  - [ ] T8.6 Snapshot: `DurationOption` shared/unselected/disabled states; `NoExpiryConfirmDialog` open/closed.
  - [ ] T8.7 Behavior: "Sem prazo" picker → confirmation modal flow → on confirm, mutation fires with `duration: 'no_expiry'`; on cancel, no mutation fires.

- [ ] **T9. Env + docs.**
  - [ ] T9.1 `.env.example` — add `WEB_APP_URL=http://localhost:3000` with a comment ("Base URL for share links — Epic 6 doctor magic-link route lives at /m/...").
  - [ ] T9.2 CLAUDE.md — add `WEB_APP_URL` to required-vars. Append "Sharing duration notes (Story 5.2)" paragraph: `expires_at` is now nullable; NULL means no expiry; RLS predicate updated to `(IS NULL OR > now())`. Append note: `conversation_starter_cache` is pre-warmed at token-create time via `conversation_starter.generate` pg-boss queue hosted in `services/llm`; dev stub adapter returns canned payload until DPA + Epic 6 prompt land.
  - [ ] T9.3 `docs/rls-review-checklist.md` — add `doctorWithNoExpiryToken` to the standard identity matrix.

## Dev Notes

### Architecture references (authoritative)

- **`conversation_starter_cache` table:** `_bmad-output/planning-artifacts/architecture.md` lines 412–421. Pre-gen at token-create time; doctor surface (Epic 6) reads from this table; cold LLM at doctor-tap is a conversion failure (architecture.md §11 line 129).
- **NFR-P4 (<3s doctor conversion window):** architecture.md line 43. Drives the pre-gen-at-token-create decision.
- **`SET LOCAL app.current_share_token_id` doctor principal:** Story 5.1 ADR; mirrors `app.current_patient_id` (architecture.md lines 519–540).
- **pg-boss queue pattern (Story 4.1 precedent):** `services/llm/src/index.ts:32–45`. Add a sibling queue for `conversation_starter.generate`. Use `retryLimit: 3, retryDelay: 30, retryBackoff: true` — same as `letter.generate`.
- **Stub-adapter pattern (Story 4.1 precedent):** `services/llm/src/adapters/anthropic.ts:146–190` (`createStubLLMAdapter`). Empty `ANTHROPIC_API_KEY` → stub adapter; non-empty → real Sonnet. Story 5.2's stub returns a canned `ConversationStarterPayload` JSONB.

### UX references (authoritative)

- **Duration picker UX:** `_bmad-output/planning-artifacts/ux-design-specification.md` lines 1195–1211. Visual order, default selection, confirmation modal.
- **Tier-2 "Enviar":** UX spec line 1107 (Tier 2 = secondary, outlined teal). UX-DR13 mandates sharing actions are NEVER Tier 1.
- **Copy verbatim:**
  - Duration labels: "24 horas" / "7 dias" / "30 dias" / "Sem prazo".
  - No-expiry confirmation body: "Confirmar acesso sem prazo — o médico poderá ver seus dados até você revogar manualmente."
  - Summary sentence form: "{Doctor display name} verá: {biomarcadores} — {duração ou "sem prazo"}."
  - Send button: "Enviar".

### Patterns to copy (don't reinvent)

- **`writeAuditLog` in same tx:** Story 5.1 fix-up (`router/sharing.ts` `ctx.db.transaction(async (tx) => ...)` pattern). Reuse — never split mutation + audit across multiple `ctx.db` calls.
- **Stub-LLM gate by empty env var:** Story 4.1 `services/llm/src/index.ts:22–30`. Apply same gate for Conversation Starter (the gate is module-level; one selector per process).
- **Outbox-style enqueue inside tx:** Story 4.1 reference to `services/extraction/src/notifications/emit.ts` — if `boss.send()` isn't tx-aware against the same Postgres pool, INSERT directly into `pgboss.job` from the resolver's tx.
- **RLS test identity factory:** `packages/db/__tests__/rls/helpers.ts` Story 5.1 extensions. Add `doctorWithNoExpiryToken` and `doctorWithActiveTokenAndReadyCache` / `_AndQueuedCache`.
- **Narrow catches:** every new `try/catch` in this story must articulate which error shapes it swallows. Worker retries are pg-boss territory; user-facing tRPC mutations rethrow everything that isn't a known database conflict.
- **Validators-as-shared-truth:** all pt-BR copy + all magic numbers + all audit-event names in `packages/validators`. Story 5.1 R1 review caught multiple inline-pt-BR violations — do not repeat.
- **404 not 403 on cross-patient resource lookups:** `getShareUrl` follows the same rule (Story 5.1 R1 finding).

### Anti-patterns explicitly forbidden in 5.2

- Do **NOT** set a server-side default for `duration` in `createShareTokenInputSchema`. The screen owns the default-selection of `"7d"`. Server-side default invites callers that "forgot" to pick — surfacing the omission at the screen layer is correct.
- Do **NOT** issue `boss.send('conversation_starter.generate', ...)` outside the same transaction as the share_token INSERT. If pg-boss isn't tx-aware, write the row directly to `pgboss.job` table inside the tx (outbox pattern from Story 4.1).
- Do **NOT** generate the share-URL string on the client. The HMAC signing secret stays server-side; expose only through `sharingRouter.getShareUrl`.
- Do **NOT** physical-delete the `concluido.tsx` routes before verifying all `router.replace` / `router.push` call sites point at `resumo` instead.
- Do **NOT** broad-catch `(err)` in the Conversation Starter consumer; narrow to `Anthropic.APIError` + `ECONNRESET` (mirror the Letter consumer).
- Do **NOT** include the raw `tokenHmac` value in any audit-log metadata or log line. The cookie-like secret must never appear in observability.
- Do **NOT** introduce a sentinel far-future date for no-expiry. Use SQL `NULL` and update RLS predicates accordingly.
- Do **NOT** add a `pnpm db:push` migration step that drops the existing NOT NULL constraint without checking `pnpm db:push` actually emits a safe `ALTER COLUMN DROP NOT NULL` (it does — verify in dev). The prod migration deferral still applies; Story 5.7 will batch this `DROP NOT NULL` with the rest.
- Do **NOT** introduce a Tier-1 "Enviar" button (UX-DR13).
- Do **NOT** include the doctor's raw `displayName` in any audit-log metadata. Continue to hash via `identifier_hash` for audit; the display name is patient-private.

### Latest tech notes (query Context7 before locking versions)

- **`expo-sharing` SDK 54** — confirm `Sharing.shareAsync(url, {dialogTitle})` is the current API. If a different module name (e.g. `Sharing.isAvailableAsync`) is the gate, follow the gate-first pattern.
- **`navigator.share` Web API** — confirm browser support story; provide clipboard fallback explicitly.
- **`pg-boss` 12.18.x** — confirm the `send(name, data, options)` signature accepts a custom Postgres connection for tx-aware enqueue. If not, write directly to `pgboss.job` and let pg-boss pick it up.

### Previous story intelligence — Story 5.1 (R1 fix-up complete)

- **R1 finding: `createShareToken` not in tx.** Already fixed in Story 5.1 R1 patches. The Story 5.2 extension to `createShareToken` MUST live inside the same `ctx.db.transaction` — do not add new code outside it.
- **R1 finding: Concluir fire-and-forget.** Already fixed: `flushPending` → `flushAsync` and awaited. Story 5.2's `resumo.tsx` similarly must `await` any final mutation before invoking the share-sheet.
- **R1 finding: Inline pt-BR.** Story 5.2 introduces multiple new copy strings — all must land in `packages/validators/src/sharing.ts`. Reviewer will grep.
- **R1 finding: RLS test matrix gaps.** Story 5.1 R1 filled to 6 identities. Story 5.2 adds `doctorWithNoExpiryToken` — extend the same helper file.
- **R1 finding: Narrow catches.** The Conversation Starter consumer uses worker-style retries; follow the Letter consumer's catch shape (`Anthropic.APIError` + `ECONNRESET` only).

### Project Structure Notes

All new file locations align with existing conventions:

- `packages/db/src/schema/sharing.ts` — extended in-place (one-file-per-feature precedent).
- `packages/db/policies/custom_rls_conversation_starter_cache.sql` — matches existing `custom_rls_<table>.sql` naming.
- `packages/api/src/router/sharing.ts` — extended in-place.
- `services/llm/src/consumers/generate-conversation-starter.ts` — matches `generate-letter.ts` precedent.
- `packages/ui/src/components/DurationOption/`, `NoExpiryConfirmDialog/` — barrel directories match Story 4.1 / 5.1 component precedent.
- `apps/expo/src/app/(tabs)/compartilhar/` — extends existing Story 5.1 routes.
- `packages/validators/src/sharing.ts` — extended in-place.

No structural conflicts.

### Testing standards summary

- **DB integration + RLS:** testcontainer-postgres-16; runs via `pnpm --filter @healthtracker/db test:integration` + `test:rls`. New `conversation_starter_cache.rls.test.ts` and the share_tokens / share_token_biomarkers nullable-expiry case.
- **API integration:** testcontainer + tRPC caller; cover the duration → expires_at mapping with fake timers.
- **`services/llm` worker:** unit-test the new consumer against an in-memory pg-boss stub + stub LLM adapter.
- **Mobile/web component:** snapshot `DurationOption` + `NoExpiryConfirmDialog`. Behavior test the no_expiry → modal flow.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2 lines 1239–1263]
- [Source: _bmad-output/planning-artifacts/architecture.md#Conversation Starter cache lines 412–421]
- [Source: _bmad-output/planning-artifacts/architecture.md#NFR-P4 line 43]
- [Source: _bmad-output/planning-artifacts/architecture.md#Sharing token structure lines 434–445]
- [Source: _bmad-output/planning-artifacts/architecture.md#Doctor latency 90s window line 129]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Duration picker lines 1195–1211]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Tier 2 button line 1107]
- [Source: _bmad-output/implementation-artifacts/5-1-patient-configures-per-biomarker-sharing-with-a-named-doctor.md — Epic 5 schema + RLS + sharingRouter precedent]
- [Source: _bmad-output/implementation-artifacts/4-1-patient-receives-a-streamed-letter-narrative-after-a-draw-is-confirmed.md — services/llm stub-adapter pattern + pg-boss queue + ANVISA framing]
- [Source: services/llm/src/index.ts:22-45 — adapter selector + queue/consumer registration]
- [Source: services/llm/src/adapters/anthropic.ts:146-190 — createStubLLMAdapter]
- [Source: services/llm/src/consumers/generate-letter.ts — consumer pattern to mirror]
- [Source: packages/db/src/schema/sharing.ts:76-115 — Story 5.1 share_tokens schema to extend]
- [Source: packages/db/policies/custom_rls_share_*.sql — Story 5.1 RLS policies to amend]
- [Source: packages/api/src/router/sharing.ts createShareToken — Story 5.1 tx wrapper to extend]
- [Source: packages/validators/src/sharing.ts — Story 5.1 audit + copy constants to extend]
- [Source: epics.md Story 6.2 lines 1437-1461 — doctor-side consumer of conversation_starter_cache]
- [Source: CLAUDE.md — narrow-catches, validators-as-shared-truth, audit-in-tx discipline]

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Known infra blockers (out-of-code)

- **Production migration still deferred.** `supabase/migrations/0005_epic_5_sharing_schema.sql` lands in the last story of Epic 5. Story 5.2 adds nullable `expires_at` + `conversation_starter_cache` to the deferred bundle.
- **`WEB_APP_URL`** must be set in dev/staging/prod. Boot-time check rejects empty in production. Dev default: `http://localhost:3000`.
- **`ANTHROPIC_API_KEY`** still gates real-vs-stub. Story 5.2 stays in stub mode for Conversation Starter; real prompt + DPA gate are Story 6.2's territory.
- **Doctor-side consumer (Epic 6 Story 6.2)** reads the `conversation_starter_cache` row this story populates. The payload shape locked here (3 prompts + biomarkerCards) is the contract Epic 6 will consume.
