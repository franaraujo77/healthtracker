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

---

## R1-followup resolution (addendum — 2026-05-30)

Francis approved fixing **all** remaining R1 findings. Patches below
sit on top of `aca8cc4` (the original R1 patch) and ship in a single
commit on the existing `worktree-story-6-2` branch / PR #57. The
original findings sections above are PRESERVED unchanged for audit.

### MEDIUM-1 — `professionalSessionProcedure` overstates its guarantee → RESOLVED

- File: `packages/api/src/trpc.ts` lines 129–202 (revised).
- Decision: folded the activation gate (SELECT `professionals` WHERE
  user_id = session.user.id LIMIT 1) INTO the middleware. The
  procedure name is now truthful — any consumer is guaranteed a
  verified Supabase session AND an activated `professionals` row
  before the resolver body runs.
- Error semantics preserved: missing row throws
  `PRECONDITION_FAILED` with code `DOCTOR_NOT_ACTIVATED` (same
  message the resolvers used) so the limiares RSC's catch-and-render
  ("ative sua conta" placeholder card) continues to work without
  changes.
- Call-site cleanup: both `accountRouter.updateStalenessThresholds`
  and `accountRouter.listStalenessThresholds` had their inline
  activation gates removed (`packages/api/src/router/account.ts`).
  Unused `Professionals` import dropped.
- Test added:
  `packages/api/__tests__/professional-session-gate.test.ts` —
  mirrors the shape of
  `__tests__/sharing/doctor-procedure-session-gate.test.ts`. Covers
  null-session, session-but-no-professionals-row, and the happy
  path. Uses a fake `tx.execute` so no real DB is touched.

### MEDIUM-2 — Story spec ACs truncated → RESOLVED

- File:
  `_bmad-output/implementation-artifacts/6-5-doctor-configures-biomarker-staleness-thresholds-for-their-professional-view.md`.
- Restored the four canonical Given/When/Then blocks verbatim from
  `_bmad-output/planning-artifacts/epics.md` lines 1521–1545.
- Kept the implementation-contract ACs (5–13) as a separate
  subsection — they are layered on top of the canonical ACs and
  remain load-bearing for the review/audit cycle and Story 6.6.
- Added a new "Activation/authorization contract" section that
  references the MEDIUM-1 fix above (so a future reviewer reading
  the spec sees that the activation gate is at the middleware
  layer, not the resolver).
- No prior git history existed for fuller AC text on the story
  file (story landed in `cff99f0` already truncated); the epic is
  the canonical source.

### MEDIUM-3 — Composite PK vs `uniqueIndex` reality → RESOLVED

- File: `packages/db/src/schema/staleness_thresholds.ts` lines 1–82.
- Decision: option (a) — switched `uniqueIndex("staleness_thresholds_pk")`
  to `primaryKey({ name: "staleness_thresholds_pk", columns: [...] })`.
  This mirrors Story 5.1's `share_token_biomarkers` precedent
  (`packages/db/src/schema/sharing.ts` lines 196–200) — the
  dev's "composite PK" comment is now truthful.
- No migration ships in this story (per AC9 / Story 6.5 scope);
  Story 6.6 batches the Epic 6 SQL.
- ON CONFLICT target stays explicit on the (professional_user_id,
  biomarker_category) pair — no resolver changes required.

### MEDIUM-4 — Synthetic `Session` shim on settings page → RESOLVED

- Files:
  - `packages/auth/src/server.ts` — added
    `getVerifiedSessionForCaller()` helper that re-validates the JWT
    via `getUser()`, prefers the real `getSession()` row, falls
    back to the verified-user synthetic shape. One source of truth.
  - `apps/web/src/app/profissional/configuracoes/limiares/page.tsx`
    — replaced inline `getUser()` + `getSession()` + shim with a
    single `getVerifiedSessionForCaller()` call.
- The view page at `apps/web/src/app/m/[token]/view/page.tsx` was
  intentionally NOT migrated in this commit — it adds a Token-status
  pre-auth gate between `getUser()` and the synthetic shim, so the
  refactor needs a separate look (deferred to Story 6.6 hardening
  pass, as the original review note suggested).

### LOW-1 — Form toast never auto-clears → RESOLVED

- File:
  `apps/web/src/app/profissional/configuracoes/limiares/StalenessThresholdsForm.tsx`.
- Added a `useEffect` that schedules a 4s `setTimeout` whenever
  `toast` is non-null, with cleanup on unmount / on supersession.
  Project had no prior toast convention to mirror.

### LOW-2 — Form `useState` drifts on save success → RESOLVED

- Same file. The mutation's `onSuccess` now:
  1. Syncs local state from the submitted thresholds — for every
     row whose category was in the payload, `value` is updated to
     the persisted value, `isDefault` flips to `false`, and
     `touched` resets to `false`. Rows that were NOT in the payload
     get `touched: false` (no value churn).
  2. Invalidates the tRPC query (`trpc.account.listStalenessThresholds.queryKey()`)
     so any sibling consumer re-fetches.
  3. Still calls `router.refresh()` to keep the RSC in sync.

### LOW-3 — `getConversationStarter` dedup → fan-out contract → RESOLVED

- File: `packages/api/src/router/sharing.ts` lines ~1494–1547.
- Added a block comment above the dedup/fan-out code documenting:
  - **Order guarantee** — output is index-aligned to input
    `payload.biomarkerCards`; dedup is purely a SQL `IN (...)`
    optimization.
  - **Missing-data semantics** — `currentValue === null` →
    `isStale: false`; missing observation → `isStale: false`;
    unknown category → fallback to `STALENESS_DEFAULT_DAYS`.
  - **Best-effort contract** — any SELECT failure degrades silently
    to `biomarkerStaleness: undefined` (consumed by `BiomarkerCard`'s
    `isStale === undefined` short-circuit).

## Quality gates (R1-followup post-patch)

- `pnpm -w typecheck` — **17/17 clean** (no errors, no warnings).
- `pnpm -w lint` — **clean** for changed packages. Pre-existing
  warnings in `biomarker-suggestion.test.ts` (unused
  eslint-disable directives) unchanged — not in scope for this
  round. The new test file
  `professional-session-gate.test.ts` lints clean.
- `pnpm --filter @healthtracker/api test:unit` — **334/334 passed**
  (was 330 pre-patch; +4 new tests in
  `professional-session-gate.test.ts`).
- `pnpm --filter @healthtracker/db test:integration` —
  **skipped (infra unavailable)**. The full integration suite
  (incl. `staleness_thresholds.rls.test.ts`) requires a Docker
  daemon for testcontainers; that infra was not available in this
  worktree (`docker.from_env()` couldn't start the
  `postgres:16-alpine` container). The RLS contract did not
  change in this round (no SQL or RLS file touched); the
  Drizzle-schema PK switch is metadata-only.
