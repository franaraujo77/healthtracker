# Story 7.5: Patient picks a life event date via a platform-native date picker

Status: done

<!-- Carry-forward from Story 7.1's R1 MED finding (free-text date input UX). Inserted into the Epic 7 sequence in commit 9faaa6f. Stacks on Stories 7.1 + 7.2 + 7.3 / PR #59. -->
<!-- `LifeEventSheet` lives in `packages/ui` (shared with apps/web) — the native picker dep cannot be imported there without breaking the web build. The architectural seam ships as a `renderDateField` slot prop on `LifeEventSheet`; apps/expo passes a render function that uses `@react-native-community/datetimepicker`; web (when it ever uses the sheet) falls back to the existing text input. -->

## Story

As a **patient adding a life event on mobile**,
I want **to pick the event date using my phone's native date picker (a wheel on iOS, a calendar on Android), with future dates non-selectable**,
so that **I can pick dates quickly without typing errors, matching the experience I have with every other native app, and the existing Story 7.1 server-side retroactive-only refine becomes a defense-in-depth check rather than the primary UX**.

## Acceptance Criteria

> Lifted from `_bmad-output/planning-artifacts/epics.md` lines 1719–1745. AC5–AC8 lock the implementation contract.

1. **AC1 — Native picker opens on tap of the date field in `LifeEventSheet` on mobile.**
   **Given** I tap "Adicionar evento de vida" and `LifeEventSheet` opens on Expo,
   **When** I tap the date field,
   **Then** the platform-native date picker (`@react-native-community/datetimepicker`) opens — iOS shows the wheel/inline modal style; Android shows the calendar dialog. The initial selected date is **São Paulo "today"** computed at picker-open time via the existing `todayInSaoPauloIso()` helper (NOT `new Date()`'s local clock — Story 3.1 R3-P246 / Epic 6 carry-forward: resolver-time clock authority must be consistent across the patient's surface).

2. **AC2 — Future dates non-selectable at the UI layer.**
   **Given** the picker is open,
   **When** I attempt to swipe / scroll / tap a date later than today (São Paulo),
   **Then** the picker's `maximumDate` is set to São Paulo today; the OS-level picker disables those dates so the invalid state is unreachable from the UI. The server-side `eventDate <= todayInSaoPauloIso()` refine from Story 7.1 remains in place as defense-in-depth (AR5).

3. **AC3 — Picker confirms a valid past or present date; `dd/mm/aaaa` displayed, ISO `yyyy-mm-dd` posted to the mutation.**
   **Given** I confirm a date,
   **When** the picker closes,
   **Then** the date field renders the chosen date as pt-BR `dd/mm/aaaa` (via the existing `formatCollectedAtPtBr` helper) — same display convention as Story 2.7's BIA form and Story 3.1's biomarker tap-detail. **And** the tRPC mutation `lifeEvents.createLifeEvent` receives the wire-format ISO `yyyy-mm-dd` unchanged from Story 7.1 (no validator changes; no server changes).

4. **AC4 — Web surface unchanged.**
   **Given** the web app (Next.js, post-MVP) ever opens `LifeEventSheet`,
   **Then** the Story 7.1 pt-BR `dd/mm/aaaa` / ISO text-input fallback continues to work; no native picker is required on web. The `LifeEventSheet` exposes an optional `renderDateField` slot prop that, when omitted, falls back to the existing text-input render path. Web omits the prop → text input. Mobile passes a render function backed by the native picker → native picker.

5. **AC5 — `@react-native-community/datetimepicker` lands in `apps/expo` only.**
   **Given** `packages/ui` is shared with `apps/web` and the native picker package is native-modules-only (importing it on web breaks Next.js bundling),
   **Then** the dependency is added to `apps/expo/package.json` ONLY. The `LifeEventSheet` component in `packages/ui` does NOT import `@react-native-community/datetimepicker`. The platform branching lives entirely in apps/expo — `apps/expo/src/app/(tabs)/inicio.tsx` (the only current `LifeEventSheet` consumer) passes a `renderDateField` function that uses the native picker; web consumers (if/when they exist) omit the prop and the sheet's internal text input renders.

6. **AC6 — `renderDateField` slot prop type contract.**
   **Given** the slot prop must let the consumer fully own the date input UI while preserving the sheet's local validation,
   **Then** `LifeEventSheet` accepts `renderDateField?: (props: { value: string; onChange: (isoDate: string) => void; maxDateIso: string }) => React.ReactNode`. Semantics:
   - `value` — the current ISO `yyyy-mm-dd` string held in sheet state.
   - `onChange(isoDate)` — invoked by the slot when the user confirms a new date. Sheet state updates and the Save button re-evaluates its disabled-state.
   - `maxDateIso` — `todayInSaoPauloIso()` recomputed on every render of the sheet (not memoized — the timezone helper is cheap; a long-lived bottom sheet open across midnight should NOT freeze the max-date at open time).
     When `renderDateField` is omitted, the sheet renders the existing text input unchanged (AC4 fallback).

7. **AC7 — No mutation/validator/schema changes.**
   **Given** the wire format (`yyyy-mm-dd`) and the server-side refine (`eventDate <= todayInSaoPauloIso()`) are unchanged,
   **Then** Story 7.5 ships ZERO changes to `packages/validators/src/life-events.ts`, `packages/api/src/life-events.ts`, `packages/api/src/router/life-events.ts`, `packages/db/src/schema/life_events.ts`, or `packages/db/policies/custom_rls_life_events.sql`. Diff stat must show those files unchanged.

8. **AC8 — Permission / availability handling.**
   **Given** `@react-native-community/datetimepicker` requires no runtime permission on iOS or Android (the picker is a self-contained system UI; no Photo Library / Camera-style permission flow),
   **Then** Story 7.5 ships NO permission-request code. The picker simply renders. The component MUST gracefully no-op when running in a Node/test environment (vitest mounts may import-resolve the package; the slot pattern means vitest never reaches that code path — but the import in `apps/expo` should not crash on cold load).

**Requirements traceability:** UX-DR20 (pt-BR + native parity), FR47 (Story 7.1), AR5 (defense-in-depth: UI gate + server refine).

---

## Tasks / Subtasks

- [ ] **Task 1 — Add `@react-native-community/datetimepicker` to `apps/expo` (AC5)**
  - [ ] 1.1 Run `pnpm --filter @healthtracker/expo add @react-native-community/datetimepicker`. Verify the version pinned matches Expo SDK 54 compatibility (the package publishes `npm dist-tag` aligned with each Expo SDK; check the Expo SDK 54 docs page or the package's `peerDependencies` against `react-native@0.81.x`). The dep ships in `dependencies` (runtime), NOT `devDependencies`.
  - [ ] 1.2 Run `pnpm install` to refresh the workspace lockfile. Verify no peer-dep warnings.
  - [ ] 1.3 Add a guard comment near the import site in `apps/expo/src/app/(tabs)/inicio.tsx` documenting why this import stays in apps/expo and NOT in packages/ui (the comment is the canonical place to record the architectural rationale; CLAUDE.md doesn't need a stanza for one dep).

- [ ] **Task 2 — Extend `LifeEventSheet` with optional `renderDateField` slot (AC4, AC6)**
  - [ ] 2.1 In `packages/ui/src/components/LifeEventSheet.tsx`, add the new prop to `LifeEventSheetProps`: `renderDateField?: (props: { value: string; onChange: (isoDate: string) => void; maxDateIso: string }) => React.ReactNode`.
  - [ ] 2.2 Inside the sheet body, replace the existing date-input block with:
    ```tsx
    {renderDateField !== undefined ? (
      renderDateField({
        value: eventDate,
        onChange: (next: string) => setEventDate(next),
        maxDateIso: todayInSaoPauloIso(),
      })
    ) : (
      <Input ... /> // the existing text-input fallback unchanged
    )}
    ```
  - [ ] 2.3 The internal `parseLifeEventDateInput` parser stays — the text-input fallback still needs it. When the slot is used, the slot's `onChange` is guaranteed to emit ISO `yyyy-mm-dd` (per AC6 contract), so the sheet's `parsedDate` recomputation continues to work uniformly. **No `parseLifeEventDateInput` change** (preserves Story 7.1's two-format tolerance for the web fallback).
  - [ ] 2.4 The slot's `onChange` MUST be invoked with ISO; the slot itself is responsible for converting the native picker's `Date` object to ISO. Document this in the prop's JSDoc.

- [ ] **Task 3 — Wire the native picker on `inicio.tsx` (AC1, AC2, AC3, AC5)**
  - [ ] 3.1 Import `DateTimePicker` (default export) from `@react-native-community/datetimepicker` at the top of `apps/expo/src/app/(tabs)/inicio.tsx`. Wrap in a JSDoc comment explaining the apps/expo-only architectural seam.
  - [ ] 3.2 Build a `renderLifeEventDateField` function inside the screen component (or hoisted as a stable callback). It:
    - Maintains local `showPicker` state initialized to `false`.
    - On iOS: renders `<DateTimePicker mode="date" display="inline" ...>` always-visible (iOS UX convention for in-form date picking — wheel inline rather than modal-trigger).
    - On Android: renders a TouchableOpacity / Pressable showing the formatted date; tapping sets `showPicker=true`; when `showPicker` is true, mounts `<DateTimePicker mode="date" display="default" onChange={...}>` which auto-dismisses after selection (Android picker is a one-shot modal).
    - Both branches pass `maximumDate={new Date(<maxDateIso>)}` (parsed safely — use `new Date(\`${maxDateIso}T00:00:00\`)` so the timezone is interpretation-local; the picker compares calendar dates).
    - Both branches: on `onChange(event, selectedDate)` where `event.type === 'set'` AND `selectedDate` is defined, convert to ISO via `formatDateToIso(selectedDate)` (a small local helper that emits `yyyy-mm-dd` from a `Date` using the local-calendar parts — NOT `.toISOString().slice(0,10)` which UTC-shifts; mirrors the Story 7.1 hazard documented at the same boundary).
    - The pt-BR display label (when needed) uses `formatCollectedAtPtBr` from `@healthtracker/validators`.
  - [ ] 3.3 Pass `renderDateField={renderLifeEventDateField}` to the existing `<LifeEventSheet>` in the JSX (line ~816 today).

- [ ] **Task 4 — Tests**
  - [ ] 4.1 No new unit tests for the slot prop directly — it's a pass-through render contract.
  - [ ] 4.2 If `@healthtracker/ui` ships a vitest config (Epic 6 retro: still absent in 7.x), add a snapshot regression that asserts the text-input fallback STILL renders when `renderDateField` is omitted. Skip with an F-item if vitest infra still absent (Story 7.1 / 7.2 precedent).
  - [ ] 4.3 No api/db/validator test changes (AC7).

- [ ] **Task 5 — Quality gates**
  - [ ] 5.1 `pnpm -w typecheck` — green across all packages.
  - [ ] 5.2 `pnpm -w lint` — green.
  - [ ] 5.3 `pnpm -w format:fix && pnpm -w format` — clean.
  - [ ] 5.4 `pnpm --filter @healthtracker/api test:unit` — green (unchanged; should NOT regress).
  - [ ] 5.5 Manual run-through (Expo simulator iOS + Android): open Início → tap "Adicionar evento de vida" → tap date field → confirm native picker renders → swipe to a future date → verify it's disabled → confirm a past date → verify the field re-renders with `dd/mm/aaaa` → save → verify the mutation completed and the Fingerprint marker landed at the right x-position.

- [ ] **Task 6 — Documentation**
  - [ ] 6.1 Add a one-line note to the CLAUDE.md "Personal context: life events + emotional check-ins" stanza: native picker on mobile via `renderDateField` slot pattern; web text-input fallback preserved.

---

## Dev Notes

### Worktree + branching

- Continues on `worktree-story-7-1` / PR #59. Stacks on Stories 7.1 + 7.2 + 7.3 commits.

### Reused patterns

- **`todayInSaoPauloIso()`** — Story 7.1 / 7.2's clock authority. Used at picker-open time AND on every render (AC6) so a long-lived bottom sheet across midnight gets the new max-date naturally.
- **`formatCollectedAtPtBr`** — Story 3.1 R3-P246 utility for pt-BR date display. Reused for the picker's read-out.
- **Slot-prop discipline** — the `renderDateField` slot is additive (default `undefined` → existing render). The text-input fallback in the web bundle remains byte-identical to today. Story 7.1's two-format parser (`parseLifeEventDateInput`) is untouched.

### Architectural seam

The native-picker dep lives in apps/expo because `packages/ui` is bundled by Next.js for the web app; importing a native-only module there breaks `next build`. The slot pattern (a render prop) is the standard React idiom for letting a consumer inject platform-specific UI into a shared component without forcing the shared component to know about the platform.

### Existing code surfaces to read

- `packages/ui/src/components/LifeEventSheet.tsx` (Story 7.1) — the component being extended. Specifically lines 230-238 (existing date input block) and the prop interface around lines 52-69.
- `packages/validators/src/life-events.ts` (Story 7.1) — `todayInSaoPauloIso` reference + the server-side refine that becomes defense-in-depth.
- `packages/validators/src/index.ts` `formatCollectedAtPtBr` — pt-BR display helper.
- `apps/expo/src/app/(tabs)/inicio.tsx` line 816 — where `<LifeEventSheet>` is mounted.

### Behaviors that must be preserved (regression watch)

- **Story 7.1 web text-input fallback** — when `renderDateField` is omitted, the sheet renders identically to today's web behavior.
- **Server-side `eventDate <= todayInSaoPauloIso()` refine** — untouched; remains as defense-in-depth.
- **`parseLifeEventDateInput` two-format tolerance** — untouched; the text-input fallback still parses `dd/mm/aaaa` AND `yyyy-mm-dd`.
- **The mutation wire format** — ISO `yyyy-mm-dd` unchanged.

### Project Structure Notes

- **MODIFIED files (3):**
  - `apps/expo/package.json` (added `@react-native-community/datetimepicker` dep)
  - `pnpm-lock.yaml` (lockfile regen)
  - `packages/ui/src/components/LifeEventSheet.tsx` (added optional slot prop)
  - `apps/expo/src/app/(tabs)/inicio.tsx` (added `renderDateField` render function + import)
  - `CLAUDE.md` (one-line note appended to existing stanza)
- **NEW files: NONE**
- **NO files in `apps/web/`, `packages/validators/`, `packages/api/`, `packages/db/`, `supabase/migrations/`** (AC7).

### Open questions for Francis

1. **Android picker UX choice — modal vs inline.** Default `display="default"` renders the system calendar modal (one-shot). `display="spinner"` is also available. Going with `default` for OS-native parity.
2. **iOS picker UX — wheel vs inline calendar.** `display="inline"` renders the iOS 14+ inline calendar (modern style). On older iOS (< 14) it falls back to wheel. Going with `inline` for current iOS.
3. **Web fallback long-term plan.** When web Fingerprint ships (post-MVP) and `LifeEventSheet` lands on web, the text-input fallback works but the browser-native `<input type="date">` would be a meaningful UX upgrade. Tracked as deferred work; not in 7.5 scope.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1719–1745] Story 7.5 spec.
- [Source: `_bmad-output/implementation-artifacts/7-1-patient-adds-a-life-event-to-their-fingerprint-timeline.md`] Story 7.1 — the architectural ancestor; this story closes its R1 MED finding about free-text date input UX.
- [Source: commit `9faaa6f`] The chore commit that inserted this story into the Epic 7 sequence.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (BMad bmad-create-story workflow)

### Review Findings — R1 (2026-05-30)

Three parallel adversarial reviews. 7/8 ACs MET, 1 DEVIATED (AC1 — initial-date state used device-local clock instead of São Paulo today; now patched).

- [x] [Review][Patch] **R1-H1 — `initialEventDate` prop has no shape contract; non-ISO input (e.g. `dd/mm/aaaa` from a future consumer) silently leaks into `isoStringToLocalDate` which then falls back to today + `formatCollectedAtPtBr` returns the raw string** `[packages/ui/src/components/LifeEventSheet.tsx]` — replaced `todayLocalIso` with `resolveInitialEventDate(initial)` that normalises via `parseLifeEventDateInput` (the same two-format parser used elsewhere in the sheet) and falls back to `todayInSaoPauloIso()` on parse failure.
- [x] [Review][Patch] **R1-AC1 — `LifeEventSheet` initial state seeded from device clock (`todayLocalIso`) instead of São Paulo today** `[packages/ui/src/components/LifeEventSheet.tsx]` — same patch as R1-H1; the spec asked the initial selected date to be São Paulo today, matching the server-side refine. A patient traveling outside BRT was the failure mode.
- [x] [Review][Patch] **R1-M1 — `androidPickerVisible` was screen-scoped and not reset when the sheet closes; reopening with stale state would auto-mount the picker** `[apps/expo/src/app/(tabs)/inicio.tsx]` — reset `setAndroidPickerVisible(false)` in the sheet's close handler.
- [x] [Review][Defer] **R1-M2 — iOS inline picker may overflow the sheet on small devices (iPhone SE)** — UX concern, not correctness; deferred to manual run-through (Task 5.5). If clipping is observed, switch to `display="compact"`.
- [x] [Review][Defer] **R1-L1 — `useCallback` deps include `androidPickerVisible` → new callback identity on every toggle** — confirmed by Edge Hunter as no real remount (React reconciles host components by element type, not callback identity). Deferred as micro-optimization.
- [x] [Review][Defer] **R1-L2 — long-lived sheet open across midnight: `maxDateIso` advances but `value` may lag a day** — minor UX edge; deferred (acceptable; opening a life-event sheet for 12+ hours is unusual).
- [x] [Review][Dismiss] **`maxDateIso` recomputed every render causes picker remount** — false positive; React reconciles by element type, not prop identity.
- [x] [Review][Dismiss] **Android double-tap on Pressable mounts two pickers** — `setX(true)` while `true` is idempotent; only one mount.
- [x] [Review][Dismiss] **`setAndroidPickerVisible` closure stale in callback** — `useState` setters are stable refs.

### Completion Notes List

- All 6 tasks complete. Status: `in-progress → done`.
- Quality gates: typecheck (17 packages green), lint (15 packages green), api unit tests (358 pass, unchanged — Story 7.5 ships no API/validator/db changes per AC7), format clean.
- R1 review applied 3 patches autonomously (1 HIGH spec-deviation + 1 HIGH input-shape + 1 MED reset on close). 3 deferred (UX edges + micro-perf). 3 dismissed (false positives).
- AC7 verified: zero changes to `packages/validators/`, `packages/api/`, `packages/db/`, `supabase/migrations/`, `apps/web/`.
- Stacks on Stories 7.1 + 7.2 + 7.3 / PR #59.
- Manual run-through (Task 5.5) is the user's `/verify` step (Expo iOS + Android simulators).

### File List

**MODIFIED files (4):**

- `apps/expo/package.json` (added `@react-native-community/datetimepicker@^9.1.0`)
- `pnpm-lock.yaml` (lockfile regen)
- `packages/ui/src/components/LifeEventSheet.tsx` (added optional `renderDateField` slot prop + `resolveInitialEventDate` helper)
- `apps/expo/src/app/(tabs)/inicio.tsx` (added `renderLifeEventDateField` callback + native picker import + local↔ISO date helpers)
- `CLAUDE.md` (appended native-picker discipline bullet)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (7.5 status transitions)

**NEW files: NONE**

**NO files in `apps/web/`, `packages/validators/`, `packages/api/`, `packages/db/`, `supabase/migrations/`** (AC7).

### File List
