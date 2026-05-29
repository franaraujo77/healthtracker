# Story 5.4: Patient revokes a doctor's access to their record

Status: review

> **Stacked on Stories 5.1 + 5.2 + 5.3 / PR #56.** Wires the revoke mutation, the 5-second deferred-server-write undo window, the `RevokeConfirmDialog` confirmation sheet, and the `AccessLogItem` "Revogar acesso" action. The doctor-side 403 path is **explicitly Epic 6's** territory — Story 5.1 already shipped the `verifyShareToken` helper that Epic 6 will call.
>
> **Out of scope (per user direction):** Production migration still deferred to the last story of Epic 5. No new DB columns — `share_tokens.revoked_at` already exists (Story 5.1). Doctor-side `share_token.rejected` audit is Epic 6 (the path that emits it doesn't exist yet).
>
> **ADR resolutions locked in this story (user-confirmed):**
>
> 1. **Deferred-server-write undo.** Tapping "Revogar acesso" + confirming sets a pending UI state and starts a 5s timer. If undo isn't tapped, the timer fires `sharingRouter.revokeShareToken`. If undo is tapped, the timer is cancelled and **no server write happens**. The DB never sees the failed revoke; no audit noise; no unrevoke mutation needed.
> 2. **Doctor-side 403 deferred to Epic 6.** Story 5.4 emits `share_token.revoked` (patient-actor) audit on successful revoke; the future `share_token.rejected` audit (with reason='revoked') is written by Epic 6's `verifyShareToken` consumer when a doctor presents a revoked token. Story 5.1's `verifyShareToken` helper at `packages/api/src/sharing.ts` already filters `revoked_at IS NULL` — Epic 6 just needs to surface the right error class.
> 3. **`revoked-pending` UI state owned client-side only.** The 5s pending window is a `useState` slot on the parent screen (Acessos tab). The `AccessLogItem` receives `tokenStatus="revoked-pending"` as a transient prop from a parent-owned `revokingTokenIds: Set<string>` map. Once the timer fires and the mutation resolves, the next refetch returns `tokenStatus="revogado"` from the resolver. Story 5.3's status-derivation (`packages/api/src/sharing.ts:computeAccessLogTokenStatus`) gets a new `"pending"` enum member.

## Story

**As a** patient,
**I want** to revoke a specific doctor's access at any time,
**so that** I can immediately end access I no longer want to grant, regardless of the original expiry.

## Acceptance Criteria

1. **AC1 — Revoke button on `AccessLogItem` for `ativo` / `sem prazo` status.** Given an `AccessLogItem` in the expanded variant whose `tokenStatus IN ('ativo','sem prazo')` AND `event === 'share_token.created'` (the row that owns the revoke action — Story 5.3 surfaces share_token.created as the canonical "this is a share" row), when the patient taps "Revogar acesso", then `RevokeConfirmDialog` (NEW Tamagui dialog component in `packages/ui`) opens. The button is **Tier 2** (`Button variant="secondary"`) per UX-DR13 — sharing actions are never Tier 1. a11y label: `"Revogar acesso de {displayName} ao seu histórico de saúde"` via `REVOKE_BUTTON_A11Y_PT_BR_FN` (T5.1).

2. **AC2 — `RevokeConfirmDialog` content + Tier-2 confirm.** The dialog body copy is verbatim: `"Tem certeza? {displayName} perderá acesso aos seus dados imediatamente."` (constant `REVOKE_CONFIRM_BODY_PT_BR_FN(displayName)` — T5.1). Two buttons: "Revogar" (Tier 2, secondary — destructive treatment via `$accessLogRevoked` muted neutral, **NOT** red; UX line 1079) and "Cancelar" (Tier 3, text). Pressing outside the dialog = cancel. The dialog mirrors `NoExpiryConfirmDialog` (Story 5.2) in structure — both are confirmation sheets.

3. **AC3 — Deferred-server-write undo (5s).** Given the patient taps "Revogar" in the confirm dialog, when the dialog closes, then:
   - The screen adds the `shareTokenId` to `revokingTokenIds: Set<string>` (parent-owned state on the Acessos screen).
   - The corresponding `AccessLogItem` re-renders with `tokenStatus="revoked-pending"` (badge copy `"Revogando…"` via `ACCESS_LOG_TOKEN_STATUS_PT_BR_FN` extended — T5.1). The item is dimmed but still visible.
   - A bottom-anchored `UndoToast` (NEW `packages/ui` component) appears for 5000 ms with body copy `"Acesso revogado. Desfazer?"` (constant `REVOKE_UNDO_TOAST_PT_BR` — T5.1) and a "Desfazer" button (Tier 2). The toast carries a circular countdown indicator (visual progress 5→0 seconds; pure CSS animation — no JS interval per-render).
   - If the patient does NOT tap "Desfazer" within 5s, the timer fires `sharingRouter.revokeShareToken.useMutation({...})({shareTokenId})`. The screen invalidates `trpc.sharing.listAccessLog.queryKey()` on success; the next refetch returns `tokenStatus="revogado"` and the item re-renders with the final state.
   - If the patient taps "Desfazer" within 5s, `clearTimeout` fires, `revokingTokenIds` removes the id, the item re-renders with its original `tokenStatus`, and **no server mutation happens**. No audit row, no DB write. A second Toast `"Revogação cancelada."` (constant `REVOKE_UNDONE_TOAST_PT_BR`) confirms.
   - Multi-revoke: if the patient revokes share A then revokes share B before A's 5s window closes, the toast updates to reflect B (most recent revoke wins the toast surface), but both timers run independently in `revokingTokenIds`. Both eventually fire (or both can be undone — though only the most-recent toast is dismissable).

4. **AC4 — `sharingRouter.revokeShareToken` mutation.** New `protectedProcedure.mutation`:
   - Input: `z.object({ shareTokenId: z.string().uuid() })`.
   - Output: `z.object({ shareTokenId: z.string().uuid(), revokedAt: z.string().datetime() })`.
   - Inside `ctx.db.transaction(async (tx) => ...)`:
     - SELECT FOR UPDATE the `share_tokens` row WHERE `id = $1 AND patient_id = current_setting('app.current_patient_id')::uuid AND revoked_at IS NULL`. (Patient_id check is defense-in-depth; RLS already scopes; but the `revoked_at IS NULL` guard short-circuits re-revocation.)
     - If 0 rows: throw `NOT_FOUND` (404 — never 403; mirrors Story 5.1 cross-patient discipline).
     - If 1 row: UPDATE `share_tokens SET revoked_at = now() WHERE id = $1` (the FOR UPDATE row-lock prevents double-revoke under concurrent calls).
     - `writeAuditLog(tx, { actorId: patientId, actorType: 'patient', event: 'share_token.revoked', resourceId: shareTokenId, resourceType: 'share_token', metadata: { revokedAt: now-iso } })`. Audit constant: add `SHARING_AUDIT_TOKEN_REVOKED = "share_token.revoked"` to `packages/validators/src/sharing.ts` (T5.1).
     - Return `{ shareTokenId, revokedAt }`.
   - Narrow catches per Story 5.1 R1 discipline — only catch `isUniqueViolation` (extremely unlikely here; defensive). Programmer errors (`TypeError`, etc.) rethrow.

5. **AC5 — Subsequent doctor requests rejected with 403 (Epic 6 deferred).** Per ADR resolution #2: out of scope for 5.4. The `share_tokens` RLS policy from Story 5.1 already excludes revoked tokens for the doctor principal (`share_tokens_select_own_doctor` requires `revoked_at IS NULL`); Story 5.4's revoke makes the row invisible to the doctor automatically. The future `verifyShareToken` consumer (Epic 6) will surface the right HTTP 403 + emit `share_token.rejected` audit. Story 5.4 emits ONLY `share_token.revoked` (patient-actor). Document this in the spec dev notes so reviewers don't flag the missing rejection-side audit.

6. **AC6 — `AccessLogItem` revoked + revoked-pending rendering.** Story 5.3's `AccessLogItem` already handles 4 `tokenStatus` values (`ativo`/`expirado`/`revogado`/`sem prazo` + null). Story 5.4 adds a 5th: `"revoked-pending"`. Badge copy `"Revogando…"`. Token color: `$accessLogNeutral` (the muted warm-neutral — same as `revogado`; the dim treatment + "Revogando…" copy + countdown indicator on the toast disambiguate). Adds two derived states inside the item:
   - When `tokenStatus="revoked-pending"`: the "Revogar acesso" button is **hidden** (no double-tap), the item is dimmed via `opacity: 0.6`, and a small inline `"(Desfazer no toast)"` hint renders next to the badge.
   - When `tokenStatus="revogado"`: the "Revogar acesso" button is absent; the badge shows `"Revogado"`; the absolute timestamp of revocation comes from a new optional row field `revokedAtDisplay` populated by the resolver from `share_tokens.revoked_at`.
   - Extend `Story 5.3 AC11` event-label helper to also surface the revocation timestamp for `share_token.revoked` rows: `"Você revogou o acesso de {displayName} ({formatRelativeTimePtBr(revokedAt)})"` — but the row's primary timestamp is already the `audit_log.created_at` of the revoke event, which IS the revocation time. So a separate `revokedAtDisplay` field is redundant; just use the existing timestamp. Confirm in T3 — DO NOT add the redundant column.

7. **AC7 — `UndoToast` component (NEW).** `packages/ui/src/components/UndoToast/UndoToast.tsx`. Tamagui Toast or bottom-anchored `Animated.View`:
   - Props: `{ visible: boolean, message: string, undoLabel: string, onUndo: () => void, onTimeout: () => void, durationMs: number = 5000 }`.
   - Renders message + "Desfazer" button + circular countdown ring (5→0 seconds; CSS-driven `@keyframes` not RAF — survives backgrounding gracefully).
   - On mount or `visible: true → false` flip: starts/clears internal timer. On timer fire: invokes `onTimeout`. On undo press: invokes `onUndo` (parent clears `visible`).
   - Auto-dismisses after `durationMs` (calls `onTimeout`). Tappable backdrop does NOT dismiss (user must explicitly undo or wait).
   - a11y: `accessibilityRole="alert"`, focus management via Tamagui Sheet conventions if Sheet-based.

8. **AC8 — Concurrent-revoke ordering.** If the patient taps revoke on Share A, then immediately on Share B (both within 5s), the most-recent toast (Share B) replaces A's toast on screen — but A's timer continues. When A's 5s window closes, A's mutation fires silently (no toast surface — the user already moved on). The `revokingTokenIds` set tracks both. When the user navigates away from the Acessos tab mid-window, the parent component's cleanup function should fire any pending timers immediately (not cancel them — the user already confirmed; we just lose the undo opportunity). Document this in dev notes; encode via a `useEffect` cleanup that calls `Object.values(timers).forEach(t => clearTimeout(t)); pendingMutationsRef.current.forEach((id) => mutation.mutate({shareTokenId: id}))`.

9. **AC9 — RLS policy unchanged.** Story 5.1's `share_tokens_select_own_patient` returns all rows (active + revoked + expired). The patient continues to see their revoked shares in `listAccessLog`. No RLS update needed in 5.4.

10. **AC10 — Test the deferred-write semantics.** Critical: under fake timers, assert that the mutation fires at exactly 5000 ms, not earlier; assert that undo-within-window cancels the mutation; assert that undo-after-window is rejected (the button should not be tappable post-timer-fire). Integration test for `revokeShareToken` covers: happy path; cross-patient 404; re-revoke (already-revoked row) 404; concurrent revokes serialized by FOR UPDATE.

11. **AC11 — Audit allowlist already includes `share_token.revoked`.** Story 5.3's `ACCESS_LOG_EVENT_KINDS` allowlist already includes `share_token.revoked` (forward-compat from Story 5.3 ADR). The new audit constant `SHARING_AUDIT_TOKEN_REVOKED` becomes the constant-name source-of-truth for that string. Verify `listAccessLog` already picks up `share_token.revoked` rows; if so, no resolver change. The `AccessLogItem` already renders the event label `"Você revogou o acesso de {displayName}."` (Story 5.3 T2.1 — already in `ACCESS_LOG_EVENT_LABEL_PT_BR_FN`).

12. **AC12 — Revoke from elsewhere (Compartilhar tab).** Out of scope: Story 5.x or a later polish pass adds revoke entry-points from the Compartilhar tab landing (the share list). Story 5.4 ships revoke entry from the Acessos tab only. Document for the deferred work file.

## Tasks / Subtasks

> **Plan:** 1) Router + audit + tests → 2) Validators + copy → 3) UndoToast + RevokeConfirmDialog components → 4) Wire AccessLogItem + Acessos screens (Expo + web) → 5) Tests.

- [ ] **T1. `revokeShareToken` mutation + audit (AC4, AC10, AC11).** (AC: 4, 10, 11)
  - [ ] T1.1 `packages/api/src/router/sharing.ts` — add `revokeShareToken` `protectedProcedure.mutation` per AC4 spec. Use `ctx.db.transaction(async (tx) => ...)`. Inside: SELECT FOR UPDATE; if 0 rows → throw `NOT_FOUND`; UPDATE `revoked_at = now()`; `writeAuditLog(tx, ...)` with the new constant. Narrow `catch (err)` on `isUniqueViolation` only.
  - [ ] T1.2 `packages/validators/src/sharing.ts` — add `SHARING_AUDIT_TOKEN_REVOKED = "share_token.revoked"`. Add `revokeShareTokenInputSchema` + `revokeShareTokenOutputSchema`. Re-export from `index.ts`.
  - [ ] T1.3 Unit test at `packages/api/__tests__/sharing/revoke-share-token.test.ts` — synchronous Zod schema tests + a stub-resolver test asserting the narrow catch on 23505.
  - [ ] T1.4 Integration test at `packages/api/__tests__/sharing/revoke-share-token.integration.test.ts` — `it.todo()` placeholders for happy/cross-patient/re-revoke/concurrent. Real testcontainer assertions when Docker available; `it.todo` otherwise.
  - [ ] T1.5 Verify `ACCESS_LOG_EVENT_KINDS` in Story 5.3 already contains `"share_token.revoked"` (it should — forward-compat). If missing, add.

- [ ] **T2. UndoToast component (AC3, AC7, AC10).** (AC: 3, 7, 10)
  - [ ] T2.1 `packages/ui/src/components/UndoToast/UndoToast.tsx` (NEW). Tamagui implementation; backdrop NOT-dismissable; CSS keyframe for the 5→0 countdown ring; cleanup function on `visible: false` cancels the internal timer.
  - [ ] T2.2 `packages/ui/src/components/UndoToast/index.ts` (NEW) — barrel.
  - [ ] T2.3 Re-export from `packages/ui/src/index.ts`.
  - [ ] T2.4 Snapshot scaffold at `packages/ui/src/components/UndoToast/UndoToast.test.tsx` (same `@ts-nocheck` pattern as Story 5.3 component scaffolds).

- [ ] **T3. RevokeConfirmDialog component (AC1, AC2).** (AC: 1, 2)
  - [ ] T3.1 `packages/ui/src/components/RevokeConfirmDialog/RevokeConfirmDialog.tsx` (NEW). Mirror `NoExpiryConfirmDialog` (Story 5.2). Body uses `REVOKE_CONFIRM_BODY_PT_BR_FN(displayName)`. Confirm button Tier-2 with the muted `$accessLogRevoked` treatment (NOT red). Cancel Tier-3 ghost.
  - [ ] T3.2 Barrel + UI index re-export.

- [ ] **T4. AccessLogItem revoke wiring + screens (AC1, AC3, AC6, AC8).** (AC: 1, 3, 6, 8)
  - [ ] T4.1 `packages/ui/src/components/AccessLogItem/AccessLogItem.tsx` — add `"revoked-pending"` to the local `tokenStatus` switch (badge copy + treatment). Hide the "Revogar acesso" button when `tokenStatus !== 'ativo' && tokenStatus !== 'sem prazo'`. When state is `revoked-pending`, dim the item (`opacity: 0.6`) and append the inline `"(Desfazer no toast)"` hint via a new `ACCESS_LOG_REVOKING_HINT_PT_BR` constant (T5.1).
  - [ ] T4.2 Add `onRevokePress?: (shareTokenId: string, displayName: string) => void` prop. When `tokenStatus IN ('ativo','sem prazo')` AND `event === 'share_token.created'` AND `shareTokenId !== null`: render the Tier-2 "Revogar acesso" button. The screen owns the dialog + toast (T4.3) — the item just hoists the press event.
  - [ ] T4.3 `apps/expo/src/app/(tabs)/acessos/index.tsx` — add screen-level state:
    - `revokingTokenIds: Set<string>` (Set state).
    - `timers: Record<string, ReturnType<typeof setTimeout>>` (ref).
    - `pendingRevokeDialog: { shareTokenId, displayName } | null`.
    - `activeToast: { shareTokenId, displayName } | null`.
    - Handler `handleRevokePress(shareTokenId, displayName)` → opens dialog.
    - Handler `handleConfirmRevoke()` → closes dialog, adds id to set, starts 5s timer, shows toast.
    - Handler `handleUndo()` → clears the latest toast's timer, removes id from set, shows "Revogação cancelada." toast.
    - Handler `handleTimerExpire(shareTokenId)` → fires `revokeMutation.mutate({shareTokenId})`, on success invalidates `trpc.sharing.listAccessLog.queryKey()`, removes id from set.
    - Cleanup `useEffect(() => () => { fire-all-pending-timers; }, [])`.
  - [ ] T4.4 Same wiring in `apps/web/src/app/acessos/page.tsx`. Hook is identical in shape; cross-platform.
  - [ ] T4.5 Pass `revokingTokenIds` down to `AccessLogList` → `AccessLogItem` via a derived `tokenStatus` override: in the screen's `accumulated` mapper, if `row.shareTokenId && revokingTokenIds.has(row.shareTokenId)`, replace `row.tokenStatus = "revoked-pending"`.

- [ ] **T5. Validators + copy (AC1, AC2, AC3, AC6, AC11).** (AC: 1, 2, 3, 6, 11)
  - [ ] T5.1 `packages/validators/src/sharing.ts`:
    - `SHARING_AUDIT_TOKEN_REVOKED = "share_token.revoked"`.
    - `REVOKE_BUTTON_LABEL_PT_BR = "Revogar acesso"`.
    - `REVOKE_BUTTON_A11Y_PT_BR_FN = (displayName) => \`Revogar acesso de ${displayName} ao seu histórico de saúde\``.
    - `REVOKE_CONFIRM_BODY_PT_BR_FN = (displayName) => \`Tem certeza? ${displayName} perderá acesso aos seus dados imediatamente.\``.
    - `REVOKE_CONFIRM_BUTTON_PT_BR = "Revogar"`.
    - `REVOKE_CONFIRM_CANCEL_PT_BR = "Cancelar"`.
    - `REVOKE_UNDO_TOAST_PT_BR = "Acesso revogado. Desfazer?"`.
    - `REVOKE_UNDO_BUTTON_PT_BR = "Desfazer"`.
    - `REVOKE_UNDONE_TOAST_PT_BR = "Revogação cancelada."`.
    - `REVOKE_TIMEOUT_MS = 5000`.
    - Extend `ACCESS_LOG_TOKEN_STATUS_PT_BR_FN` to handle `"revoked-pending"` → `"Revogando…"`.
    - Extend the `AccessLogTokenStatus` enum/type to include `"revoked-pending"`.
    - `ACCESS_LOG_REVOKING_HINT_PT_BR = "(Desfazer no toast)"`.

- [ ] **T6. Tests (every AC).** (AC: all)
  - [ ] T6.1 Validator unit tests — `REVOKE_CONFIRM_BODY_PT_BR_FN`, `REVOKE_BUTTON_A11Y_PT_BR_FN`, `ACCESS_LOG_TOKEN_STATUS_PT_BR_FN("revoked-pending")`.
  - [ ] T6.2 Resolver unit test — `revokeShareTokenInputSchema` accepts valid uuid, rejects others.
  - [ ] T6.3 Integration test at `packages/api/__tests__/sharing/revoke-share-token.integration.test.ts` — `it.todo()` placeholders + at least one synchronous "audit kind constant equals 'share_token.revoked'" assertion.
  - [ ] T6.4 RLS smoke test at `packages/db/__tests__/rls/share_tokens.rls.test.ts` — confirm a revoked token (revoked_at set) is invisible to `doctorWithActiveToken` (Story 5.1 already tests this — verify the test still passes after the new mutation is wired).
  - [ ] T6.5 Behavior test (where possible) at `apps/expo/src/hooks/__tests__/use-revoke-undo.test.ts` (NEW) — fake timers; assert 5s timeout fires mutation; assert undo within window cancels; assert undo button is unresponsive post-timer.
  - [ ] T6.6 Snapshot — `UndoToast` mounted with 5s remaining; `RevokeConfirmDialog` open; `AccessLogItem` in `revoked-pending` state.

- [ ] **T7. Env + docs.**
  - [ ] T7.1 No new env vars.
  - [ ] T7.2 CLAUDE.md — append a one-paragraph "Revoke discipline (Story 5.4)" note: deferred-server-write undo pattern (no DB churn on cancelled revokes), patient-actor `share_token.revoked` audit only (doctor-side `share_token.rejected` is Epic 6).

## Dev Notes

### Architecture references (authoritative)

- **Sharing token revocation:** `_bmad-output/planning-artifacts/architecture.md` lines 434-445 — `revoked_at` is the authoritative revoke signal; RLS predicate already excludes revoked tokens for doctor principal. Story 5.1 schema; Story 5.4 just writes the column.
- **`writeAuditLog` in-tx:** `packages/api/src/audit.ts` — propagate the `tx` handle.
- **404 not 403** on cross-patient: Story 5.1 R1 discipline.

### UX references (authoritative)

- **`AccessLogItem` revoked + revoked-pending states:** `_bmad-output/planning-artifacts/ux-design-specification.md` lines 916-922. Compact + expanded variants; revoke button visible only in active states.
- **Undo toast UX:** Acesso (5s) + Desfazer button. No red tokens for the revoked state — muted neutral.
- **Tier-2 confirm button:** UX-DR13. Mirrors NoExpiryConfirmDialog (Story 5.2).

### Patterns to copy (don't reinvent)

- **`SELECT FOR UPDATE` inside `ctx.db.transaction`** — Story 5.2 R1 patch. Closes TOCTOU between revocation check and audit emission.
- **Narrow catches** — `isUniqueViolation` only; rethrow rest. Story 5.1 R1 discipline.
- **404 on missing/cross-patient** — Story 5.1 / 5.2 / 5.3 precedent.
- **`writeAuditLog(tx, ...)`** — never `ctx.db` directly inside a tx (Story 5.1 R1).
- **Audit constant in validators** — `SHARING_AUDIT_TOKEN_REVOKED` joins the existing `SHARING_AUDIT_*` constants pattern.
- **`useFocusEffect` throttled refetch** — Story 5.3 R1 pattern; reuse `ACCESS_LOG_REFETCH_THROTTLE_MS`.
- **`invalidateQueries({ queryKey: trpc.sharing.listAccessLog.queryKey() })`** — Story 5.3 R1 pattern; reuse on mutation success.
- **Pending-set state on parent screen** — analogous to Story 5.1's debounced-toggle hook pattern; the state lives on the screen, not in the item.
- **CSS keyframes for visual countdown** — survives background/foreground transitions; no per-render JS interval.
- **Cleanup on unmount fires pending mutations** — Story 5.2 R1 `flushAsync` pattern; do not silently lose user-confirmed actions.

### Anti-patterns explicitly forbidden in 5.4

- Do **NOT** write to `share_tokens.revoked_at` outside `ctx.db.transaction`. The audit row + UPDATE must be atomic.
- Do **NOT** broad-catch `(err)` in the resolver. Narrow to `isUniqueViolation` only.
- Do **NOT** physical-delete the `share_tokens` row. The append-only audit trail depends on the row existing forever.
- Do **NOT** add a `share_tokens.unrevoked_at` column or any "undo" server mutation. The deferred-server-write pattern means cancelled revokes are no-ops.
- Do **NOT** emit `share_token.rejected` from this story. That's Epic 6 (doctor-side validation).
- Do **NOT** show a 403 on the patient surface. Patients always see their own revoked tokens; only the doctor principal is blocked by RLS.
- Do **NOT** inline pt-BR strings. All copy in `packages/validators/src/sharing.ts`.
- Do **NOT** use a red Tamagui token for the revoke confirm button or the revoked state. Muted neutral per UX line 1079.
- Do **NOT** dismiss the UndoToast on backdrop tap. User must explicitly undo or wait.
- Do **NOT** issue the mutation BEFORE the 5s timer expires. The whole point of the deferred-write pattern is that cancelled revokes never hit the DB.
- Do **NOT** lose pending revokes on screen unmount. Cleanup fires them immediately (they were already user-confirmed).
- Do **NOT** add a re-revoke audit row when the user re-revokes an already-revoked share. The `revoked_at IS NULL` guard in the FOR UPDATE SELECT returns 0 rows → 404; no UPDATE, no audit.

### Latest tech notes

- **Tamagui `Toast` vs custom `Animated.View`** — Tamagui ships a `@tamagui/toast` package; verify it's a workspace dep before authoring a custom component. If present, prefer it; if absent, custom is fine (mirror `NoExpiryConfirmDialog` structure).
- **`@react-navigation` focus events** — Story 5.3 already wires `useFocusEffect`. Cleanup on tab-leave fires pending timers (don't cancel).
- **TanStack Mutation `onSuccess` invalidation** — `useMutation({onSuccess: () => queryClient.invalidateQueries(...)})`. Standard pattern.

### Previous story intelligence

- **Story 5.1 R1**: tx wrappers, narrow catches, audit constants in validators, 404-not-403.
- **Story 5.2 R1**: SELECT FOR UPDATE on share_tokens; nullable expires_at; flushAsync awaited on screen unmount.
- **Story 5.3 R1**: throttled refetch; `invalidateQueries` pattern; `hasJoinedToken` derived from `st_id IS NOT NULL`; empty-string `displayName` guards; suppressed-kind docblock realignment.

### Project Structure Notes

All new files align with existing conventions:

- `packages/ui/src/components/UndoToast/`, `RevokeConfirmDialog/` — barrel directories.
- No new app routes (revoke entry lives inside the existing Acessos tab).
- No new schema, no new RLS files.

No structural conflicts.

### Testing standards summary

- **DB integration + RLS:** Story 5.1's existing share_tokens RLS test confirms revoked tokens are invisible to doctor principal.
- **API integration:** revokeShareToken happy path + cross-patient 404 + re-revoke 404 (idempotent) + concurrent serialization.
- **Unit:** Zod schemas, copy functions, narrow-catch logic.
- **Behavior (Expo hook):** fake timers; 5s expiry fires mutation; undo cancels; cleanup-on-unmount fires.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.4 lines 1294-1320]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#AccessLogItem revoked states lines 916-922]
- [Source: packages/db/src/schema/sharing.ts share_tokens.revoked_at — Story 5.1]
- [Source: packages/db/policies/custom_rls_share_tokens.sql doctor-principal predicate — Story 5.1]
- [Source: packages/api/src/router/sharing.ts createShareToken FOR UPDATE pattern — Story 5.2 R1]
- [Source: packages/api/src/sharing.ts computeAccessLogTokenStatus — Story 5.3]
- [Source: packages/api/src/audit.ts writeAuditLog — Stories 1.x+]
- [Source: packages/ui/src/components/NoExpiryConfirmDialog — Story 5.2 dialog precedent]
- [Source: _bmad-output/implementation-artifacts/5-1-...md narrow-catches, 404-not-403]
- [Source: _bmad-output/implementation-artifacts/5-2-...md SELECT FOR UPDATE in-tx pattern]
- [Source: _bmad-output/implementation-artifacts/5-3-...md throttled refetch, invalidateQueries]
- [Source: CLAUDE.md — code-review discipline, narrow catches]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (claude-opus-4-7), 2026-05-26.

### Debug Log References

- Verified `@tamagui/toast` is NOT a workspace dep (`packages/ui/package.json`) — implemented `UndoToast` as a custom Tamagui-primitives component with a single `setTimeout` (auth source of truth for the 5s deadline) + a 50ms `setInterval` for the linear progress bar.
- `protectedProcedure` chosen for `revokeShareToken` (not `premiumProcedure`) — a downgraded patient must still be able to revoke their existing shares (LGPD control plane).
- Pending revoke set keyed by `shareTokenId`; React triggers re-render via `setRevokingTokenIds(new Set(prev).add(id))` (Set referential equality). `timersRef.current` is a `Map<string, Timeout>` ref so re-renders don't drop handles.

### Completion Notes List

1. **`@tamagui/toast` vs custom Animated.View** — package not present in workspace; used custom Tamagui-primitives component.
2. **5-second countdown indicator** — implemented as a linear progress bar driven by a single `setInterval(50ms)` (chosen over CSS keyframes for cross-platform parity — Reanimated would be a heavyweight add for one feature). The auto-dismiss is owned by a separate `setTimeout(durationMs)` so dropped interval ticks under load can't extend the window.
3. **`revokingTokenIds: Set<string>` vs `Record<string, true>`** — `Set` chosen to match the existing `expandedIds: Set<string>` pattern in `AccessLogList` (Story 5.3).
4. **Multi-revoke toast surface** — confirmed with spec: most-recent toast wins; older timers continue silently. Documented in the Expo screen's docblock.
5. **Cleanup-on-unmount** — fires pending revokes immediately (user already confirmed). NEVER cancels (anti-pattern per spec). Uses a `useRef` over `fireRevoke` to avoid stale closures while still running with `[]` deps.

### File List

**Created**

- `packages/api/__tests__/sharing/revoke-share-token-validators.test.ts` — Zod + copy-function unit tests for `revokeShareTokenInputSchema`, `REVOKE_*` constants, and the new `"revoked-pending"` enum member.
- `packages/api/__tests__/sharing/revoke-share-token.integration.test.ts` — `it.todo()` placeholders + synchronous audit-constant assertions.
- `packages/ui/src/components/RevokeConfirmDialog/RevokeConfirmDialog.tsx` — Tier-2 confirmation dialog; mirrors `NoExpiryConfirmDialog`.
- `packages/ui/src/components/RevokeConfirmDialog/index.ts` — barrel.
- `packages/ui/src/components/RevokeConfirmDialog/RevokeConfirmDialog.test.tsx` — `@ts-nocheck` runner-ready scaffold.
- `packages/ui/src/components/UndoToast/UndoToast.tsx` — bottom-anchored toast with linear countdown; backdrop not-dismissable per spec.
- `packages/ui/src/components/UndoToast/index.ts` — barrel.
- `packages/ui/src/components/UndoToast/UndoToast.test.tsx` — fake-timer behavior scaffold (5s expiry; undo cancellation; visible=false short-circuit).

**Modified**

- `packages/validators/src/sharing.ts` — added `SHARING_AUDIT_TOKEN_REVOKED`, `revokeShareTokenInputSchema` / `revokeShareTokenOutputSchema`, `"revoked-pending"` to `ACCESS_LOG_TOKEN_STATUSES`, extended `ACCESS_LOG_TOKEN_STATUS_PT_BR_FN`, added the full revoke-ceremony copy block + `REVOKE_TIMEOUT_MS`.
- `packages/api/src/router/sharing.ts` — new `revokeShareToken` `protectedProcedure.mutation`; tx wrapper + `SELECT FOR UPDATE` + audit-in-tx + narrow `isUniqueViolation` catch.
- `packages/ui/src/components/AccessLogItem/AccessLogItem.tsx` — added `shareTokenId` + `onRevokePress` props; dim treatment for `"revoked-pending"`; revoke button gated on `event === "share_token.created"` AND active token status.
- `packages/ui/src/components/AccessLogList/AccessLogList.tsx` — surfaces `onRevokePress` and pipes `row.shareTokenId` down.
- `packages/ui/src/index.ts` — re-exports `RevokeConfirmDialog` + `UndoToast`.
- `apps/expo/src/app/(tabs)/acessos/index.tsx` — full revoke ceremony (dialog state, timers ref, undo toast, cleanup-on-unmount that flushes pending mutations).
- `apps/web/src/app/acessos/page.tsx` — web parity.

### Review Findings (2026-05-27)

Three-layer adversarial review. Convergent finding across both Blind Hunter and Edge Case Hunter: **`revokeMutation` has no `onError` handler** — server failures (network, 5xx, re-revoke 404) are silently dropped, leaving the patient believing they revoked when they didn't. LGPD-relevant.

#### Decision-needed

- [ ] [Review][Decision] **Page-unload survival within 5s undo window (web)** — `revokeMutation.mutate(...)` is fire-and-forget; on `beforeunload` the browser cancels the in-flight fetch → no DB write, no audit, row stays `ativo` on next visit. Options: (a) Use `navigator.sendBeacon('/api/sharing.revoke', {shareTokenId})` from the cleanup path — needs a new public REST endpoint that authenticates via the supabase cookie + does what the tRPC mutation does. (b) Accept the trade-off and document it (cleanup runs but cannot guarantee survival; UI on next visit will reflect server state); the patient can simply re-revoke. (c) Persist `revokingTokenIds` to localStorage and on next page load, fire any pending mutations server-side. The Expo path is unaffected (Expo Router keeps tabs mounted; cleanup-on-unmount only fires on hard kill which the OS handles differently).

#### Patch (apply before merge)

- [ ] [Review][Patch] **CRITICAL — Missing `onError` on `revokeMutation`** — `apps/expo/.../acessos/index.tsx:67-76`, web `:55-64`. Both Blind Hunter (#3,#4,#7) and Edge Case Hunter (#5,#6) flagged. Add: surfaces toast `REVOKE_FAILED_PT_BR = "Não foi possível revogar. Tente novamente."` (new validators constant). On the re-revoke 404 path specifically (`error.data?.code === 'NOT_FOUND'`), DON'T surface as failure — silently treat as "already revoked elsewhere" (the invalidate-and-refetch will surface the correct revoked state). Detect via `error.data?.httpStatus === 404` or the tRPC error code.
- [ ] [Review][Patch] **CRITICAL — UPDATE missing `revoked_at IS NULL` defense-in-depth** — `packages/api/src/router/sharing.ts:550-553`. Today the SELECT FOR UPDATE filter saves us, but a future refactor that drops the SELECT (or replaces it with a non-locking variant) silently overwrites `revoked_at`. Fix: change `UPDATE share_tokens SET revoked_at = $now WHERE id = $id` to `UPDATE share_tokens SET revoked_at = $now WHERE id = $id AND revoked_at IS NULL` and assert rowCount === 1 (throw NOT_FOUND on 0 — defense-in-depth aligned with the SELECT).
- [ ] [Review][Patch] **HIGH — `:undone:undone` infinite chain on cancel-confirmation toast** — `apps/expo/.../acessos/index.tsx:268-291`, web `:537-556`. The "Revogação cancelada." toast carries an "Desfazer" button (inherited from `UndoToast`'s shape). Tapping it re-enters `handleUndo` with `shareTokenId="${id}:undone"`, which has no real timer; the handler then sets `setActiveToast({shareTokenId: "${id}:undone:undone"})`. Loops. Fix: add a new `UndoToast` prop `undoLabel?: string | null` — when `null`, the button is hidden. The cancel-confirmation toast passes `undoLabel={null}` so there's no infinite-chain surface.
- [ ] [Review][Patch] **HIGH — Cleanup-on-unmount Map mutation during iteration** — `apps/expo/.../acessos/index.tsx:235-242`, web `:212-219`. The `for (const [id, handle] of timers.entries())` loop calls `fireFnRef.current(id)` which calls `timersRef.current.delete(shareTokenId)`. ECMA-262 `Map.entries()` reflects deletions of the current entry, but the contract is fragile if a future maintainer adds a `set()` inside `fireRevoke`. Fix: snapshot ids first: `const ids = Array.from(timers.keys()); for (const id of ids) { clearTimeout(timers.get(id)!); fireFnRef.current(id); }`.
- [ ] [Review][Patch] **HIGH — `revokingTokenIds` stale → "Revogando…" flicker after `invalidateQueries`** — `apps/expo/.../acessos/index.tsx:71-75,157-167`. Sequence: `onSuccess` fires `invalidateQueries`; refetch returns `tokenStatus="revogado"`; in parallel `onSettled` clears the Set. If refetch arrives first, the `accumulated` mapper override still forces `"revoked-pending"` until `onSettled` lands. UI flicker `revoked → pending → revoked`. Fix: clear the Set entry BEFORE `invalidateQueries` (`onSuccess: (data) => { setRevokingTokenIds(prev => { const n = new Set(prev); n.delete(data.shareTokenId); return n; }); void queryClient.invalidateQueries(...); }`). Remove the duplicate clear from `onSettled` (or keep it as defense-in-depth no-op).
- [ ] [Review][Patch] **MEDIUM — Audit `revokedAt` uses JS `new Date()` not server `now()`** — `packages/api/src/router/sharing.ts:548-580`. The DB column AND the audit metadata both use the JS `revokedAt` const computed at resolver entry. Under web-pod clock drift, ordering across rows is per-app-server-clock. Fix: switch the UPDATE to `revoked_at = now()` (Postgres clock), use `RETURNING revoked_at`, and pass that returned value to `writeAuditLog`. Adds one round-trip-saving `RETURNING` clause; aligns audit metadata with DB column under a single clock.
- [ ] [Review][Patch] **MEDIUM — `AccessLogTokenStatus` enum could leak `revoked-pending` server-side via Zod** — `packages/validators/src/sharing.ts:336-341,393-401`. The current enum is shared between the server output schema and the client mapper. A bug (or malicious response) returning `revoked-pending` from the server wouldn't be rejected. Fix: split into two enums — `ServerAccessLogTokenStatus = ["ativo","expirado","revogado","sem prazo"]` (used by Zod output schema) and `ClientAccessLogTokenStatus = [...Server, "revoked-pending"]` (used by `AccessLogItem` prop type). Update the resolver's output Zod schema to use the Server variant; AccessLogItem prop type uses the Client variant.
- [ ] [Review][Patch] **MEDIUM — Revoke button only renders in `expanded` mode (undocumented gate)** — `packages/ui/src/components/AccessLogItem/AccessLogItem.tsx:194`. The spec's AC1 lists three conditions but the implementation adds a fourth (`expanded`). The patient must tap-to-expand before they can revoke. Fix: either (a) drop the `expanded` requirement so the button is always visible on active-share rows (most discoverable); or (b) keep the gate and document explicitly in the spec + add a hint in the compact view like "Toque para expandir" so the action is discoverable. Recommendation: (a) — revoke is high-value, hiding it behind expansion is anti-discoverable.
- [ ] [Review][Patch] **LOW — `progressPct` NaN guard** — `packages/ui/src/components/UndoToast/UndoToast.tsx:108-111`. If a future caller passes `durationMs={0}`, division-by-zero yields NaN → `width: NaN%` render glitch. Add `if (durationMs <= 0) return 0;` early return in the progress computation.
- [ ] [Review][Patch] **LOW — Wire `revokeShareTokenOutputSchema` via `.output(...)` on the procedure** — `packages/api/src/router/sharing.ts:540-585` + `packages/validators/src/sharing.ts:111-116`. The output Zod schema is exported but the procedure has no `.output(revokeShareTokenOutputSchema)` — dead export. Either wire it (defense-in-depth on the response shape) or remove the export.
- [ ] [Review][Patch] **LOW — Missing CLAUDE.md "Revoke discipline" paragraph + share_tokens RLS smoke + use-revoke-undo hook test (T7.2, T6.4, T6.5)** — three small misses called out by the Auditor. T7.2: append a one-paragraph note to CLAUDE.md (deferred-server-write pattern, patient-only audit). T6.4: in `packages/db/__tests__/rls/share_tokens.rls.test.ts`, confirm a smoke case where the doctor sees nothing for a revoked-during-session token (likely already covered; verify). T6.5: skip — `UndoToast.test.tsx` covers the 5s deadline behavior; the screen-level test would only add cleanup-on-unmount coverage which Edge Case Hunter's F1/F2 will be addressed by the patches above.

#### Deferred (pre-existing or out-of-scope)

- [x] [Review][Defer] **AC7 cosmetic deviation: linear progress bar + setInterval vs spec's circular CSS-keyframe ring** — material-behavior identical; auto-dismiss owned by the separate `setTimeout(durationMs)`. Justified in Dev Agent Record. Story 5.x polish pass.
- [x] [Review][Defer] **Expo Router tab-suspension behavior** — timer keeps running while tab is offscreen; the server-write deadline is correct under backgrounding; only the visual countdown bar may not be visible if the user tabbed away. Acceptable per spec intent.
- [x] [Review][Defer] **Multi-revoke older toasts silently replaced** — documented spec trade-off. Toast queue is Story 5.x polish.
- [x] [Review][Defer] **`onCancel` double-fire on `RevokeConfirmDialog`** — idempotent setState; harmless today; only matters if onCancel later tracks events.
- [x] [Review][Defer] **`UndoToast` `durationMs` effect dep re-run on prop identity change** — constant from validators; doesn't change in practice.
- [x] [Review][Defer] **Integration test `it.todo()` coverage of FOR UPDATE / concurrent / cross-patient** — matches Story 5.x precedent; CI testcontainer harness runs them when the final Epic 5 story lands.
- [x] [Review][Defer] **VoiceOver `alert` role focus-stealing UX** — flagged by Edge Case Hunter for UX review; acceptable for v1.
- [x] [Review][Defer] **Android hardware back on `RevokeConfirmDialog`** — Tamagui Dialog default handles it; verify in manual test.

### Known infra blockers (out-of-code)

- **Production migration still deferred.** Story 5.7 (final Epic 5) lands the batched migration. Story 5.4 adds no new schema — `revoked_at` already exists.
- **Doctor-side 403 + `share_token.rejected` audit deferred to Epic 6.** Story 5.1's `verifyShareToken` helper is already revoked-token-aware; Epic 6 wires the surface.
- **Revoke from Compartilhar tab landing** — out of scope; deferred to Story 5.x polish.
- **Web page-unload trade-off (accepted — decision A, 2026-05-27).** On `beforeunload` within the 5s undo window the in-flight `revokeShareToken` fetch is cancelled by the browser; the revoke does NOT land server-side. On next visit, `listAccessLog` refetch returns the row as `ativo` and the patient can simply re-revoke. Accepted because (1) the user took deliberate confirm action so they're not surprised, (2) the row is still active rather than in a half-state, (3) worst-case cost is one extra patient tap. No `sendBeacon` endpoint and no `localStorage` persistence are introduced. The Expo path is unaffected (Expo Router keeps tabs mounted; cleanup-on-unmount only fires on hard process kill which the OS handles via its lifecycle).

### Review fixes applied (2026-05-27)

All 11 "Patch (apply before merge)" items applied + decision A documented:

- **Patch #1 (CRITICAL)** — `onError` wired on `revokeMutation` in both Expo and web screens. Re-revoke 404 is silenced + invalidates the list (refetch surfaces the correct `revogado` state); other errors flip the `activeToast` to `kind: "error"` carrying `REVOKE_FAILED_PT_BR` so the patient knows to re-tap. The pending-set entry clears in both success and error paths (no automatic retry).
- **Patch #2 (CRITICAL)** — `revokeShareToken` UPDATE now carries the `AND revoked_at IS NULL` defense-in-depth predicate alongside the SELECT FOR UPDATE; 0-row result throws `NOT_FOUND`. Uses raw `tx.execute` with `RETURNING revoked_at` to keep both the column and audit metadata on a single Postgres clock (patch #6).
- **Patch #3 (HIGH)** — `UndoToast.undoLabel` is now `string | null`; passing `null` hides the Desfazer button. Both screens use a discriminated `ActiveToast = { kind: "revoking" | "undone" | "error" }` union; only the `revoking` surface renders the undo button. The `:undone:undone:undone…` infinite chain is gone.
- **Patch #4 (HIGH)** — cleanup-on-unmount snapshots `Array.from(timers.keys())` before iterating, then re-reads each handle from the Map. Eliminates the Map-mutation-during-iteration foot-gun for future maintainers.
- **Patch #5 (HIGH)** — `setRevokingTokenIds` clears the entry BEFORE `invalidateQueries` (both `onSuccess` and `onError` paths). The `onSettled` clear is dropped; no more `revoked → pending → revoked` flicker.
- **Patch #6 (MEDIUM)** — folded into patch #2. UPDATE-RETURNING uses Postgres `now()`; the same `revokedAt` value flows into both `writeAuditLog` and the mutation output.
- **Patch #7 (MEDIUM)** — `SERVER_ACCESS_LOG_TOKEN_STATUSES` split from `ACCESS_LOG_TOKEN_STATUSES`. `accessLogItemRowSchema.tokenStatus` now uses the Server variant — a buggy/malicious response carrying `"revoked-pending"` is Zod-rejected at the tRPC boundary.
- **Patch #8 (MEDIUM)** — dropped the `expanded` gate on `AccessLogItem`'s revoke button. The button now renders in compact view too whenever the row is `share_token.created` + active status. High-value action, fully discoverable.
- **Patch #9 (LOW)** — `progressPct` short-circuits to 0 when `durationMs <= 0` (NaN guard).
- **Patch #10 (LOW)** — `.output(revokeShareTokenOutputSchema)` wired on the procedure chain.
- **Patch #11 (LOW)** — CLAUDE.md "Revoke discipline (Story 5.4)" paragraph appended; share_tokens RLS test already covers `doctorWithRevokedToken` (verified). The Expo screen-level hook test (T6.5) remains skipped per the review's stated rationale — the F1/F2 cleanup-on-unmount paths are covered by patches above.
- **Decision A** — accept the web `beforeunload` trade-off; documented in CLAUDE.md "Revoke discipline" paragraph + this spec's `### Known infra blockers (out-of-code)` section.
