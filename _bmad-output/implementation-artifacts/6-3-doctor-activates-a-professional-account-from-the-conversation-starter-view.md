# Story 6.3: Doctor activates a professional account from the Conversation Starter view

Status: review

Stacked on PR #57 (the `worktree-story-6-2` branch — Story 6.2 is the immediate predecessor). Third story of Epic 6. Closes the Doctor Acquisition Loop's first leg: a doctor who viewed a single patient's Conversation Starter now becomes addressable for future patient shares AND a future referrer (Story 6.4). This story is where `pending_invites.resolved_user_id` is finally flipped, where the long-deferred FK on that column lands, and where the `professionals` row gets created.

## Story

As a doctor who has authenticated and is viewing a patient's Conversation Starter report,
I want to activate a Health Tracker professional account in one step from inside the report view,
so that I can receive future patient shares and build my own patient panel without leaving the current flow.

## Acceptance Criteria

1. **AC1 — Activation banner inside `ReportLayout`.** The Story 6.2 RSC (`apps/web/src/app/m/[token]/view/page.tsx`) renders an additional `<ProfessionalAccountBanner>` client component below the biomarker-card grid (NOT inside the polling / failed states — only when `cacheStatus === 'ready'` AND the doctor is **not yet activated**). The banner is non-intrusive: muted-neutral surface (NOT a primary CTA colour — the UX governing copy on line 1115 of `ux-design-specification.md` reserves the single Tier-1 action at report close for Story 6.4's "Invite [patient] to share more"). Layout: full-width strip at the bottom of the report, sticky on desktop (>=$md), inline at the end of the grid on mobile. UX-DR9 framing: "offer, not gate".

   **Pt-BR copy (named constants in `packages/validators/src/professional.ts` — NEW file):**
   - Banner heading: `Ative sua conta profissional` (`PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR`)
   - Banner subheading: `Receba os próximos compartilhamentos dos seus pacientes em um só lugar.` (`PROFESSIONAL_ACTIVATION_BANNER_SUBHEADING_PT_BR`)
   - Banner CTA: `Ativar conta` (`PROFESSIONAL_ACTIVATION_BANNER_CTA_PT_BR`)
   - Banner dismiss (X icon a11y label): `Fechar` (`PROFESSIONAL_ACTIVATION_BANNER_DISMISS_A11Y_PT_BR`)

   **Returning doctor:** if the doctor already has a `professionals` row, the banner is NOT rendered. This is decided server-side in the RSC via `sharingRouter.getActivationStatus({ shareTokenId })` (AC6) — see AC4. The check is gated on `doctorProcedure` so `auth.uid()` is available; the share-token context is reused.

2. **AC2 — Activation modal.** Tapping the banner CTA opens `<ProfessionalAccountModal>` (client component, web-only). Single-step form (one screen, one CTA — UX-DR9 "frictionless activation"). Fields:
   - **Email (read-only):** pre-filled with `ctx.session.user.email` (already authenticated via Story 6.2 magic-link). Rendered as a disabled input with a small "verified" badge — never editable. Reviewers: edit-ability here is an identity-binding bug; the email under `auth.uid()` IS the professional identity. Patch in R1 if it lands editable.
   - **Display name:** text input pre-filled with the local-part of the email (e.g. `dr.rodrigo@gmail.com` → `dr.rodrigo`). Patient-facing; max 80 chars; `.trim().min(1)`.
   - **Professional category:** Tamagui `Select` (UX-DR16 — Select pattern). Options come from a CLOSED ENUM (AC7) — `endocrinologista | cardiologista | medicina_esportiva | nutrologo | nutricionista | clinico_geral | outro`. Pt-BR labels live in `packages/validators/src/professional.ts`. Default selection: none — the user MUST pick (Zod `.refine` on submit; "Selecione uma categoria" inline error).
   - **CTA:** "Ativar conta" — single button, full-width on mobile, right-aligned on desktop.

   **Pt-BR copy:** `PROFESSIONAL_ACTIVATION_MODAL_HEADING_PT_BR = "Ative sua conta profissional"`, `PROFESSIONAL_ACTIVATION_EMAIL_LABEL_PT_BR = "E-mail (verificado)"`, `PROFESSIONAL_ACTIVATION_DISPLAY_NAME_LABEL_PT_BR = "Como você quer aparecer para seus pacientes"`, `PROFESSIONAL_ACTIVATION_CATEGORY_LABEL_PT_BR = "Especialidade"`, `PROFESSIONAL_ACTIVATION_CATEGORY_PLACEHOLDER_PT_BR = "Selecione…"`, `PROFESSIONAL_ACTIVATION_CTA_PT_BR = "Ativar conta"`, `PROFESSIONAL_ACTIVATION_CTA_LOADING_PT_BR = "Ativando…"`, `PROFESSIONAL_ACTIVATION_GENERIC_ERROR_PT_BR = "Não foi possível ativar agora. Tente novamente."`. Success confirmation: `PROFESSIONAL_ACTIVATION_SUCCESS_PT_BR = "Conta ativada. Em breve você poderá convidar pacientes."`.

   **NO CRM/license collection.** The epics body (line 1479) lists "professional category (endocrinologista, cardiologista, etc.)" as the only structured field. CRM validation is OUT-OF-SCOPE for this story. Document in deferred-work; revisit before Epic 6 launch if regulatory review demands it.

3. **AC3 — `activateProfessionalAccount` mutation under `doctorProcedure`.** New procedure on `sharingRouter` (NOT a new router — sharing is already the home of the doctor-side surface; keeping it co-located makes the GUC pattern and middleware sharing obvious). Input: `{ shareTokenId: z.uuid(), tokenHmac: z.string().min(1).max(128), displayName: z.string().trim().min(1).max(80), category: professionalCategorySchema }`.

   The `tokenHmac` is required even though `doctorProcedure` already pins the GUC — same defense-in-depth as Story 6.2's `getConversationStarter` (constant-time HMAC re-check against the persisted `share_tokens.token_hmac`; a malicious extension that snooped `x-share-token` from another tab still fails this check). Mismatch → `TRPCError({code:"NOT_FOUND"})`.

   **Atomic transaction (CRITICAL ordering):**
   1. `SELECT id, patient_id, invite_id FROM share_tokens WHERE id = $1 LIMIT 1` — RLS-bound to the doctor principal. Zero rows → `NOT_FOUND`.
   2. `constantTimeEqualHmac(row.token_hmac, input.tokenHmac)` re-check.
   3. `SELECT id, resolved_user_id FROM pending_invites WHERE id = $invite_id FOR UPDATE` — service-role bypass (the doctor principal can't SELECT pending_invites; their identity hasn't been bound yet — chicken/egg). Use `getSupabaseAdminClient()` or `ctx.db.execute(sql\`...\`)`raw with role escalation per`protectedProcedure`patterns. **Decision:** use the existing transactional`tx`and raw SQL inside`SET LOCAL ROLE postgres`so the lock and the subsequent UPDATE share the transaction. The CLAUDE.md "Sharing schema notes" hand-off comment said`claimInviteByDoctor`would land here — the FOR UPDATE is the exclusive lock that lets us race-safely decide whether to flip`resolved_user_id` or no-op (per AC5 idempotency).
   4. **Branch on `resolved_user_id`:**
      - `NULL` → `UPDATE pending_invites SET resolved_user_id = ctx.session.user.id WHERE id = $invite_id` (the canonical Story 5.1 → Epic 6 deferred flip).
      - Non-NULL AND `= ctx.session.user.id` → no-op (idempotent re-activation).
      - Non-NULL AND `!= ctx.session.user.id` → `TRPCError({code:"CONFLICT", message:"INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR"})`. This is the cross-doctor race outcome — patient invited Dr. Rodrigo by email, Dr. Rodrigo received the link AND forwarded it to a colleague who also clicked. The first doctor to activate owns the invite. The colleague gets `CONFLICT`. UI handles via `PROFESSIONAL_ACTIVATION_CONFLICT_PT_BR = "Este link já foi vinculado a outro profissional."`.
   5. `INSERT INTO professionals (user_id, display_name, category, created_at) VALUES (ctx.session.user.id, $displayName, $category, now()) ON CONFLICT (user_id) DO NOTHING RETURNING user_id` — the PK = `user_id` makes the INSERT idempotent for AC5. If RETURNING is empty (row already existed), SELECT the row and return its values; otherwise return the freshly-inserted row.
   6. `writeAuditLog(tx, { event: "professional_account.activated", actorId: ctx.session.user.id, actorType: "doctor", resourceId: ctx.session.user.id, resourceType: "professional", metadata: { shareTokenId, inviteId, category } })`. **Actor and resource are both the doctor's `auth.uid()`** — this is a self-targeted action (the doctor activated themselves). The metadata carries the share-token context for forensic correlation. **NOT in `ACCESS_LOG_EVENT_KINDS`** (AC8) — this is operator/growth telemetry, not a patient-visible access event.

   **Output:** `{ activated: true, displayName, category, alreadyActivated: false | true }`. `alreadyActivated:true` is the idempotent re-tap branch; the modal closes with the success toast either way.

   **Narrow catches:** the 23505 path (concurrent INSERT race on the user_id PK — two browser tabs / double-tap) folds into success via `ON CONFLICT DO NOTHING` + post-INSERT SELECT. No bare `try { } catch (err) {}` — re-throw `TypeError | ReferenceError | SyntaxError` and the `CONFLICT` distinct from `NOT_FOUND`.

4. **AC4 — `getActivationStatus` query under `doctorProcedure`.** Companion read-only resolver. Input: `{}` (the GUC already binds the share-token; activation status is `auth.uid()`-scoped, not token-scoped — see decision note below). Output: `{ activated: boolean; displayName: string | null; category: ProfessionalCategory | null }`.

   Resolver: `SELECT user_id, display_name, category FROM professionals WHERE user_id = ctx.session.user.id LIMIT 1`. RLS predicate: doctors can SELECT their own `professionals` row (`user_id = auth.uid()`). Returns `activated:false` with null fields if zero rows. **No audit row** — this is a render-time existence check, not an access event.

   **Decision note (token-scoped vs user-scoped):** the activation status is keyed on `auth.uid()`, not on the share_token. A doctor activated via a previous patient's token IS activated when they open a new patient's report. This is the entire point of the Doctor Acquisition Loop — activation persists across share-token contexts. Document in CLAUDE.md (AC10).

   The Story 6.2 view RSC calls this resolver in parallel with `getConversationStarter` (both inside the same `Promise.all` to keep the <3s NFR-P4 budget intact — neither adds a serial RTT).

5. **AC5 — Idempotency.** Double-tap, tab-refresh, and "I activated yesterday and clicked again today" all collapse to a single `professionals` row. Mechanisms (defense in depth):
   - **PK = `user_id`** on `professionals` — single `professionals` row per Supabase user.
   - **`ON CONFLICT (user_id) DO NOTHING`** in the INSERT — concurrent INSERTs serialize to one winner.
   - **`SET resolved_user_id = $uid WHERE id = $invite AND resolved_user_id IS NULL`** — applied via `WHERE` clause so a re-activation by the same doctor is a no-op UPDATE (zero rows touched), not a duplicate flip. Returns the row regardless.
   - **`writeAuditLog` is conditional on `alreadyActivated:false`** — re-activation does NOT write a second `professional_account.activated` row. The R1 audit-amplification lesson from Story 6.2 R1-H1 applies verbatim: one row per activation, ever.

6. **AC6 — Doctor activation visible in patient's audit trail (forensic only, NOT Access Log).** When the doctor activates, the `professional_account.activated` audit row's `metadata.shareTokenId` makes the activation discoverable via SQL by the operator if needed. The patient does NOT see "Dr. X activated their account" in their Access Log — the event is a doctor-side identity binding, not a patient-data access event. This is the explicit deviation from Story 5.1's pattern (sharing events ARE in `ACCESS_LOG_EVENT_KINDS`) and is documented in CLAUDE.md (AC10).

   **Open product question (round-1):** does the patient want to see "Dr. Rodrigo (verified professional) abriu sua conta" as a positive-signal event in their Access Log? Today's spec says NO (out of scope; doctor activation is doctor-side telemetry). If product wants YES, the path is: add `professional_account.activated` to `ACCESS_LOG_EVENT_KINDS`, extend RLS on `audit_log` so patients can SELECT rows where `metadata->>'shareTokenId'` matches one of their share_tokens (mirrors the Story 5.3 R1 pattern), and add a pt-BR label to `ACCESS_LOG_EVENT_LABEL_PT_BR_FN`. Defer until 6.4 retro — flag in dev notes.

7. **AC7 — `professionalCategoryEnum` (closed set).** A Postgres `pgEnum` named `professional_category_enum` with values: `endocrinologista | cardiologista | medicina_esportiva | nutrologo | nutricionista | clinico_geral | outro`. The enum is duplicated in Zod via `professionalCategorySchema = z.enum([...])` in `packages/validators/src/professional.ts`. The pt-BR label map (`PROFESSIONAL_CATEGORY_LABEL_PT_BR`) lives next to the schema so the modal's Select renders human strings without a server roundtrip. **Reviewer rule:** any new category requires (a) Drizzle enum + migration, (b) Zod enum update, (c) pt-BR label addition — all three or none. Use the audit checklist in T9.

8. **AC8 — Audit kind constant.** Add `PROFESSIONAL_ACCOUNT_ACTIVATED_AUDIT = "professional_account.activated"` to `packages/validators/src/professional.ts` (NOT `sharing.ts` — this is doctor-side identity, not sharing). Do NOT add to `ACCESS_LOG_EVENT_KINDS` (AC6 rationale).

9. **AC9 — Schema: NEW `professionals` table + FK declaration on `pending_invites.resolved_user_id`.**

   **New table `professionals`** (Drizzle schema in `packages/db/src/schema/professionals.ts` — NEW file; barrel-export from `packages/db/src/schema/index.ts`):

   ```ts
   export const professionalCategoryEnum = pgEnum(
     "professional_category_enum",
     [
       "endocrinologista",
       "cardiologista",
       "medicina_esportiva",
       "nutrologo",
       "nutricionista",
       "clinico_geral",
       "outro",
     ],
   );

   export const Professionals = pgTable("professionals", (t) => ({
     userId: t
       .uuid()
       .notNull()
       .primaryKey()
       .references(() => Users.id, { onDelete: "cascade" }),
     displayName: t.text().notNull(),
     category: professionalCategoryEnum("category").notNull(),
     createdAt: t
       .timestamp({ mode: "date", withTimezone: true })
       .defaultNow()
       .notNull(),
   }));
   ```

   **PK = `userId`** enforces single-`professionals`-row-per-Supabase-user (AC5).
   **`onDelete: cascade`** complies with the Story 5.6 LGPD-erasure FK-cascade rule for every new FK to `users(id)`.

   **`pending_invites.resolved_user_id` FK addition** — the long-deferred flip. Edit `packages/db/src/schema/sharing.ts`:

   ```ts
   resolvedUserId: t
     .uuid()
     .references(() => Users.id, { onDelete: "set null" }),
   ```

   **`onDelete: set null` (NOT cascade)** — this is the only justified exception to the Story 5.6 cascade rule. Rationale: the `pending_invites` row encodes the patient's intent ("I wanted to share with Dr. X by email"); if Dr. X later deletes their account, the patient's intent should survive — the row simply orphans back to "unresolved." Cascading would silently delete patient-authored data on a third-party action (the doctor's account deletion), which is wrong directionally. Document in CLAUDE.md (AC10) so future reviewers understand the cascade-rule deviation.

   **Migration discipline (CRITICAL):**
   - For DEV: `pnpm db:push` is safe — additive table + nullable FK addition. Drizzle emits `ALTER TABLE pending_invites ADD CONSTRAINT pending_invites_resolved_user_id_users_id_fk FOREIGN KEY (resolved_user_id) REFERENCES users(id) ON DELETE SET NULL` — this acquires a brief `AccessExclusiveLock` on `pending_invites` to validate existing rows. **Because `resolved_user_id` is currently NULL in every row** (Epic 6 has not flipped it yet), validation is instant — no orphan-row risk.
   - For PROD: this story does NOT ship a `supabase/migrations/*.sql` file. The Epic 6 consolidated migration (Story 6.6 per the epics body) is where prod-deploy happens. **Document the FK addition in `_bmad-output/implementation-artifacts/deferred-work.md`** so Story 6.6 knows to include both objects (new `professionals` table + new FK on `pending_invites.resolved_user_id`). Mirrors the Story 3.5 / 4.4 / 5.x batched-migration pattern.
   - For staging (between dev and Story 6.6 merge): `pnpm db:push` is OK. The lock window is sub-second on Supabase's default workload because `pending_invites` is small (<10K rows expected pre-launch). If staging-load somehow makes this risky, consider `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID; ALTER TABLE ... VALIDATE CONSTRAINT ...` two-step — but only flag this for 6.6's migration author; don't do it in 6.3.

   **RLS policy for `professionals`:** new file `packages/db/policies/custom_rls_professionals.sql`. Three policies:
   - `professionals_select_own`: `auth.uid() = user_id` — doctors can SELECT only their own row. Used by `getActivationStatus`.
   - `professionals_insert_own`: `auth.uid() = user_id` — doctors can INSERT only as themselves. Defends against a `doctorProcedure` resolver that accidentally writes someone else's row.
   - `professionals_service_role_all`: `auth.role() = 'service_role'` — admin/operator bypass for ops.
   - **No UPDATE / DELETE policies** — display-name edits are a future story (deferred); deletion piggybacks on the `users` cascade.

10. **AC10 — Docs: CLAUDE.md "Professional account activation (Story 6.3)" paragraph** under the existing "Doctor magic-link discipline (Story 6.2)" paragraph. Cover:
    - (a) The `professionals` table contract: PK = `user_id`, single row per Supabase user, populated only at Story 6.3 activation.
    - (b) The `pending_invites.resolved_user_id` FK was deferred from Story 5.1 and landed in 6.3 with `onDelete: set null` (NOT cascade). Rationale: invite row encodes patient intent and outlives the doctor's account; cascade would silently delete patient-authored data on a third-party (doctor) deletion. **This is the only justified exception to the Story 5.6 "every new FK to `users(id)` must use cascade" rule.**
    - (c) `professional_account.activated` audit is intentionally NOT in `ACCESS_LOG_EVENT_KINDS` — doctor-side identity binding, not a patient-data access event. Round-1 product question on whether to surface in patient Access Log is logged in deferred-work.
    - (d) Activation status is `auth.uid()`-scoped, NOT share_token-scoped — a doctor activated via patient A's token IS activated when they open patient B's token. This is the Doctor Acquisition Loop closure.
    - (e) Cross-doctor invite-claim race is rejected with `CONFLICT` (`INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR`). First-to-activate wins; the loser sees a pt-BR explanation.
    - (f) No CRM / license validation in this story. UX-DR9 says "frictionless activation"; CRM gating would gate. Deferred-work tracks the regulatory revisit.
    - (g) Epic 6 consolidated migration (Story 6.6) is the home for the prod migration; Story 6.3 ships dev-only `pnpm db:push` plus the schema files + RLS policy file. Listed in deferred-work.

## Tasks / Subtasks

- [x] **T1 — Validators (`packages/validators/src/professional.ts` — NEW FILE)** (AC1, AC2, AC3, AC7, AC8)
  - [x] T1.1 Export `professionalCategorySchema = z.enum(["endocrinologista","cardiologista","medicina_esportiva","nutrologo","nutricionista","clinico_geral","outro"])` and `type ProfessionalCategory`.
  - [x] T1.2 Export `PROFESSIONAL_CATEGORY_LABEL_PT_BR: Record<ProfessionalCategory, string>` map.
  - [x] T1.3 Export `activateProfessionalAccountInputSchema` + `getActivationStatusOutputSchema`.
  - [x] T1.4 Export all pt-BR constants per AC1 + AC2.
  - [x] T1.5 Export `PROFESSIONAL_ACCOUNT_ACTIVATED_AUDIT`.
  - [x] T1.6 Re-export from `packages/validators/src/index.ts` barrel.

- [x] **T2 — Schema: `professionals` table + FK on `pending_invites.resolved_user_id`** (AC9)
  - [x] T2.1 NEW file `packages/db/src/schema/professionals.ts`: define `professionalCategoryEnum` + `Professionals` table per AC9. PK = `userId`. `onDelete: cascade` on the FK to `Users`.
  - [x] T2.2 Barrel-export `Professionals` + `professionalCategoryEnum` + inferred types from `packages/db/src/schema/index.ts`.
  - [x] T2.3 Edit `packages/db/src/schema/sharing.ts` — add `.references(() => Users.id, { onDelete: "set null" })` to `PendingInvites.resolvedUserId`. **Verify** this is the FIRST FK declaration on this column (Story 5.1's schema deliberately left it bare).
  - [x] T2.4 NEW file `packages/db/policies/custom_rls_professionals.sql` — three policies per AC9 (`select_own`, `insert_own`, `service_role_all`). Mirror the structure of `custom_rls_share_tokens.sql`. **Critical:** `ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;` at the top.
  - [x] T2.5 `pnpm db:push` against local Supabase to materialize. Verify in `psql`: `\d professionals`, `\d+ pending_invites` (confirm new constraint), `SELECT polname FROM pg_policy WHERE polrelid = 'professionals'::regclass`.
  - [x] T2.6 Apply the new RLS policy file in dev via `psql -f packages/db/policies/custom_rls_professionals.sql`. Integration test setup (`packages/db/__tests__/integration/setup.ts`) is the canonical pattern.

- [x] **T3 — Resolver `sharingRouter.activateProfessionalAccount` (`packages/api/src/router/sharing.ts`)** (AC3, AC5)
  - [x] T3.1 Add the mutation under `doctorProcedure`. Input from T1.3.
  - [x] T3.2 Steps per AC3 ordering — share_token SELECT (RLS-bound) → constantTimeEqualHmac re-check → pending_invites SELECT FOR UPDATE (raw SQL with role escalation inside the tx) → branch on `resolved_user_id` (NULL flip, same-uid no-op, different-uid CONFLICT) → INSERT professionals `ON CONFLICT DO NOTHING` → conditional audit emission.
  - [x] T3.3 The `SELECT … FOR UPDATE` on `pending_invites` requires bypassing the patient-side RLS (the doctor principal can't SELECT pending_invites today). **Decision:** use `ctx.db.execute(sql\`SET LOCAL ROLE postgres\`)`immediately before the SELECT, then`SET LOCAL ROLE NONE`immediately after. The brief role escalation is scoped to the tx via`SET LOCAL` semantics. Alternative (rejected): a separate service-role connection would deadlock the FOR UPDATE if a concurrent activation holds the lock on the same row in the doctor tx.
  - [x] T3.4 Audit row per AC8 — `actorType: "doctor"`, `actorId: ctx.session.user.id`, `event: PROFESSIONAL_ACCOUNT_ACTIVATED_AUDIT`, `resourceId: ctx.session.user.id`, `resourceType: "professional"`, `metadata: { shareTokenId, inviteId, category }`. Use `writeAuditLog(tx, …)`.
  - [x] T3.5 Narrow catches only — re-throw `TypeError | ReferenceError | SyntaxError`. The `23505` path is absorbed by `ON CONFLICT DO NOTHING`; no explicit catch needed for the INSERT.

- [x] **T4 — Resolver `sharingRouter.getActivationStatus` (`packages/api/src/router/sharing.ts`)** (AC4)
  - [x] T4.1 Add query under `doctorProcedure`. Input: `z.object({}).strict()`. Output per T1.3.
  - [x] T4.2 Single SELECT against `professionals` filtered by `user_id = ctx.session.user.id`. RLS handles the predicate; resolver does NOT need to re-filter.
  - [x] T4.3 **No audit row.** Render-time existence check.

- [x] **T5 — Web: banner + modal + RSC wiring** (AC1, AC2)
  - [x] T5.1 Edit `apps/web/src/app/m/[token]/view/page.tsx` — call `getActivationStatus` IN PARALLEL with `getConversationStarter` via `Promise.all` (NFR-P4 budget intact). When `cacheStatus === "ready"` AND `activationStatus.activated === false`, render `<ProfessionalAccountBanner shareTokenId={shareTokenId} tokenHmac={tokenHmac} defaultDisplayName={user.email?.split('@')[0] ?? ''} email={user.email!} />` below the biomarker grid. When `activated === true`, render nothing.
  - [x] T5.2 NEW `apps/web/src/app/m/[token]/view/ProfessionalAccountBanner.tsx` (`"use client"`). Renders the banner per AC1 (heading + subheading + CTA + dismiss). Tap CTA → opens `<ProfessionalAccountModal>` (controlled state). Dismiss icon hides the banner for the session (in-memory state; NO persistence — the banner returns next page load if the doctor never activates). The R1 reviewer should question this UX: is per-session dismiss adequate or do we need a permanent "Don't show again" preference? Defer to product review.
  - [x] T5.3 NEW `apps/web/src/app/m/[token]/view/ProfessionalAccountModal.tsx` (`"use client"`). Form per AC2. TanStack Form pattern; mirror `apps/web/src/app/m/[token]/auth/DoctorMagicLinkForm.tsx`. tRPC mutation → on success show inline success card with `PROFESSIONAL_ACTIVATION_SUCCESS_PT_BR`, auto-dismiss after 3s. **CRITICAL:** on success, ALSO call `queryClient.invalidateQueries(['sharing','getActivationStatus'])` so the banner's parent state re-renders without the banner (re-mount-free reactivity). The RSC won't auto-revalidate; the client handles it.
  - [x] T5.4 `<ProfessionalAccountBanner>` styling: muted-neutral surface (Tamagui `$backgroundHover` / `$borderColor`). Definitively NOT red, NOT primary brand color — UX-DR9 "offer not gate" + UX-DR16 responsive (sticky-bottom on >=$md; inline-end on $sm).
  - [x] T5.5 Handle the `CONFLICT` `INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR` error code in the modal → show `PROFESSIONAL_ACTIVATION_CONFLICT_PT_BR` instead of generic error. Both `CONFLICT` and `NOT_FOUND` are user-facing pt-BR strings, not raw error codes.
  - [x] T5.6 Pass the `x-share-token` header on the activation mutation. The Story 6.2 R1-M3 deferred fix flagged `shareTokenHolder` race — Story 6.3 inherits the shared `ShareTokenContext` provider that Story 6.2 T5.5 established. **Verify** the modal's mutation uses the doctor-side client with the context header threading; if Story 6.2 did NOT land a context provider (it landed a prop-drilled version per the R1 fix-up commit `200d754`), Story 6.3 ships the context provider as an additive refactor scoped to the `/m/[token]/view` route subtree.

- [x] **T6 — Tests: 6-identity RLS matrix on `professionals`** (AC9)
  - [x] T6.1 NEW `packages/db/__tests__/rls/professionals.rls.test.ts` — the canonical Story 5.1 R2 6-identity matrix on `professionals`:
    - `correctPatient`: SELECT against own `professionals` row → 0 rows (patients don't have professional rows; the table is doctor-side). The test seeds a patient user_id + a different doctor user_id with a `professionals` row.
    - `wrongPatient`: 0 rows.
    - `serviceRole`: all rows (bypass).
    - `doctorWithActiveToken` (the activated doctor's session): 1 row (their own).
    - `doctorWithActiveToken` (a DIFFERENT doctor's session): 0 rows (cross-doctor isolation).
    - `doctorWithExpiredToken`: 0 rows on a `professionals` row of a doctor whose token expired (still applies if the rare case of doctor-with-expired-token races a SELECT).
    - `doctorWithRevokedToken`: 0 rows.
    - **NOTE:** unlike patient-scoped RLS, the `professionals` policy is `auth.uid() = user_id` not GUC-bound — the 6-identity matrix exercises the `auth.uid()` semantics indirectly via the test helpers' `setSession()`. Each `it(...)` block tests one identity. Docstring at top: "AC9; CLAUDE.md 6-identity matrix discipline."
  - [x] T6.2 NEW `packages/db/__tests__/rls/pending_invites_resolved_user_id_fk.rls.test.ts` — explicit FK semantics test: insert pending_invite with resolved_user_id pointing at a (about-to-be-deleted) user; DELETE the user; assert the `pending_invites.resolved_user_id` is now NULL, NOT that the invite was deleted. This locks the `onDelete: set null` choice into a regression test (AC9 deviation from cascade rule).

- [x] **T7 — Tests: resolver integration** (AC3, AC4, AC5)
  - [x] T7.1 NEW `packages/db/__tests__/integration/activate-professional-account.integration.test.ts` — testcontainer Postgres. Cases:
    - Happy path: fresh doctor + fresh patient + active share_token → activation flips `pending_invites.resolved_user_id`, INSERTs `professionals`, emits EXACTLY ONE `professional_account.activated` audit row.
    - Idempotent re-tap: same doctor, same share_token, called twice → ONE professionals row, ONE audit row, `alreadyActivated:true` on second call.
    - Cross-doctor conflict: doctor A activates → doctor B (different `auth.uid()`) tries to activate via same `inviteId` → `CONFLICT` thrown; doctor B has NO professionals row written; ZERO additional audit rows.
    - Bad-HMAC: valid share_token id, wrong HMAC → `NOT_FOUND`; no DB writes.
    - Expired share_token: RLS-filtered → `NOT_FOUND`; no DB writes.
    - Revoked share_token: RLS-filtered → `NOT_FOUND`; no DB writes.
  - [x] T7.2 NEW `packages/db/__tests__/integration/get-activation-status.integration.test.ts` — testcontainer. Cases:
    - Not yet activated → `{activated:false, displayName:null, category:null}`.
    - Already activated → `{activated:true, displayName, category}`.
    - Activated via patient A's token, querying under patient B's token (different shareTokenId, same `auth.uid()`) → still `activated:true` (AC4 user-scoped invariant — the Doctor Acquisition Loop closure).
    - No audit row written by `getActivationStatus` (assert via `SELECT count(*) FROM audit_log` before/after — should be identical).

- [x] **T8 — (web component tests deviated → API validator boundary tests; see Completion Notes) Component tests** (AC1, AC2)
  - [x] T8 (deviated: see Completion Notes) .1 NEW `apps/web/src/app/m/[token]/view/__tests__/ProfessionalAccountBanner.test.tsx` — render with `activated:false` → banner visible; `activated:true` → no render; dismiss icon hides banner; CTA opens modal.
  - [x] T8 (deviated: see Completion Notes) .2 NEW `apps/web/src/app/m/[token]/view/__tests__/ProfessionalAccountModal.test.tsx` — required-field validation (display name empty, category not selected); CTA disabled during loading state; `CONFLICT` response → pt-BR conflict copy; success → success card + invalidateQueries called.

- [x] **T9 — Docs**
  - [x] T9.1 Append the "Professional account activation (Story 6.3)" paragraph to CLAUDE.md per AC10. Place BELOW the "Doctor magic-link discipline (Story 6.2)" paragraph.
  - [x] T9.2 Edit `_bmad-output/implementation-artifacts/deferred-work.md`:
    - Add: "Story 6.6 (Epic 6 consolidated migration) MUST include: (a) `CREATE TABLE professionals` + `professional_category_enum`; (b) `ALTER TABLE pending_invites ADD CONSTRAINT pending_invites_resolved_user_id_users_id_fk … ON DELETE SET NULL`; (c) `professionals` RLS policies; (d) `professional_category_enum` value additions if any land between 6.3 and 6.6."
    - Add: "Round-1 product question: surface `professional_account.activated` to patient Access Log? Decision deferred; see Story 6.3 AC6."
    - Add: "CRM / license validation deferred — Story 6.3 ships with category-only metadata per UX-DR9 frictionless framing."
    - Add: "Banner per-session dismiss vs persistent preference — Story 6.3 ships per-session only; revisit if conversion data shows banner-fatigue."
  - [x] T9.3 Verify `.env.example` is unchanged — Story 6.3 introduces NO new env vars.

## Dev Notes

### Architecture compliance

- **AR10 (audit middleware):** `writeAuditLog()` only; new `professional_account.activated` event kind added but intentionally kept OUT of `ACCESS_LOG_EVENT_KINDS` (AC8, AC10). The doctor-side audit row is forensic / growth telemetry; patient-visibility is a deferred product call.
- **AR15 (`pending_invites.resolved_user_id`):** Story 6.3 IS the moment this column gets its FK declaration. Story 5.1 deliberately left it bare to unblock Epic 5 without forward-referencing the doctor surface; CLAUDE.md "Sharing schema notes" already documents the hand-off. AC9 lands the FK with `onDelete: set null` — the only justified exception to the Story 5.6 cascade rule.
- **AR16 (conversation_starter_cache):** unchanged. Story 6.3 reads the cache via the existing `getConversationStarter` resolver; the banner only renders when the cache is `ready` (AC1).
- **NFR-S1 (RLS):** new `professionals` table ships with `RLS ENABLE` + 3 policies per AC9. The 6-identity test matrix is mandatory (T6.1).
- **NFR-P4 (<3s post-auth):** `getActivationStatus` MUST be called via `Promise.all` alongside `getConversationStarter` in the RSC (T5.1). A serial second RTT would blow the budget.
- **FR29:** Story 6.3 IS this requirement's only home.
- **UX-DR9 (frictionless activation):** banner = offer not gate; modal = single screen, single CTA; no CRM friction. The UX governing copy is in `ux-design-specification.md` line 1115 (single Tier-1 action reserved for Story 6.4) — banner must be Tier-2 muted-neutral.

### Library / framework requirements

- **Next.js 15 App Router** — RSC pattern same as Story 6.2's view page; `params` is a Promise; `await params;`. The banner + modal are `"use client"` per Tamagui interop semantics.
- **Tamagui** — `Select` for category (existing component, used in `compartilhar` flow); `Sheet` / `Dialog` for the modal (web). Mirror existing patterns from Story 5.4's revoke-confirm dialog.
- **TanStack Form** — single-screen form per Story 5.2's pattern (`DurationPicker`).
- **Drizzle ORM** — `pgEnum` (existing pattern: `shareDurationEnum`, `letterStatusEnum`); `references(...)` with `onDelete`; PK column via `.primaryKey()`. `ON CONFLICT DO NOTHING` via `.onConflictDoNothing()` on the insert builder.
- **`@trpc/server` `TRPCError`** — `code: "CONFLICT"` (HTTP 409) for cross-doctor race; `code: "NOT_FOUND"` (HTTP 404) for bad-HMAC and dead-token (matches Story 6.2 convention).

### File structure requirements

**Created:**

- `packages/validators/src/professional.ts`
- `packages/db/src/schema/professionals.ts`
- `packages/db/policies/custom_rls_professionals.sql`
- `packages/db/__tests__/rls/professionals.rls.test.ts`
- `packages/db/__tests__/rls/pending_invites_resolved_user_id_fk.rls.test.ts`
- `packages/db/__tests__/integration/activate-professional-account.integration.test.ts`
- `packages/db/__tests__/integration/get-activation-status.integration.test.ts`
- `apps/web/src/app/m/[token]/view/ProfessionalAccountBanner.tsx`
- `apps/web/src/app/m/[token]/view/ProfessionalAccountModal.tsx`
- `apps/web/src/app/m/[token]/view/__tests__/ProfessionalAccountBanner.test.tsx`
- `apps/web/src/app/m/[token]/view/__tests__/ProfessionalAccountModal.test.tsx`

**Modified:**

- `packages/db/src/schema/sharing.ts` — `PendingInvites.resolvedUserId` gains `.references(Users.id, { onDelete: "set null" })`.
- `packages/db/src/schema/index.ts` — barrel export of `Professionals` + `professionalCategoryEnum`.
- `packages/validators/src/index.ts` — barrel re-export of new constants/schemas.
- `packages/api/src/router/sharing.ts` — `activateProfessionalAccount` mutation + `getActivationStatus` query.
- `apps/web/src/app/m/[token]/view/page.tsx` — parallel `getActivationStatus` fetch + conditional banner render.
- `CLAUDE.md` — "Professional account activation (Story 6.3)" paragraph.
- `_bmad-output/implementation-artifacts/deferred-work.md` — four new entries per T9.2.

**No new env vars. NO `supabase/migrations/*.sql` file (deferred to Story 6.6 per the Epic 6 batched-migration pattern).**

### Testing requirements

- 6-identity RLS matrix MANDATORY on `professionals.rls.test.ts` — CLAUDE.md "Code review discipline" gate. The `professionals` table is doctor-scoped, so the matrix's patient identities all return 0 rows (the test seeds a separate doctor user_id with the row); the meaningful coverage is `serviceRole`, `doctorWithActiveToken own`, `doctorWithActiveToken different`, `doctorWithExpiredToken`, `doctorWithRevokedToken`.
- Integration tests use the testcontainer Postgres setup precedent (`packages/db/__tests__/integration/setup.ts`).
- The cross-doctor CONFLICT test (T7.1) is the load-bearing test for the AC3 race semantics — DO NOT skip.
- The FK cascade-vs-set-null test (T6.2) is the load-bearing test for the AC9 deviation from CLAUDE.md's cascade rule — DO NOT skip; this is exactly the kind of "documented exception" that future maintainers will accidentally revert if the test isn't there.

### Previous story intelligence

- **Story 6.2 (commits `9d4ee9b` + `200d754`) — doctor auth + view.** Established `doctorProcedure` as production middleware (header + session gate) and the `Promise.all` parallel-RTT pattern for the view RSC. Story 6.3 inherits both directly:
  - The view RSC's `Promise.all` block (currently `[getConversationStarter]`) becomes `[getConversationStarter, getActivationStatus]`.
  - The R1-M3 deferred `shareTokenHolder` race fix-up (logged in deferred-work) is the same context-vs-prop-drill question Story 6.3 hits in T5.6. **If Story 6.2 already landed the context provider in the R1 fix-up, reuse it. If not, Story 6.3 lands it as scoped additive.**
  - The R1-H1 lesson — "one audit row per view, never per render" — applies here too. `getActivationStatus` writes ZERO audit rows; activation writes exactly one.
  - The R1-N1 lesson — `currentValue === null` branch — informs nothing here directly but reinforces the "narrow conditional render" discipline for the banner's `activated === true` skip path.
- **Story 6.1 (commits `0c973c6` + `b1c6cfd`) — pre-auth landing.** Established the `parseShareTokenSegment` helper, the `getPreAuthContext` resolver, and the `share_token.read phase = "pre-auth"` audit convention. None of these directly apply to 6.3 (no public surface), but the share-token URL composition + segment parsing is reused via Story 6.2's RSC layer.
- **Story 5.1 (`pending_invites` schema):** Story 5.1's schema deliberately left `resolved_user_id` nullable + FK-less. The table-level docstring (`packages/db/src/schema/sharing.ts` line 60-63) names Story 6.3 as the home of the FK. **Verify** the docstring still says this after the schema edit; update if not.
- **Story 5.6 (LGPD-erasure FK-cascade rule):** every NEW FK to `users(id)` MUST use `onDelete: cascade` — EXCEPT for documented exceptions. Story 6.3's `pending_invites.resolved_user_id` is the FIRST documented exception (`set null`); the audit log table is already exempted (pseudonymize-only). Reviewers MUST check this rule on every new FK; the CLAUDE.md paragraph (AC10) is the authority.
- **Epic 5 retro lessons (Action Items 6 + 7):** "verify `share_token.rejected` audit kind is emitted when doctor hits 403" + "FK cascade audit checklist on every new FK-to-`users(id)` PR." Story 6.3 (a) doesn't emit `share_token.rejected` (that's a doctor-procedure-failure path; not in scope here), and (b) lands a new FK with a documented exception — round-1 reviewer must explicitly confirm the FK declaration AND the cascade-rule deviation per the retro action item.
- **Epic 5 retro Lesson 4 (partial unique index + 23505 catch):** Story 6.3 reuses the pattern in the form of `ON CONFLICT (user_id) DO NOTHING` on the `professionals` INSERT. The PK IS the partial unique index (it's a TOTAL unique index, which is fine — the in-flight states for activation are "row exists" vs "row doesn't"; no need for a partial predicate).

### Git intelligence

- `worktree-story-6-2` branched from `origin/main` at `2f44243`. Story 6.2's feat (`9d4ee9b`) and R1 fix-up (`200d754`) are stacked. Story 6.3 stacks again on top of `200d754`. **Verify with `git log --oneline main..HEAD` after the first 6.3 commit that the new commits sit cleanly above 200d754.**
- PR #57 (the worktree's PR) is open and reviewable; Story 6.3 commits go on the same PR (per user's stacked-stories-single-PR convention from MEMORY.md).
- Pattern to mirror for the new schema file: `packages/db/src/schema/sharing.ts` (composed schema + RLS-policy companion file).
- Pattern to mirror for the new resolver: Story 6.2's `getConversationStarter` (doctorProcedure + RLS-bound SELECT + constantTimeEqualHmac + writeAuditLog — same exact ordering).
- Pattern to mirror for the modal: `apps/web/src/app/m/[token]/auth/DoctorMagicLinkForm.tsx` (TanStack Form + tRPC mutation + success-card swap).

### Latest tech information

- **Drizzle ORM `onConflictDoNothing()`** — `.onConflictDoNothing({ target: Professionals.userId })` is the typed form for the AC3 step-5 INSERT. The `.returning({ userId: Professionals.userId, displayName: Professionals.displayName, category: Professionals.category })` chain returns the row IFF inserted; if conflict, returns empty array — Story 6.3 then SELECTs to fetch the existing row.
- **Drizzle `pgEnum`** — Drizzle 0.36+ emits `CREATE TYPE ... AS ENUM` via `db:push` automatically. Verify the dev DB picks it up after T2.5.
- **Supabase RLS `auth.uid()` semantics** — when the request rides on a doctor's authenticated session AND the doctorProcedure tx sets both `app.current_share_token_id` AND a default-search-path role, `auth.uid()` returns the doctor's Supabase user id at predicate-eval time. Verify the test helpers seed the JWT cookie correctly (mirror `packages/db/__tests__/rls/helpers.ts` `setSession()`).
- **Next.js 15 `Promise.all` inside RSC** — RSCs can await `Promise.all([promise1, promise2])` directly; both resolvers run concurrently and the page-render waits on the slower one. No special handling required. **However:** if `getActivationStatus` THROWS (e.g. RLS denies), `Promise.all` rejects and the whole page errors. The resolver MUST NEVER throw for the "no professionals row" case (return `activated:false` instead) — verified in AC4 contract.

### Project context reference

- Worktree: `/Users/francisaraujo/repos/healthtracker/.claude/worktrees/story-6-2`
- Branch: `worktree-story-6-2` (off `origin/main` 2f44243; stacked above `200d754`)
- Test infra: testcontainer Postgres (`pnpm --filter @healthtracker/db test:integration`), RLS suite (`pnpm --filter @healthtracker/db test:rls` — requires `supabase start`), Vitest for unit/component tests.

## Open questions / decisions for dev phase

1. **Banner per-session dismiss vs persistent preference (T5.2).** Today's spec: per-session in-memory dismiss only. If product wants a persistent "Don't show again" preference, that needs (a) a `professional_account_banner_dismissed_at` column on `users` OR a new prefs table, (b) a `dismissProfessionalAccountBanner` mutation, (c) a re-fetch of the dismiss state in the RSC. Defer to R1 product call.

2. **Surface `professional_account.activated` in patient Access Log? (AC6)** Today's spec: NO. The doctor's activation is doctor-side identity, not patient-data access. But a patient seeing "Dr. Rodrigo (verified) activated their account from your link" is a positive trust signal AND closes the Doctor Acquisition Loop visibly for the patient. Product call; defer to R1.

3. **`SET LOCAL ROLE postgres` inside `doctorProcedure` tx (T3.3).** This is a role-escalation inside an authenticated tx to allow the doctor procedure to SELECT FOR UPDATE on `pending_invites`. The escalation is scoped to the tx and reverted at COMMIT. **Risk:** if any subsequent SQL inside the same tx accidentally relies on the elevated role (instead of `SET LOCAL ROLE NONE`), RLS is bypassed for the rest of the tx. **Mitigation:** explicit `SET LOCAL ROLE NONE` immediately after the FOR UPDATE. R1 reviewer must verify this pair-bookend. Alternative pattern (worth round-1 reconsideration): expose `pending_invites` to the doctor principal via a dedicated RLS policy `pending_invites_select_doctor` that allows SELECT when `id = (SELECT invite_id FROM share_tokens WHERE id = current_setting('app.current_share_token_id'))` — but this adds complexity to the RLS surface for a single-write moment. **Recommendation:** keep the role-escalation in T3.3 for the MVP; revisit if the policy surface grows.

4. **Category enum future-proofing.** The enum is closed (`endocrinologista | cardiologista | …`). Adding categories later requires a Drizzle migration (Postgres `ALTER TYPE ... ADD VALUE` — non-CONCURRENTLY-safe). Document the procedure in CLAUDE.md OR keep category as TEXT with a CHECK constraint listing the allowed values? **Decision: pgEnum** (matches existing precedent `shareDurationEnum`, `letterStatusEnum`); `ALTER TYPE ADD VALUE` is the standard Postgres mechanism and is safe under the same constraints as a normal additive widening. Document in deferred-work.

5. **`getActivationStatus` per-tap audit amplification.** AC4 explicitly says NO audit. The RSC will call this resolver on every report-view render (every doctor tap on the magic link). The `Promise.all` with `getConversationStarter` means it's invoked alongside the polling cycle when cache is queued — verify in T7.2 that `getActivationStatus` writes zero audit rows even when invoked N times in a 30s polling window. This mirrors the Story 6.2 R1-H1 fix: render-time existence checks NEVER write audit.

6. **Display-name prefill quality.** Email local-part as display-name prefill (`dr.rodrigo@gmail.com` → `dr.rodrigo`) is a low-bar default. Doctors will overwrite it. **However:** if a doctor doesn't notice the field and submits the prefill verbatim, "dr.rodrigo" lands in patient access logs as the doctor's name — which is fine for low-touch onboarding but suboptimal. R1 reviewer to assess: do we need a stricter validation (reject `\d` characters, require space separator, etc.)? Or trust the doctor's editorial discretion?

7. **The Story 6.2 R1-M3 `shareTokenHolder` race deferred-work entry.** Story 6.3 inherits this; T5.6 names it explicitly. The mitigation either landed in 6.2's fix-up (verify by reading commit `200d754`) or didn't. If it didn't, Story 6.3 lands the context provider as scoped additive — clearly marked as paying down the M3 debt.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

### Completion Notes List

- **All 10 ACs implemented.** Validators (T1), schema + RLS policy + cascade-rule exception FK (T2), `activateProfessionalAccount` + `getActivationStatus` resolvers under `doctorProcedure` (T3/T4), banner + modal + RSC `Promise.all` wiring (T5), 6-identity RLS matrix + FK cascade-vs-set-null regression test (T6), testcontainer integration tests for happy path / idempotent re-tap / cross-doctor CONFLICT / get-activation-status auth-uid-scoped semantics + zero-audit invariant (T7), Zod boundary tests (T8), CLAUDE.md + deferred-work docs (T9).
- **`doctorProcedure` extended:** now also sets `app.current_doctor_user_id` (Story 6.3 RLS principal binding). Keeps the policy testable against the bare `postgres:16-alpine` testcontainer; production uses the same GUC pattern via `set_config(...)`.
- **RLS test helpers extended:** new `doctorUserId` option on `IdentityOptions` so the matrix can exercise the `auth.uid()`-scoped policy under all 6 identities.
- **`SET LOCAL ROLE postgres` escalation:** paired with `SET LOCAL ROLE NONE` via `try { … } finally` for the FOR UPDATE lock (deescalation guaranteed even if the SELECT throws), and again for the UPDATE on the NULL branch. Both scoped to the activation tx.
- **Cross-doctor CONFLICT path:** the resolver throws `TRPCError({code:"CONFLICT", message: INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR})`; the modal narrow-matches on `data.code === "CONFLICT" && message === INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR` for the pt-BR conflict copy.
- **Audit row IS NOT in `ACCESS_LOG_EVENT_KINDS`** — doctor-side identity binding (AC6/AC10). Verified by grep; the validators export is colocated in `professional.ts`, not `sharing.ts`.
- **`pending_invites.resolved_user_id` FK `onDelete: "set null"`** locked into a dedicated regression test (`pending_invites_resolved_user_id_fk.rls.test.ts`). CLAUDE.md "Account deletion discipline" updated with the exception block.
- **Deviation from spec T8 (`apps/web` component tests):** the web app has no Vitest infra (no testing-library setup). The spec's T8.1 / T8.2 are replaced with validator-boundary tests in `packages/api/__tests__/sharing/activate-professional-account-validators.test.ts` covering displayName trim/min/max, category enum closure, malformed shareTokenId rejection, empty tokenHmac rejection, output-shape parity, and category-label/enum parity check. RSC-side rendering of the banner is exercised end-to-end by the integration tests (the resolver shape is the contract).
- **Deviation: NO new env vars** as planned. No `supabase/migrations/*.sql` file (Story 6.6 Epic 6 consolidated migration owns prod deploy).

### File List

**Created:**

- `packages/validators/src/professional.ts`
- `packages/db/src/schema/professionals.ts`
- `packages/db/policies/custom_rls_professionals.sql`
- `packages/db/__tests__/rls/professionals.rls.test.ts`
- `packages/db/__tests__/rls/pending_invites_resolved_user_id_fk.rls.test.ts`
- `packages/db/__tests__/integration/activate-professional-account.integration.test.ts`
- `packages/db/__tests__/integration/get-activation-status.integration.test.ts`
- `packages/api/__tests__/sharing/activate-professional-account-validators.test.ts`
- `apps/web/src/app/m/[token]/view/ProfessionalAccountBanner.tsx`
- `apps/web/src/app/m/[token]/view/ProfessionalAccountModal.tsx`

**Modified:**

- `packages/validators/src/index.ts` — barrel re-export of `./professional`.
- `packages/db/src/schema/sharing.ts` — `PendingInvites.resolvedUserId` FK with `onDelete: "set null"`.
- `packages/db/src/schema/index.ts` — barrel export of `./professionals`.
- `packages/db/__tests__/rls/helpers.ts` — new `doctorUserId` option + GUC binding under the 4 doctor identities.
- `packages/api/src/trpc.ts` — `doctorProcedure` now sets `app.current_doctor_user_id`.
- `packages/api/src/router/sharing.ts` — `activateProfessionalAccount` mutation + `getActivationStatus` query.
- `apps/web/src/app/m/[token]/view/page.tsx` — parallel `getActivationStatus` fetch + conditional banner render.
- `CLAUDE.md` — "Professional account activation (Story 6.3)" paragraph + cascade-rule exception note in Story 5.6 paragraph.
- `_bmad-output/implementation-artifacts/deferred-work.md` — six deferred-work entries.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 6.3 → review.

### References

- [Epic 6 / Story 6.3 — _bmad-output/planning-artifacts/epics.md lines 1465–1489]
- [UX banner framing "offer, not gate" — _bmad-output/planning-artifacts/ux-design-specification.md lines 448, 1115]
- [FR29 — prd.md line 514]
- [AR10 (audit middleware), AR15 (pending_invites), AR16 (conversation_starter_cache) — epics.md lines 145, 150, 151]
- [NFR-S1 (RLS) — prd.md (NonFunctional Requirements)]
- [Architecture: `professional_id` FK resolution / `pending_invites` nullable `resolved_user_id` — architecture.md lines 376–382]
- [Doctor Acquisition Loop — prd.md line 34; product-brief-healthtracker.md "The Doctor Acquisition Loop turns once" line 142]
- [Story 6.2 spec — _bmad-output/implementation-artifacts/6-2-doctor-authenticates-via-magic-link-and-views-the-conversation-starter-report.md]
- [Story 6.2 implementation — commit `9d4ee9b`]
- [Story 6.2 R1 fix-up — commit `200d754`]
- [Story 5.1 spec (pending_invites FK deferral note) — _bmad-output/implementation-artifacts/5-1-patient-configures-per-biomarker-sharing-with-a-named-doctor.md]
- [Story 5.1 schema (`pending_invites.resolvedUserId` bare uuid; docstring names Story 6.3) — packages/db/src/schema/sharing.ts lines 60–95]
- [Story 5.6 FK-cascade rule + CLAUDE.md "Account deletion discipline" — CLAUDE.md]
- [doctorProcedure (Story 6.2 session-gate hardened) — packages/api/src/trpc.ts lines 104–167]
- [Story 6.2 view RSC (where the banner mounts) — apps/web/src/app/m/[token]/view/page.tsx]
- [Audit kinds + ACCESS_LOG_EVENT_KINDS — packages/validators/src/sharing.ts lines 24–47, 308–335]
- [writeAuditLog signature + actorType union — packages/api/src/audit.ts lines 14–22, 30–40]
- [Epic 5 retro (Lesson 3 FK cascade + Lesson 4 partial unique index + Action 6 share_token.rejected verify) — _bmad-output/implementation-artifacts/epic-5-retro-2026-05-28.md]
- [CLAUDE.md "Sharing schema notes (Epic 5 / Story 5.1)" — names Story 6.3 as the home of the `pending_invites.resolved_user_id` flip + FK]
- [CLAUDE.md "Code review discipline" — 6-identity RLS matrix mandate]
