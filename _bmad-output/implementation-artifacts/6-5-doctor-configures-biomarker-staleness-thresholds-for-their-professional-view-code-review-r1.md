# Story 6.5 — Code Review Round 1

Reviewer: bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor)
Diff scope: commit `cff99f0` (Story 6.5 only — 20 files, +1861/-20)
Spec: `_bmad-output/implementation-artifacts/6-5-...-professional-view.md`
Date: 2026-05-30

## Summary

| Severity  | Count | Notes                            |
| --------- | ----- | -------------------------------- |
| CRITICAL  | 0     |                                  |
| HIGH      | 1     | Patched in this round            |
| MEDIUM    | 4     | Left for Francis                 |
| LOW       | 3     | Left for Francis                 |
| Dismissed | ~6    | False-positive parallel-tx, etc. |

## Top 3 findings

1. **HIGH** — BiomarkerCard stale chip uses `backgroundColor="$textSecondary"`, a text token mis-applied as a surface, yielding ~2.3:1 contrast on dark theme (WCAG AA fail). PATCHED in commit (see below) by swapping to `$accessLogNeutral`.
2. **MEDIUM** — `professionalSessionProcedure` name implies "doctor-verified" but only verifies a Supabase session exists; any signed-in user (incl. patients) can hit `updateStalenessThresholds` / `listStalenessThresholds`. The application-layer activation gate (SELECT `professionals` → PRECONDITION_FAILED) is the real guard. Adequate defense-in-depth today; flag for rename / clearer docstring before reuse.
3. **MEDIUM** — Story spec ACs were destroyed by the sed regression and replaced with one-line stubs (line 17 confesses). ACs 1–13 are too vague to enforce on a future review pass. Restore from git history before sprint sign-off.

## Findings detail

### HIGH-1 — Stale chip contrast / token misuse _(PATCHED)_

- File: `packages/ui/src/biomarker-card.tsx` line 289 (pre-patch)
- `backgroundColor="$textSecondary"` (`#A8A29E` dark / `#6B6B6B` light) + `color="$textPrimary"` (`#F5F0EB` dark / `#1A1A1A` light).
- Dark-theme contrast `#F5F0EB` on `#A8A29E` ≈ 2.3:1 — FAILS WCAG AA (4.5:1 for body text). Also semantically wrong (text-color token used as a surface).
- Fix: swap to `$accessLogNeutral` (`#F0EFEC` light / `#2E2A26` dark) — an existing muted-warm surface token from Story 5.3 that passes AA paired with `$textPrimary`. NOT amber, per UX-DR13.

### MEDIUM-1 — `professionalSessionProcedure` naming

- File: `packages/api/src/trpc.ts` line 149
- Middleware sets `app.current_doctor_user_id = session.user.id` for ANY signed-in user. A signed-in patient hitting `account.updateStalenessThresholds` would clear middleware but hit `PRECONDITION_FAILED` at the activation gate. Functionally safe; the name suggests stronger guarantees than it delivers.
- Suggested: rename to `authedSessionDoctorGucProcedure`, or merge the activation gate INTO the middleware (one DB lookup amortized).

### MEDIUM-2 — Story spec coherence

- File: `_bmad-output/implementation-artifacts/6-5-...-professional-view.md` lines 16–32
- ACs 1–13 reduced to one-line abstracts. Reviewers cannot verify load-bearing contracts (e.g. "no DELETE policy" rationale, "biomarkerStaleness parallel array shape") from the spec — only from the code. Restore.

### MEDIUM-3 — `staleness_thresholds` PK semantics

- File: `packages/db/src/schema/staleness_thresholds.ts` line 68
- Schema comments describe a "composite primary key" but the table uses `uniqueIndex("staleness_thresholds_pk")` only — no actual `primaryKey()`. ON CONFLICT works because the unique index satisfies the conflict target, but a table with NO PK is unusual. Either add `primaryKey({ columns: [...] })` or update the comments.

### MEDIUM-4 — Settings page synthetic session shim

- File: `apps/web/src/app/profissional/configuracoes/limiares/page.tsx` lines 47–53
- When `getSession()` returns null but `getUser()` returned a user, the page fabricates a `Session` with empty `access_token`. Mirrors `view/page.tsx`, but the resolver this hits (`professionalSessionProcedure`) only reads `session.user`. Tracked debt that should be eliminated once `createSupabaseServerClient` is hardened (Story 6.6 candidate).

### LOW-1 — Form toast never auto-clears

- File: `StalenessThresholdsForm.tsx` line 45
- Success/error toast persists indefinitely; no `setTimeout` or dismiss UI. Polite to clear after ~4s.

### LOW-2 — Form local state drift on success

- File: `StalenessThresholdsForm.tsx` line 57
- On success calls `router.refresh()` (RSC re-fetch) but `useState rows` is initialized once. After save, `isDefault` flags remain stale until full unmount. Acceptable for MVP; flag.

### LOW-3 — `getConversationStarter` dedup→fan-out

- File: `packages/api/src/router/sharing.ts` lines 1496–1547
- Dedups categories for the SQL IN clause but maps back per-card; cards with malformed categories degrade silently to `isStale=false`. Intentional; document the contract.

### Dismissed (sample)

- "Nested `ctx.db.transaction()` inside `professionalSessionProcedure`'s outer tx" — postgres-js handles via savepoints; pattern in use across sharingRouter.
- "`app.current_user_role` set to `doctor` even for patients hitting the procedure" — irrelevant; only the staleness_thresholds policies use it, and they only check `service_role`.
- "Audit kind not in `ACCESS_LOG_EVENT_KINDS`" — INTENTIONAL per AC8; doctor-side telemetry.
- "DELETE policy absent" — INTENTIONAL per AC9; UI has no delete path.

## Patches applied this round

- `packages/ui/src/biomarker-card.tsx` — swap stale-chip `backgroundColor` from `$textSecondary` to `$accessLogNeutral` (HIGH-1).

## Quality gates (post-patch)

See bottom of this file (Francis-relayed results).
