# Story 6.3 — Round 1 Code Review

Reviewer: Murat (bmad-code-review, R1)
Commit under review: `38f09bf`
PR: #57 (stacked on Stories 6.1 + 6.2)
Date: 2026-05-29
Diff scope: ~2300 LOC across 21 files (validators, schema, RLS policy, resolvers, doctorProcedure extension, web banner+modal, tests, docs)

---

## Verdict

**Request changes** — one **HIGH** correctness bug (post-activation banner stays visible until next navigation) plus a couple of **MEDIUM** findings around the broken RLS escalation contract on UPDATE and FK FOR-UPDATE acquisition. No blockers. The 6-identity matrix, FK-set-null regression, audit-amplification disciplines all landed correctly; spec adherence is high.

## Severity counts

- blocker: 0
- high: 1
- medium: 3
- low: 4
- nit: 3

---

## HIGH

### H1 — Banner does not disappear after successful activation (UX correctness)

**Files:**

- `apps/web/src/app/m/[token]/view/page.tsx:127-133, 228-235`
- `apps/web/src/app/m/[token]/view/ProfessionalAccountModal.tsx:103-112`

`getActivationStatus` is called from the **RSC** via `doctorCaller.sharing.getActivationStatus({})` in `Promise.all`, NOT from a client `useQuery`. The modal's `queryClient.invalidateQueries({ queryKey: trpc.sharing.getActivationStatus.queryKey() })` therefore invalidates a **TanStack Query cache key that nothing on this page is reading** — there is no client subscriber to refresh. After the success card auto-dismisses (3s) and the modal closes, `BannerBody` falls back to `open=false, dismissed=false` and **the banner re-renders** (the parent prop `activationStatus.activated` is still `false` — it's the RSC-frozen value from page load).

The doctor sees: "Conta ativada" toast → banner reappears 3s later. From the doctor's perspective, the activation looks like it failed silently. They have to manually dismiss the banner or hard-refresh to see the activated state persist.

T5.3 in the spec explicitly named this gap (`queryClient.invalidateQueries(...) so the banner's parent state re-renders without the banner (re-mount-free reactivity). The RSC won't auto-revalidate; the client handles it`) — but the implementation invalidates the wrong layer.

**Fix options (pick one):**

1. After success, also call `router.refresh()` from `next/navigation` — forces RSC re-execution; the next `getActivationStatus` call will return `activated:true`.
2. Set `dismissed=true` (or a new `activatedThisSession` flag) inside `onSuccess` so the banner stays hidden for the rest of the session even with stale RSC state.
3. Lift `activationStatus.activated` to a client query in the banner so invalidation actually does something.

(2) is the lowest-risk patch — it matches the spec's "session-only" dismiss model and removes the RSC-staleness dependency entirely.

---

## MEDIUM

### M1 — UPDATE on `pending_invites` happens AFTER the FOR UPDATE lock was released

**File:** `packages/api/src/router/sharing.ts:1667-1708`

The escalation pattern looks correct at first glance — `SET LOCAL ROLE postgres` → SELECT FOR UPDATE → `SET LOCAL ROLE NONE` in `finally`. But then the NULL branch re-escalates and runs the UPDATE in a SEPARATE escalation block. Between the first `finally { SET LOCAL ROLE NONE }` (line 1689) and the re-escalation at line 1698, the row lock acquired by FOR UPDATE is **still held** (locks persist for the tx, not the role) — so this is functionally correct on the race side. However:

- The UPDATE has `WHERE id = $invite AND resolved_user_id IS NULL` — a belt-and-braces predicate that does NOT close the window for the case `resolved_user_id` was already set by some other tx between the FOR UPDATE+SELECT and the UPDATE. Under serializable isolation that's impossible (the FOR UPDATE holds), but the explicit IS NULL guard is correct defensive code.
- More importantly: between the SELECT FOR UPDATE and the re-escalated UPDATE, the resolver runs (`SET LOCAL ROLE NONE` and then conditional branch evaluation in JS) under the un-escalated role. None of that JS touches the DB, so this is technically fine — but it makes the contract more brittle than the spec implies. A future patch that adds, say, an audit-log read between the SELECT and the UPDATE will silently break RLS or DB access.

**Recommendation:** keep one escalation block that wraps SELECT FOR UPDATE + UPDATE together; the JS branch decision (NULL vs same-uid vs different-uid) can run BEFORE the SET LOCAL ROLE NONE. The post-UPDATE escalation is what should bookend; the SELECT-only escalation should not bookend separately. Today's structure works but the next reviewer will be confused.

### M2 — `SET LOCAL ROLE NONE` semantics differ from `RESET ROLE` and may not be what the dev thought

**File:** `packages/api/src/router/sharing.ts:1689, 1707`

Postgres has both `RESET ROLE` (reverts to session-authorization role) and `SET ROLE NONE` (also resets). `SET LOCAL ROLE NONE` IS a documented form (https://www.postgresql.org/docs/16/sql-set-role.html — "NONE and RESET are equivalent"). So this is semantically correct. The R1 reviewer concern is documentation-only: the code's comment ("De-escalate before ANY subsequent statement runs") implies SET LOCAL is needed to UN-escalate; in reality, `SET LOCAL ROLE x` is auto-reverted at tx commit/rollback regardless. The bookend is real defense (against accidental later reads under elevated role) but the comment overstates the security necessity. Consider clarifying that the explicit reset is a code-hygiene guardrail, not a security requirement (the tx boundary is the real boundary). Not a bug — but the spec implies this contract should be crisp.

### M3 — Banner uses inline `style` (raw hex colors), bypassing Tamagui tokens

**File:** `apps/web/src/app/m/[token]/view/ProfessionalAccountBanner.tsx:64-115`, `ProfessionalAccountModal.tsx` (most JSX)

Spec T5.4 was explicit: `<ProfessionalAccountBanner>` styling MUST use Tamagui `$backgroundHover` / `$borderColor` (per UX-DR16). The implementation hardcodes `#f3f4f6`, `#e5e7eb`, `#4b5563`, `#6b7280`, `#9ca3af`, `#b45309`, etc. This is a deviation from UX-DR16 (token discipline) and from T5.4 explicitly. The colors look fine but they break light/dark-mode + future theme rebranding without a follow-up sweep.

Mark as medium because R2 fixing this is one pass over both files; the longer it sits, the more drift accumulates with the rest of the Tamagui-tokenized surfaces.

---

## LOW

### L1 — `ShareTokenProvider` mount order race between Banner and existing `<MarkStarterViewed>` / `<ConversationStarterPolling>`

**Files:** `apps/web/src/app/m/[token]/view/page.tsx:163, 229`; `ProfessionalAccountBanner.tsx:127`

Three subtrees in the same page each mount their own `<ShareTokenProvider>` (the holder is module-scope; effects write `props.shareTokenId` on mount and `null` on unmount). All three pass the SAME `shareTokenId`, so they don't race destructively today. BUT: any future commit that mounts two providers with different ids in the same tree silently last-write-wins. Reviewer concern is the **pattern**, not this story's correctness — file follow-up to lift `<ShareTokenProvider>` to a single ancestor at the route layout. Spec T5.6 actually called this out as M3-deferred work.

### L2 — No `useId` on the modal's `prof-email` / `prof-display-name` / `prof-category`

**File:** `apps/web/src/app/m/[token]/view/ProfessionalAccountModal.tsx`

Hardcoded `id` strings will collide if the modal mounts twice (it won't today, but it's a footgun). `React.useId()` is the established pattern.

### L3 — `Promise.all` widens NOT_FOUND surface; `getActivationStatus` cannot 404 but is included in the catch

**File:** `apps/web/src/app/m/[token]/view/page.tsx:127-143`

The catch swallows `NOT_FOUND` from either resolver into a `/m/[token]` redirect. `getActivationStatus` is read-only against the `professionals` table and never throws `NOT_FOUND` (it returns `activated:false`). Today this is fine. But a future change that makes `getActivationStatus` throw on, say, a missing `professionals_select_own` policy will silently redirect to the dead-link page. Add a comment noting that NOT_FOUND in this Promise.all is `getConversationStarter`-only, OR move the activation fetch out of the Promise.all.

### L4 — Modal's success state does not invalidate (or even use) the activation status that drives the banner

See H1; this is the same root cause but lower-severity if H1 is fixed. Once H1 lands, this becomes redundant code and the `invalidateQueries` call can be removed entirely (currently a no-op).

---

## NITS

### N1 — Test file's `seedProfessional` rebuilds `category` union inline

`packages/db/__tests__/rls/professionals.rls.test.ts:28-35` — duplicates the `professionalCategoryEnum` literal union. Import `ProfessionalCategory` from `@healthtracker/validators` instead.

### N2 — `BannerBody` uses `<section aria-label>` for both states

`ProfessionalAccountBanner.tsx:46, 62` — the same aria-label on the modal-host `<section>` and the banner `<section>` will read as "Ative sua conta profissional" in both states. Use distinct labels (modal: `aria-modal` is already set on the dialog inside; the wrapping section's aria-label is redundant noise).

### N3 — Audit metadata stringifies `category` redundantly

`sharing.ts:1789-1793` writes `category: input.category` into audit metadata, but the audit row already carries `resourceType: "professional"` and the resource id is the doctor's own uid. The category is on the `professionals` table — duplicating it in audit is fine but if it ever drifts via display-name edit (future story) the audit will pin the activation-time category. That's actually the desired forensic property; document the intent.

---

## Per-check pass/fail (items 1-11 from the R1 task)

1. **`SET LOCAL ROLE postgres` escalation pattern.** PASS with notes (M1, M2). Escalation IS inside tx, `finally` bookend is correct, ON the SELECT FOR UPDATE only — but the UPDATE in the NULL-branch is escalated separately (not minimal, not braided). Both blocks are scoped; no return/throw can bypass `finally`. Minimal-section criterion: borderline. Functionally safe; structurally noisy.
2. **`pending_invites.resolved_user_id` FK = `onDelete: 'set null'`.** PASS. `sharing.ts:96-98` declares it exactly. CLAUDE.md "Account deletion discipline" carries the exception block (line 255 of CLAUDE.md). Regression test (`pending_invites_resolved_user_id_fk.rls.test.ts`) exercises the delete-user-then-assert-NULL flow. No other FK in this diff violates the cascade rule (`Professionals.userId` uses cascade per `schema/professionals.ts:46`).
3. **`activateProfessionalAccount` race semantics.** PASS. `professionals.userId` is PK; `ON CONFLICT (user_id) DO NOTHING` + post-conflict SELECT handles same-uid re-tap; different-uid throws `TRPCError({code:"CONFLICT", message: INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR})`. HMAC re-check runs BEFORE the tx (sharing.ts:1652-1654) — so before escalation. Good.
4. **`professional_account.activated` audit event.** PASS. NOT in `ACCESS_LOG_EVENT_KINDS` (verified — `validators/src/professional.ts:91` declares the constant; no import from sharing's allowlist). Lives in `professional.ts` not `sharing.ts`. Audit row has `actorId = doctorUserId = ctx.session.user.id`. `metadata` carries `shareTokenId`/`inviteId`/`category` for forensics.
5. **`doctorProcedure` GUC extension.** PASS. `trpc.ts:164-166` sets `app.current_doctor_user_id` via `set_config(..., true)` (SET LOCAL semantics). Name follows convention. RLS policy `professionals_select_own` uses `current_setting('app.current_doctor_user_id', true)` — `true` returns NULL on missing, NOT an error. Unbound case: `user_id::text = NULL` is NULL (3-valued logic), so the policy returns no rows — correct default-deny.
6. **No CRM/license validation.** PASS. Modal has email (read-only), display-name, category Select — no CRM field. Frictionless per UX-DR9.
7. **NFR-S6 boot gate.** PASS. No new env var introduced. `.env.example` unmodified (verified per dev's completion notes; spec T9.3).
8. **`pending_invites` RLS implications.** PASS with risk: the dev DID NOT add a new doctor-side SELECT policy on `pending_invites`. The resolver bypasses RLS via SET LOCAL ROLE postgres — correctly minimal. Existing patient-side policies unchanged. No regression for legitimate access. Adding the FK does not change the column-level visibility (RLS predicates are row-level). OK.
9. **T8 deviation — web component tests → validator unit tests.** PARTIAL. The validator-boundary suite (`activate-professional-account-validators.test.ts`) covers schema correctness comprehensively (trim/min/max, enum closure, malformed token id, empty hmac, label/enum parity, output shape). It does NOT cover: banner-shows-when-not-activated render path, banner-hides-when-activated path, dismiss-button interaction, modal-success render swap, field-error rendering, focus management, CONFLICT-error pt-BR copy substitution, post-success `invalidateQueries` invocation (which is itself the H1 bug). My recommendation for R2: stand up `apps/web` Vitest+@testing-library/react in a follow-up story (one-time cost), and add **at minimum** an integration test that asserts the banner disappears after successful activation (would have caught H1). For 6.3 ship the substitute; for 6.4 the cost calculus tips.
10. **CLAUDE.md anchor placement.** PASS. Placed below "Pre-auth landing discipline (Story 6.1)" — there is no Story 6.2 section (Story 6.2 modified the doctorProcedure inline, not as a dedicated paragraph). Judgment call is reasonable; ordering is by story number anyway.
11. **No new patterns invented.** PASS. Resolver mirrors Story 6.2's `getConversationStarter` (RLS-bound SELECT → constant-time HMAC re-check → conditional audit). Insert idempotency mirrors Story 5.5's `requestExport` (`onConflictDoNothing` + post-conflict SELECT). Audit gating mirrors Story 6.2 R1-H1 (one row per activation).

---

## Hunt-list checks (CLAUDE.md "Code review discipline")

- **Narrow catches.** PASS. The resolver has no broad `catch (err)`. The only catches in the diff are in `sharing.ts:1239-1248`/`1393-1406`/`1440-1450`/`1520-1535` — all pre-existing Story 6.1/6.2 code; the Story 6.3 resolver uses no try/catch at all (the `try { ... } finally { ROLE NONE }` blocks have no catch clause). Programmer errors propagate naturally.
- **TOCTOU on SELECT-EXISTS-then-INSERT.** PASS. `professionals` INSERT uses `ON CONFLICT (user_id) DO NOTHING` — no exists-then-insert. `pending_invites` UPDATE is locked by SELECT FOR UPDATE before branching.
- **Partial-index ON-CONFLICT WHERE-clause mismatches.** N/A — `professionals_user_id_pkey` is a total unique constraint; no partial predicate.
- **Broad catches that swallow programmer errors.** PASS — see above.
- **6-identity RLS matrix.** PASS. `professionals.rls.test.ts` has 7 `it(...)` blocks covering: correctPatient, wrongPatient, serviceRole, doctorWithActiveToken(own), doctorWithActiveToken(other), doctorWithExpiredToken, doctorWithRevokedToken, plus a +1 `INSERT WITH CHECK 42501` adversarial. All identities in the docstring have a matching `it(...)`. No claim/ship gap.
- **No `@ts-ignore` / `@ts-expect-error` / `.skip` / `.todo()` in shipped code.** PASS. Verified via grep across all 21 changed files.

---

## False-positive observations

- **Spec called out a `shareTokenHolder` race deferred from 6.2 (T5.6).** On re-read, Story 6.2's `200d754` did land `<ShareTokenProvider>` + the module-scope holder. Story 6.3's banner correctly mounts its own provider with the same id as the sibling polling component. No race in practice — same id wins or loses, both writes are identical.
- **Spec open-question #3 worried about `SET LOCAL ROLE postgres` poisoning the tx if NONE-reset is dropped.** On re-read the dev wrote `try/finally` AND scoped each escalation to a single SQL statement. The reviewer-suggested `pending_invites_select_doctor` policy is correctly rejected; the escalation is minimal.
- **Spec called out display-name prefill quality (open question #6).** On re-read the validator does `.trim().min(1).max(80)` and the modal pre-fills the email local-part. The "dr.rodrigo lands in audit" scenario is the doctor's choice; no regression here. Not a finding.

---

## Top 3 findings (severity-ordered)

1. **H1** — Activation banner stays visible after successful activation (RSC-vs-client-cache mismatch: `invalidateQueries` invalidates a key nothing reads).
2. **M1** — UPDATE escalation block is separate from the SELECT-FOR-UPDATE escalation block; the explicit `WHERE resolved_user_id IS NULL` predicate saves correctness but the structure invites future regressions.
3. **M3** — Banner + modal hardcode hex colors (`#f3f4f6`, `#e5e7eb`, etc.) instead of Tamagui tokens (`$backgroundHover` / `$borderColor`), violating UX-DR16 token discipline named in T5.4.

End of R1.
