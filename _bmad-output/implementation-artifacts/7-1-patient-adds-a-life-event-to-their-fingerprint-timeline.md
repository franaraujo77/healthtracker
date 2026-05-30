# Story 7.1: Patient adds a life event to their Fingerprint timeline

Status: ready-for-dev

<!-- First story of Epic 7 ("Patient Adds Personal Context to Their Record"). -->
<!-- Auto-promotes `epic-7: backlog → in-progress` in sprint-status. -->
<!-- Establishes the patient-personal-context architectural patterns (table naming, `privacy_flag = 'patient_only'` invariant, audit kinds, RLS predicate template) that Stories 7.2 / 7.3 / 7.4 will reuse. -->
<!-- This worktree (`worktree-story-7-1`) is a FRESH branch off `main@fc74f7c` — NOT stacked on any open PR. New PR per the Epic 7 plan; the stacked-PR pattern resumes only if Story 7.2 lands on top of this. -->

## Story

As a **patient**,
I want **to add life events (e.g. "started iron supplementation", "marathon training block") to my Fingerprint timeline, with retroactive dates and an optional category tag**,
so that **I can mark personal context that may explain changes in my trends and understand the story behind the data — not just the numbers, and never share that context with any doctor unless I explicitly opt in later**.

## Acceptance Criteria

> Lifted verbatim from `_bmad-output/planning-artifacts/epics.md` lines 1585–1603, then expanded with implementation-contract ACs (5–11) that lock the Epic 7 architectural decisions taken at story-creation time.

1. **AC1 — Entry sheet from the Fingerprint view.**
   **Given** I am viewing the Fingerprint chart on the Início tab,
   **When** I tap **"Adicionar evento de vida"** (a NEW Tier-2 CTA below the chart),
   **Then** a Tamagui `Sheet` (bottom sheet, dismissible by swipe-down per UX-DR § "Modal bottom sheets") opens with three inputs in pt-BR:
   - **Description** — `TextArea`, free text, **max 140 chars** (hard cap; live counter shows `n/140`).
   - **Event date** — `DateTimePicker` allowing **retroactive entry** (any date `<= today`; no future dates).
   - **Category tag (optional)** — picker over a closed enum of pt-BR labels (see AC9): one of `Medicamento` / `Alimentação` / `Atividade física` / `Estresse` / `Sono` / `Doença` / `Outro`.
     The sheet's primary CTA is **"Salvar evento"**; secondary is **"Cancelar"**. State is preserved on dismiss-by-swipe for 24h per the modal-bottom-sheet convention (re-opening within 24h restores the in-progress entry).

2. **AC2 — Save persists with `privacy_flag = 'patient_only'` by default and is invisible to any doctor view.**
   **Given** I save a life event,
   **When** it is stored,
   **Then** a row is inserted into `life_events` with: `patient_id` = `ctx.session.user.id`, `event_date` (DATE column, NO TIMESTAMPTZ — mirrors `observations.collected_at` per architecture.md line 70), `description`, `category` (nullable enum), and `privacy_flag = 'patient_only'` (NEW pgEnum `life_event_privacy_enum` with values `patient_only` and `shared_explicit`; **only `patient_only` is writable in Story 7.1** — `shared_explicit` is a forward-compat slot for a future story and rejected by Zod refine until then).
   **And** the row never appears in any doctor RLS scope: no `share_token_biomarkers` / `share_tokens` predicate touches `life_events`, and the table ships **no doctor RLS policy at all** (denial-by-RLS-absence pattern — mirrors `staleness_thresholds` which has no patient-side SELECT policy; AC8 RLS matrix locks this).

3. **AC3 — Life event renders as a marker on the Fingerprint when the relevant time period is in view.**
   **Given** I have at least one saved life event AND `drawCount >= 2` (the `baseline-established` chart state from Story 3.3 is the only Fingerprint that has an x-axis time scale to mark — Story 3.2's `cold-start-1` single-draw state has no timeline; AC3 does NOT render in cold-start),
   **When** the `FingerprintChart` in `baseline-established` state renders,
   **Then** each life event with `event_date` within the rendered window appears as a **vertical marker line** on the x-axis (Victory Native v41 `Line` annotation), labelled with the **description truncated to 32 chars + ellipsis** (pt-BR). The label is visible without taps. Markers use the Tamagui token `$lifeEventMarker` (NEW token — neutral teal-grey `#5C7A7A`, AA contrast on `$surfaceElevated`; **NEVER amber, NEVER red** — life events are neutral context, not alerts; UX-DR contrast rules).
   **And** when multiple events fall on the same `event_date`, markers stack vertically and the label shows the **count** (e.g. `"3 eventos em 12/03/2024"`).

4. **AC4 — `writeAuditLog()` records `life_event.created`.**
   **Given** the `lifeEventsRouter.createLifeEvent` resolver writes the row,
   **When** it completes successfully inside the `protectedProcedure` transaction,
   **Then** exactly **one** `writeAuditLog` row is appended with:
   - `event = 'life_event.created'` (NEW audit kind constant `LIFE_EVENT_AUDIT_CREATED` in `@healthtracker/validators`)
   - `actorType = 'patient'`, `actorId = patientId`
   - `resourceType = 'life_event'`, `resourceId = lifeEvent.id`
   - `metadata = { eventDate: <yyyy-MM-dd string>, category: <enum or null> }` — **description is NOT in metadata** (PII hygiene; the audit log is patient-visible via Story 5.3's Access Log surface, but more importantly the description may contain sensitive personal context like medication names; mirrors Story 5.5's PII discipline in export metadata).
     The write lives inside the same Drizzle transaction as the `INSERT INTO life_events` (atomicity contract — Story 3.1 AC4 pattern).

5. **AC5 — `life_event.created` is NOT added to `ACCESS_LOG_EVENT_KINDS`.**
   **Given** life events are private patient-authored data with `privacy_flag = 'patient_only'`,
   **Then** the constant `LIFE_EVENT_AUDIT_CREATED` is **deliberately excluded** from `ACCESS_LOG_EVENT_KINDS` in `packages/validators/src/sharing.ts`. The Access Log (Story 5.3 Acessos tab) surfaces only **share-related** events — life events are not access events; they're personal annotations. Surfacing `life_event.created` would confuse the doctor-access narrative the Acessos tab establishes. (Same rationale as `staleness_threshold.updated` from Story 6.5 — doctor-side preferences also do not surface to the Access Log.)

6. **AC6 — Description Zod hardening + retroactive-only date refinement.**
   **Given** the resolver receives raw input,
   **Then** the Zod schema enforces:
   - `description: z.string().trim().min(1, "Descrição obrigatória").max(140, "Máximo 140 caracteres")` — `trim()` BEFORE the min/max check so whitespace-only input rejects.
   - `eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((iso) => iso <= todayInPatientTzIso(), { message: "Data não pode estar no futuro" })` — date-string compare (lexicographic on `yyyy-MM-dd`). The "today" reference is computed via the existing `collected-at.ts` `todayInSaoPauloIso()` helper (UTC offset normalisation; mirrors Story 2.7's BIA date discipline; Epic 6 R1 carry-forward: "resolver-time clock authority").
   - `category: z.enum(LIFE_EVENT_CATEGORIES).nullable()` — closed enum; unknown values reject.
   - `privacyFlag: z.literal("patient_only")` — Story 7.1 is the only writable shape; `shared_explicit` is a future-story slot rejected at Zod boundary.

7. **AC7 — Soft-delete semantics are reserved for a future story (NOT implemented here).**
   **Given** Epic 7's mutability is scoped to **create** only for Story 7.1 (per epic spec: AC blocks 1–4 cover create; update / delete deferred to a future Epic 7 story or out-of-scope),
   **Then** the `life_events` table ships **without** a `deleted_at` column. If a future story adds edit/delete, it ships an additive migration. **Do not** anticipate by pre-adding the column — Epic 6 R1 carry-forward: "schema-anticipation slips" (Story 6.5 originally added forward-compat columns that R1 cut). The Drizzle schema may include a `// FUTURE-WORK:` comment for clarity, but no column.

8. **AC8 — Defensive RLS matrix (4 identities × 5 ops) locks the `life_events` invariant.**
   **Given** `life_events` is the first Epic 7 patient-personal-context table,
   **Then** a RLS test file `packages/db/__tests__/rls/life-events.rls.test.ts` exercises the 4-identity matrix below for each of `{SELECT, INSERT, UPDATE, DELETE, anonymous}`:
   - `OWNING_PATIENT` (`app.current_patient_id = patient_id`) — SELECT: 1 row; INSERT: succeeds; UPDATE/DELETE: 0 rows affected (no patient-side write policy beyond INSERT).
   - `OTHER_PATIENT` (different `app.current_patient_id`) — SELECT: 0 rows; INSERT: succeeds against own `patient_id` only; UPDATE/DELETE: 0 rows affected.
   - `DOCTOR_WITH_SHARE_TOKEN` (`app.current_share_token_id` bound, token points at `OWNING_PATIENT`) — SELECT: **0 rows** (the invariant — doctor can never see life events even when authorised to read biomarkers); INSERT/UPDATE/DELETE: 0 rows affected (no doctor policies exist).
   - `SERVICE_ROLE` (RLS bypass) — full access (the seed path for tests and the future analytics path).
     **And** the matrix is the load-bearing test for the "denial-by-RLS-absence" pattern: explicitly assert that an attempted doctor SELECT returns zero rows, not just that the query "doesn't error." Pattern carries forward to Stories 7.2 / 7.3 / 7.4.

9. **AC9 — Closed pt-BR category enum + label map.**
   **Given** the category picker needs a closed set and the audit metadata needs a stable enum value,
   **Then** a NEW pgEnum `life_event_category_enum` lands in `packages/db/src/schema/life_events.ts` with the seven values: `medication` / `nutrition` / `physical_activity` / `stress` / `sleep` / `illness` / `other`.
   **And** a NEW const in `packages/validators/src/life-events.ts` named `LIFE_EVENT_CATEGORIES` is the source of truth (`readonly` tuple typed via `z.enum(LIFE_EVENT_CATEGORIES)`). A `LIFE_EVENT_CATEGORY_LABELS_PT_BR` map adjacent in the same file holds the visible labels: `medication → "Medicamento"`, etc. **All UI surfaces import from `LIFE_EVENT_CATEGORY_LABELS_PT_BR` — never hard-code the pt-BR label** (Epic 5 R1 carry-forward: "greppable-copy regression" — every pt-BR literal lives in `@healthtracker/validators`).

10. **AC10 — Migration is deferred to a future Epic 7 batched-migration story.**
    **Given** Epic 7 follows the same batched-migration pattern as Epics 3 / 4 / 5 / 6 (Story 3.5 baseline, Story 4.4 / 6.6 incremental — the per-story Drizzle additive flow + final SQL migration story at end of epic),
    **Then** Story 7.1 ships **schema** (`packages/db/src/schema/life_events.ts`) + **RLS policy file** (`packages/db/policies/custom_rls_life_events.sql`) + **Drizzle export** (`packages/db/src/schema/index.ts`) — but **NO `supabase/migrations/*.sql` file**. Dev path: `pnpm db:push` (additive, safe per CLAUDE.md ops note); CI path: testcontainer integration auto-applies via `drizzle-kit push --force` + the `custom_rls_*.sql` file via `psql -f`. The consolidated Epic 7 migration is **deferred to a not-yet-planned Story 7.5** (see § "Open questions" — sprint-status.yaml does NOT list 7.5 today; this story will surface that gap to Francis at hand-off).

11. **AC11 — No web app surface this story.**
    **Given** Epic 7 is patient-mobile-first (the entry surface is the Fingerprint chart which today only lives on the Início tab in `apps/expo/`),
    **Then** Story 7.1 ships **no `apps/web/` route or component changes**. The `/inicio` web route mirrors Início but the Fingerprint marker rendering can be added in a follow-up if/when the web Fingerprint is built (Epic 3 retro noted "web Fingerprint is post-MVP"). The router and validators are platform-agnostic, so the web extension is a small additive task whenever it ships.

**Requirements traceability:** FR47, AR10 (audit log), UX-DR20 (pt-BR copy + WCAG AA contrast), NFR-S2 (RLS), NFR-S4 (audit append-only), AR5 (RLS as security boundary; app-layer is defense-in-depth).

---

## Tasks / Subtasks

- [ ] **Task 1 — Schema: `life_events` table + RLS policy (AC2, AC6, AC7, AC8, AC9, AC10)**
  - [ ] 1.1 Create `packages/db/src/schema/life_events.ts`. Define two pgEnums: `lifeEventPrivacyEnum` (`patient_only`, `shared_explicit`) and `lifeEventCategoryEnum` (the 7 values from AC9). **No `deleted_at` column** (AC7).
  - [ ] 1.2 Table columns: `id uuid pk defaultRandom`, `patientId uuid notNull references Users.id onDelete: 'cascade'` (Story 5.6 FK-cascade discipline — life events are patient-authored personal context; the patient deletes their account → life events go with them; cascade is the right semantic, NOT `set null`), `eventDate date('event_date', { mode: 'string' }).notNull()` (DATE not TIMESTAMPTZ — mirrors `observations.collected_at`), `description text notNull` (CHECK constraint at DB layer: `LENGTH(description) BETWEEN 1 AND 140`), `category lifeEventCategoryEnum('category')` (nullable), `privacyFlag lifeEventPrivacyEnum('privacy_flag').notNull().default('patient_only')`, `createdAt timestamptz notNull defaultNow()`.
  - [ ] 1.3 Index: `index('life_events_patient_date_idx').on(table.patientId, table.eventDate)`. This is the read-path for the Fingerprint marker query (`SELECT … WHERE patient_id = ? AND event_date BETWEEN ?lo AND ?hi`).
  - [ ] 1.4 Add `export * from "./life_events"` to `packages/db/src/schema/index.ts` (alpha-sorted between `letters` and `loinc_ref`).
  - [ ] 1.5 Create `packages/db/policies/custom_rls_life_events.sql`. Three statements only:
    ```
    ALTER TABLE "life_events" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "life_events_select_own" ON "life_events";
    CREATE POLICY "life_events_select_own" ON "life_events"
      FOR SELECT USING (patient_id::text = current_setting('app.current_patient_id', true));
    DROP POLICY IF EXISTS "life_events_insert_own" ON "life_events";
    CREATE POLICY "life_events_insert_own" ON "life_events"
      FOR INSERT WITH CHECK (patient_id::text = current_setting('app.current_patient_id', true));
    ```
    **No UPDATE / DELETE / doctor policy.** The absence is the denial. Add a header comment that documents the "denial-by-RLS-absence" pattern + cross-links to AC8 and the Epic 7 epic-level invariant ("life events never appear in any shared doctor view").
  - [ ] 1.6 Run `pnpm db:push` against dev DB; verify drift via `pnpm db:push --strict` reports zero pending.

- [ ] **Task 2 — Validators: enums, copy, audit kind, Zod schema (AC1, AC4, AC5, AC6, AC9)**
  - [ ] 2.1 Create `packages/validators/src/life-events.ts`. Export:
    - `LIFE_EVENT_CATEGORIES = ['medication','nutrition','physical_activity','stress','sleep','illness','other'] as const`
    - `LIFE_EVENT_CATEGORY_LABELS_PT_BR: Record<typeof LIFE_EVENT_CATEGORIES[number], string>` with the 7 pt-BR labels from AC1.
    - `LIFE_EVENT_PRIVACY_FLAGS = ['patient_only','shared_explicit'] as const`
    - `LIFE_EVENT_DESCRIPTION_MAX = 140 as const`
    - `LIFE_EVENT_AUDIT_CREATED = 'life_event.created' as const` (NEW audit kind constant — see AC4).
    - `createLifeEventInputSchema = z.object({ description, eventDate, category, privacyFlag }).strict()` per AC6. Use `.strict()` so unknown keys reject (Story 2.8 R1-P221 pattern).
    - pt-BR copy constants: `LIFE_EVENT_SHEET_TITLE_PT_BR = 'Adicionar evento de vida'`, `LIFE_EVENT_CTA_OPEN_PT_BR = 'Adicionar evento de vida'`, `LIFE_EVENT_CTA_SAVE_PT_BR = 'Salvar evento'`, `LIFE_EVENT_CTA_CANCEL_PT_BR = 'Cancelar'`, `LIFE_EVENT_DESCRIPTION_PLACEHOLDER_PT_BR = 'O que aconteceu? (até 140 caracteres)'`, `LIFE_EVENT_DATE_LABEL_PT_BR = 'Data do evento'`, `LIFE_EVENT_CATEGORY_LABEL_PT_BR = 'Categoria (opcional)'`, `LIFE_EVENT_MULTI_DAY_LABEL_PT_BR = (n, dateBr) => \`${n} eventos em ${dateBr}\``, `LIFE_EVENT_TRUNCATE_SUFFIX = '…'`, `LIFE_EVENT_FUTURE_DATE_ERROR_PT_BR = 'Data não pode estar no futuro'`, `LIFE_EVENT_DESCRIPTION_REQUIRED_PT_BR = 'Descrição obrigatória'`, `LIFE_EVENT_DESCRIPTION_TOO_LONG_PT_BR = 'Máximo 140 caracteres'`.
  - [ ] 2.2 Add `export * from "./life-events";` to `packages/validators/src/index.ts`.
  - [ ] 2.3 **DO NOT** add `LIFE_EVENT_AUDIT_CREATED` to `ACCESS_LOG_EVENT_KINDS` (AC5). Add an inline `// AC5: deliberately excluded — life events are private patient-authored context.` comment adjacent to the constant.

- [ ] **Task 3 — API: `lifeEventsRouter.createLifeEvent` + `listLifeEventsInWindow` (AC2, AC4, AC6)**
  - [ ] 3.1 Create `packages/api/src/life-events.ts` — the read+write helper layer (mirrors `observations-record.ts` / `letters.ts` split between helper + router).
    - `createLifeEvent(database: AuditDb, input, patientId)`: validates with Zod schema, INSERTs row, writes `LIFE_EVENT_AUDIT_CREATED` audit row in the same transaction (`writeAuditLog`, NOT `writeAuditLogIfNew` — no dedup needed; user-initiated, no race), returns `{ id, patientId, eventDate, description, category, privacyFlag, createdAt }`.
    - `listLifeEventsInWindow(database, patientId, { from, to })`: SELECTs `WHERE patient_id = ? AND event_date BETWEEN ? AND ?` ordered by `event_date asc, created_at asc`. Used by Task 4 to feed markers to the chart. **No audit write on read** — the patient is reading their own data and the Fingerprint render path is high-frequency; an audit per render is noise (Story 3.1 audits `observation.read` once per call but life-event reads piggyback on the Fingerprint render — same author, same surface).
  - [ ] 3.2 Create `packages/api/src/router/lifeEvents.ts`:
    - `createLifeEvent: protectedProcedure.input(createLifeEventInputSchema).mutation(async ({ ctx, input }) => createLifeEvent(ctx.db, input, ctx.session.user.id))`.
    - `listInWindow: protectedProcedure.input(z.object({ from: isoDateSchema, to: isoDateSchema }).strict()).query(async ({ ctx, input }) => listLifeEventsInWindow(ctx.db, ctx.session.user.id, input))`.
    - **NOT** `premiumProcedure` — life events are a base-tier feature (free-tier patients benefit from personal context; gating it would contradict the epic's "patient is the expert on their own experience" framing per UX spec line 263).
  - [ ] 3.3 Wire `lifeEventsRouter` into `packages/api/src/root.ts` under key `lifeEvents`.
  - [ ] 3.4 Resolver-time clock authority: use `todayInSaoPauloIso()` from `@healthtracker/validators/collected-at` for the AC6 retroactive-only refine. Do **NOT** use `new Date().toISOString().slice(0,10)` (UTC-shift hazard documented in Story 3.1 R3-P246 + Story 2.7 BIA discipline). The Zod refine runs the helper at validation time, NOT module-load time (avoids clock-frozen-at-import bug).

- [ ] **Task 4 — UI: `LifeEventSheet` component + Fingerprint marker integration (AC1, AC3)**
  - [ ] 4.1 Create `packages/ui/src/components/LifeEventSheet/LifeEventSheet.tsx` — Tamagui-only.
    - Props: `{ open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (input: CreateLifeEventInput) => Promise<void>; isSubmitting: boolean }`.
    - Internal state: description / eventDate / category / submitError.
    - Layout: `<Sheet snapPoints={[60]} modal>` with `TextArea` (140-char live counter), `DateTimePicker` (mode: 'date', max: today; iOS/Android native pickers per `@react-native-community/datetimepicker` — already in repo from Story 2.7 BIA form), category `Select` over `LIFE_EVENT_CATEGORIES` rendered via `LIFE_EVENT_CATEGORY_LABELS_PT_BR`, Salvar/Cancelar buttons.
    - On submit: optimistic close on success (avoid stuck modal on slow network); error → inline error text + retain sheet open (Story 2.4 sheet UX precedent).
    - Accessibility: every input has `accessibilityLabel` + `accessibilityHint`; counter is `accessibilityLiveRegion="polite"` so VoiceOver announces remaining chars.
    - Re-export from `packages/ui/src/index.ts`.
  - [ ] 4.2 Extend `packages/ui/src/fingerprint-chart-baseline.tsx`:
    - Add OPTIONAL prop `lifeEvents?: { id: string; eventDate: string; description: string }[]` to `FingerprintBaselineChartProps`. Default `[]` — existing callers (Story 3.3) keep working unchanged (additive prop discipline per Epic 6 R1 carry-forward).
    - When non-empty: render a Victory Native v41 vertical line annotation per event at `x = daysFromEpoch(event.eventDate)` (reusing the `daysFromIso` helper already in the file). Label = `description` truncated to 32 chars + `LIFE_EVENT_TRUNCATE_SUFFIX`.
    - Same-date stacking: group by `event_date`; when `count > 1`, render a single marker with the `LIFE_EVENT_MULTI_DAY_LABEL_PT_BR(count, formatCollectedAtPtBr(eventDate))` label instead.
    - Token: marker stroke uses NEW Tamagui token `$lifeEventMarker` (= `#5C7A7A` — neutral teal-grey; declared in `packages/ui/src/theme/tokens.ts` adjacent to the existing `FINGERPRINT_BASELINE_TOKENS`). Stroke width 1.5px, dashed (8,4). **Never amber, never red** (AC3).
    - Reduced-motion: same fall-through as the existing chart — markers render without animation when `reducedMotion=true`.
  - [ ] 4.3 Wire `apps/expo/src/app/(tabs)/inicio.tsx`:
    - Add a new `useQuery(trpc.lifeEvents.listInWindow.queryOptions({ from, to }, { staleTime: 0, refetchOnWindowFocus: true, enabled: drawCountFromRecord >= 2 }))`. `from`/`to` derive from the existing `baselineChartBiomarkers` history extent (chronological min/max collectedAt across all biomarkers; widen `to` to today so a life event dated after the latest draw still shows).
    - Add `useMutation(trpc.lifeEvents.createLifeEvent.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: [['lifeEvents','listInWindow']] }) }))`.
    - Add a Tier-2 **"Adicionar evento de vida"** `Button` BELOW the `FingerprintChart` (only when `showFingerprintBaseline === true`; the cold-start states do NOT show the CTA — AC3 invariant).
    - On Button press, set local `lifeEventSheetOpen = true`. On `LifeEventSheet.onSubmit`, await `createMutation.mutateAsync(input)` and close on success.
    - Pass `lifeEvents={lifeEventsQuery.data ?? []}` through to `<FingerprintChart state="baseline-established" ...>`.
    - Story 3.4 cache discipline: the new query key MUST be added to `PERSIST_QUERY_KEYS` in `apps/expo/src/utils/api.tsx` so offline Fingerprint reads still show life-event markers. Mirror the existing `observations.getRecord` / `observations.getPersonalBaseline` whitelist + the `FINGERPRINT_CACHE_QUERY_KEYS` invalidation list at the top of `inicio.tsx`.

- [ ] **Task 5 — Tests (AC2, AC4, AC6, AC8)**
  - [ ] 5.1 Unit: `packages/api/__tests__/life-events.test.ts` (mock Drizzle, mirror `observations-record.test.ts` pattern). Assertions:
    - `createLifeEvent` writes exactly one `writeAuditLog` row with the AC4 metadata shape and **no description field in metadata** (PII hygiene check).
    - Zod boundary: 0-char description rejects; 141-char rejects; whitespace-only rejects (`.trim()` order); date > today rejects with `LIFE_EVENT_FUTURE_DATE_ERROR_PT_BR`; unknown category rejects.
    - `listLifeEventsInWindow` does NOT call `writeAuditLog` (AC inference — no audit on render path).
  - [ ] 5.2 Validators: `packages/validators/__tests__/life-events.test.ts` — assert `LIFE_EVENT_AUDIT_CREATED` is NOT in `ACCESS_LOG_EVENT_KINDS` (AC5 regression lock — if a later story accidentally adds it, this test fails).
  - [ ] 5.3 RLS integration: `packages/db/__tests__/rls/life-events.rls.test.ts` — full 4-identity matrix per AC8.
    - **Carry-forward from Epic 6 retro § "Integration test infrastructure is dead in this worktree":** the testcontainer harness has been broken for 3 consecutive stories on Rancher Desktop. Author the test file with the full matrix, BUT do not block the story on a green run. If `pnpm --filter @healthtracker/db test:integration` cannot execute locally, document the skip in Completion Notes with the exact error message; the `rls-adversarial` GHA job runs against a clean shadow DB and will execute this test in CI. Story 5.6 / 6.4 / 6.5 / 6.6 precedent applies.
  - [ ] 5.4 UI snapshot (`packages/ui/__tests__/`): only if `@healthtracker/ui` has a working test script wired today (Epic 6 retro: still absent in Stories 6.5 / 6.6). Skip with an F-item if not — do NOT block on adding the test infra in this story.
  - [ ] 5.5 No web tests this story (AC11).

- [ ] **Task 6 — Quality gates (mandatory)**
  - [ ] 6.1 `pnpm -w typecheck` — green across all 17 packages.
  - [ ] 6.2 `pnpm -w lint` — green across all 15 packages.
  - [ ] 6.3 `pnpm -w format:fix && pnpm -w format` — clean.
  - [ ] 6.4 `pnpm --filter @healthtracker/api test:unit` — green (Task 5.1 added).
  - [ ] 6.5 `pnpm --filter @healthtracker/validators test:unit` — green (Task 5.2 added).
  - [ ] 6.6 `pnpm --filter @healthtracker/db test:integration` — green **IF** testcontainers infra is operational; **document the skip + reason in Completion Notes** if Rancher still blocks it (Epic 6 retro carry-forward).
  - [ ] 6.7 Manual run-through (Expo simulator + dev DB seeded via `pnpm db:studio`): seed 2 published draws; open Início; verify the "Adicionar evento de vida" CTA renders BELOW the chart at `drawCount >= 2`; tap it; create a backdated event; verify the marker appears at the right x-position with the truncated label; verify the audit row lands via `pnpm db:studio` SELECT on `audit_log WHERE event = 'life_event.created'`; verify the description is **not** present in `metadata`.

- [ ] **Task 7 — Documentation discipline (Epic 6 retro carry-forward)**
  - [ ] 7.1 Append a "Life events discipline (Story 7.1)" stanza to `CLAUDE.md` after the existing "Doctor staleness thresholds" section. Cover: the `privacy_flag = 'patient_only'` invariant + the "denial-by-RLS-absence" pattern (doctors get zero rows because there is no doctor policy, not because a predicate said so); the AC5 exclusion from `ACCESS_LOG_EVENT_KINDS`; the AC4 PII discipline (description never in audit metadata).
  - [ ] 7.2 Append the Story 7.5 (or future Epic 7 batched migration) checklist: tables `life_events`, enums `life_event_privacy_enum` + `life_event_category_enum`, index `life_events_patient_date_idx`, RLS policy `life_events_select_own` + `life_events_insert_own`.

---

## Dev Notes

### Worktree + branching

- **This is a fresh worktree `worktree-story-7-1`** branched off `main@fc74f7c` (last commit: Epic 6 retro merge, PR #58). It is **NOT stacked on any open PR**. Open a brand-new PR for Story 7.1.
- The stacked-PR pattern resumes only if Story 7.2 starts before this PR merges (per Epic 6 retro § "5-stacked-story-on-one-PR" — stacking is fine, just intentional). Default expectation: 7.1 lands as its own PR, then 7.2 stacks if started concurrently.
- Auto-merge is **disabled** repo-wide; the PR will need a manual merge after CODEOWNER review (per user memory `feedback_worktree_pr_workflow.md`).

### Epic 6 retro carry-forwards (3 items load-bearing for Story 7.1)

1. **Integration-test infra is degraded.** Rancher Desktop's lima VM rejects testcontainers' docker.sock bind-mount; Stories 6.4 / 6.5 / 6.6 all SKIPPED `test:integration`. Task 5.3 (RLS matrix) and Task 6.6 (gate) account for this: author the tests, document any skip, rely on `rls-adversarial` GHA. Do NOT block this story on local Docker.
2. **R1 gotcha checklist (carry-forward unaddressed across Epics 5/6).** This story pre-bakes the known R1 shapes inline:
   - **Procedure-name truthfulness** — `lifeEventsRouter.createLifeEvent` is `protectedProcedure` (not `premiumProcedure`); the name claims "protected = authenticated patient", and that is what it delivers. No activation gate, no premium gate, no inline pre-check that the name would lie about (Epic 6 R1 MEDIUM-1 pattern).
   - **Activation/auth gate placement** — `protectedProcedure` middleware is the single gate; no inline `SELECT FROM users WHERE id = ?` in the resolver body.
   - **Contrast tokens** — markers use `$lifeEventMarker` (neutral teal-grey, AA on `$surfaceElevated`), explicitly NOT amber + NOT red (Story 6.5 R1 HIGH-1 carry-forward).
   - **Integration-test deferral pattern** — Task 5.3 + Task 6.6 follow Story 6.5 / 6.6 precedent.
   - **Resolver-time clock authority** — AC6 / Task 3.4 use `todayInSaoPauloIso()` at validation time, never module-load time.
   - **FK-cascade-vs-set-null discipline** — `patient_id` references `users(id) ON DELETE CASCADE` (NOT `set null`). Life events are patient-authored personal data; cascade is the right semantic (Story 5.6 LGPD Art. 18 discipline).
   - **Greppable pt-BR copy** — every visible literal lives in `packages/validators/src/life-events.ts`; no hard-coded pt-BR string in components or screens (Epic 3 R3-P247 / Epic 5 / Epic 6 retro pattern).
   - **Partial-unique-index + 23505 catch** — N/A this story (no idempotent dedup contract; a patient can intentionally create multiple events on the same date with the same description).
   - **Nullable-column predicate** — `category` is nullable in schema and surface; the Zod schema explicitly `.nullable()`s it, the UI sends `null` not `undefined` (Story 5.2 R1 nullable-expires_at carry-forward).
3. **Migration-authoring contract.** Epic 6 R1 H1 + R1-followup taught the team to defer all SQL to a final batched-migration story per epic. Story 7.1 ships Drizzle schema + RLS policy file only (AC10). Hand-authoring vs. `supabase db diff --use-migra` is a Story 7.5 decision; document the Drizzle source-of-truth + policy-file byte-equivalence requirement when that story arrives.

### Existing code surfaces to read before writing (READ ALL of these)

- `packages/api/src/observations-record.ts` — the read-side helper pattern Task 3.1 mirrors (single SELECT + RLS + boundary type narrowing + helper/router split).
- `packages/api/src/letters.ts` lines 1–200 — `writeAuditLog` + `writeAuditLogIfNew` usage; Story 7.1 uses the non-dedup variant.
- `packages/api/src/trpc.ts` lines 56–102 — `protectedProcedure` definition. Confirm the resolver wrapping (transaction-scoped GUC) before writing the resolver.
- `packages/db/src/schema/letters.ts` — the Drizzle schema pattern Task 1.2 mirrors (file structure, exports, JSDoc header convention).
- `packages/db/policies/custom_rls_observations.sql` — the minimal RLS policy pattern Task 1.5 mirrors (SELECT-own + nothing else).
- `packages/db/policies/custom_rls_staleness_thresholds.sql` — the "no doctor policy at all" precedent (Story 6.5 final form after R1-followup). Read the header comments — the denial rationale is identical to Story 7.1's.
- `packages/db/__tests__/rls/staleness-thresholds.rls.test.ts` — the multi-identity RLS matrix shape Task 5.3 mirrors.
- `packages/ui/src/fingerprint-chart-baseline.tsx` lines 60–150 — the Victory Native v41 entry surface; Task 4.2 extends this. Note the `daysFromIso` helper at line 112 — REUSE it; do not re-implement.
- `packages/validators/src/sharing.ts` lines 308–340 — the `ACCESS_LOG_EVENT_KINDS` definition. AC5 requires NOT adding to this list — Task 2.3 documents the deliberate omission.
- `packages/validators/src/collected-at.ts` — `todayInSaoPauloIso()`. Used in Task 3.4.
- `apps/expo/src/app/(tabs)/inicio.tsx` — the Início screen. Task 4.3 extends it; the file is 706 lines and dense. Read carefully — the `useCacheRefetchOnOnline` integration on line 144 is the offline-Fingerprint contract; the new query key MUST flow through `FINGERPRINT_CACHE_QUERY_KEYS` (Story 3.4 R1-P270 lesson: tRPC v11 query-key shape).
- `apps/expo/src/utils/api.tsx::PERSIST_QUERY_KEYS` — the Story 3.4 dehydrate whitelist. Add the new `lifeEvents.listInWindow` key here so offline-cached Fingerprint reads also show markers.
- `_bmad-output/implementation-artifacts/3-3-...-md` (if needed) — the canonical Story 3.3 spec for the `baseline-established` chart state Task 4.2 extends.
- `_bmad-output/implementation-artifacts/3-4-...-md` — Story 3.4 cache discipline; Task 4.3 inherits the persist-query-keys + invalidate-on-online pattern.
- `_bmad-output/implementation-artifacts/epic-6-retro-2026-05-30.md` — § 7 and § 9 above informed AC8 (defensive RLS), AC10 (migration deferral), and the R1 gotcha checklist.

### Existing behaviour that must be preserved (regression watch)

- **Story 3.3 baseline chart rendering** — Task 4.2 adds a single OPTIONAL prop to `FingerprintBaselineChartProps`. Default `[]` → zero behaviour change for callers that don't pass `lifeEvents`. A snapshot regression of the existing `baseline-established` chart with `lifeEvents={[]}` must be byte-identical to today.
- **Story 3.4 offline-cached Fingerprint** — adding a new query key to the persist whitelist MUST not change the existing two-key behaviour. The `FINGERPRINT_CACHE_QUERY_KEYS` list grows from 2 → 3; the `useCacheRefetchOnOnline` semantics carry through unchanged.
- **Story 4.3 biomarker-tap → `BIOMARKER_DETAIL_ROUTE`** — the `BiomarkerCard.onPress` wiring on `inicio.tsx` lines 622–637 is untouched.
- **Story 2.5 `ExtractionPulse` + Story 2.6 offline-queue banner** — the new Tier-2 "Adicionar evento de vida" CTA sits BELOW the chart, NOT BELOW the existing CTAs. Ordering: ExtractionPulse → offline-queue banner → FingerprintChart → BiomarkerCard list → **NEW life-event CTA** → UploadSourceSheet (modal, not in tree order).
- **Story 5.6 cascade discipline** — `life_events.patient_id` references `users(id) ON DELETE CASCADE`. Patient account deletion takes life events with it. This is the right semantic AND honours LGPD Art. 18 right-to-erasure.

### Project Structure Notes

- **NEW files (8):**
  - `packages/db/src/schema/life_events.ts`
  - `packages/db/policies/custom_rls_life_events.sql`
  - `packages/db/__tests__/rls/life-events.rls.test.ts`
  - `packages/validators/src/life-events.ts`
  - `packages/validators/__tests__/life-events.test.ts`
  - `packages/api/src/life-events.ts`
  - `packages/api/src/router/lifeEvents.ts`
  - `packages/api/__tests__/life-events.test.ts`
  - `packages/ui/src/components/LifeEventSheet/LifeEventSheet.tsx`
- **MODIFIED files (6):**
  - `packages/db/src/schema/index.ts` (add export)
  - `packages/validators/src/index.ts` (add export)
  - `packages/api/src/root.ts` (mount `lifeEvents` key on `appRouter`)
  - `packages/ui/src/fingerprint-chart-baseline.tsx` (add optional `lifeEvents` prop + marker rendering)
  - `packages/ui/src/index.ts` (re-export `LifeEventSheet`)
  - `packages/ui/src/theme/tokens.ts` (add `$lifeEventMarker` token)
  - `apps/expo/src/app/(tabs)/inicio.tsx` (wire query + mutation + CTA + sheet)
  - `apps/expo/src/utils/api.tsx` (add to `PERSIST_QUERY_KEYS`)
  - `CLAUDE.md` (append Story 7.1 + Story 7.5 stanzas)
- **NO files touched in `apps/web/`** (AC11).
- **NO `supabase/migrations/*.sql` file** (AC10).

### Open questions for Francis (surface at hand-off, do NOT block on these)

1. **Sprint-status.yaml does NOT list Story 7.5.** The Epic 7 epic in `epics.md` lines 1691–1711 defines Story 7.5 ("Author incremental Supabase migration for Epic 7 schema"), but `sprint-status.yaml` lines 824–829 enumerate only `epic-7` + `7-1` … `7-4`. AC10 defers the migration to a future story; if Francis confirms 7.5 is the intended slot, append `7-5-author-incremental-supabase-migration-for-epic-7-schema: backlog` to sprint-status.
2. **Edit / delete life event** — the epic spec (lines 1585–1601) describes create only. If patients should be able to edit a typo or delete an event entirely (likely UX desire), it's a new story. Story 7.1 ships create-only; AC7 explicitly does not pre-bake the schema for mutability.
3. **Web Fingerprint** — `/inicio` on web (Next.js) currently mirrors Início but does not render the FingerprintChart (Epic 3 retro: web Fingerprint is post-MVP). Story 7.1 follows that precedent (AC11). When web Fingerprint ships, life-event markers should follow on the same chart prop surface — the additive prop discipline keeps this trivial.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1573–1604] Epic 7 + Story 7.1 spec.
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1691–1711] Story 7.5 (the deferred migration story that sprint-status currently does NOT list).
- [Source: `_bmad-output/planning-artifacts/prd.md` line 541] FR47 — life events with `privacy_flag` default patient-only.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` lines 215, 263, 670, 760–770, 804] Life event UX prompt timing (immediately after draw confirms / from Fingerprint view); bottom-sheet pattern; "patient is the expert" framing.
- [Source: `_bmad-output/planning-artifacts/architecture.md` line 70] `collected_at` DATE-not-TIMESTAMPTZ pattern that AC2 inherits for `event_date`.
- [Source: `_bmad-output/implementation-artifacts/epic-6-retro-2026-05-30.md` §§ 4, 7, 9] Integration-test infra carry-forward, R1 gotcha checklist carry-forward, migration-authoring contract carry-forward.
- [Source: `_bmad-output/implementation-artifacts/3-1-...-md` AC4 / AC7] Audit + RLS pattern that Story 7.1 mirrors.
- [Source: `_bmad-output/implementation-artifacts/3-4-...-md`] Offline-cached Fingerprint persist-query-keys + invalidate-on-online pattern.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (BMad bmad-create-story workflow)

### Debug Log References

### Completion Notes List

- Story spec authored 2026-05-30 on `worktree-story-7-1` (fresh branch off `main@fc74f7c`).
- Epic 6 retro carry-forwards explicitly pre-baked into AC8 (RLS matrix), AC10 (migration deferral), and Dev Notes § "R1 gotcha checklist".
- Integration tests authored per AC8 but execution may be SKIPPED locally if Rancher/testcontainers still broken; `rls-adversarial` GHA covers production gate.
- Open question to Francis: Story 7.5 (Epic 7 batched migration) is in `epics.md` but missing from `sprint-status.yaml`. AC10 defers SQL migration to that story; sprint-status will need 7.5 appended before Epic 7 closes.

### File List
