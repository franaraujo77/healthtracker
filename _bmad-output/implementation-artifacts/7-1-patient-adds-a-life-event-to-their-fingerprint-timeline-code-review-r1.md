# Story 7.1 — Code Review Round 1

**Branch:** `worktree-story-7-1`
**Reviewed HEAD (pre-patch):** `dfd11bc`
**Reviewers (in-session):** Blind Hunter, Edge Case Hunter, Acceptance Auditor
**Scope:** `git show --stat dfd11bc` — life-events RLS, schema, resolver, router, validators, sheet, chart annotation, Tier-2 CTA, RLS + unit tests.

---

## Severity counts

- **CRITICAL:** 0
- **HIGH:** 0
- **MEDIUM:** 2 (1 patched, 1 noted)
- **LOW:** 4 (noted)

---

## Top 3 findings

### 1. MEDIUM — `createLifeEventInputSchema.eventDate` accepts impossible calendar dates (PATCHED)

The Zod regex `/^\d{4}-\d{2}-\d{2}$/` accepts `2024-02-30`, `2024-13-01`, `2024-04-31`, etc. The retroactive-only `<=` string compare passes for those inputs (string comparison only — no calendar awareness). The malformed date then reaches the resolver and is forwarded to Postgres' `DATE` parser, where it surfaces as a 500-class `INTERNAL_SERVER_ERROR` instead of the friendly pt-BR `LIFE_EVENT_EVENT_DATE_INVALID` validation hint. The free-text date input (dev deviation #1) makes this trivially reachable — typo `2024-02-30` or `2024-13-15` is plausible from a patient typing `yyyy-mm-dd` manually.

The codebase already has the canonical defense — `BiaSubmissionSchema.collectedAt` (R1-P200) ships exactly this guard: a `validDateParts`-style refine that round-trips through `Date.UTC`. Story 7.1 did not adopt it.

**Patch applied** — added `isRealIsoDate` refine to `createLifeEventInputSchema.eventDate`, mirroring the BIA pattern. Maps to existing `LIFE_EVENT_EVENT_DATE_INVALID` validation message; no new copy needed.

**Evidence:** `packages/validators/src/life-events.ts:78–84` (pre-patch).

### 2. MEDIUM — Free-text `yyyy-mm-dd` date input (dev deviation #1) — NOT patched

The `LifeEventSheet` uses a free-text `<Input>` for the date with placeholder `AAAA-MM-DD`. This is a known dev deviation. The validation chain is now defensive (regex + real-date refine + future-date refine + pt-BR error mapping), so a typo surfaces a friendly hint. **However:**

- Patients on mid-range Android (UX-DR2) typing on a 12-key keyboard are likely to mis-type the `-` separator or get the digit count wrong on first try.
- The Tier-2 CTA path doesn't have any "Hoje" / "Ontem" quick-fill, so even a patient marking "today" types 10 chars.
- pt-BR users are accustomed to `dd/mm/aaaa` (BIA form uses this). The wire format must stay `yyyy-mm-dd`, but the input could parse `dd/mm/aaaa` and convert.

**Recommendation (Francis to decide):** Either ship a platform-native date picker in a follow-up (deferred to 7.x) or accept `dd/mm/yyyy` input and convert client-side. Left unpatched — UX call, not a security or correctness defect now that #1 lands.

**Evidence:** `packages/ui/src/components/LifeEventSheet.tsx:155–164`.

### 3. LOW — `description` is shipped to the FE as a marker prop but never rendered

`FingerprintLifeEventMarker.description` is on the FE prop, populated by `lifeEventsQuery`, and threaded through `BaselineSkiaChart` → into the `lifeEventLines` array — but **never rendered** (no tooltip, no a11y label uses it). It's effectively dead data on the wire. This is mobile-only via tRPC over the Expo client — there is no RSC payload or `apps/web` consumer for `fingerprint-chart-baseline.tsx` (`isReactNative` guard short-circuits the web bundle). No leakage path beyond the device today.

**Recommendation:** Either strip `description` from `FingerprintLifeEventMarker` (and from the marker mapping in `inicio.tsx`) to avoid PII traveling unnecessarily, OR surface a tap-tooltip in a follow-up. Left unpatched — dev's intentional staging note in the spec.

**Evidence:** `packages/ui/src/fingerprint-chart-baseline.tsx:96–100`, `apps/expo/src/app/(tabs)/inicio.tsx:476–483`.

---

## Other findings (LOW)

- **LOW — Tier-2 CTA `<Button>` has no explicit `accessibilityLabel`.** Falls back to children text `"Adicionar evento de vida"`, which is fine, but other CTAs on the page set the label explicitly. Inconsistency only.
- **LOW — `LifeEventSheet` lacks focus management on open.** No `inputRef.focus()` on sheet open; screen-reader users land at the sheet handle, not the description field. Tamagui `Sheet` doesn't auto-focus the first input.
- **LOW — `lifeEventWindow` "today" derivation uses the device local clock, not São Paulo.** This is fine for the chart window (the server refine is the auth boundary) but creates a one-day drift on devices set to a non-Brazil TZ. Cosmetic only.
- **LOW — vertical-line annotation rendered via `Line` with two synthetic points carrying `xValue: 0, yValue: 0` placeholders.** Victory Native v41's `Line` typically expects render-prop `points`; passing hand-crafted skia coordinates is a working-but-fragile contract that could break on a Victory Native minor bump. Recommend integration-testing the chart visually before relying on this in retro.

---

## What I patched vs what I left

| Severity | Finding                                        | Action                                   |
| -------- | ---------------------------------------------- | ---------------------------------------- |
| MEDIUM   | Invalid calendar dates pass Zod regex          | **Patched** (`isRealIsoDate` refine)     |
| MEDIUM   | Free-text date input UX                        | Left — Francis decides (follow-up story) |
| LOW      | `description` shipped to FE marker prop unused | Left — intentional staging per dev notes |
| LOW      | Missing `accessibilityLabel` on CTA            | Left — cosmetic                          |
| LOW      | No focus management on sheet open              | Left — follow-up                         |
| LOW      | `lifeEventWindow` today uses local TZ          | Left — cosmetic                          |
| LOW      | Hand-crafted Line points for vertical markers  | Left — visual QA needed                  |

---

## Hot spots — verified as compliant

- **RLS** (`custom_rls_life_events.sql`): SELECT-own and INSERT-own bound to `app.current_patient_id` GUC; INSERT WITH CHECK prevents `patient_id` forgery. No doctor policy — **doctor-zero-rows invariant intact** and consistent with epic intent (life events are intentionally private; FR47 explicit-opt-in surface deferred).
- **RLS test matrix** (`life_events.rls.test.ts`): all 4 identities covered (correctPatient sees 1 row; wrongPatient/doctorWithAccess/doctorWithoutAccess see 0). Integration tests skipped under Rancher per spec — RLS test is independent of the integration suite.
- **Audit emission**: `life_event.created` with `{eventDate, category}` metadata; unit test asserts description NEVER appears in `JSON.stringify(metadata)`. `audit.ts` accepts `event: string` (no narrow union to update). NOT in `ACCESS_LOG_EVENT_KINDS` — correct per doctor-zero-rows.
- **Atomicity**: `protectedProcedure` wraps the entire resolver in `ctx.db.transaction`, so the insert + audit write either both commit or both roll back. Audit failure cannot orphan a `life_events` row.
- **Sentinel window `1970-01-01`**: `enabled: false` gates the network call entirely; the sentinel input lives only in the React Query key and is replaced as soon as `lifeEventWindow !== null`. No cache pollution path.
- **Description char-length CHECK** (`BETWEEN 1 AND 140`) matches Zod's trimmed bounds. Resolver does not re-trim — relies on Zod transform output (correct; `z.string().trim()` parses to the trimmed value).
- **`$lifeEventMarker` token**: defined in `tokens.ts` AND mapped in both `lightTheme` and `darkTheme`. Light `#5F8A8A` on `#FFFFFF` ≈ 3.6:1 contrast — meets WCAG AA for non-text UI components (3:1); dark `#9FBABA` on `#3C3836` ≈ 4.4:1, also OK. Token explicitly marked as "NOT a background" per Story 6.5 R1 lesson.
- **Additive prop discipline on `FingerprintBaselineChart`**: `lifeEvents` is optional with `?? []` fallback; pre-existing call sites without the prop render byte-for-byte unchanged.

---

## Quality-gate output

- `pnpm -w typecheck` → 17/17 successful (post-patch).
- `pnpm -w lint` → 15/15 successful, 0 errors (5 pre-existing warnings in unrelated files).
- `pnpm --filter @healthtracker/api run test:unit` → 39 test files / 338 tests passing.
- Integration / RLS tests (`packages/db/__tests__/rls/`) require `supabase start` — skipped in this session per spec carry-over (Rancher docker.sock).

---

## Commit SHAs

- Patch commit (after this report writes): see PR body.

---

## R1-followup addendum — 2026-05-30

Francis approved fixing all remaining R1 findings. The original report above is preserved; this section summarises the patches.

### Spec-file recovery

The story spec `7-1-patient-adds-a-life-event-to-their-fingerprint-timeline.md` was missing from the worktree (never committed in `dfd11bc`; review agent had nothing to read at review time). Restored by copying from the main worktree (the canonical copy at `/Users/francisaraujo/repos/healthtracker/_bmad-output/implementation-artifacts/`). Included in the followup commit.

### Patches applied

| ID  | Severity | Finding                                                                              | Patch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1  | MED      | Free-text `yyyy-mm-dd` date input is poor UX for pt-BR patients                      | Added `parseLifeEventDateInput()` accepting BOTH `dd/mm/aaaa` and ISO `yyyy-mm-dd`, converting to ISO before tRPC submit. Placeholder updated to `DD/MM/AAAA`, `accessibilityHint` added in pt-BR, `keyboardType="numbers-and-punctuation"`. **Picker dependency NOT added** — `@react-native-community/datetimepicker` is not in the workspace; adding a dep mid-PR was out of scope per the followup brief. Picker remains a Story 7.x follow-up. The server-side `isRealIsoDate` refine stays as defence-in-depth. (`packages/ui/src/components/LifeEventSheet.tsx:71-128, 154-159, 211-220`) |
| #2  | LOW      | `description` shipped to chart marker prop but never rendered (PII discipline)       | Removed `description` from `FingerprintLifeEventMarker` interface and from the marker mapping in `inicio.tsx`. The resolver/cache still carries it (spec contract for future sheet/editor surfaces), but it never reaches the render tree or React DevTools. (`packages/ui/src/fingerprint-chart-baseline.tsx:96-105`, `apps/expo/src/app/(tabs)/inicio.tsx:476-486`)                                                                                                                                                                                                                            |
| #3  | LOW      | Tier-2 CTA `<Button>` lacked explicit `accessibilityLabel`                           | Added `accessibilityLabel={LIFE_EVENT_CTA_PT_BR}` to match the convention used by neighbouring CTAs. (`apps/expo/src/app/(tabs)/inicio.tsx:701`)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| #4  | LOW      | `LifeEventSheet` had no focus management on open                                     | Added `descriptionRef` (typed against a local `FocusableRef` interface so `packages/ui` doesn't take an RN dep) and a `useEffect` that fires `descriptionRef.current?.focus()` one tick after the sheet opens. Screen-reader users now land on the description field instead of the sheet handle. (`packages/ui/src/components/LifeEventSheet.tsx:79-89, 133-141, 173-181, 194-205`)                                                                                                                                                                                                             |
| #5  | LOW      | `lifeEventWindow` "today" derivation used device local clock instead of São Paulo TZ | Imported `todayInSaoPauloIso` and replaced the inline `new Date()`-derived ISO. Eliminates the one-day window drift on devices set to a non-Brazil TZ. (`apps/expo/src/app/(tabs)/inicio.tsx:42, 451-457`)                                                                                                                                                                                                                                                                                                                                                                                       |

### Deferred (intentionally not patched in this round)

- **Hand-crafted `Line` points with placeholder `xValue: 0, yValue: 0`** (original LOW about Victory Native fragility). Visual QA against the chart is what the original review recommended; no clean code-only fix exists today. Left for retro / Story 7.x follow-up.

### Picker decision

Option 3 (pt-BR parser fallback) chosen because `@react-native-community/datetimepicker` is NOT in `package.json` anywhere in the workspace and the followup brief explicitly forbade adding a dep mid-PR. The accepted-formats list (`dd/mm/aaaa` and ISO `yyyy-mm-dd`) is exported as `parseLifeEventDateInput` so a future picker swap is mechanical. Native picker tracked as a Story 7.x deferred item.

### Quality-gate output (post-followup)

- `pnpm -w typecheck` → 17/17 successful.
- `pnpm -w lint` → 15/15 successful, 0 errors (pre-existing warnings only).
- `pnpm --filter @healthtracker/api test:unit` → 39 files / 338 tests passing (no API surface changes; validator schema unchanged).
- `pnpm --filter @healthtracker/db test:integration` → skipped (Docker still blocked under Rancher; documented as carry-over).
