# Story 4.2: Patient re-reads a previously generated Letter

Status: ready-for-dev

> **Builds on Story 4.1.** Reuses the `LetterReader` route, `letters` schema, SSE re-open path, and `letter.read` audit kind that 4.1 landed. This story is a thin wiring layer: a new tRPC procedure that maps a `(collected_at, lab_name)` draw → its `(letterId, status)`, plus a "Ler carta" entry point on the Histórico draw-detail screen. No new schema. No new push notifications. No changes to `services/llm`. **Stacked on PR #54 (Story 4.1 branch)** — do not merge until 4.1 is on `main`.

## Story

**As a** patient,
**I want** to re-read any Letter that was previously generated for a past draw,
**so that** I can refer back to narrative context at any time, not just when it first arrives.

## Acceptance Criteria

1. **AC1 — "Ler carta" surfaces on the draw detail.** Given the patient navigates to the Histórico tab and taps a completed draw, when the draw detail view loads, then a new tRPC query `letter.getForDraw({collectedAt, labName})` resolves; if it returns `{letterId, status: 'complete'}`, the screen renders a "Ler carta" button (pt-BR constant `LETTER_READ_CTA_PT_BR` — already authored in 4.1's validators).

2. **AC2 — Re-read renders the stored body, no LLM call.** When the patient taps "Ler carta", `router.push(CARTA_ROUTE(letterId))` opens the Story 4.1 `LetterReader` route. The LetterReader's `use-letter-stream` hook connects to the SSE endpoint, which detects `letters.status === 'complete'` AND `letters.body !== null` and replays the cached body as a single `type:"token"` event followed by `type:"done"` (Story 4.1 `services/llm/src/routes/letter-stream.ts` lines ~93–98). **No Anthropic call is made** for a re-read — this branch returns before subscribing to the in-process fan-out.

3. **AC3 — `letter.read` audit on re-read.** Given the Letter is opened for re-reading, when the SSE endpoint authenticates and resolves the owner check, then an `audit_log` row with `event='letter.read'`, `actor_id=patientId`, `actor_type='patient'`, `resource_id=letterId`, `resource_type='letter'` is written before headers are flushed. This is the existing 4.1 behavior — Story 4.2 must NOT add a parallel audit write at the tRPC layer (would double-count; Story 4.1's `letter.read` audit is the single source of truth per the 4.1 router docblock).

4. **AC4 — "Preparing" surface when the Letter is not yet complete.** Given the LLM service was unavailable when the Letter was originally triggered (`letters.status IN ('queued', 'generating', 'failed')`), when the patient lands on the draw detail, then in place of the "Ler carta" button, the screen renders the inline message `LETTER_PREPARING_RETRY_PT_BR` ("Sua carta está sendo preparada. Você receberá uma notificação quando estiver pronta.") with `accessibilityRole="alert"`. No button is shown (the patient cannot open the LetterReader for a non-complete letter from this surface; preventing a confusing empty/loading reader render). Add this constant to `packages/validators/src/index.ts` in this story.

5. **AC5 — No regression on draw detail.** All Story 3.1 / 3.3 behaviour on `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` is preserved byte-for-byte: existing BiomarkerCard list, draw-not-found copy (R1-P241), back button (R2-P245), date formatting (R3-P246). The Letter section appends at the bottom of the existing layout, NOT in the middle of the biomarker list.

6. **AC6 — Cross-patient safety.** The new `letter.getForDraw` tRPC procedure is `protectedProcedure` (RLS-scoped). Foreign-patient `letters` rows MUST NOT be reachable. The procedure does NOT take `patientId` as input (Story 3.x discipline — `patientId = ctx.session.user.id` is the only safe source). Returns `null` when no Letter exists for the draw (this is a normal case — most pre-4.1 draws have no Letter; new draws on the free tier also have no Letter).

7. **AC7 — Multi-upload draw handling.** A single draw `(collected_at, lab_name)` can have multiple associated `uploads` rows (patient uploaded same lab report twice). The query joins `letters → uploads → observations` and picks the **most recent** `letters` row (`ORDER BY created_at DESC LIMIT 1`). The button always opens the same canonical Letter; we do not render multiple "Ler carta" buttons for one draw (a Letter is per-draw narrative, not per-upload).

## Tasks / Subtasks

> Plan: 1) tRPC procedure → 2) validators copy → 3) wire draw detail → 4) tests.

- [ ] **T1. tRPC: `letter.getForDraw` query.** (AC: 1, 4, 6, 7)
  - [ ] T1.1 Add a helper `getLetterForDraw(database, args)` to `packages/api/src/letters.ts`. Signature: `{patientId: string, collectedAt: string (yyyy-mm-dd), labName: string (empty string = null sentinel, mirroring Story 3.1 `historicoDrawDetailRoute` semantics)}` → `Promise<{letterId: string, status: 'queued'|'generating'|'complete'|'failed'} | null>`.
  - [ ] T1.2 SQL via Drizzle:
    ```ts
    // join letters → uploads to filter by (collected_at, lab_name)
    // collected_at comes from observations rows; uploads.lab_name is set
    // by the extraction worker's F141 dispatcher.
    const rows = await database
      .select({
        id: Letters.id,
        status: Letters.status,
        createdAt: Letters.createdAt,
      })
      .from(Letters)
      .innerJoin(Uploads, eq(Letters.uploadId, Uploads.id))
      .innerJoin(Observations, eq(Observations.uploadId, Uploads.id))
      .where(
        and(
          eq(Letters.patientId, args.patientId),
          eq(Observations.patientId, args.patientId),
          eq(Observations.collectedAt, args.collectedAt),
          // labName "" sentinel ↔ uploads.lab_name IS NULL
          args.labName === ""
            ? isNull(Uploads.labName)
            : eq(Uploads.labName, args.labName),
        ),
      )
      .orderBy(desc(Letters.createdAt))
      .limit(1);
    ```
    The double `patientId` predicate is defense-in-depth — RLS is the primary boundary but the explicit predicate makes the SELECT plan stable and avoids accidental cross-patient joins if RLS context is ever misconfigured.
  - [ ] T1.3 Add `getForDraw` to `packages/api/src/router/letter.ts` as a `premiumProcedure.input(...).query`. Input schema: `z.object({collectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), labName: z.string()})`. **Do not** decode/encode `labName` — the caller passes the raw value Story 3.1's `historicoDrawDetailRoute` packs into the URL.
  - [ ] T1.4 **No** `letter.read` audit write at this layer (avoid double-count with Story 4.1's SSE-endpoint audit). The query is a metadata lookup, not a content read.

- [ ] **T2. Validators copy — `LETTER_PREPARING_RETRY_PT_BR`.** (AC: 4)
  - [ ] T2.1 Append to `packages/validators/src/index.ts` Story 4.1 section (after `LETTER_READ_CTA_PT_BR`):
    ```ts
    /**
     * Story 4.2 AC4 — copy shown on the draw-detail screen when a Letter
     * row exists for the draw but `status !== 'complete'` (queued,
     * generating, failed). Distinct from `LETTER_UNAVAILABLE_PT_BR`
     * (Story 4.1, "demorando" register): this surface promises a future
     * notification rather than asking the patient to retry.
     */
    export const LETTER_PREPARING_RETRY_PT_BR =
      "Sua carta está sendo preparada. Você receberá uma notificação quando estiver pronta.";
    ```
  - [ ] T2.2 Update Story 4.1's `LETTER_NOTIFICATION_TITLE_PT_BR` audit reference comment block — no copy change. (Sanity check that the existing "letter_ready" push aligns with AC4's "receberá uma notificação" promise.)

- [ ] **T3. Draw detail screen wiring.** (AC: 1, 4, 5)
  - [ ] T3.1 Open `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx`. Add a `useQuery` call for `letter.getForDraw` keyed on `({collectedAt, labName})`, ENABLED only when `collectedAt` is a non-empty string AND `draw` exists in the cached `getRecord` payload (avoid firing the query for unreachable draws):
    ```ts
    const letterQuery = useQuery(
      trpc.letter.getForDraw.queryOptions(
        { collectedAt: collectedAt ?? "", labName: labParam },
        { enabled: Boolean(collectedAt) && Boolean(draw) },
      ),
    );
    ```
  - [ ] T3.2 Below the BiomarkerCard map (`AC5` — append, do not interleave), render exactly ONE of:
    - `letterQuery.data?.status === 'complete'` → `<Button onPress={() => router.push(CARTA_ROUTE(letterQuery.data.letterId))}>{LETTER_READ_CTA_PT_BR}</Button>`
    - `letterQuery.data !== null && letterQuery.data?.status !== 'complete'` → `<Text accessibilityRole="alert">{LETTER_PREPARING_RETRY_PT_BR}</Text>`
    - `letterQuery.data === null` → render NOTHING (most pre-Epic-4 draws + free-tier draws). Silent absence is the correct UX — do NOT advertise the feature to free-tier patients on this surface (Story 4.3 / Premium upsell owns that path).
  - [ ] T3.3 Loading state: while `letterQuery.isLoading`, render nothing in the Letter slot. The button appearing 200ms after the draw detail mounts is fine; the spinner under the existing biomarker list would be visual noise (Epic 2 retro § preparation gaps — over-loading-indicator pattern).
  - [ ] T3.4 Error state: on `letterQuery.isError`, render nothing in the Letter slot AND console.warn (Sentry will pick it up). The draw detail must remain functional for the BiomarkerCard list even when the Letter lookup fails (NFR-I3 — LLM-adjacent failure must not block patient observation reads).

- [ ] **T4. Tests.** (AC: all)
  - [ ] T4.1 Unit (vitest) for `getLetterForDraw` helper in `packages/api/__tests__/letters.test.ts` (NEW): the four shapes — happy path (`status='complete'` returns id + status), preparing (`status='generating'` returns id + status), no Letter (returns null), cross-patient leak attempt (foreign patientId returns null even with matching collectedAt). Mock the Drizzle query chain following the pattern in `packages/api/__tests__/observations-record.test.ts`.
  - [ ] T4.2 Unit (vitest) for the multi-upload tie-break in T4.1 — two `letters` rows for the same `(patientId, collectedAt, labName)` → returns the most recent by `createdAt`.
  - [ ] T4.3 Mobile snapshot/behavior test for `[collectedAt].tsx` is **not** added — `@testing-library/react-native` isn't wired in `apps/expo` (Story 3.x retro acknowledgment); manual QA covers AC5 visual no-regression. F-item to add RN testing infra remains deferred.
  - [ ] T4.4 Re-use Story 4.1's `LETTER_DIAGNOSTIC_PHRASE_REGEX` — verify no regression on the regex constant (no functional change in 4.2; reading-level retro on the existing string).

## Dev Notes

### Architecture references

- `_bmad-output/planning-artifacts/epics.md` §"Story 4.2" lines 1125–1149 — verbatim ACs.
- `_bmad-output/planning-artifacts/architecture.md` §15 (Gap 1 resolution, line 1450) — `letters` schema is the read source.
- Story 4.1 dev record: `4-1-patient-receives-a-streamed-letter-narrative-after-a-draw-is-confirmed.md` — every artifact mentioned in 4.2 was either added or extended there.
- Story 3.1 dev record: `3-1-patient-views-their-complete-longitudinal-biomarker-record.md` — `(collectedAt, labName)` grouping semantics; `""` empty-string sentinel for null lab.

### Patterns to copy (don't reinvent)

- **`premiumProcedure` from Story 4.1** (`packages/api/src/middleware/entitlements.ts`) — wraps `getForDraw`. Free-tier patients get `PRECONDITION_FAILED / PREMIUM_REQUIRED` for free; the mobile draw-detail handles the resulting tRPC error by rendering nothing (matches AC1's "if a Letter exists" gate — for free tier, semantically equivalent to "no Letter").
- **Story 3.1 `(collectedAt, labName)` route shape** — `historicoDrawDetailRoute(collectedAt, labName)` is the producer; `[collectedAt].tsx` reads via `useLocalSearchParams`; Story 4.2 reuses these props verbatim.
- **Story 3.4 R2-P275 cross-patient cache leak** — if `letter.getForDraw` ever lands in the persisted cache whitelist (currently it isn't), the SIGNED_OUT `queryClient.removeQueries` must include it. As of 4.2, `letter.getForDraw` is NOT in `shouldPersistQuery` — it refetches on each draw-detail mount, which is acceptable for low-volume metadata.
- **Story 4.1 SSE re-open path** — `services/llm/src/routes/letter-stream.ts` already handles re-read by replaying `letters.body` as a single token + done event. AC2's "no LLM call" requirement is satisfied by that early-return; do NOT duplicate the body-fetch logic at the tRPC layer.

### Story 4.1 review findings — DO NOT inherit

Story 4.1's PR #54 surfaced 5 critical/high code-review findings. Story 4.2 must NOT extend or re-trigger any of them:

- F1 (dedup index keyed wrong) — N/A; 4.2 doesn't write to `audit_log.letter.queued` or `letters`.
- F2 (23505 catch aborts Drizzle tx) — N/A; 4.2's helper is a SELECT only.
- F3 (worker tx blocks upload) — N/A; 4.2 doesn't touch the worker.
- F4 (`onDone` IIFE) — N/A; 4.2 doesn't change the consumer.
- F5 (boss.work serial) — N/A; 4.2 doesn't enqueue Letters.

The 4.2 dev SHOULD review the 4.1 PR comments before starting so the planned 4.1 fixes don't conflict with 4.2's wiring (especially if 4.1's `letter.getStatus` or `letter.getForDraw` shape lands as part of the F-fix).

### Anti-patterns explicitly forbidden in 4.2

- Do **not** add a parallel `letter.read` audit write at the tRPC layer (AC3 already satisfied by SSE endpoint; would double-count).
- Do **not** inline pt-BR strings; the new copy goes in `packages/validators` (Epic 2 retro discipline).
- Do **not** persist the `letter.getForDraw` query into the React Query persister (Story 3.4 invariant — Letter metadata is fresh-fetch only).
- Do **not** render multiple "Ler carta" buttons for one draw (AC7 — one button per `(collected_at, lab_name)`).
- Do **not** open the LetterReader for `status !== 'complete'` (AC4 — show the preparing message instead; opening the reader for a queued/generating letter would show the connecting/error states from Story 4.1, which use different copy).
- Do **not** auto-encode `labName` again — the URL-encoding lives in `historicoDrawDetailRoute`; the draw-detail screen already receives the decoded value from `useLocalSearchParams`.
- Do **not** add a fallback that retries `letter.getForDraw` on error — Sentry capture is sufficient; the draw detail must remain functional without it.

### Project Structure Notes

- `packages/api/src/letters.ts` — adds one new exported helper (`getLetterForDraw`); existing `enqueueLetterGeneration` + `getLetterStatusForPatient` are untouched.
- `packages/api/src/router/letter.ts` — adds one new `getForDraw` procedure; existing `getStatus` is untouched.
- `packages/validators/src/index.ts` — append `LETTER_PREPARING_RETRY_PT_BR` only.
- `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` — add one `useQuery` call and one conditional render block. No file moves, no helper extractions.

No structural conflicts. No new dependencies.

### Testing standards summary

- API unit: `packages/api/__tests__/letters.test.ts` (NEW). Vitest, mock Drizzle, follow `observations-record.test.ts` shape.
- Manual QA path: cold-start mobile, seed a `letters` row for an existing draw via psql, open Histórico → draw → verify "Ler carta" → tap → LetterReader renders body. Repeat with `status='generating'` and verify the preparing message appears.
- Test integration (Letter creation) is out of scope — Story 4.1 owns the write path.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2 lines 1125–1149]
- [Source: _bmad-output/planning-artifacts/architecture.md#letters schema gap 1 lines 1450–1463]
- [Source: _bmad-output/implementation-artifacts/4-1-patient-receives-a-streamed-letter-narrative-after-a-draw-is-confirmed.md]
- [Source: apps/expo/src/app/(tabs)/historico/[collectedAt].tsx — Story 3.1 draw detail to extend]
- [Source: packages/validators/src/index.ts — `historicoDrawDetailRoute` and Story 4.1 `LETTER_*` constants]
- [Source: services/llm/src/routes/letter-stream.ts:93–98 — cached-complete SSE re-open path that AC2 relies on]
- [Source: packages/api/src/middleware/entitlements.ts — `premiumProcedure` for AC6]

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Known infra blockers

None new for 4.2. Inherits Story 4.1's blockers (Anthropic DPA, Railway, ANTHROPIC_API_KEY, JWT subscriptionTier) but does not require any of them to be resolved — re-read works against any pre-existing `letters.body`, including the Story 4.1 stub adapter's placeholder body.
