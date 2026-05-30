# Story 6.4 — Code Review R1

Commit: `c6eb554` (worktree-story-6-2; PR #57; stacked on Story 6.3 R1 `66ddaeb`).
Spec: `_bmad-output/implementation-artifacts/6-4-doctor-invites-a-patient-to-create-a-health-tracker-account.md`.
Reviewer scope: 25 files / +3 290 / -30 lines.

**Verdict: REQUEST CHANGES.** No blockers; one high-severity correctness/coverage concern around the integration suite, plus medium issues on a dynamic import inside a hot path and on the spec/implementation tension around `initializeProfile` rollback semantics. The load-bearing security guarantees (HMAC domain-prefix, FK `set null` exception, 7-identity RLS, NOT-in-`ACCESS_LOG_EVENT_KINDS`) all land correctly with regression coverage.

---

## Bucketed findings

- Blockers: 0
- High: 1
- Medium: 4
- Low: 3
- Nits: 3

## Top findings

1. **[HIGH] Integration tests mirror SQL inline — resolver behavior (narrow 23505 catch, activation gate, `alreadyRegistered` short-circuit, programmer-error rethrow) is NOT exercised by `create-patient-invite.integration.test.ts`.** Spec T8.1 lists six cases (happy, idempotent, already-registered, phone-normalisation hash collision, doctor-not-activated, renewal); only three ship (happy / idempotent / renewal) plus a check-constraint case. Inline-SQL mirror is the documented db-package pattern (no api import), but the gap leaves the `alreadyRegistered` branch + the `PRECONDITION_FAILED` activation gate + the 23505 narrow-catch with **only the resolver's own implementation as their first line of defense** — no end-to-end safety net. Recommend either (a) adding api-level integration tests that invoke `appRouter.createCaller` from a `packages/api/__tests__/integration` location, or (b) extending the inline mirrors to cover all six spec cases and explicitly comment the gap.

2. **[MEDIUM] Dynamic `await import("@healthtracker/db/client")` inside the `createPatientInvite` hot path** (`packages/api/src/router/sharing.ts:1927`) for the `auth.users` existence probe. Functionally correct (the bare service-role connection bypasses the doctor's RLS tx; intentional), but the pattern is unusual and unprincipled — pays a module-resolution cost on every call, hides the dependency from static analysis, and risks circular-dep papering. Hoist to a top-level import (the bare `db` is already imported in `packages/api/src/trpc.ts:7`) or wrap behind a named helper in `packages/api/src/sharing.ts`.

3. **[MEDIUM] Spec/impl tension on `initializeProfile` atomicity.** The R1 task brief item #5 demands rollback on flip failure. The shipped helper `resolvePatientInviteWithinTx` is contracted as "MUST NOT THROW" — infra failures, HMAC mismatch, race-revoke, all silently no-op. The spec AC7 step 4 / T4.4 explicitly accepts the silent-no-op path ("registration still completes — but no audit emission and no referrer attribution"), so the shipped behavior matches the spec, but the silent fail-open swallows EVERY non-programmer-error from the SELECT, the HMAC compare, and the UPDATE. Recommend narrowing the `catch` to swallow only Postgres error shapes you can articulate (e.g. concurrent-update class) and let unknown shapes propagate; today's broad `catch (err) { ...; console.warn }` is exactly the failure mode CLAUDE.md "Narrow catches" warns against.

## Per-check pass/fail

1. **HMAC domain-prefix is load-bearing.** PASS. `signPatientInviteToken` prepends `"patient_invite:"`; `verifyPatientInviteToken` recomputes with the prefix. The regression test in `patient-invite-helpers.test.ts:117` uses the SAME `raw` for both calls and asserts inequality; a separate `cross-surface-replay` test confirms a share-token signature does NOT verify as a patient-invite signature. Solid.
2. **Partial unique index + narrow 23505.** PASS. Index `patient_invites_professional_identifier_active_uq` is `ON (professional_user_id, identifier_hash) WHERE status = 'pending'`; resolver SELECT-existing filter and INSERT both use `status = 'pending'`; 23505 catch is narrow and folds via re-SELECT.
3. **`onDelete: 'set null'` on `resolved_user_id`.** PASS. Schema declares it; `patient_invites_resolved_user_id_fk.rls.test.ts` exercises a real DELETE on `users` and asserts the row survives with NULL. CLAUDE.md has side-by-side exception block alongside Story 6.3. The other new FK (`professionalUserId` → `Professionals.userId`) correctly uses `cascade` (professional-side ownership).
4. **`patient_invite.sent` + `.resolved` NOT in `ACCESS_LOG_EVENT_KINDS`.** PASS. Audit emissions use the correct constants; allowlist in `packages/validators/src/sharing.ts:308-328` is unchanged.
5. **`initializeProfile` resolved-flip atomicity.** PARTIAL — see finding #3 above. The tx IS the protectedProcedure-opened transaction (`packages/api/src/trpc.ts:83`); HMAC re-check via `constantTimeEqualHmac` IS performed before the UPDATE. The atomicity question is the catch breadth.
6. **`auth.users` existence probe.** PASS on safety: parameterized via `sql\`\``interpolation (no concat / injection vector); routes through service-role bare`db`; narrow catch (TypeError/ReferenceError/SyntaxError rethrow; everything else → degrade-to-not-registered) so probe failures do not leak shape to the doctor. Pattern smell (#2) flagged separately. Timing-window between match / no-match is the inherent enumeration-oracle risk that the spec explicitly accepts (Q1).
7. **`revokePatientInvite` deliberately out of scope.** PASS. `revoked_at` column exists; no mutation writes it (grep confirms). RLS UPDATE policy permits the future revoke surface without code today exercising it — no dead-producer pattern.
8. **HMAC re-check in resolver.** PASS. `createPatientInvite` runs inside `doctorProcedure`; `getPatientInviteContext` (publicProcedure) re-checks via `constantTimeEqualHmac`. `resolvePatientInviteWithinTx` also re-checks before the UPDATE.
9. **Tier-1 banner ↔ button swap.** PASS for the activated→button direction (`view/page.tsx:239-260` ternary on `activationStatus.activated`). The un-activation direction is N/A (no deactivation flow exists; spec Q6 deferred).
10. **`/convite/[inviteSegment]` landing page.** PASS. Malformed segment renders `InvalidLandingShell` without a DB hit; the `valid:false` branch (expired/revoked/bad-hmac/unknown) renders the same generic shell — no enumeration oracle; the `patient_invite.resolved` audit fires only inside `initializeProfile` after a successful UPDATE, never on page-load.
11. **No new env vars.** PASS. `SHARE_TOKEN_HMAC_SECRET` and `WEB_APP_URL` reused via existing `validateSharingEnv()` boot-gate; `.env.example` not touched in the diff.
12. **Inline `<RegisterForm>` reuse.** PASS. `inviteId`/`tokenHmac` props are individually optional; `RegisterForm({})` falls back to the legacy path. The default-export signature `RegisterForm(props: RegisterFormProps = {})` keeps the non-invite call sites unchanged.

## Other findings

- **[MEDIUM] `aria-label` collision in `InvitePatientButton`.** Both the wrapping `<section>` and the inner `<button>` use `INVITE_PATIENT_BUTTON_PT_BR` (= "Convidar paciente"); screen-reader users hear the same string twice. Either drop the section-level `aria-label` or differentiate (e.g. `aria-labelledby` on the section pointing to a dedicated heading).
- **[MEDIUM] `RegisterForm` partial-prop pair silently falls through.** When exactly one of `{inviteId, tokenHmac}` is passed, the code routes through the unattributed path with no warning. Acceptable defense; consider a dev-only `console.warn` since the only call site is `PatientInviteLanding` which always passes both — a partial pair would be a programmer error.
- **[LOW] `UUID_SHAPE_REGEX` duplicated.** Same regex in `packages/validators/src/professional.ts:328` and `apps/web/src/app/m/[token]/view/page.tsx:44`. Export once from validators and import.
- **[LOW] `PATIENT_INVITE_HMAC_DOMAIN_PREFIX` is module-private.** The constant lives behind module scope in `packages/api/src/sharing.ts:362`. Consider exporting it as a `const` so a future R1 reviewer can assert against the literal in a test rather than against the indirect inequality.
- **[LOW] `verifyPatientInviteToken` is defined but never imported by the resolver path** — the resolver only `sign`s; verification happens elsewhere via `constantTimeEqualHmac` (since both sides hold the HMAC, not the raw). The dead-import is benign but the helper exists primarily for the unit test. Either delete the unused export or document the test-only contract.
- **[NIT] "Fechar" hardcoded** in `InvitePatientModal.tsx:171 + 191` while every other pt-BR string in the modal is a named constant. Move to `INVITE_PATIENT_CLOSE_PT_BR` for parity.
- **[NIT] Spec calls for `displayName: z.string().trim().min(1).max(80).nullable().default(null)`** — shipped schema matches, but combined with the modal's "pass null when empty after trim" client-side handling, the `.min(1)` server-side branch is unreachable. Either drop the `.min(1)` (it's tautological after `trim().nullable()`) or change the modal to send the empty string and rely on Zod to coerce — pick one source of truth.
- **[NIT] Integration test file naming.** `inviteInline` helper in `create-patient-invite.integration.test.ts:39` is a near-copy of the resolver's INSERT path; long-term the right answer is to extract a shared SQL fixture in `packages/db/__tests__/integration/setup.ts` (mirrors the `activate-professional-account.integration.test.ts` precedent the dev cites).

## False positives / non-issues on re-read

- **The dev's "Deviation" note about using raw `db.execute` for the `auth.users` probe instead of `getSupabaseAdminClient()`** is defensible: `auth.admin.getUserByEmail/Phone` would add two pagination-aware SDK calls + an SDK timing footprint vs one parameterized SELECT. Documented trade-off; accept.
- **The `getPatientInviteContext` resolver using bare `ctx.db` from `publicProcedure`** is correct: `publicProcedure` does not open a tx (no GUC bound), so reads against `patient_invites` ride on the service-role postgres role and bypass the no-patient-SELECT RLS policy as designed.
- **The `dynamic="force-dynamic"` + `revalidate=0` + `noindex,nofollow`** on the `/convite/[inviteSegment]` page correctly prevents caching/indexing of the one-time invite URL. Solid.
- **Initial concern that `patient_invites_select_own` USING uses `app.current_doctor_user_id` GUC vs the spec AC9 sketch using `auth.uid()`** is not a real deviation — Story 6.3's RLS pattern (which Story 6.4 inherits) intentionally uses the GUC for testability against the bare testcontainer; documented in CLAUDE.md.
