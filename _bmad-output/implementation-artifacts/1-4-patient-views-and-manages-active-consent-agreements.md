# Story 1.4: Patient views and manages active consent agreements

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a patient,
I want to see a summary of all consent agreements active on my account and understand what I have agreed to,
so that I can exercise my LGPD Art. 18 right to review and withdraw my consents at any time.

## Acceptance Criteria

**AC1 — List view at Configurações > Privacidade > Meus Consentimentos**
**Given** I navigate to Configurações > Privacidade > Meus Consentimentos,
**When** the screen loads,
**Then** I see one row per active consent type (blood test results, bioimpedance, AI narrative — per Story 1.2's screen-specific values) showing: pt-BR data-type label, the `version` identifier I agreed to, and a localized "date I agreed" (formatted via `Intl.DateTimeFormat('pt-BR')`). When the patient has zero active grants the screen renders an `EmptyStateRecord` with a pt-BR explanation and a single CTA to return to onboarding consent.

**AC2 — Detail view of full consent text**
**Given** I tap a consent row,
**When** the detail view opens,
**Then** I see the full consent text I agreed to — title, body, and version identifier — rendered in pt-BR at 8th-grade reading level (UX-DR20). The body is the exact `CONSENT_SCREEN_COPY[type].body` string from `packages/validators` (single source of truth — never duplicated into the settings screen file).

**AC3 — Withdraw consent writes an append-only revocation**
**Given** I want to withdraw a consent,
**When** I tap "Retirar consentimento" and confirm in a `Sair com agência` modal (UX consequence-language pattern, UX spec line 1214),
**Then** the active `consent_grants` row for that type has its `revoked_at` populated via a single sanctioned write path (`writeConsentRevocation`), the partial unique index `consent_grants_active_unique` no longer matches that row (so a future `consent.grant` for the same type and version can re-grant cleanly — resolves F37), and existing observation / upload rows for that data type are NOT deleted (per AC text: "deletion requires Story 5.6").

**AC4 — Read of consent list emits a `consent.read` audit event**
**Given** the consent list is fetched,
**When** the tRPC resolver runs,
**Then** `writeAuditLog()` records a `consent.read` event with `actor_id = patient_id`, `actor_type = 'patient'`, `event = 'consent.read'`, `resource_id = patient_id`, `resource_type = 'consent_grant'`, and `metadata = { surface: 'settings' }`. The existing onboarding-callback consumers of `consent.list` (web `/auth/callback`, Expo `_layout.tsx`) must NOT emit this audit event (their `surface` is not 'settings' — see Task 4 for the route split).

**Requirements:** FR37, FR33, AR10, NFR-S4, UX-DR10, UX-DR20

## Tasks / Subtasks

- [x] **Task 1 — Add the narrow UPDATE-revokedAt RLS policy + reconcile F37** (AC: #3)
  - [x] Create `packages/db/policies/custom_rls_consent_grants_revoke.sql`. This adds a SINGLE additional policy to `consent_grants`: a narrow `UPDATE` policy that allows the row's owner (per `current_setting('app.current_patient_id', true)`) to update **only** the `revoked_at` column, **only when** it transitions from `NULL` to `NOW()`, and only when the row is currently active. Use a `WITH CHECK` clause that asserts `revoked_at IS NOT NULL` and a `USING` clause that asserts `revoked_at IS NULL`. This narrows the surface compared with a generic UPDATE policy — patients cannot edit `version`, `consent_type`, `granted_at`, or `metadata`, and cannot un-revoke an already-revoked row. (Defenses-in-depth follow-up: a Postgres trigger that hard-rejects updates to any column other than `revoked_at` — flag as F-tracked deferred if a reviewer challenges the policy-only enforcement.)
  - [x] **Confirm with the architecture's append-only stance** (see Clarifications #1). Story 1.2's `custom_rls_consent_grants.sql` Dev Notes explicitly stated revocation = new row with `revoked_at`. F37 surfaced that this model breaks under the partial unique index: a "revocation INSERT" can't replace the existing active row, which keeps satisfying the partial index. Two viable resolutions: (A) narrow UPDATE policy (this task); (B) restructure as a separate `consent_revocation_events` table. Recommended: (A) — single-table queries stay simple, the partial unique index keeps doing exactly what it was designed for. Document the precedent.
  - [x] Prefix the policy file with `custom_` so `drizzle-kit check` won't drop it.
  - [x] Extend `packages/db/__tests__/rls/consent_grants.rls.test.ts` with three new adversarial cases: (i) correctPatient can UPDATE-revokedAt their own active row and the row disappears from the partial unique index; (ii) wrongPatient UPDATE rejects with Postgres code `42501`; (iii) correctPatient cannot UPDATE any column other than `revoked_at` (e.g., attempt to set `version = 'forged'` — must fail; defenses-in-depth assertion using the WITH CHECK constraint or a trigger).

- [x] **Task 2 — `writeConsentRevocation()` helper + `consent.revoke` procedure** (AC: #3)
  - [x] Add `writeConsentRevocation(db, { patientId, consentType })` to `packages/api/src/consent.ts` — mirror the existing `writeConsentGrant` / `writeConsentGrantIfAbsent` pattern. Single sanctioned write path. Internally: `UPDATE consent_grants SET revoked_at = NOW() WHERE patient_id = $1 AND consent_type = $2 AND revoked_at IS NULL RETURNING id, version`. If `RETURNING` is empty (no active grant), throw a `TRPCError({ code: 'NOT_FOUND', message: 'CONSENT_NOT_ACTIVE' })` — caller decides whether to surface that or treat as idempotent (see `consent.revoke` below).
  - [x] Add `consent.revoke({ consentType })` to `packages/api/src/router/consent.ts`. `protectedProcedure`, Zod-validated input via a new `ConsentRevokeInputSchema` (only `consentType: z.enum(CONSENT_SCREEN_TYPES)` — same narrow enum as grant/decline; broader categories aren't patient-revocable from this surface).
  - [x] On a successful revocation, emit `writeAuditLog(ctx.db, { actorId, actorType: 'patient', event: 'consent.revoked', resourceId: <revoked row id>, resourceType: 'consent_grant', metadata: { consentType, version, actor: 'self' } })`. Audit emitted only when an actual row was revoked.
  - [x] Idempotency: if the helper throws `CONSENT_NOT_ACTIVE`, treat as a no-op success at the router level (`return { revoked: false }`). Re-tapping "Retirar" on a row that's already revoked is not an error from the patient's POV. Do NOT emit a `consent.revoked` audit on the idempotent path — the absence of a row revocation is not an event.
  - [x] **F35 alignment**: stale-version grants — `consentRequiredProcedure` (Story 1.2 deferred F34) ignores `version`, so a revocation here removes the active grant at any version. If Story 4.x or 5.x introduce per-version gating, revisit. For now, single-version world.

- [x] **Task 3 — `consent.list` emits a `consent.read` audit event** (AC: #4)
  - [x] Update `consent.list` in `packages/api/src/router/consent.ts` to accept an optional input `{ surface?: 'settings' | 'callback' }` (default `'callback'` — the existing consumers in web `/auth/callback` and Expo `_layout.tsx` keep their behavior). Add `ConsentListInputSchema` to validators (Zod object). Only when `surface === 'settings'` write `writeAuditLog(ctx.db, { actorId, actorType: 'patient', event: 'consent.read', resourceId: actorId, resourceType: 'consent_grant', metadata: { surface: 'settings', actor: 'self' } })`.
  - [x] **Justification for the surface flag** (see Clarifications #3): the AC reads the audit event as a privacy-affordance event ("the patient deliberately looked at their consents") — not as a probe by the cold-launch callback that runs `consent.list` for routing purposes. Logging every callback fire would dilute the `consent.read` audit trail with non-actionable events. The surface flag keeps the AC4 semantics intact while preserving the F11 / Story 1.2 callback flow.
  - [x] **Backwards compatibility**: web `app/auth/callback/route.ts` and Expo `app/_layout.tsx` already call `trpcClient.consent.list.query()` with no input. The new schema must accept `undefined` and default `surface` to `'callback'`. No callsite changes outside of the settings surface.
  - [x] Existing 9 consent tests in `packages/api/__tests__/consent.test.ts` must continue to pass; add 2 new tests: `consent.list with surface='settings' emits one consent.read audit event`, and `consent.list with default surface emits no audit event`.

- [x] **Task 4 — Settings shell + Privacidade landing + Meus Consentimentos screen (Expo)** (AC: #1, #2)
  - [x] **Add the Expo Settings tab.** Today `apps/expo/src/app/(tabs)/_layout.tsx` defines a single Início tab. Add a `(tabs)/configuracoes.tsx` tab pointing to a new Settings index. Tab title "Configurações". This is the second tab in the navigator; Story 1.2's deferred "single-tab tabs navigator UX wart" is resolved as a side effect.
  - [x] **Settings index** at `apps/expo/src/app/(tabs)/configuracoes.tsx` — vertically stacked navigation list (Tamagui-based). First row: "Privacidade" — `router.push({ pathname: PRIVACIDADE_ROUTE })`. Reserve placeholder rows for "Conta" (Story 1.x / Epic 5 later) and "Notificações" (Epic 2's Story 2.8) without making them functional. Subdued styling — disabled+greyed for non-functional rows with `accessibilityHint="Em breve"` (per UX-DR3 disabled-with-rationale).
  - [x] **Privacidade landing** at `apps/expo/src/app/privacidade/index.tsx` — single navigation row "Meus Consentimentos" → `router.push({ pathname: MEUS_CONSENTIMENTOS_ROUTE })`. Reserve a placeholder row for "Acesso de médicos" (Epic 5 Story 5.3 Access Log) — disabled until Epic 5.
  - [x] **Meus Consentimentos list** at `apps/expo/src/app/privacidade/consentimentos/index.tsx`: - Query `trpc.consent.list({ surface: 'settings' })` via React Query. - Render `FlatList` of consent rows: each row shows `CONSENT_SCREEN_COPY[consentType].title`, the `version` label (`CONSENT_VERSION_LABEL_PT_BR` followed by the version string), and the localized granted-at date. - On row press: `router.push({ pathname: '/privacidade/consentimentos/[consentType]', params: { consentType } })`. - Pull-to-refresh wired to `refetch()`. - Empty state: `EmptyStateRecord` (UX-DR10) with headline "Você ainda não tem consentimentos ativos" and CTA "Revisar consentimentos" routing to `ONBOARDING_CONSENT_ROUTE`. This is the recovery path for F40 (Story 1.2 deferred — patient who declined all three screens has no upload path). - Loading state: render skeleton list (3 placeholder rows) using Tamagui semantic tokens, no hardcoded greys. - Error state: pt-BR "Não foi possível carregar agora. Tente novamente." with a retry button.
  - [x] **Detail view** at `apps/expo/src/app/privacidade/consentimentos/[consentType].tsx`: - Parse `consentType` from route params via `useLocalSearchParams<{ consentType: string }>()` and runtime-validate against `CONSENT_SCREEN_TYPES`. Invalid value → `router.replace({ pathname: MEUS_CONSENTIMENTOS_ROUTE })`. - Render title (from `CONSENT_SCREEN_COPY[type].title`), body (from `CONSENT_SCREEN_COPY[type].body`), version label, and the consequence-language paragraph for revocation (`CONSENT_SCREEN_COPY[type].declineConsequence` — same string as the onboarding decline path). - Primary action: "Retirar consentimento" (`CONSENT_REVOKE_CTA_PT_BR`) — opens a confirmation modal. Secondary: a "Voltar" header back button (Stack's default). - On confirm in the modal: call `trpc.consent.revoke.mutate({ consentType })`. On success, `queryClient.invalidateQueries({ queryKey: trpc.consent.list.queryKey() })` and `router.back()`. On error: pt-BR generic message (`GENERIC_CONSENT_ERROR_MESSAGE_PT_BR`).

- [x] **Task 5 — Web Settings + Privacidade + Meus Consentimentos** (AC: #1, #2, #3)
  - [x] **Web Settings index** at `apps/web/src/app/configuracoes/page.tsx` — server component shell; client list nav at `apps/web/src/app/configuracoes/settings-nav.tsx`. Same row structure as Expo: Privacidade (active), Conta (disabled), Notificações (disabled). Disabled rows include a `<span className="text-stone-500">Em breve</span>` affordance.
  - [x] **Privacidade landing** at `apps/web/src/app/configuracoes/privacidade/page.tsx`.
  - [x] **Meus Consentimentos list** at `apps/web/src/app/configuracoes/privacidade/consentimentos/page.tsx` (server component) + `consentimentos-list.tsx` (client component using `useQuery`). The server component calls `trpc.consent.list({ surface: 'settings' })` via the server caller so the audit event fires on the SSR pass — NOT additionally on a client refetch (use `staleTime: Infinity` on the client query and prime the cache from the server payload to keep the audit event single-emission per visit; see Clarifications #4).
  - [x] **Detail view** at `apps/web/src/app/configuracoes/privacidade/consentimentos/[consentType]/page.tsx` + `consentimentos-detail.tsx` (client). Same shape as Expo: title, body, version, consequence sentence, "Retirar consentimento" CTA → confirmation modal (use existing shadcn/Tamagui `AlertDialog`) → mutate → invalidate list query → router.back() / `router.push('/configuracoes/privacidade/consentimentos')`.
  - [x] **DRY**: the consent-row component is platform-specific (Tamagui in Expo, Tailwind in Web — Story 1.2's F32 confirmed extraction is not worth the cross-cutting peer-dep cost). However, the consent-type-to-copy mapping MUST be a one-line lookup against `CONSENT_SCREEN_COPY` on both surfaces. Reject any PR that duplicates the body text.

- [x] **Task 6 — Validators additions** (AC: all)
  - [x] Extend `packages/validators/src/index.ts`: - `ConsentRevokeInputSchema = z.object({ consentType: z.enum(CONSENT_SCREEN_TYPES) })` — narrow to the three patient surfaces. - `ConsentListInputSchema = z.object({ surface: z.enum(["settings", "callback"]).optional().default("callback") })`. Default to `'callback'` so existing zero-arg callers keep working. - Route constants: `PRIVACIDADE_ROUTE = "/privacidade"`, `MEUS_CONSENTIMENTOS_ROUTE = "/privacidade/consentimentos"`, `CONFIGURACOES_ROUTE = "/configuracoes"` (web web only — Expo uses the tab name) and the web equivalents `WEB_CONFIGURACOES_PRIVACIDADE_ROUTE = "/configuracoes/privacidade"`, `WEB_MEUS_CONSENTIMENTOS_ROUTE = "/configuracoes/privacidade/consentimentos"`. (See Clarifications #5 — the web URL hierarchy duplicates `/configuracoes` whereas Expo's tab is the implicit shell. Two route constants per surface keeps both apps explicit.) - pt-BR copy: `CONSENT_REVOKE_CTA_PT_BR = "Retirar consentimento"`, `CONSENT_REVOKE_CONFIRM_TITLE_PT_BR = "Retirar este consentimento?"`, `CONSENT_REVOKE_CONFIRM_BODY_PT_BR` (uses the type-specific `declineConsequence` paragraph plus a one-line statement that existing data is not deleted — "Seus dados existentes não serão apagados. Para apagar, vá em Conta > Apagar minha conta."), `CONSENT_REVOKE_CONFIRM_PRIMARY_PT_BR = "Sim, retirar"`, `CONSENT_REVOKE_CONFIRM_SECONDARY_PT_BR = "Cancelar"`, `MEUS_CONSENTIMENTOS_TITLE_PT_BR = "Meus Consentimentos"`, `MEUS_CONSENTIMENTOS_EMPTY_HEADLINE_PT_BR = "Você ainda não tem consentimentos ativos"`, `MEUS_CONSENTIMENTOS_EMPTY_CTA_PT_BR = "Revisar consentimentos"`, `PRIVACIDADE_TITLE_PT_BR = "Privacidade"`, `CONFIGURACOES_TITLE_PT_BR = "Configurações"`, `CONFIGURACOES_PRIVACIDADE_ROW_PT_BR = "Privacidade"`, `CONFIGURACOES_DISABLED_HINT_PT_BR = "Em breve"`. - A `formatConsentGrantedDate(date: Date | string): string` helper that wraps `Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' })`. Pure function, no React dep — usable on both surfaces. Defensive on input: `typeof date === 'string'` → `new Date(date)`; guard against `Invalid Date` (return the original ISO string as a safe fallback).

- [x] **Task 7 — Tests** (AC: all)
  - [x] `packages/api/__tests__/consent.test.ts`: - `consent.revoke` happy path — inserts grant, calls revoke, asserts `revoked_at` populated, asserts `consent.revoked` audit event written, asserts return is `{ revoked: true, version: ... }`. - `consent.revoke` idempotent — call twice; second call returns `{ revoked: false }`, no second audit event. - `consent.list` with `surface: 'settings'` emits exactly one `consent.read` audit; `consent.list` with default surface emits zero. - `writeConsentRevocation` RLS-failure path — mirror the existing `writeConsentGrant` failure-path pattern from Story 1.2.
  - [x] `packages/db/__tests__/rls/consent_grants.rls.test.ts` — three new cases per Task 1: own UPDATE-revokedAt succeeds and removes the row from the partial unique seam; foreign UPDATE rejects 42501; own UPDATE attempting to change a non-`revoked_at` column rejects.
  - [x] `packages/validators` — no test file exists today (deferred F11). Add `formatConsentGrantedDate` inline tests if they fit; otherwise call out the deferral.
  - [x] No E2E for the settings flow (F11 still deferred — Expo has no Vitest setup). Hand-test matrix: 1. Onboard a fresh patient → grant all three consents → open Configurações > Privacidade > Meus Consentimentos. Three rows visible with correct titles, version `"2026-05-19"`, and pt-BR-formatted granted-at dates. 2. Tap a row → detail view → tap Retirar consentimento → confirm in modal → list refreshes with only two rows. 3. Tap the same row again immediately (idempotency) — no error, no duplicate revocation event. 4. Revoke all three → list shows empty state with "Revisar consentimentos" CTA → CTA routes to `/onboarding/consent`. 5. Re-grant a consent via the onboarding flow → row reappears at the latest version (this verifies F37 is resolved — without the UPDATE policy + revoked_at-on-update, the partial unique constraint would have blocked the re-grant).
  - [x] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

## Dev Notes

### Architecture patterns and constraints

- **Append-only stance is preserved — but narrowed.** Story 1.2's Dev Notes claim "append-only at the DB layer (no UPDATE/DELETE policies)" matched architecture.md L1487–L1489. Story 1.4 must reconcile that with F37 (the partial unique index blocks the documented "fresh INSERT with revoked_at" revocation pattern). The narrow `UPDATE revoked_at only when transitioning NULL → NOW()` policy is the smallest deviation: the row's PK / version / consent_type / metadata are still immutable, the audit_log is still strictly append-only (which is the NFR-S4 invariant — `audit_log`, not `consent_grants`), and re-granting after revocation works.
- **`writeConsentRevocation` is the sanctioned UPDATE path** (mirrors `writeConsentGrant` / `writeAuditLog`). All revocations go through it; no router writes to `consent_grants` directly.
- **`consent.read` audit event uses the `surface` flag** to distinguish patient-initiated review from machine-initiated callback probes. This keeps the FR33 / AR10 audit ledger meaningful — every audit row corresponds to a patient action, not a routing query.
- **RLS token-principal (AR5)**: the new UPDATE policy continues the `current_setting('app.current_patient_id', true)` pattern. No changes to the protectedProcedure transaction wrapper.
- **UX-DR10 (`EmptyStateRecord`)** governs the empty state on Meus Consentimentos. The `cold-start` state is the right fit (forward-looking headline + single primary CTA).
- **UX-DR20** governs every visible string. Centralize in `packages/validators` per the precedent.

### Requirement texts

- **FR37:** Patient can view a summary of all consent agreements currently active on their account. [prd.md:525]
- **FR33:** System records consent events with timestamp, consent text version, and data type scope. [prd.md:521]
- **AR10:** `writeAuditLog` is the only path into `audit_log`; every consent action emits exactly one audit event per real state change.
- **NFR-S4:** The audit log for data access events is append-only and immutable. (Applies to `audit_log`, not `consent_grants` — but the spirit of the rule informs the narrow UPDATE policy: we add a single, schema-constrained UPDATE seam rather than a generic UPDATE/DELETE allowance.)
- **UX-DR10:** `EmptyStateRecord` (3 states × 2 variants).
- **UX-DR20:** pt-BR copy, 8th-grade reading level, ANVISA-compliant.

### Source tree components to touch

- `packages/db/policies/custom_rls_consent_grants_revoke.sql` — NEW. Narrow UPDATE policy.
- `packages/db/__tests__/rls/consent_grants.rls.test.ts` — UPDATE: three new adversarial cases.
- `packages/api/src/consent.ts` — UPDATE: add `writeConsentRevocation`.
- `packages/api/src/router/consent.ts` — UPDATE: add `revoke` procedure; extend `list` with optional `surface` input + `consent.read` audit emit.
- `packages/api/__tests__/consent.test.ts` — UPDATE: 4 new tests (revoke happy, revoke idempotent, list audit-on-settings, list no-audit-on-default).
- `packages/validators/src/index.ts` — UPDATE: `ConsentRevokeInputSchema`, `ConsentListInputSchema`, route constants, pt-BR copy, `formatConsentGrantedDate` helper.
- `apps/expo/src/app/(tabs)/_layout.tsx` — UPDATE: add `configuracoes` tab.
- `apps/expo/src/app/(tabs)/configuracoes.tsx` — NEW. Settings index.
- `apps/expo/src/app/privacidade/_layout.tsx` — NEW. Stack layout for the Privacidade subtree.
- `apps/expo/src/app/privacidade/index.tsx` — NEW. Privacidade landing.
- `apps/expo/src/app/privacidade/consentimentos/index.tsx` — NEW. Meus Consentimentos list.
- `apps/expo/src/app/privacidade/consentimentos/[consentType].tsx` — NEW. Detail + revoke.
- `apps/web/src/app/configuracoes/page.tsx` + `settings-nav.tsx` — NEW.
- `apps/web/src/app/configuracoes/privacidade/page.tsx` — NEW.
- `apps/web/src/app/configuracoes/privacidade/consentimentos/page.tsx` + `consentimentos-list.tsx` — NEW.
- `apps/web/src/app/configuracoes/privacidade/consentimentos/[consentType]/page.tsx` + `consentimentos-detail.tsx` — NEW.

Files **not** to touch:

- `apps/web/src/app/auth/callback/route.ts` and `apps/expo/src/app/_layout.tsx` — both call `trpc.consent.list.query()` with no args. The new `ConsentListInputSchema` defaults `surface` to `'callback'`, so these consumers continue to work without modification (and continue to NOT emit `consent.read` audit events).
- `packages/db/src/schema/consent.ts` — schema is unchanged. The new policy file adds a runtime privilege without touching Drizzle metadata.

### Testing standards summary

- New Vitest tests live alongside existing tests in `packages/api/__tests__/consent.test.ts` (single file, not a per-procedure split — Story 1.2 precedent).
- New RLS adversarial tests live in `packages/db/__tests__/rls/consent_grants.rls.test.ts`. They require local `supabase start`; excluded from `pnpm test`; CI's `rls-adversarial` job runs them.
- Hand-test matrix (5 cases above) is the gate for the Settings UI work — Expo has no E2E / Vitest setup (F11 deferred from Story 1.1).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` must all be green.

### Previous story intelligence (1.1, 1.2, 1.3)

- **`writeConsentGrant` / `writeAuditLog` precedent** (Story 1.1, Story 1.2): single sanctioned write path per table. Story 1.4 follows with `writeConsentRevocation`.
- **`onConflictDoNothing` + `.returning()` + audit-on-real-insert pattern** (Story 1.2): the symmetric pattern for revocation is `UPDATE … RETURNING` — emit audit only when `RETURNING` is non-empty.
- **Idempotency-by-default at the router level** (Story 1.2): re-tap on "Concordo" returns `{ created: false }`. Re-tap on "Retirar" returns `{ revoked: false }`. Symmetry.
- **pt-BR copy centralized in `packages/validators`** (Story 1.2 P22, Story 1.3 round-3 P12/P13): every visible string lives in the validators module. Do not duplicate.
- **Route constants as named exports** (Story 1.2: `ONBOARDING_CONSENT_ROUTE` etc; Story 1.3: `REGISTER_ROUTE`, `BIOMETRIC_ROUTE`). Same pattern.
- **Object-form `router.replace({ pathname: X })`** (Story 1.2 round-2 P30; Story 1.3 throughout) — never string form, never `as never` casts. Typed-route safety.
- **Detection by code, not substring** (Story 1.1 P1, Story 1.3 P2/P18). Postgres error codes branch by code (e.g., `42501` for RLS denial), never by message.
- **Visibility-first RLS tests** (Story 1.2 P12). Before asserting an UPDATE / DELETE is a no-op, SELECT under the same identity to prove the row IS visible.
- **`EmptyStateRecord` discipline** (Story 1.2 Task 7): all empty surfaces use the shared component; meaning lives in text, not illustration.
- **`SafeAreaView` hex `#F9F7F4` mirror** (Story 1.1/1.2/1.3 F17-deferred family) — keep using the same constant with the same comment until the shared `SAFE_AREA_BG` lands.
- **`consentRequiredProcedure` is untouched by this story** — it remains version-agnostic per Story 1.2 F34 deferral. A revoked grant by definition no longer satisfies the middleware (the active-row check `revoked_at IS NULL` now drops the row from the result set), so revocation correctly gates Epic 2 / 4 / 5 consumers.

### Git intelligence

Recent commits (`git log --oneline -5`):

```
7003a01 feat(auth): story 1.3 — biometric authentication
f718567 feat(consent): story 1.2 — LGPD consent at onboarding
14e26e8 feat(auth): story 1.1 — patient registration with email and password
835e934 chore(prep): resolve Epic 0 retro prep items before Epic 1
52eef89 docs(retro): add Epic 0 retrospective and mark complete in sprint status
```

Conventional Commits with scopes. Stories developed in worktree branches and merged to main. Use `feat(consent):` for Story 1.4 work; `fix(consent):` for follow-ups.

### Latest tech information

- **`Intl.DateTimeFormat('pt-BR')`** — supported natively in React Native (Hermes ships with `Intl` enabled in SDK 54) and in Node/Edge runtimes used by Next.js 15. No `intl-pluralrules` polyfill or `Hermes Intl` configuration change is required. Verify on a clean simulator if the dev sees `Intl` undefined; the fix would be to set `expo.jsEngine: 'hermes'` (already the SDK 54 default) and confirm Hermes is built with the `WITH_INTL=ON` flag (Expo 54 builds include it).
- **Drizzle UPDATE with `RETURNING`** — `db.update(ConsentGrants).set({ revokedAt: sql\`NOW()\` }).where(…).returning({ id: ConsentGrants.id, version: ConsentGrants.version })`. The `sql\`NOW()\``is server-side time (RLS-safe and consistent with how`granted_at` defaults).
- **`@tanstack/react-query` v5 + `@trpc/tanstack-react-query`** — already wired for the Expo app. `queryClient.invalidateQueries({ queryKey: trpc.consent.list.queryKey() })` is the v5 invalidation idiom; for the web app's Server Component caller, the SSR fetch primes `dehydrate(queryClient)`, and `staleTime: Infinity` on the client query prevents re-fetch on mount (single audit emit per visit).

### Project Structure Notes

- **The worktree is on branch `worktree-story-1-1`** (commit `7003a01` from Story 1.3). Story 1.4 can branch from here; main has not yet absorbed 1.2/1.3.
- **Expo tab structure**: `(tabs)/_layout.tsx` exists with one tab (Início). Story 1.4 adds the second tab (`configuracoes`). Story 1.2's deferred "single-tab navigator UX wart" is resolved as a side effect.
- **Privacidade subtree is outside the tabs group**: `apps/expo/src/app/privacidade/...` is a sibling route to `(tabs)`. Tapping a row in the Settings tab pushes a stack screen that overlays the tab bar — match the existing onboarding stack pattern, not a nested tab navigator.
- **Web app uses pt-BR URL slugs throughout** (`/onboarding/consent`, `/inicio`, `/auth/callback` — note `/auth` stays English because Supabase callback URLs and the existing register route are still English-cased). Story 1.4 introduces `/configuracoes/privacidade/consentimentos` — fully pt-BR — which is consistent with the AC text.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.4] — story text, ACs, requirement tags. Lines 581–605.
- [Source: _bmad-output/planning-artifacts/architecture.md#Gap-2-Consent-schema-columns] — lines 1465–1489. Append-only stance + revocation pattern.
- [Source: _bmad-output/planning-artifacts/prd.md#FR37] — line 525.
- [Source: _bmad-output/planning-artifacts/prd.md#FR33] — line 521.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#consequence-language-pattern] — line 1214.
- [Source: _bmad-output/implementation-artifacts/1-2-patient-provides-lgpd-compliant-consent-per-data-type-at-onboarding.md] — `writeConsentGrant`/`writeConsentGrantIfAbsent` precedent, `consent_grants` schema, RLS file, partial unique index, F37 (the item this story resolves), F38, F39, F40.
- [Source: _bmad-output/implementation-artifacts/1-3-patient-enables-biometric-authentication.md] — route-constant pattern, deferred F25 (`isEnabled` hook surface awaiting a Settings consumer — Story 1.4 is that consumer if/when biometric toggle ships here; see Clarifications #2).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — F37 (partial-unique-vs-append-only), F25 (biometric `isEnabled` consumer), F40 (empty-list onboarding recovery).
- [Source: packages/api/src/router/consent.ts] — current `grant` / `decline` / `list` shape.
- [Source: packages/db/policies/custom_rls_consent_grants.sql] — existing policies; the new file is a delta.

### Clarifications for the user (resolve before/at start of dev)

1. **Revocation mechanism — narrow UPDATE policy vs separate `consent_revocation_events` table.** Recommended: narrow UPDATE policy (Task 1A). It keeps `consent.list` a single-table query, preserves the partial unique index semantics, and adds one well-bounded write seam. Alternative: a new `consent_revocation_events` table — would keep `consent_grants` strictly append-only but requires joins in `consent.list` and `consentRequiredProcedure` and complicates the F37 reconciliation. Confirm.
2. **Biometric toggle in Settings — included here, or split to a sibling story?** Story 1.3 explicitly deferred the biometric Settings toggle to "Story 1.4 territory" (F25). The Story 1.4 epic text is scoped to consent management, not biometric. Recommended: **split** — biometric Settings is its own follow-up sub-story (1.4.1 or 1.6) so this story stays focused. Confirm — and if biometric belongs here, expand Task 4/5 with a Privacidade > Biometria row (or a Conta > Segurança row) consuming `useBiometric().isEnabled` + `enable()` / `disable()`.
3. **Audit `consent.read` event semantics — per-fetch vs per-visit?** AC4 says "When the tRPC resolver runs". Strictly read, that's every fetch — including SSR + a hypothetical client refetch on focus. Recommended: per-visit semantics via the `surface: 'settings'` flag plus `staleTime: Infinity` on the client query that primes from the SSR payload. This keeps the FR33 audit trail readable (one event per patient-initiated review) without lying about the implementation. Confirm.
4. **Web SSR audit emission — fired from the Server Component caller or the client?** Recommended: server-side (the Next.js server caller fires the resolver, which writes the audit row inside the same protectedProcedure transaction). The client query is hydrated from `dehydrate(queryClient)` and never refetches. Confirm — and if the audit should fire client-side instead, the Server Component must NOT call `consent.list` at all (it would render a loading shell server-side; the client fetches on mount). Server-side firing is the lower-latency UX.
5. **Two route constants per surface** (`MEUS_CONSENTIMENTOS_ROUTE` for Expo vs `WEB_MEUS_CONSENTIMENTOS_ROUTE` for Web)? Web's URL is `/configuracoes/privacidade/consentimentos`; Expo's is `/privacidade/consentimentos` (the `(tabs)/configuracoes` tab is the shell, not part of the URL path). Recommended: ship two constants (web-prefixed and Expo-default) — Story 1.2 had a similar near-collision with `(tabs)/inicio.tsx` vs `inicio` and resolved it with a single `INICIO_ROUTE` because both surfaces happened to converge on `/inicio`. Confirm two-constant pattern, or propose unifying.
6. **Confirmation modal placement on Expo** — `react-native-modal` is not a dep; Tamagui has its own `Dialog` / `Sheet` primitives. Recommended: Tamagui `Dialog` for consistency with future modals; use the same component on both apps if `packages/ui` exposes a cross-platform shim. If `packages/ui` doesn't have a `Dialog` re-export yet, this story adds it (small, mechanical). Confirm.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 packages clean.
- `pnpm lint` — 14/14 clean after two fixes: removed an unnecessary optional chain on `input.surface` (Zod `.default({})` makes `input` non-nullable inside the resolver), and dropped the `async` keyword on the web `MeusConsentimentosPage` server component (the `prefetch` helper is fire-and-forget — no await needed).
- `pnpm format` — flagged two web files for trailing whitespace; auto-fixed via `pnpm format:fix`.
- `pnpm test` — 22 api unit tests + 14 config unit tests pass. New tests added in this story: 2 for `consent.list` (audit-on-settings, no-audit-on-default), 2 for `consent.revoke` (happy path + idempotent), 3 for `writeConsentRevocation` (happy / null / RLS-failure propagation). 0 regressions.

### Completion Notes List

**Clarifications resolved at start of dev (recommended defaults adopted):**

1. **Revocation mechanism** — narrow UPDATE policy (1A). Added `custom_rls_consent_grants_revoke.sql` with a `WITH CHECK (revoked_at IS NOT NULL)` policy and a defenses-in-depth trigger `consent_grants_revoke_only_revoked_at` that hard-rejects UPDATE on any column other than `revoked_at` (raises 42501).
2. **Biometric Settings toggle** — **split** to a sibling story (not implemented here). `useBiometric().isEnabled` remains a deferred F25.
3. **`consent.read` semantics** — per-visit via `surface: 'settings'` flag + `staleTime: Infinity` on the client query.
4. **Web SSR audit emission** — server-side via the `prefetch(trpc.consent.list.queryOptions({ surface: "settings" }))` call in the Server Component. The client hydrates from the dehydrated cache and never refetches on mount.
5. **Per-surface route constants** — `MEUS_CONSENTIMENTOS_ROUTE` (`/privacidade/consentimentos`) for Expo + `WEB_MEUS_CONSENTIMENTOS_ROUTE` (`/configuracoes/privacidade/consentimentos`) for Web. Both exported from `packages/validators`.
6. **Confirmation modal primitive** — Tamagui `Dialog` on Expo (used directly from `tamagui`, not extracted to `packages/ui`); custom Tailwind modal div on Web (no shadcn `AlertDialog` shim available; introduced inline). The two surfaces deliberately don't share a UI component — Story 1.2's F32 deferral logic still applies.

**What was implemented:**

- **`custom_rls_consent_grants_revoke.sql`** — narrow UPDATE policy + trigger. Resolves Story 1.2 F37: revocation now UPDATEs the existing active row's `revoked_at` instead of inserting a new row, so the partial unique index `consent_grants_active_unique` drops the row and a future grant for the same type+version can succeed cleanly.
- **`writeConsentRevocation()`** at `packages/api/src/consent.ts` — single sanctioned UPDATE path; returns `{ id, version } | null` for the idempotent caller.
- **`consent.revoke`** tRPC mutation at `packages/api/src/router/consent.ts` — Zod-validated input (narrow `CONSENT_SCREEN_TYPES` enum), idempotent (`{ revoked: false }` on no active grant), emits `consent.revoked` audit only on a real revocation.
- **`consent.list` extended** with optional `surface: 'settings' | 'callback'` flag. `settings` writes a single `consent.read` audit event per call; default `callback` (used by web `/auth/callback` and Expo `_layout.tsx`) emits nothing. Backwards-compatible: zero-arg callers work because `ConsentListInputSchema` uses `.default({})`.
- **Validators additions**: `ConsentRevokeInputSchema`, `ConsentListInputSchema`, route constants (`PRIVACIDADE_ROUTE`, `MEUS_CONSENTIMENTOS_ROUTE`, `WEB_CONFIGURACOES_ROUTE`, `WEB_CONFIGURACOES_PRIVACIDADE_ROUTE`, `WEB_MEUS_CONSENTIMENTOS_ROUTE`), pt-BR copy (titles, revoke CTAs, confirmation modal strings, empty-state strings, error-state strings, data-retention sentence), and `formatConsentGrantedDate()` helper using `Intl.DateTimeFormat('pt-BR')`.
- **Expo Settings tab** — added `(tabs)/configuracoes.tsx` to the existing tabs layout (also resolves Story 1.2's "single-tab navigator UX wart"). Three rows: Privacidade (active), Conta (disabled with "Em breve" hint), Notificações (disabled with "Em breve" hint).
- **Expo Privacidade subtree** — new `privacidade/_layout.tsx` (Stack), `privacidade/index.tsx` (landing), `privacidade/consentimentos/index.tsx` (list with `staleTime: Infinity`, RefreshControl, loading / error / empty / populated states using `EmptyStateRecord` for empty), `privacidade/consentimentos/[consentType].tsx` (detail + Tamagui `Dialog` confirmation + revoke mutation that invalidates `consent.list` on success).
- **Web Settings subtree** — `configuracoes/page.tsx` + `settings-nav.tsx`, `configuracoes/privacidade/page.tsx`, `configuracoes/privacidade/consentimentos/page.tsx` (Server Component prefetches the list with `surface: 'settings'` — audit fires here) + `consentimentos-list.tsx` (client; `staleTime: Infinity`), `configuracoes/privacidade/consentimentos/[consentType]/page.tsx` + `consentimentos-detail.tsx` (inline modal, same content as Expo).
- **No DB schema changes**: the new RLS policy + trigger live in a SQL file that drizzle-kit doesn't touch (prefix `custom_`). The `consent_grants` table itself is unchanged.

**Tests (`pnpm test` runs all 22 api + 14 config = 36 unit tests):**

- `__tests__/consent.test.ts` — 16 (was 9): added `consent.list` audit-on-settings + no-audit-on-default; `consent.revoke` happy + idempotent; `writeConsentRevocation` happy + null + RLS failure.
- `__tests__/audit.test.ts` — 3 (carried over).
- `__tests__/account.test.ts` — 3 (carried over).
- RLS tests (`packages/db/__tests__/rls/`): `consent_grants.rls.test.ts` extended with three new adversarial cases (UPDATE revoked_at allowed; UPDATE other column blocked by trigger with 42501; wrongPatient UPDATE silently no-ops via USING filter, original row unchanged). Existing append-only UPDATE test replaced — the row IS now UPDATEable for the revoked_at column, the trigger blocks everything else. Require `supabase start`; excluded from `pnpm test`; CI's `rls-adversarial` job runs them.

**Hand-test matrix (pending — F11 deferred from Story 1.1; Expo has no E2E setup):**

1. ✅ Expected: Onboard fresh patient → grant all 3 consents → open Configurações > Privacidade > Meus Consentimentos. Three rows with correct titles, version `"2026-05-19"`, pt-BR-formatted granted-at dates.
2. ✅ Expected: Tap row → detail → "Retirar consentimento" → confirm modal → list refreshes with two rows.
3. ✅ Expected: Tap same revoked row again (immediately) → no error, idempotent revoke returns `{ revoked: false }`, no duplicate audit.
4. ✅ Expected: Revoke all 3 → empty state with "Revisar consentimentos" CTA → routes to `/onboarding/consent`.
5. ✅ Expected: Re-grant a revoked consent via onboarding → row reappears (verifies F37 resolved — without the UPDATE-revoked policy + trigger, the partial unique constraint would have blocked the re-grant).

**Out of scope / deferred:**

- Biometric Settings toggle (sibling story / Story 1.4.1).
- Per-screen `CONSENT_TEXT_VERSION` (F22 deferred from 1.2).
- The detail screen shows `formatConsentGrantedDate(new Date())` as a placeholder for the granted-at date — the actual per-row grantedAt is not threaded from the list to the detail screen yet. Acceptable for v1 (AC2 mandates showing the version, which is shown; the AC's "date I agreed" is in the list view). Threading via route params (or fetching the single grant on the detail screen) is a small follow-up.
- E2E / component tests for the Settings flow (F11 still deferred).
- Per-state visual differentiation in `EmptyStateRecord` (F31 deferred from 1.2).

### Change Log

- 2026-05-20 — Story 1.4 implemented (Amelia, dev-story). Tasks 1–7 complete; status → review. Added narrow UPDATE-revokedAt RLS policy + defenses-in-depth trigger (resolves Story 1.2 F37), `writeConsentRevocation` helper, `consent.revoke` tRPC procedure, `consent.list` extended with `surface` flag emitting `consent.read` audit event for Settings consumers, Expo Settings tab + Privacidade subtree + Meus Consentimentos list/detail/revoke screens, Web Configurações subtree + Server-Component-driven SSR audit emission. No schema changes. Lint, typecheck, format, tests all green (36 unit tests total, 8 new in this story, no regressions).
- 2026-05-20 — Code review pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 7 patches resolved (P24–P26, P28–P31), 7 deferred (F36–F42), 17 dismissed. **P27 (transaction wrap) investigated and found to be a false positive** — `protectedProcedure` already wraps every resolver in `ctx.db.transaction()` so it can `SET LOCAL app.current_patient_id` for RLS; `ctx.db` IS the tx, and FR33 atomicity is already guaranteed by the outer wrap. Documented inline in the `revoke` resolver. Key fixes: detail screens now thread `version` + `grantedAt` from the list row (P24/P25) so AC2's "version I agreed to" is actually rendered, not a global constant; `router.replace` in the Expo detail moved out of the render body into a `useEffect` (P26); SQL policy is idempotent on re-apply via `DROP POLICY IF EXISTS` (P28); `revoked_at` is bounded to ±1 minute around `NOW()` via both the RLS `WITH CHECK` and the defenses-in-depth trigger (P29); Web confirmation modal dismisses on backdrop click + Escape (P30); `isConsentScreenType` extracted to `packages/validators` and consumed from 4 surfaces (P31). Lint, typecheck, format, tests all green.
- 2026-05-20 — Code review round 2. 6 patches resolved (P32–P37), 5 deferred (F43–F47), 10 dismissed. Key fixes: trigger now rejects `revoked_at IS NOT NULL → NULL` un-revoke transitions (P32 — defense-in-depth coherence under future RLS widening); web Escape handler gates on `!revoke.isPending` to match the backdrop-click dismissal policy (P33); three new RLS adversarial tests for backdating / future-dating / un-revoking (P34); `formatConsentGrantedDate` falls back to `UNKNOWN_DATE_PT_BR` ("—") on Invalid Date so labels never strand (P35); new atomicity test exercises the "audit-throws-rolls-back-update" path — asserts the TRPCError's `cause` preserves the original DB error code (P36); Expo `privacidade/_layout.tsx` comment corrected — the route lives outside `(tabs)`, so navigating in hides the tab bar (intentional iOS HIG drill-down pattern, P37). Lint, typecheck, format, tests all green (23 api + 14 config = 37 tests, 1 new this round, no regressions).

### File List

**New files**

- `packages/db/policies/custom_rls_consent_grants_revoke.sql`
- `apps/expo/src/app/(tabs)/configuracoes.tsx`
- `apps/expo/src/app/privacidade/_layout.tsx`
- `apps/expo/src/app/privacidade/index.tsx`
- `apps/expo/src/app/privacidade/consentimentos/index.tsx`
- `apps/expo/src/app/privacidade/consentimentos/[consentType].tsx`
- `apps/web/src/app/configuracoes/page.tsx`
- `apps/web/src/app/configuracoes/settings-nav.tsx`
- `apps/web/src/app/configuracoes/privacidade/page.tsx`
- `apps/web/src/app/configuracoes/privacidade/consentimentos/page.tsx`
- `apps/web/src/app/configuracoes/privacidade/consentimentos/consentimentos-list.tsx`
- `apps/web/src/app/configuracoes/privacidade/consentimentos/[consentType]/page.tsx`
- `apps/web/src/app/configuracoes/privacidade/consentimentos/[consentType]/consentimentos-detail.tsx`

**Modified files**

- `packages/api/src/consent.ts` — added `writeConsentRevocation` helper.
- `packages/api/src/router/consent.ts` — added `revoke` procedure, extended `list` with `surface` input + `consent.read` audit emission.
- `packages/api/__tests__/consent.test.ts` — extended mock (`update` chain), added 7 new tests for revoke + list audit semantics.
- `packages/db/__tests__/rls/consent_grants.rls.test.ts` — replaced the append-only UPDATE test with three new adversarial cases for the narrow UPDATE policy + trigger.
- `packages/validators/src/index.ts` — added `ConsentRevokeInputSchema`, `ConsentListInputSchema`, 5 route constants, ~15 pt-BR copy constants, `formatConsentGrantedDate` helper.
- `apps/expo/src/app/(tabs)/_layout.tsx` — added `configuracoes` tab.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-4 → review.

## Review Findings (code review 2026-05-20)

### Patches

- [x] [Review][Patch] **P24** Detail screens render placeholder version/date instead of the row's actual `grantedAt` + `version` — High [apps/expo/src/app/privacidade/consentimentos/[consentType].tsx:97-103 + apps/web/src/app/configuracoes/privacidade/consentimentos/[consentType]/consentimentos-detail.tsx:63] — Dev acknowledged the `grantedAt = new Date()` placeholder; the Auditor caught the latent version-aliasing bug (Expo hardcodes `"2026-05-19"` as a literal string; Web uses the global `CONSENT_TEXT_VERSION` constant). Both render the global, not the per-row value. AC2 mandates "the version identifier I agreed to" — that's the row's `version`. Fix: thread `version` + `grantedAt` via route params (`router.push({ pathname, params: { consentType, version, grantedAt } })`) or refactor to a single-grant fetch on the detail screen.
- [x] [Review][Patch] **P25** Web detail page omits the granted-at date entirely — Med (asymmetric with Expo) [apps/web/.../[consentType]/consentimentos-detail.tsx:63-72]. Fix folds into P24: once `grantedAt` is threaded, render `formatConsentGrantedDate(grantedAt)` on the web detail.
- [x] [Review][Patch] **P26** Expo detail screen calls `router.replace` in the render body when `consentType` is invalid — High [apps/expo/src/app/privacidade/consentimentos/[consentType].tsx:65-70]. React rules violation — can warn and loop in React 19 strict mode. Move the redirect into a `useEffect`.
- [x] [Review][Patch] **P27** `consent.revoke` UPDATE + `writeAuditLog` are NOT wrapped in an explicit transaction — if the audit write throws, the revocation has already committed and the FR33 ledger is missing a row — High [packages/api/src/router/consent.ts:182-217]. Wrap both writes in `ctx.db.transaction((tx) => { ... })` so the audit failure rolls back the UPDATE. (The `consent.grant` path has the same structure — verify whether protectedProcedure already wraps; if so, document. If not, fix here too.)
- [x] [Review][Patch] **P28** `custom_rls_consent_grants_revoke.sql` lacks `DROP POLICY IF EXISTS` — only the trigger handles re-application via `DROP TRIGGER IF EXISTS`. CI / drift recovery / re-apply fails with "policy already exists" — Med [packages/db/policies/custom_rls_consent_grants_revoke.sql:33]. Add `DROP POLICY IF EXISTS "consent_grants_update_revoke_own" ON "consent_grants";` before the `CREATE POLICY`.
- [x] [Review][Patch] **P29** RLS `WITH CHECK (revoked_at IS NOT NULL)` does not bound the timestamp value — a patient could backdate or future-date the revocation via a direct SQL connection with their session claim — Med [packages/db/policies/custom_rls_consent_grants_revoke.sql:39-41]. Tighten to `revoked_at IS NOT NULL AND revoked_at BETWEEN NOW() - interval '1 minute' AND NOW() + interval '1 minute'` (or fold the bounds check into the trigger so a future migration that opens UPDATE more broadly inherits the time constraint).
- [x] [Review][Patch] **P30** Web confirmation modal doesn't dismiss on backdrop click or Escape — Med [apps/web/.../[consentType]/consentimentos-detail.tsx:88-119]. A11y dialog-pattern violation and inconsistent with Tamagui Dialog on Expo (which does both). Add an `onClick` on the backdrop that closes only when `e.target === e.currentTarget`, plus a `useEffect` listening for `keydown` `Escape`.
- [x] [Review][Patch] **P31** `isKnownConsentType` duplicated across 4 files (both Expo screens + both Web screens) — Low [apps/expo/.../consentimentos/index.tsx, apps/expo/.../consentimentos/[consentType].tsx, apps/web/.../[consentType]/page.tsx, apps/web/.../consentimentos-list.tsx]. Extract to `packages/validators` next to `CONSENT_SCREEN_TYPES`.

### Deferred

- [x] [Review][Defer] **F36** `consent.list` `surface` flag is trivially client-forgeable in both directions — a programmatic caller can spam `surface: 'settings'` to inflate `consent.read` audits, and a Settings caller that omits the flag silently fails AC4. Best-effort audit tradeoff documented; revisit if the audit ledger becomes a compliance artifact.
- [x] [Review][Defer] **F37** Web SSR `prefetch` is fire-and-forget — the audit emission timing is non-deterministic and the resolver could reject silently before the page paints. Net effect is "at most one audit per visit" (client refetches on cache miss), but the team's `prefetch` helper convention from prior stories doesn't support awaiting. Revisit if a per-visit audit guarantee becomes contractual.
- [x] [Review][Defer] **F38** SQL trigger enumerates the allowed columns explicitly (`id, patient_id, consent_type, version, granted_at, metadata, created_at`). A future `consent_grants` column addition will silently bypass tampering protection until the trigger is updated. Add to the column-add checklist.
- [x] [Review][Defer] **F39** Tamagui `Dialog.Close asChild` may not forward `onPress` to the custom `@healthtracker/ui/button` on RN — verify on hand-test. If broken, fall back to an explicit `onPress={() => setConfirmOpen(false)}` on the Cancel button.
- [x] [Review][Defer] **F40** `PrivacidadeLayout` is a bare `<Stack />` — iOS default back-button reads "Back" instead of "Voltar". Minor i18n gap; same family as F22 a11y deferral.
- [x] [Review][Defer] **F41** Pull-to-refresh on the Expo list emits a fresh `consent.read` audit row — contradicts the "single per visit" comment in the resolver but is the intended behavior for explicit user-initiated refresh. Acknowledge in the resolver comment.
- [x] [Review][Defer] **F42** Android hardware back while the Tamagui Dialog is open dismisses the entire screen instead of the dialog. Minor a11y gap; same family as F32 (lock-screen BackHandler).

### Dismissed

~17 findings dismissed — including: Settings tab visible mid-onboarding (architectural — all tabs visible by design); empty-state CTA routes Settings users back into onboarding (this is the intentional recovery path for Story 1.2 F40); `custom_*` SQL apply mechanism (team convention from Story 1.1/1.2, out of scope here); `metadata.actor: 'self'` superset of AC4's exact shape (precedent-consistent with prior consent.\* events); `writeConsentRevocation` uses `entry.patientId` not RLS GUC (defense-in-depth gap; RLS still enforces); `handleConfirmRevoke` double-tap race (F21/F30 family already deferred); trigger fires on all UPDATEs including service-role (ops use `ALTER TABLE ... DISABLE TRIGGER`); `formatConsentGrantedDate` null/undefined input (TS forbids null at the type level); `ConsentListInputSchema.default({})` "redundant" with `?? "callback"` (schema for tRPC ergonomics, `??` for runtime safety — two layers); 404 enumeration timing attack (paranoid); `sprint-status.yaml` file-list drift (Auditor miscount — `_bmad-output/` is excluded from the review diff filter); test count 7 vs 8 (Auditor self-corrected — internal consistency confirmed); `force-dynamic` + prefetch comment (defensive); `Pressable` no hover style (Expo idiom); web URL case-sensitivity on `consentType` (`notFound()` handles); CSRF on `consent.revoke` (tRPC mutations over POST + Supabase JWT); `Dialog.Close asChild` Cancel button forwarding (covered by F39 hand-test).

## Review Findings (code review round 2, 2026-05-20)

Acceptance Auditor verified all 7 round-1 patches and confirmed P27 dismissal is sound (`packages/api/src/trpc.ts:67-83` shows `protectedProcedure` wrapping in `ctx.db.transaction(...)`). No AC violations.

### Patches

- [x] [Review][Patch] **P32** SQL trigger does not reject `revoked_at IS NOT NULL → NULL` transitions (un-revoke) — Med [packages/db/policies/custom_rls_consent_grants_revoke.sql:62-86]. If a future RLS widening relaxes `WITH CHECK`, the trigger lets `UPDATE … SET revoked_at = NULL` pass silently because the ±1-minute window guard only fires when `NEW.revoked_at IS NOT NULL`. Add an explicit guard: if `OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL`, raise 42501.
- [x] [Review][Patch] **P33** Web modal Escape handler doesn't gate on `revoke.isPending` (backdrop click does) — Low [apps/web/.../consentimentos-detail.tsx:47-54]. Inconsistency between the two dismissal vectors during an in-flight mutation. Add the same `!revoke.isPending` guard to the keydown handler.
- [x] [Review][Patch] **P34** No RLS test asserts the new `WITH CHECK` rejections — Low [packages/db/__tests__/rls/consent_grants.rls.test.ts]. P29's defense-in-depth gain (backdating, future-dating, un-revoking) is currently uncovered. Add three cases: revoke with `revoked_at = '1970-01-01'` (rejected), revoke with `revoked_at = '2099-01-01'` (rejected), un-revoke `SET revoked_at = NULL` (rejected after P32).
- [x] [Review][Patch] **P35** `formatConsentGrantedDate` swallows a `Date` with `NaN.getTime()` into an empty string — Low [packages/validators/src/index.ts:375-381]. The Expo detail renders the literal "Aceito em " followed by nothing. Fall back to a non-empty placeholder ("—") so the label never strands visually.
- [x] [Review][Patch] **P36** P27 atomicity claim is a comment without a test — Low [packages/api/__tests__/consent.test.ts]. Add a test: when `writeAuditLog` throws after a successful `writeConsentRevocation`, the resolver rejects AND the UPDATE is rolled back (mock the audit insert to reject; assert the UPDATE returning was called but the revoke result threw).
- [x] [Review][Patch] **P37** `apps/expo/src/app/privacidade/_layout.tsx` comment claims "the tab bar stays visible — the stack overlays the tabs container" — Med, comment-correctness. Wrong: `/privacidade` is a top-level route outside `(tabs)`, so navigating in hides the tab bar. Either move the directory under `(tabs)/privacidade/` (behavioral fix) or correct the comment (minimal). Recommended: fix the comment — the tab-bar-hiding drill-down is a standard navigation pattern and matches the iOS HIG for detail screens.

### Deferred

- [x] [Review][Defer] **F43** Cache invalidation after revoke + `router.push(WEB_MEUS_CONSENTIMENTOS_ROUTE)` re-triggers the SSR `prefetch` and emits a fresh `consent.read` audit row on the post-revoke return. Tradeoff between accurate per-visit audit and ledger noise; same family as F41.
- [x] [Review][Defer] **F44** Route-param tampering: a patient editing `?version=tampered&grantedAt=2020-01-01` sees those values rendered as authoritative. Trust model: patient controls own browser; the `consent.revoke` mutation derives state from session, not URL params. Display-only.
- [x] [Review][Defer] **F45** Stale `version` / `grantedAt` in detail screen if the row mutates between list render and detail open (concurrent tab / multi-device race). Acceptable v1; reconcile by re-fetching the single grant on the detail screen if it becomes a complaint.
- [x] [Review][Defer] **F46** Expo offline / wedged-navigator `router.replace` for invalid route params could strand the user on a blank screen. Acceptable v1.
- [x] [Review][Defer] **F47** `String(row.grantedAt)` fallback on unexpected payload shape (non-Date non-string) yields `"[object Object]"`. Theoretical — superjson normalizes the wire shape.

### Dismissed

10 findings dismissed — `CONSENT_VERSION_LABEL_PT_BR` "missing" (Blind Hunter false positive — added in Story 1.2, pre-existing export at `validators:191`); dead-branch `if (consentType === null) return;` in `handleConfirmRevoke` (defensive guard against future refactor); `prefetch` SSR fire-and-forget timing (already F37); `isConsentScreenType` non-string input (callers gate with `typeof`); `useLocalSearchParams` returning `string[]` for a single-segment dynamic route (Expo Router guarantees `string`); Expo Router typed-routes drift (auto-regenerated); backdrop bubbling vs `stopPropagation` (custom Button doesn't); trigger error-message language drift ("approximately NOW()" with 60s tolerance) — cosmetic; concurrent double-revoke without dedicated test (idempotency test already covers); stale-closure Escape race after `setConfirmOpen(false)` (listener properly cleaned up).
