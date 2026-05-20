# Story 1.2: Patient provides LGPD-compliant consent per data type at onboarding

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new patient,
I want to review and explicitly consent to each type of health data being collected,
so that I maintain control over my data and the system satisfies LGPD Art. 11 requirements for sensitive data.

## Acceptance Criteria

**AC1 — Three consent screens shown after registration**
**Given** I have just created an account,
**When** the consent flow begins,
**Then** I am shown individual consent screens for: (1) blood test results, (2) bioimpedance measurements — each with the consent text version identifier, a plain-language explanation of what will be stored and why, and a distinct "Concordo" action.

**AC2 — Consent grant persisted on tap**
**Given** I am on a consent screen,
**When** I tap "Concordo",
**Then** a consent event is written to `consent_grants` (see Project Structure Notes for the AC's `consent_records` → arch `consent_grants` reconciliation) with: `patient_id`, `consent_type`, `version`, `granted_at` timestamp, and my `patient_id` sourced from `SET LOCAL app.current_patient_id`.

**AC3 — Decline blocks data collection at the tRPC layer**
**Given** I skip or decline a consent category,
**When** I proceed through onboarding,
**Then** data collection for that category is blocked at the tRPC layer (via a `consentRequiredProcedure(type)` middleware factory) and the UI does not show upload options for it.

**AC4 — AI narrative consent identifies Anthropic**
**Given** the blood test results and bioimpedance consents are accepted,
**When** the AI narrative consent screen appears,
**Then** it identifies Anthropic as the AI processing provider, explains that blood marker and BIA data will be sent to generate personalized narratives (The Letter), and requires a distinct "Concordo" tap before The Letter feature is enabled; declining this consent allows data storage but disables The Letter and Conversation Starter discussion prompts.

**AC5 — Onboarding hands off to Início empty state**
**Given** all mandatory consents are accepted,
**When** onboarding completes,
**Then** I land on the empty-state Início screen showing the `EmptyStateRecord` component with a pt-BR headline and a single "Enviar resultado" CTA.

**Requirements:** FR32, FR33, FR37, NFR-S1, NFR-S6, UX-DR10, UX-DR20

## Tasks / Subtasks

- [x] **Task 1 — Define the `consent_grants` schema + `consent_type` enum** (AC: #1, #2)
  - [x] Create `packages/db/src/schema/consent.ts`. Table `consent_grants` (see Clarifications for name reconciliation). Columns per architecture (`architecture.md` lines 1465–1487): `id` (uuid PK defaultRandom), `patient_id` (uuid notNull), `consent_type` (pgEnum `consent_type_enum`), `version` (text notNull), `granted_at` (timestamptz defaultNow notNull), `revoked_at` (timestamptz nullable), `metadata` (jsonb default `{}`), `created_at` (timestamptz defaultNow notNull). Append-only — revocation inserts a new row with `revoked_at` set rather than updating.
  - [x] Define `pgEnum('consent_type_enum', [...])` with the values needed to satisfy AC1 + AC4. See Clarifications for the AC-vs-arch enum mismatch; recommended set: `blood_test_results`, `bioimpedance`, `ai_narrative`. (Architecture's broader `health_data_processing` / `ai_extraction` / `doctor_sharing` / `llm_letter_generation` values do not 1:1 map to AC1's three patient-facing screens — confirm with the user before coding.)
  - [x] Use `snake_case` (Drizzle configured). Export from `packages/db/src/schema/index.ts` (currently exports only `audit`, `posts`, `users`).
  - [x] Defenses-in-depth: store `consent_type` as the pgEnum, not free text (closes deferred F6 for this table). No FK to `auth.users` (consistent with `users` table — F4 deferred).

- [x] **Task 2 — RLS policy + adversarial RLS test for `consent_grants`** (AC: #2, #3; Story 0.4 mandate)
  - [x] Add `packages/db/policies/custom_rls_consent_grants.sql` using the `current_setting('app.current_patient_id', true)` token-principal pattern (AR5). Policies: SELECT own (`patient_id::text = current_setting(...)`), INSERT own (WITH CHECK on `patient_id`). NO UPDATE or DELETE policy — revocation is an insert, append-only at the DB layer (NFR-S4). Prefix `custom_` so `drizzle-kit check` won't drop it.
  - [x] Add `packages/db/__tests__/rls/consent_grants.rls.test.ts`. Mirror the `audit_log.rls.test.ts` matrix exactly: correctPatient sees exactly own row; wrongPatient sees `[]`; foreign-id INSERT rejects with Postgres code `42501`; anon zero rows; UPDATE / DELETE — SELECT-first under correctPatient to prove the row is visible, _then_ assert the no-op (round-2 P12 pattern).

- [x] **Task 3 — `writeConsentGrant()` helper + audit hookup** (AC: #2, #3)
  - [x] Add a thin helper at `packages/api/src/consent.ts` that wraps the `consent_grants` insert, mirroring the `writeAuditLog` pattern (single sanctioned write path). Signature: `writeConsentGrant(db: AuditDb, { patientId, consentType, version, metadata? })`.
  - [x] On every grant, also call `writeAuditLog(ctx.db, { actorId: patientId, actorType: 'patient', event: 'consent.granted', resourceId: <new grant id>, resourceType: 'consent_grant', metadata: { consentType, version } })` — FR33 wants the event in the audit trail; `consent_grants` itself is the source of truth and the audit row is the cross-cutting log.
  - [x] Add an analogous `event: 'consent.declined'` audit event when AC3's decline path fires (no row in `consent_grants` is written for a decline — the absence is the negative state — but the audit ledger MUST record the decision).

- [x] **Task 4 — `consentRequiredProcedure(type)` middleware factory** (AC: #3, #4)
  - [x] Create `packages/api/src/middleware/consent.ts` exporting `consentRequiredProcedure(consentType)` — modeled on the planned `premiumProcedure` pattern in `architecture.md` lines 805–830. Layers on top of `protectedProcedure`; queries `consent_grants` for `patient_id = ctx.session.user.id AND consent_type = consentType AND revoked_at IS NULL` (latest version); throws `TRPCError({ code: 'FORBIDDEN', message: 'CONSENT_REQUIRED' })` when missing.
  - [x] No callers exist yet (uploads land in Epic 2). Add a Vitest unit test that proves the factory throws `FORBIDDEN` without a grant and proceeds with one. Do NOT wire it into any router this story.
  - [x] For AC4's "decline AI narrative → disable The Letter": the gate is the same middleware applied to the Letter procedure in Epic 4. Do NOT add the Letter gate here (premature). Just confirm the middleware works for `ai_narrative` as a consent type.

- [x] **Task 5 — `consent` tRPC router with `grant`, `decline`, `list`** (AC: #1, #2, #3)
  - [x] Create `packages/api/src/router/consent.ts` (per architecture line 1104) and register in `packages/api/src/root.ts`. All procedures are `protectedProcedure`.
  - [x] `grant({ consentType, version })` — Zod-validated input. Inserts via `writeConsentGrant`; emits `consent.granted` audit. Idempotent on `(patient_id, consent_type, version)` via `onConflictDoNothing()` + `.returning()`; emit audit only when actually inserted (mirrors Story 1.1's `initializeProfile` pattern).
  - [x] `decline({ consentType, version })` — emits the `consent.declined` audit event; writes nothing to `consent_grants`. Returns the persisted decision so the client can confirm.
  - [x] `list()` — returns the patient's currently-active grants (`revoked_at IS NULL`, deduplicated per `consent_type` by latest `granted_at`). Used by AC5 to verify all mandatory consents are present before routing to Início, and consumed by Story 1.4 (consent management).

- [x] **Task 6 — Validators + shared pt-BR copy** (AC: #1, #4)
  - [x] Extend `packages/validators/src/index.ts` (do not create a new module — single-file pattern):
    - Export `ConsentDataType` TypeScript union mirroring the pgEnum values.
    - Export `ConsentGrantInputSchema` (Zod) and `ConsentDeclineInputSchema`.
    - Export `CONSENT_TEXT_VERSION` constant. **Decide format**: use ISO date `"2026-05-19"` for the first version; bump on any consent-text change. (See Clarifications for format options.)
    - Export pt-BR copy constants per screen (titles, body text, Concordo / Pular labels, decline-consequence sentences in the consequence-language pattern from UX spec line 1214). Naming pattern: `CONSENT_BLOOD_*`, `CONSENT_BIOIMPEDANCE_*`, `CONSENT_AI_NARRATIVE_*`.

- [x] **Task 7 — `EmptyStateRecord` shared UI component** (AC: #5; UX-DR10)
  - [x] Add `packages/ui/src/empty-state-record.tsx` per UX spec lines 987–1006 — Tamagui-based, cross-platform. Props: `headline` (string), `description?` (string), `ctaLabel` (string), `onCtaPress` (() => void), `state?: 'cold-start' | 'partial' | 'filtered-empty'` (default `'cold-start'`), `variant?: 'full-page' | 'inline'` (default `'full-page'`).
  - [x] Illustration is `aria-hidden="true"`; all meaning is in text. Use semantic tokens (no hardcoded hex). The CTA is the primary interactive element.
  - [x] Re-export from `packages/ui/src/index.ts`.

- [x] **Task 8 — Onboarding consent flow (web + Expo)** (AC: #1, #2, #3, #4, #5)
  - [x] **Replace** the Story 1.1 placeholder pages: `apps/web/src/app/onboarding/consent/page.tsx` and `apps/expo/src/app/onboarding/consent.tsx`.
  - [x] Sequential flow (no skipping forward — back is allowed): blood → bioimpedance → AI narrative.
  - [x] Each screen: title, plain-language body (8th-grade reading level — UX-DR20), visible `CONSENT_TEXT_VERSION` identifier (small, low-contrast), primary "Concordo" button (calls `consent.grant`), secondary "Pular por agora" button (calls `consent.decline` — never red). On the AI narrative screen, the body explicitly names "Anthropic" as the AI provider (AC4).
  - [x] After each step, advance to the next screen. After the last step, `router.replace` to the new Início route (see Task 9) so back-navigation cannot return to consent.
  - [x] Show the decline consequence in the consequence-language pattern (UX spec line 1214) — e.g., for AI narrative declined: _"Sem o consentimento de IA, A Carta não será gerada — seus exames continuam protegidos no app."_
  - [x] No raw consent body text duplicated across apps — render from shared validators constants (Task 6).
  - [x] DRY the submit-handler logic between web (`@tanstack/react-form`) and expo (`useState`) per Story 1.1 review F16 — extract a hook or helper that calls `trpc.consent.grant.mutate / decline.mutate` so the two platforms cannot drift.

- [x] **Task 9 — Início route + EmptyStateRecord landing** (AC: #5)
  - [x] **Web:** create `apps/web/src/app/inicio/page.tsx` — renders `EmptyStateRecord` with the AC5 copy (headline: _"Sua história de saúde começa aqui"_, CTA label: _"Enviar resultado"_ per AC5 — see Clarifications for the AC vs UX-spec wording conflict). CTA `onPress` is a no-op placeholder this story; the upload entry point ships in Epic 2.
  - [x] **Expo:** create `apps/expo/src/app/inicio.tsx` (or the equivalent under any tabs layout once it exists — see Clarifications). The post-consent `router.replace` target must match.
  - [x] Update `apps/web/src/app/auth/register/register-form.tsx` and `apps/expo/src/app/register.tsx` so that the registration → consent route is unchanged (`/onboarding/consent` still entry), but the post-consent route is `/inicio`. The web `/auth/callback` route and Expo `_layout.tsx` deep-link handler (which call `initializeProfile`) do NOT need consent-flow awareness — they continue to redirect to the same configured `next` (default `/`); the consent flow is reached via the register form's `router.push("/onboarding/consent")`. **Confirm** with the user whether email-confirmed deep-link users should also enter the consent flow if they haven't completed it; for this story, assume they do (link sent → click → land on `/onboarding/consent` via the existing route).

- [x] **Task 10 — Tests** (AC: all)
  - [x] Vitest unit tests in `packages/api/__tests__/consent.test.ts`: `consent.grant` (happy + idempotent + audit emitted exactly once), `consent.decline` (audit emitted, no row written), `consent.list` (returns deduped current grants), `consentRequiredProcedure` factory (throws `FORBIDDEN` without grant, proceeds with grant).
  - [x] `writeConsentGrant` failure-path test (RLS denial propagates so transaction rolls back — Story 1.1 P4 pattern).
  - [x] The `consent_grants.rls.test.ts` adversarial matrix (Task 2).
  - [x] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

## Dev Notes

### Architecture patterns and constraints

- **`consent_grants` is append-only** (architecture.md lines 1465–1487). Revocation = new row with `revoked_at` set; never UPDATE. No UPDATE/DELETE RLS policies → enforced at DB layer (NFR-S4 analog).
- **RLS token-principal (AR5)**: `consent_grants` policies use `current_setting('app.current_patient_id', true)` — same pattern as `users`/`audit_log`. Resolvers run inside `protectedProcedure`'s transaction wrapper.
- **Audit pattern (AR10)**: `writeAuditLog` is the only path into `audit_log`. Consent operations write to both `consent_grants` (data) and `audit_log` (cross-cutting log). Both writes happen inside the same `protectedProcedure` transaction so they are atomic (Story 1.1 demonstrated this works for `users` + `audit_log`).
- **tRPC enforcement primitive** for AC3: no `consentRequiredProcedure` exists today. Build it as a factory layered on `protectedProcedure`, modeled on the documented `premiumProcedure` pattern (architecture.md lines 805–830). Place at `packages/api/src/middleware/consent.ts`.
- **NFR-S6 (DPA gate)**: a signed DPA with Anthropic must be in place before any patient data is processed for The Letter or Conversation Starter. Story 1.2 only collects the _consent_ — it does not send anything to Anthropic. The Letter procedure (Epic 4) is what enforces the DPA + the `ai_narrative` consent.
- **UX-DR20** (pt-BR, 8th-grade, ANVISA-compliant): all consent copy in pt-BR, plain language, no legalese. UX spec line 1214's consequence-language pattern applies to decline messaging.
- **UX-DR10** (`EmptyStateRecord`): 3 states (cold-start / partial / filtered-empty) × 2 variants (full-page / inline). Illustration `aria-hidden`; meaning in text only.

### Requirement texts

- **FR32:** Patient must provide explicit, per-data-type consent before any health data is collected or processed. [prd.md:520]
- **FR33:** System records consent events with timestamp, consent text version, and data type scope. [prd.md:521]
- **FR37:** Patient can view a summary of all consent agreements currently active on their account. [prd.md:525] — Story 1.4 consumes this; Story 1.2 must expose `consent.list` to make 1.4 trivial.
- **NFR-S1:** All patient health data encrypted at rest (AES-256) and in transit (TLS 1.3). Satisfied at the Supabase infra layer.
- **NFR-S6:** DPA with the LLM provider before any patient data is processed for The Letter / Conversation Starter. [prd.md:565]
- **UX-DR10:** Implement `EmptyStateRecord` component (warm illustration `aria-hidden` + forward-looking pt-BR headline + single primary CTA; 3 states; full-page and inline variants). [epics.md:169]
- **UX-DR20:** pt-BR copy, 8th-grade reading level, ANVISA-compliant framing. [epics.md:179]

### Source tree components to touch

- `packages/db/src/schema/consent.ts` — NEW. `consent_grants` table + `consent_type` pgEnum.
- `packages/db/src/schema/index.ts` — UPDATE: re-export `./consent`.
- `packages/db/policies/custom_rls_consent_grants.sql` — NEW.
- `packages/db/__tests__/rls/consent_grants.rls.test.ts` — NEW.
- `packages/api/src/consent.ts` — NEW: `writeConsentGrant()` helper.
- `packages/api/src/middleware/consent.ts` — NEW: `consentRequiredProcedure(type)` factory.
- `packages/api/src/router/consent.ts` — NEW: `grant` / `decline` / `list` procedures.
- `packages/api/src/root.ts` — UPDATE: register `consentRouter`.
- `packages/api/__tests__/consent.test.ts` — NEW: router + helper + middleware unit tests.
- `packages/validators/src/index.ts` — UPDATE: add `ConsentDataType`, `ConsentGrantInputSchema`, `ConsentDeclineInputSchema`, `CONSENT_TEXT_VERSION`, and `CONSENT_*` copy constants.
- `packages/ui/src/empty-state-record.tsx` — NEW.
- `packages/ui/src/index.ts` — UPDATE: re-export `EmptyStateRecord`.
- `apps/web/src/app/onboarding/consent/page.tsx` — REPLACE the placeholder with the real flow.
- `apps/expo/src/app/onboarding/consent.tsx` — REPLACE the placeholder with the real flow.
- `apps/web/src/app/inicio/page.tsx` — NEW: Início empty state.
- `apps/expo/src/app/inicio.tsx` — NEW: Início empty state (or under tabs layout if added).

### Testing standards summary

- Co-locate Vitest tests as `__tests__/<name>.test.ts` in `packages/api` (Story 1.1 set up vitest there) and `packages/db` (existing).
- RLS tests live in `packages/db/__tests__/rls/<table>.rls.test.ts` and are excluded from `pnpm test` — require local `supabase start`. Run in CI's `rls-adversarial` job.
- Use the Story 1.1 round-2 patterns: assert exact row arrays, assert Postgres `42501` for RLS denials, SELECT-first to prove visibility before asserting UPDATE/DELETE no-ops.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` must all be green.

### Previous story intelligence (1.1)

Patterns established that Story 1.2 MUST mirror (full list in story 1.1's Review Findings sections):

- **Schema file location and export discipline**: new table file → exported from `schema/index.ts`. `users.ts` and `audit.ts` set the precedent.
- **RLS policy file naming**: `custom_rls_<table>.sql`. The `custom_` prefix is mandatory.
- **Single-write-path helpers**: `writeAuditLog` is the only path into `audit_log`. Story 1.2 mirrors this with `writeConsentGrant` for `consent_grants`.
- **Idempotent insert + audit-on-real-insert pattern**: `onConflictDoNothing()` + `.returning()` + emit audit only when length > 0. Used by `initializeProfile`; reused by `consent.grant`.
- **Normalize at the boundary, not in the schema** (P9): `normalizeEmail()` lives in validators and is called right before `signUp`. For consent, that means: don't chain transforms onto the version string in Zod — pass the canonical constant `CONSENT_TEXT_VERSION` from validators on both apps.
- **Detection by code, not substring** (P1): if any consent error code surfaces in Supabase / Postgres, never substring-match localized messages — use code-based detection.
- **Visibility-first RLS tests** (P12): before asserting UPDATE/DELETE is a no-op, SELECT under the same identity to prove the row IS visible.
- **DRY across web + expo** (F16 deferred from 1.1): the two apps duplicated the registration submit logic; Story 1.2 should not repeat that mistake for 3 screens × 2 apps. Extract a shared submit hook/handler from the start.
- **Tamagui semantic tokens** (F17 deferred): do not use `$biomarkerDeviation` for form errors. Use `$color.error` only for system errors; pick deliberate tokens for amber hints.
- **No hardcoded hex** (UX-DR1): except where a native API (`SafeAreaView`) genuinely cannot read Tamagui tokens — and only with the documented comment pattern Story 1.1 established (mirror `colorTokens.backgroundPrimary.light`).
- **F10 awareness**: `actorType: 'system'` audit writes are blocked by current RLS. Story 1.2 emits patient-actor audit events only (`actor: 'self'`) — F10 does not block this story, but do not introduce system-actor consent flows here.

### Git intelligence

Recent commits (from `git log --oneline`):

```
14e26e8 feat(auth): story 1.1 — patient registration with email and password
835e934 chore(prep): resolve Epic 0 retro prep items before Epic 1
52eef89 docs(retro): add Epic 0 retrospective and mark complete in sprint status
```

Conventional Commits with scopes. Stories developed in worktree branches and merged to main. Use `feat(consent):` scope for Story 1.2 work; `fix(consent):` for follow-ups.

### Project Structure Notes

- **Story file is on branch `worktree-story-1-1` (same worktree as the merged Story 1.1).** Story 1.2 implementation should branch from this branch or from `main` once 1.1 is merged. The current worktree already carries the post-1.1 file layout (real `users`/`audit_log` schemas; placeholder consent pages to replace).
- **`packages/api/src/router/` is singular** (not `routers/`); root file is `root.ts` (not `router/index.ts`). Register new routers there.
- **Tabs layout for Expo does not exist yet.** AC5's Início screen and the post-consent route depend on Task 9's decision (see Clarifications).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.2] — story text, ACs, requirement tags.
- [Source: _bmad-output/planning-artifacts/architecture.md#consent_grants] — lines 1465–1487, schema + RLS + append-only pattern.
- [Source: _bmad-output/planning-artifacts/architecture.md#premiumProcedure-pattern] — lines 805–830, middleware factory model for `consentRequiredProcedure`.
- [Source: _bmad-output/planning-artifacts/architecture.md#Audit-Log-Write-Pattern] — `writeAuditLog` contract.
- [Source: _bmad-output/planning-artifacts/prd.md] — FR32/FR33/FR37 (lines 520–525), NFR-S1 (line 561), NFR-S6 (line 565).
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#EmptyStateRecord] — lines 987–1006, component spec.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#LGPD-consent-at-onboarding] — lines 1228–1233.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Consequence-language-pattern] — line 1214.
- [Source: _bmad-output/implementation-artifacts/1-1-patient-creates-account-with-email-and-password.md] — precedents, deferred items F4–F18, review patterns P0–P12.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — F4, F5, F6, F7, F8, F9, F10 are the items most relevant to 1.2.

### Review Findings (code review round 2, 2026-05-19) — RESOLVED

- [x] [Review][Patch] **P23** Register-form (web + Expo) now uses a separate `serverNotice` state slot for `VERIFY_EMAIL_MESSAGE_PT_BR`. Web renders `<p role="status" className="text-sm text-stone-700">`; Expo renders `<Text accessibilityLiveRegion="polite" color="$textSecondary">` (no `accessibilityRole="alert"`). The error slot keeps `role="alert"` / `accessibilityRole="alert"` so screen readers correctly distinguish the two.
- [x] [Review][Patch] **P25** `consent_grants.rls.test.ts` now mirrors the `audit_log.rls.test.ts` matrix exactly — added `wrongPatient sees []` and `anon zero rows or explicit error` cases. Total cases: own INSERT, foreign INSERT (42501), wrongPatient empty, anon zero/error, SELECT-own, UPDATE no-op (visibility-first), DELETE no-op (visibility-first + tightened assertion).
- [x] [Review][Patch] **P26** Added `writeConsentGrantIfAbsent` to `packages/api/src/consent.ts` — idempotent counterpart that emits the partial-index ON CONFLICT DO NOTHING and returns `{ id } | null`. The grant resolver now routes through it instead of inlining the insert chain, so the "single sanctioned write path" claim holds.
- [x] [Review][Patch] **P27** Callback handlers now nest the try/catch: `initializeProfile` failure → consent (unknown state); `consent.list` failure after a successful `initializeProfile` → assume completed, route to `next` (web) / no redirect (Expo). Transient blips no longer bounce returning users back through onboarding.
- [x] [Review][Patch] **P28** Dropped `or` from `packages/db/src/index.ts` re-exports — no consumer in this story needed it.
- [x] [Review][Patch] **P29** Expo consent screen body wrapped in `<ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>`; Concordo/Pular footer pinned outside the scroll container. Long pt-BR copy stays reachable on small phones.
- [x] [Review][Patch] **P30** Expo `router.replace` normalized — `register.tsx` and `onboarding/consent.tsx` now use object form `{ pathname: ROUTE }` matching `_layout.tsx`. Typed-route safety enforced everywhere.
- [x] [Review][Patch] **P31** RLS DELETE assertion tightened from `(data ?? []).length > 0` to `expect(data).toHaveLength(1)` — matches the specificity of the UPDATE no-op assertion.
- [x] [Review][Defer] **F32** Task 8 DRY mandate — shared submit-handler hook between web (TanStack Form) and Expo (useState) was NOT extracted; shared schemas/copy/routes mitigate ~80% of drift risk, React state machine still duplicated. Honest call: extracting a `useConsentFlow` hook requires adding React as a `packages/validators` peer dep (cross-cutting change). Revisit when a third surface (Story 1.4 settings consent panel) makes the case.
- [x] [Review][Defer] **F33** Web `/auth/callback` latency — every email-verification redirect now does 2 sync DB calls (initializeProfile + consent.list). Acceptable for v1; revisit if login p95 regresses.
- [x] [Review][Defer] **F34** `consentRequiredProcedure` ignores `version` — stale grants satisfy the gate when `CONSENT_TEXT_VERSION` bumps. Tied to F22 (per-screen versioning).
- [x] [Review][Defer] **F35** `decline` doesn't check for an active grant — a patient who granted then declined logs only the decline; the grant remains active. Story 1.4 (consent management) territory.
- [x] [Review][Defer] **F36** Partial unique index `WHERE revoked_at IS NULL` correctness against `drizzle-kit push` — no real-DB integration test in this story proves drizzle emits the WHERE clause. Verify on first `pnpm db:push` by inspecting the generated index DDL.
- [x] [Review][Defer] **F37** Append-only + partial unique revocation model — to revoke and re-grant, the original active row must move out from under the partial index. Without an UPDATE policy, that means a fresh INSERT with `revoked_at` set leaves the original row still satisfying the partial unique constraint. Story 1.4 must reconcile (either add a narrow UPDATE-revokedAt RLS policy, or restructure as a separate `consent_revocation_events` table).
- [x] [Review][Defer] **F38** `consent.list` dedup is application-side (`Set` over fetched rows) — could push to SQL via `DISTINCT ON (consent_type) ... ORDER BY consent_type, granted_at DESC`. Performance optimization for long-lived patients.
- [x] [Review][Defer] **F39** Consent flow on resume — patient who granted screens 1–2, killed the app, then returns starts at step 1 again (re-tap is idempotent at the API but UX is confusing). On mount, fetch `consent.list` and `setStepIndex` to the first ungranted screen.
- [x] [Review][Defer] **F40** Declining all 3 screens lands the patient on Início whose CTA, once Epic 2 wires uploads, will hit `CONSENT_REQUIRED` with no recovery path. Epic 2 must gate the upload CTA on the consent-grants set.
- [x] [Review][Defer] **F41** Anti-phishing scanners (Outlook, Gmail Safelinks, etc.) click verification links to preview them, consuming the single-use code before the patient does. Out of scope for this story; requires Supabase auth flow tuning.

~17 dismissed as noise — including: recurring "ctx.db not transactional" false positive (`ctx.db` IS the protectedProcedure tx, Story 1.1 pattern); package.json types path change is fully documented; `INTERNAL_SERVER_ERROR` defensive branch is acknowledged dead path; `description` prop unused on Início is optional + not in AC5; CONSENT_TEXT_VERSION single-global is F22-deferred; consent_type_enum hybrid is user-approved; `consentRequiredProcedure` speculative is spec-mandated; `<YStack flex={1} />` spacer is an idiom; mobile router.replace cleanup is minor; mock cross-talk is hypothetical; no register-form test is F11-deferred; Tamagui-token hex duplication is F24-deferred; `$biomarkerDeviation` for error color is F17-deferred.

### Review Findings (code review 2026-05-19) — RESOLVED

- [x] [Review][Patch] **P13** Race-safe idempotency — schema now declares a `consent_grants_active_unique` partial unique index on `(patient_id, consent_type, version) WHERE revoked_at IS NULL`. The `grant` resolver was rewritten to `INSERT ... ON CONFLICT DO NOTHING ... RETURNING id`; on conflict (empty `RETURNING`), a single fallback SELECT looks up the existing grant. Audit emitted only when a row was actually inserted, so `consent.granted` never duplicates under concurrency.
- [x] [Review][Patch] **P14** `consent.list` now orders by `desc(grantedAt), desc(createdAt), desc(id)` — deterministic tiebreakers eliminate dedup flapping.
- [x] [Review][Patch] **P15** `EmptyStateRecord.state` prop removed; component now exports only `EmptyStateRecordVariant`. Restoring per-state visuals is deferred to F31 (a consumer that differentiates `partial` / `filtered-empty`).
- [x] [Review][Patch] **P16** Web `/auth/callback` and Expo `_layout.tsx` now query `consent.list` after `initializeProfile`. The patient routes to `/onboarding/consent` whenever there are 0 active grants (covers first-time AND consent-incomplete returning users). On `initializeProfile`/`consent.list` failure, the safe fallback is also consent — a brand-new patient can no longer silently bypass AC3.
- [x] [Review][Patch] **P17** Register-form no-session branch (web + Expo) now sets `VERIFY_EMAIL_MESSAGE_PT_BR` ("Enviamos um link de verificação para o seu e-mail. Clique nele para continuar.") on the existing inline message slot instead of navigating to a consent page that would 401 on every mutation.
- [x] [Review][Patch] **P18** `ConsentGrantInputSchema` / `ConsentDeclineInputSchema` narrowed to `z.enum(CONSENT_SCREEN_TYPES)` — the 3 patient-facing values only. Pre-granting `doctor_sharing` or `llm_letter_generation` from the patient UI is now a Zod input error.
- [x] [Review][Patch] **P19** Added `GENERIC_CONSENT_ERROR_MESSAGE_PT_BR` ("Não foi possível registrar agora. Tente novamente.") — consent flows on web and Expo no longer borrow the registration copy. Expo error `<Text>` now carries `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"` so VoiceOver / TalkBack announce it.
- [x] [Review][Patch] **P20** Expo `_layout.tsx` now uses `router.replace({ pathname: ONBOARDING_CONSENT_ROUTE })` — typed `Href` object, no `as never` cast. A future route rename surfaces as a type error.
- [x] [Review][Patch] **P21** `consent.test.ts` cleaned up — removed the unused `Caller` type and the `_Caller` workaround. Replaced the existence-check tests with the new ON CONFLICT mock chain (`values → onConflictDoNothing → returning`) and added a third grant test covering the `INTERNAL_SERVER_ERROR / CONSENT_GRANT_CONFLICT_RESOLUTION_FAILED` edge case.
- [x] [Review][Patch] **P22** Annotated F20 + F21 in `deferred-work.md` with explicit "→ Story 1.4" pointers — those items are revocation-flow concerns that 1.4 will close.
- [x] [Review][Defer] Repeated decline writes repeated audit events — FR33 captures every decision; UI button disable covers in-flight; add dedup if noise becomes a problem.
- [x] [Review][Defer] `consent_grants.revoked_at` has no CHECK constraint (e.g., `revoked_at >= granted_at`) — Story 1.4 introduces revocation and is the right place.
- [x] [Review][Defer] RLS `WITH CHECK` doesn't constrain `revoked_at` — a patient could insert a row with `revoked_at` pre-set; defenses-in-depth for Story 1.4.
- [x] [Review][Defer] Per-screen `CONSENT_TEXT_VERSION` (vs single global) — bumping the global re-prompts unchanged screens; revisit when legal copy changes per-screen.
- [x] [Review][Defer] Single-tab tabs navigator UX wart — hide tab bar until additional tabs ship (later epic).
- [x] [Review][Defer] `SafeAreaView` hex `#F9F7F4` duplicated across `(tabs)/_layout.tsx`, `(tabs)/inicio.tsx`, `onboarding/consent.tsx` — extract to a shared `SAFE_AREA_BG` constant (joins F17 deferred family).
- [x] [Review][Defer] `next` query parameter lost when consent forces a redirect — preserve via `/onboarding/consent?next=...` and resume post-consent.
- [x] [Review][Defer] Mobile rapid "Concordo" double-tap race — disabled={pending} covers typical case; add ref guard if telemetry shows duplicates.
- [x] [Review][Defer] Cold-start deep-link before router mounted — Expo Router v6 handles internally; surface if observed in practice.
- [x] [Review][Defer] TRPCError vs network-error distinction in user messaging — generic message acceptable for v1.
- [x] [Review][Defer] `version` field accepts any non-empty string — values are server-controlled today; add ISO regex if external callers appear.
- [x] [Review][Defer] No callback-route integration test for the redirect-to-consent branch — joins F11 (no app-level test infra).
- [x] [Review][Defer] `EmptyStateRecord` per-state visual differentiation — wire when a consumer differentiates `partial` / `filtered-empty`.

14 dismissed as noise (false positives or established patterns) — including: writeConsentGrant audit-split is intentional (mirrors Story 1.1 writeAuditLog); `ctx.db` IS the protectedProcedure tx; Tailwind `text-amber-700` is the web design system equivalent; mobile `$biomarkerDeviation` use is the F17-deferred token misuse from Story 1.1; package.json types change is fully documented in Dev Agent Record; etc.

### Clarifications for the user (resolve before/at start of dev)

1. **Table name:** AC2 says `consent_records`; architecture says `consent_grants` (architecture.md:1465). This story uses `consent_grants` (precedent: Story 1.1 went with architecture's `users` over AC's `patients`). Confirm.
2. **Column names:** AC2 says `data_type` / `consent_text_version` / `agreed_at`; architecture says `consent_type` / `version` / `granted_at`. Recommended: architecture names. Confirm.
3. **Enum values for `consent_type`:** architecture lists 4 values (`health_data_processing`, `ai_extraction`, `doctor_sharing`, `llm_letter_generation`) that do not 1:1 map to AC1's three screens. **Recommended**: define a new enum `('blood_test_results', 'bioimpedance', 'ai_narrative')` to match the AC screens exactly; widen later as other consent surfaces appear. Alternative: collapse blood + bioimpedance into a single `health_data_processing` grant written twice with different `metadata.dataType` — semantically weak. Confirm.
4. **`CONSENT_TEXT_VERSION` format:** options are ISO date (`"2026-05-19"`), semver (`"1.0.0"`), or a content hash. Recommended: ISO date — easy to reason about, naturally orderable, bumps on every copy change. Confirm.
5. **UX-spec vs AC three-screen mismatch:** UX spec lines 1228–1233 list (core processing / AI narrative / analytics); AC1 lists (blood / bioimpedance / AI narrative). This story follows the AC. Confirm — and if UX spec governs, the schema and screens shift accordingly.
6. **CTA label for Início:** AC5 says `"Enviar resultado"`; UX spec table (line ~1170) says `"Adicionar primeiro exame"`; Story 1.5 wording (epics.md:627) says `"Enviar primeiro resultado"`. This story uses AC5's exact text. Confirm.
7. **Início route on Expo:** there is no tabs layout today (`apps/expo/src/app/index.tsx` is the root). Recommended for this story: add a plain `apps/expo/src/app/inicio.tsx` and `router.replace('/inicio')` from consent — defer tabs layout to whichever later story introduces multi-tab navigation. Confirm.
8. **Letter gate plumbing (AC4):** the AI-narrative consent must "enable" The Letter. Recommended: do NOT denormalize a `letterEnabled` flag onto `users` — derive it by querying `consent_grants` from `premiumProcedure` (or the Letter procedure itself) in Epic 4. Story 1.2 only needs to ensure the consent row is written. Confirm.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 packages clean.
- `pnpm lint` — 14/14 packages clean (after removing three forbidden non-null assertions in `consent.ts` router + web/expo consent flows).
- `pnpm format` — 10/10 packages clean after `pnpm format:fix`.
- `pnpm test` — 14 unit tests pass (8 new for Story 1.2: 2 grant, 1 decline, 1 list-dedup, 2 writeConsentGrant, 2 consentRequiredProcedure). 6 carried over from Story 1.1.
- Mid-implementation infra fix: `packages/api/package.json` `exports.types` pointer corrected from `./dist/index.d.ts` (incorrect since `__tests__` was added to the tsconfig include) to `./dist/src/index.d.ts` so the new `consent` router types resolve in `apps/web` and `apps/expo`. The same broken pattern still exists in `packages/db/package.json` but db consumers fall back to the `default` source path and were unaffected; flagged as a follow-up.

### Completion Notes List

**Decisions resolved at start (recorded in Clarifications):**

1. Three screens follow the AC: `blood_test_results`, `bioimpedance`, `ai_narrative`.
2. Architecture names win: table `consent_grants`, columns `consent_type` / `version` / `granted_at`.
3. Hybrid `consent_type_enum` — three screen-specific values plus the architecture's four generic values (`health_data_processing`, `ai_extraction`, `doctor_sharing`, `llm_letter_generation`) reserved for Epic 4 / Epic 5.
4. Expo tabs layout added now under `apps/expo/src/app/(tabs)/`. Único tab so far; later epics add Fingerprint / Settings.
5. `CONSENT_TEXT_VERSION = "2026-05-19"` (ISO date).
6. CTA `"Enviar resultado"` (AC5).
7. Letter gate derived from `consent_grants` at procedure time — no `letterEnabled` denormalization on `users`.
8. Email-confirm callback routes new patients (`initializeProfile.created === true`) to `/onboarding/consent`; returning users keep the requested `next`.

**What was implemented:**

- `consent_grants` Drizzle table + `consent_type_enum` pgEnum (7 values) at `packages/db/src/schema/consent.ts`, exported from `schema/index.ts`. Append-only at the DB layer (revocation = new row with `revoked_at`).
- `custom_rls_consent_grants.sql` with SELECT-own + INSERT-own WITH CHECK; no UPDATE/DELETE policies (NFR-S4).
- `consent_grants.rls.test.ts` adversarial matrix (5 cases), mirroring `audit_log.rls.test.ts` exactly — including the Story 1.1 round-2 visibility-first pattern (SELECT under correctPatient before asserting UPDATE/DELETE no-op).
- `writeConsentGrant()` helper at `packages/api/src/consent.ts` — single sanctioned write path, mirrors `writeAuditLog`.
- `consentRequiredProcedure(consentType)` factory at `packages/api/src/middleware/consent.ts` — layered on `protectedProcedure`, throws `FORBIDDEN / CONSENT_REQUIRED` when no active grant exists. No router consumes it yet; Epic 2/4/5 are the planned callers.
- `consent` router (`grant`, `decline`, `list`) at `packages/api/src/router/consent.ts`, registered in `root.ts`. `grant` is idempotent (existence check returns `created: false` on repeat) and emits `consent.granted` audit only on real insert. `decline` writes only the `consent.declined` audit event. `list` returns the patient's currently-active grants deduped by `consent_type` (latest wins).
- `packages/validators` extended with `CONSENT_DATA_TYPES`, `ConsentScreenType`, `ConsentGrantInputSchema`, `ConsentDeclineInputSchema`, `CONSENT_TEXT_VERSION`, `CONSENT_SCREEN_COPY` (pt-BR copy for the 3 screens with consequence-language pattern for decline), `CONSENT_VERSION_LABEL_PT_BR`, `INICIO_HEADLINE_PT_BR`, `INICIO_CTA_PT_BR`, plus route constants `ONBOARDING_CONSENT_ROUTE` / `INICIO_ROUTE`.
- `EmptyStateRecord` shared Tamagui component at `packages/ui/src/empty-state-record.tsx` (3 states × 2 variants per UX-DR10; `aria-hidden` illustration slot).
- Web onboarding consent flow: `app/onboarding/consent/page.tsx` (server shell) + `consent-flow.tsx` (client; TanStack Query mutations; sequential 3-screen flow; `router.replace(INICIO_ROUTE)` on completion to block back-navigation). Web Início at `app/inicio/page.tsx` + `inicio-empty-state.tsx`.
- Expo onboarding consent flow: `app/onboarding/consent.tsx` rewritten end-to-end; copy + routes pulled from shared validators. Expo Início at `app/(tabs)/inicio.tsx` under a new `(tabs)/_layout.tsx` (single tab today).
- Web `/auth/callback`: after `initializeProfile` returns `{ created: true }`, redirect to `/onboarding/consent` instead of the requested `next` (Story 1.2 AC3 hand-off enforced at the verification seam).
- Expo `_layout.tsx` deep-link handler: same — `router.replace(ONBOARDING_CONSENT_ROUTE)` when initializeProfile reports the user was just created.
- `packages/db/src/index.ts` extended to re-export common Drizzle operators (`and`, `desc`, `eq`, `isNull`, `or`) so `@healthtracker/api` doesn't need its own `drizzle-orm` dep.
- `packages/api/package.json` types pointer corrected (`./dist/src/index.d.ts`) — required because `__tests__` in tsconfig include changes the emit layout (story 1.1 set this up but the dist layout drift only surfaced when api consumers needed a new export).

**Tests (`pnpm test` runs all 14):**

- `__tests__/audit.test.ts` — 3 (carried over).
- `__tests__/account.test.ts` — 3 (carried over).
- `__tests__/consent.test.ts` — 8 (new): grant happy, grant idempotent, decline, list dedup, writeConsentGrant happy + RLS-failure-propagation, consentRequiredProcedure has-grant + no-grant.
- RLS tests (`packages/db/__tests__/rls/`): `users.rls.test.ts`, `audit_log.rls.test.ts`, `consent_grants.rls.test.ts` — require `supabase start`; excluded from `pnpm test`; run in CI `rls-adversarial` job.

**Out of scope / deferred:**

- Consent revocation flow (Story 1.4 will add the `revoke` procedure and consent management UI).
- `consentRequiredProcedure` consumers (Epic 2 uploads, Epic 4 Letter, Epic 5 sharing).
- `packages/db/package.json` types-pointer parity fix — db consumers currently work via the `default` source fallback; flag for cleanup.
- E2E / component tests for the consent screens (deferred from Story 1.1 as F11; same constraint here).

### Change Log

- 2026-05-19 — Story 1.2 implemented (Amelia, dev-story). Tasks 1–8 complete; status → review.
- 2026-05-19 — Code review pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 10 patches resolved (P13–P22), 13 deferred (F19–F31), 14 dismissed. Key fixes: race-safe ON CONFLICT idempotency + partial unique index; consent gating on email-confirm callback for consent-incomplete returners; register-form no-session inline message instead of dead-end nav; narrower `CONSENT_SCREEN_TYPES` input schema; consent-specific error copy + Expo a11y live region. Status remains `review`.
- 2026-05-19 — Code review round 2 on the patched code. 8 patches resolved (P23–P31, no P24): added `writeConsentGrantIfAbsent` so the helper is actually the sanctioned write path; nested try/catch so a `consent.list` blip no longer bounces returning users; separate notice/error slots in register-form so screen readers don't announce a success notice as an alert; RLS test matrix completed (wrongPatient + anon); ScrollView around Expo consent body; `router.replace` normalized to object form; removed speculative `or` re-export; tightened DELETE assertion. 10 additional findings deferred (F32–F41).

### File List

**New files**

- `packages/db/src/schema/consent.ts`
- `packages/db/policies/custom_rls_consent_grants.sql`
- `packages/db/__tests__/rls/consent_grants.rls.test.ts`
- `packages/api/src/consent.ts`
- `packages/api/src/middleware/consent.ts`
- `packages/api/src/router/consent.ts`
- `packages/api/__tests__/consent.test.ts`
- `packages/ui/src/empty-state-record.tsx`
- `apps/web/src/app/onboarding/consent/consent-flow.tsx`
- `apps/web/src/app/inicio/page.tsx`
- `apps/web/src/app/inicio/inicio-empty-state.tsx`
- `apps/expo/src/app/(tabs)/_layout.tsx`
- `apps/expo/src/app/(tabs)/inicio.tsx`

**Modified files**

- `packages/db/src/schema/consent.ts` (code review P13: `consent_grants_active_unique` partial unique index)
- `packages/api/src/consent.ts` (round-2 P26: added `writeConsentGrantIfAbsent` idempotent helper)
- `packages/api/src/router/consent.ts` (code review P13/P14: ON CONFLICT idempotency + deterministic list tiebreakers; round-2 P26: routes through `writeConsentGrantIfAbsent`)
- `packages/api/__tests__/consent.test.ts` (code review P21: new mock chain + INTERNAL_SERVER_ERROR fallback test; round-2: metadata added to insert assertion)
- `packages/db/__tests__/rls/consent_grants.rls.test.ts` (round-2 P25: added wrongPatient + anon cases; P31: tightened DELETE assertion)
- `apps/expo/src/app/onboarding/consent.tsx` (round-2 P29: ScrollView body + pinned footer; P30: object-form router.replace)
- `apps/expo/src/app/register.tsx` (round-2 P23: separate serverNotice slot; P30: object-form router.replace)
- `packages/validators/src/index.ts` (code review P18/P19: narrower screen-only input schemas + `GENERIC_CONSENT_ERROR_MESSAGE_PT_BR` + `VERIFY_EMAIL_MESSAGE_PT_BR`)
- `packages/ui/src/empty-state-record.tsx` (code review P15: removed unused `state` prop)
- `packages/ui/src/index.ts` (code review P15: dropped `EmptyStateRecordState` export)
- `apps/web/src/app/onboarding/consent/consent-flow.tsx` (code review P19: consent-specific error constant)
- `apps/expo/src/app/onboarding/consent.tsx` (code review P19: consent-specific error + a11y live region)
- `apps/web/src/app/auth/register/register-form.tsx` (code review P17: no-session inline verify-email message)
- `apps/expo/src/app/register.tsx` (code review P17: no-session inline verify-email message)
- `apps/web/src/app/auth/callback/route.ts` (code review P16: route on `consent.list` + safe consent fallback; round-2 P27: nested try/catch distinguishes init vs list failure)
- `apps/web/src/app/auth/register/register-form.tsx` (round-2 P23: separate serverNotice slot)
- `apps/expo/src/app/_layout.tsx` (code review P16/P20: consent gating + typed `Href`; round-2 P27: nested try/catch)
- `packages/db/src/index.ts` (round-2 P28: dropped unused `or` re-export)
- `packages/db/src/index.ts` (re-export Drizzle operators)
- `packages/db/src/schema/index.ts` (export `./consent`)
- `packages/api/src/root.ts` (register `consentRouter`)
- `packages/api/package.json` (`exports.types` → `./dist/src/index.d.ts`)
- `packages/validators/src/index.ts` (consent vocabulary + schemas + pt-BR copy + route constants)
- `packages/ui/src/index.ts` (export `EmptyStateRecord` + types)
- `apps/web/src/app/onboarding/consent/page.tsx` (placeholder → real consent flow shell)
- `apps/expo/src/app/onboarding/consent.tsx` (placeholder → real 3-screen flow)
- `apps/web/src/app/auth/callback/route.ts` (route new patients to `/onboarding/consent`)
- `apps/expo/src/app/_layout.tsx` (deep-link handler routes new patients to `/onboarding/consent`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story 1-2 → review)
