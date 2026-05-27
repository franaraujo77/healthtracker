# Story 5.5: Patient exports their complete health record as JSON or PDF

Status: review

> **Stacked on Stories 5.1 + 5.2 + 5.3 + 5.4 / PR #56.** LGPD Art. 18 data-portability surface. Async pg-boss job + Supabase Storage signed URL pattern (mirrors Story 4.1 letter-generation queue topology). Adds `exports` table + RLS, `sharingRouter.requestExport` / `getExport` procedures, a new `record.export.generate` pg-boss queue, a new `services/llm` consumer that emits JSON / PDF via `@react-pdf/renderer`, and a Configurações > Dados > Exportar registro screen.
>
> **Out of scope (per user direction):** Production migration still deferred to the last story of Epic 5. No Supabase Storage bucket migration files — Story 5.7 will fold the `exports` bucket creation + RLS policy SQL into the batched migration.
>
> **ADR resolutions locked in this story (user-confirmed):**
>
> 1. **Async pg-boss + Supabase Storage signed URL.** `requestExport` enqueues a job + returns `{exportId}` immediately. Worker generates the artifact, uploads to `exports/{patientId}/{exportId}.{format}`, UPDATEs `exports.status='ready'`. Client polls `getExport({exportId})` for status; when ready, the resolver returns a short-lived signed URL. **No bytes in tRPC responses.**
> 2. **`@react-pdf/renderer` in `services/llm`.** Reuse the existing persistent worker; no new container, no headless browser. PT-BR fonts via the existing Lora pipeline from Story 4.1 (also re-used for the export's headline; body uses DM Sans). Real PDF rendering is gated on the same dev/prod env split as the Letter generation (no DPA required for PDF — patient data stays in our infra).
> 3. **Life events deferred to Epic 7.** Story 5.5 AC4 says PDF includes "life events"; Story 7.1 (Epic 7 backlog) ships the `life_events` table. Story 5.5 scopes PDF + JSON to **what exists today**: observations (draws) + BIA + uploads metadata. JSON includes an empty `lifeEvents: []` array as the schema slot. PDF renders a "Eventos da vida" section with an empty-state copy when zero rows. When Epic 7 lands, the consumer extends to include real entries; the export schema doesn't change.

## Story

**As a** patient,
**I want** to export my entire health record as a JSON file or formatted PDF,
**so that** I can exercise my LGPD Art. 18 data-portability right and keep a personal copy of my data.

## Acceptance Criteria

1. **AC1 — Configurações > Dados > Exportar registro screen.** Given the patient navigates to `apps/expo/src/app/configuracoes/dados/exportar.tsx` (and web equivalent `apps/web/src/app/configuracoes/dados/exportar/page.tsx`), when the screen loads, then the patient sees:
   - A format selector (radio group, `DurationOption`-style — actually use a new `ExportFormatOption` component or reuse the `DurationOption` shape with different copy). Options: `"JSON"` (machine-readable; pre-selected) and `"PDF"` (formatted document). Constants in `packages/validators/src/sharing.ts` as `EXPORT_FORMAT_OPTIONS`.
   - Brief explainer copy under each option: `"Para análise em outras ferramentas."` (JSON) / `"Documento formatado para impressão ou compartilhamento."` (PDF). Constants: `EXPORT_FORMAT_HINT_JSON_PT_BR` / `EXPORT_FORMAT_HINT_PDF_PT_BR`.
   - A Tier-2 "Exportar" button that calls `sharingRouter.requestExport.useMutation()` with the selected format.
   - On submit: the screen transitions to a "Gerando seu registro…" state and starts polling.
   - a11y: the radio group has `role="radiogroup"` + `accessibilityLabel="Formato do registro"` (Story 5.3 pattern). The "Exportar" button has a11y label `"Exportar registro como {formato}"`.

2. **AC2 — Async generation + 60s soft-target + polling UX.** Given the patient taps "Exportar", when the resolver succeeds, then the screen renders an `ExportProgressCard` (NEW `packages/ui` component) showing:
   - Indeterminate progress + copy `"Gerando seu registro… (até 60 segundos)"`.
   - A polling `useQuery({queryKey: trpc.sharing.getExport.queryKey({exportId}), refetchInterval: 2000})` that hits `getExport` every 2 seconds until status flips to `ready` or `failed`.
   - When `status === "ready"`: card flips to `"Pronto"` state with a Tier-2 "Baixar" button. Tapping it fetches a fresh signed URL via `getExport` (NOT cached — TTL constraints) and invokes the system share-sheet (Expo `Share.share({url})`) or browser-download (web `<a href download>`).
   - When `status === "failed"`: card shows `"Não foi possível gerar o registro. Tente novamente."` (constant `EXPORT_FAILED_PT_BR`) + a Tier-2 "Tentar novamente" button that resubmits.
   - The screen does NOT block navigation — the patient can leave and come back; on re-mount, the polling resumes against the same `exportId` (stored in `useState` + AsyncStorage on Expo; URL query param on web).
   - Spec says "delivered to the app within 60 seconds" — that's a soft target; the worker may take longer for large records. The card states "até 60 segundos" but does NOT show a timeout error at 60s; only `status === "failed"` from the server.

3. **AC3 — JSON export shape (self-contained).** Given the JSON export is generated, when the patient opens the file, then every `observations` row includes the seven required fields per AC verbatim: `loincCode`, `biomarkerName` (pt-BR human label resolved from `loinc_ref` table; Story 2.3 territory — falls back to `biomarker_name` from observations if loinc_ref missing), `valueNumeric`, `unitUcum`, `collectedAt` (ISO 8601), `labName`, `sourceType`. The top-level shape:

   ```json
   {
     "schemaVersion": "1.0.0",
     "generatedAt": "<iso-8601>",
     "patient": { "id": "<uuid>" },                // patient_id only; no PII
     "observations": [ { loincCode, biomarkerName, valueNumeric, unitUcum, collectedAt, labName, sourceType } ],
     "bia": [ { measuredAt, weightKg, bodyFatPercent, muscleMassKg, ... } ],
     "uploads": [ { id, uploadedAt, kind, status, sourceType } ],
     "lifeEvents": []   // Epic 7 placeholder; empty array in 5.5
   }
   ```

   Self-contained: no Health Tracker URLs, no LOINC dereference required (the human label is baked in). PII hygiene: `patient.id` is the UUID only — NO email, no displayName. Pretty-printed (2-space indent) for human readability. UTF-8 with BOM (`﻿`) — interoperable with Excel "Open as UTF-8".

4. **AC4 — PDF export shape.** Given the PDF export is generated, when the patient opens it, then it includes:
   - **Cover page**: Health Tracker logo placeholder (text "Health Tracker"); title `"Seu registro pessoal de saúde"`; generation date `"Gerado em {data por extenso}"`; patient ID truncated `"ID: {first-8-chars}…"`; LGPD notice `"Este documento contém seus dados pessoais. Mantenha-o em local seguro."`.
   - **Observações (Draws)** — grouped by `collectedAt` date (one section per draw). Within each section: a small table per biomarker (name | value | unit | reference range — populate the range from `loinc_ref` if available, otherwise blank).
   - **Bioimpedância (BIA)** — chronological table of BIA entries.
   - **Uploads** — table of upload metadata (date, source type, status).
   - **Eventos da vida** — empty-state copy `"Sem eventos registrados."` (Epic 7 placeholder).
   - Typography: Lora 16pt for section headings (matches Story 4.1's LetterReader); DM Sans 11pt for body. PT-BR copy throughout.
   - Page numbers in the footer.
   - Generated via `@react-pdf/renderer` (NEW dep). Fonts loaded from `services/llm/assets/fonts/` (Lora-Regular.ttf + DM Sans variable; the Lora file is already bundled for Story 4.1 — reuse).

5. **AC5 — `exports` schema + RLS.** New Drizzle table at `packages/db/src/schema/sharing.ts`:

   ```
   exports (
     id uuid pk default gen_random_uuid(),
     patient_id uuid notNull references users(id) on delete cascade,
     format text notNull check in ('json','pdf'),
     status text notNull default 'queued' check in ('queued','generating','ready','failed'),
     object_path text,           -- 'exports/{patient_id}/{export_id}.{format}' — null until ready
     file_size_bytes integer,
     failure_reason text,
     requested_at timestamptz notNull default now(),
     completed_at timestamptz,
     expires_at timestamptz notNull default (now() + interval '24 hours')   -- file lifetime in storage
   )
   ```

   Indexes: `(patient_id, requested_at desc)` for the "previous exports" list (out of scope for 5.5 UI; lands in 5.x polish).

   RLS policies (`packages/db/policies/custom_rls_exports.sql`):

   ```sql
   ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;

   DROP POLICY IF EXISTS "exports_select_own" ON "exports";
   CREATE POLICY "exports_select_own" ON "exports"
     FOR SELECT
     USING (patient_id::text = current_setting('app.current_patient_id', true));

   -- No INSERT/UPDATE/DELETE patient policies — service_role writes only.
   ```

   No doctor principal access — exports are strictly patient-only.

6. **AC6 — `requestExport` mutation.** New `protectedProcedure.mutation`:
   - Input: `z.object({ format: z.enum(['json','pdf']) })`.
   - Output: `z.object({ exportId: z.string().uuid() })`.
   - Inside `ctx.db.transaction(async (tx) => ...)`:
     - INSERT `exports` row with `status='queued'`, `format`, `patient_id`.
     - Outbox-enqueue pg-boss job `record.export.generate` with payload `{exportId}` and singleton_key `record.export.${exportId}` (mirror Story 5.2 outbox pattern via raw INSERT INTO `pgboss.job`).
     - `writeAuditLog(tx, { actorType:'patient', event: 'export.queued', resourceId: exportId, resourceType: 'export', metadata: { format } })`.
     - Return `{ exportId }`.
   - Premium gate: **inline** check via `isPremium(ctx.session.user)` (Story 5.3 pattern). Free-tier patients see `EXPORT_PREMIUM_REQUIRED_PT_BR` rather than throwing — actually wait, LGPD Art. 18 is a non-negotiable right; **exports must be available to ALL patients, free or premium**. Confirm with the team — for now, NO premium gate on exports. Document this anti-pattern-exception in dev notes (the only sharing-related action that's free-for-all).

7. **AC7 — `getExport` query.** New `protectedProcedure.query`:
   - Input: `z.object({ exportId: z.string().uuid() })`.
   - Output: `z.object({ status: ExportStatus, format: 'json'|'pdf', requestedAt: iso, completedAt: iso | null, expiresAt: iso, downloadUrl: z.string().url().nullable() })`.
   - SELECT the row WHERE `id=$1 AND patient_id = current_setting(...)`. NOT_FOUND on miss (404 not 403 — Story 5.1 discipline).
   - If `status === 'ready'` AND `expires_at > now()`: generate a fresh Supabase Storage signed URL with **1-hour TTL** via `supabase.storage.from('exports').createSignedUrl(object_path, 3600)`. Return it in `downloadUrl`.
   - If `status === 'failed'` OR `expires_at < now()`: `downloadUrl = null`.
   - This is the polling endpoint — refetched every 2s by the screen.

8. **AC8 — `services/llm` consumer (`generate-export`).** New consumer at `services/llm/src/consumers/generate-export.ts` mirroring `generate-letter.ts`:
   - Receive `{exportId}`.
   - SELECT the `exports` row + the patient's observations, uploads, BIA (when Story 2.7 BIA is queryable). Use service-role connection (RLS bypassed for workers per architecture).
   - UPDATE `exports.status = 'generating'`.
   - If `format === 'json'`: serialize the AC3 shape with 2-space indent + BOM prefix. UTF-8 string.
   - If `format === 'pdf'`: render the AC4 layout via `@react-pdf/renderer` in a worker. Output a Buffer.
   - Upload to Supabase Storage at `exports/{patient_id}/{exportId}.{format}` via the service-role client. Use `upsert: true` (idempotent — re-run safety).
   - UPDATE `exports.status = 'ready'`, `object_path`, `file_size_bytes = byteLength`, `completed_at = now()` — inside `deps.sql.begin(...)`.
   - `writeAuditLog(... event: 'export.generated', actor_type: 'system', metadata: { format, fileSizeBytes })`.
   - **Also** write `record.exported` audit (per AC5 spec verbatim): `actor_type: 'patient'`, `actor_id: <patient_id>`, `event: 'record.exported'`, `metadata: { format, requestedAt }`. This is the patient-visible audit row that the Access Log (Story 5.3) will surface — extend `ACCESS_LOG_EVENT_KINDS` to include `record.exported`.
   - On failure (after pg-boss retries exhausted, retryLimit=3 with backoff): UPDATE `status='failed'`, `failure_reason=<short code>`. Audit `export.failed`. The patient sees the AC2 "failed" state on next poll.
   - **Narrow catches** — `Anthropic.APIError` is not relevant here; narrow to known shapes: Postgres errors with known SQLSTATE codes; `Error` instances whose message matches `/network|ECONNRESET|fetch failed/i`. Programmer errors (TypeError, ReferenceError, SyntaxError) rethrow.
   - **Memory guard:** for large patient records (e.g. 1000+ observations + PDF), the consumer must NOT load all observations into a single in-memory array before serializing. Use a streaming approach for JSON (write to a temp file then upload), and for PDF use `@react-pdf/renderer` which streams to a Buffer (acceptable for typical patients <500 observations; flag for future polish if it becomes a bottleneck).

9. **AC9 — Supabase Storage `exports` bucket + service-role write.** The bucket `exports` must exist with:
   - **Private** (no public reads — all reads go through signed URLs).
   - No CDN caching.
   - Service-role can write; no public RLS policy needed (private buckets are service-role-only by default in Supabase).
   - Per project convention, the bucket is created via SQL in the deferred Epic 5 migration (Story 5.7). For dev: a `psql -f packages/db/policies/supabase_storage_exports.sql` file authored in T2.
   - File lifecycle: a future cleanup job (Story 5.x polish OR Supabase Storage lifecycle rule) removes files past `expires_at`. **NOT** Story 5.5's concern — flag in deferred-work.

10. **AC10 — `record.exported` audit + Access Log surface.** Per AC5 verbatim: audit row written. Two emissions: `export.queued` (request time, patient-actor) + `record.exported` (generation time, patient-actor, the "I did this" surface) + `export.generated` (system-actor — operational telemetry). The `ACCESS_LOG_EVENT_KINDS` allowlist (Story 5.3) gains `record.exported`. `ACCESS_LOG_EVENT_LABEL_PT_BR_FN` gains a case: `"Você exportou seu registro completo ({format.toUpperCase()})."`.

11. **AC11 — Signed-URL TTL safety.** The download URL TTL is 1 hour. The file lifetime in storage is 24h (set on the row at insert; the worker tags the storage object too via metadata if Supabase supports it — verify). If the patient holds onto the URL past 1h, it 403s — they can `getExport` again for a fresh URL until 24h post-`completed_at`, at which point the file is removed (by the cleanup job — see AC9). The screen does NOT cache the URL between polls — every "Baixar" tap fetches a fresh URL.

12. **AC12 — Idempotency: re-requesting an export.** The patient may tap "Exportar" again before the previous job finishes. There is NO active-export uniqueness constraint — each tap creates a new row + job. Spec rationale: exports are cheap to re-run (no expensive LLM call), and patients may want JSON + PDF for the same data. If we ever surface a "previous exports" list (Story 5.x polish), we'll dedup there. Document in dev notes; no schema constraint.

## Tasks / Subtasks

> **Plan:** 1) Schema + RLS → 2) Validators + audit constants → 3) Router (request + get + premium-exception) → 4) services/llm consumer + react-pdf scaffolding → 5) UI (screen + ExportProgressCard) → 6) Tests + Access-Log allowlist extension.

- [ ] **T1. Schema + RLS (AC5, AC9, AC11).** (AC: 5, 9, 11)
  - [ ] T1.1 `packages/db/src/schema/sharing.ts` — add `exports` table per AC5. Use `pgEnum` for `format` and `status` (mirrors Story 5.2 `shareDurationEnum` pattern). Index on `(patient_id, requested_at desc)`.
  - [ ] T1.2 Re-export inferred types `ExportRow`, `NewExport`, `ExportFormat`, `ExportStatus` from `packages/db/src/schema/index.ts`.
  - [ ] T1.3 `packages/db/policies/custom_rls_exports.sql` (NEW) — patient SELECT-own per AC5. Patient INSERT/UPDATE/DELETE: NONE. Service-role bypasses.
  - [ ] T1.4 `packages/db/policies/supabase_storage_exports.sql` (NEW) — bucket creation + service-role-only access. Dev applies via `psql -f`; prod folds into Story 5.7 migration. Match the pattern in `packages/db/policies/custom_storage_lab_uploads_policy.sql` (existing precedent from Story 2.x).
  - [ ] T1.5 Update testcontainer setup to load the new policy file. Verify via the existing setup glob.
  - [ ] T1.6 Integration test `packages/db/__tests__/integration/exports-schema.integration.test.ts` (NEW) — assert table comes up; CHECK constraints reject invalid format/status; cascade-delete from `users(id)` removes export rows.
  - [ ] T1.7 RLS test `packages/db/__tests__/rls/exports.rls.test.ts` (NEW) — 3-identity matrix (correctPatient sees own, wrongPatient sees zero, serviceRole sees all). No doctor-principal test (exports are patient-only by ADR).

- [ ] **T2. Validators + audit constants (AC1, AC3, AC10, AC11).** (AC: 1, 3, 10, 11)
  - [ ] T2.1 `packages/validators/src/sharing.ts`:
    - `EXPORT_FORMATS = ["json","pdf"] as const` + `ExportFormat` type.
    - `EXPORT_STATUSES = ["queued","generating","ready","failed"] as const` + `ExportStatus` type.
    - `EXPORT_FORMAT_OPTIONS: readonly {value: ExportFormat, label: string, hint: string}[]` per AC1 copy.
    - `EXPORT_FAILED_PT_BR = "Não foi possível gerar o registro. Tente novamente."`.
    - `EXPORT_PROGRESS_PT_BR = "Gerando seu registro… (até 60 segundos)"`.
    - `EXPORT_READY_PT_BR = "Pronto"`.
    - `EXPORT_DOWNLOAD_BUTTON_PT_BR = "Baixar"`.
    - `EXPORT_RETRY_BUTTON_PT_BR = "Tentar novamente"`.
    - `EXPORT_SUBMIT_BUTTON_PT_BR = "Exportar"`.
    - `EXPORT_FORMAT_GROUP_A11Y_PT_BR = "Formato do registro"`.
    - `EXPORT_SUBMIT_A11Y_PT_BR_FN = (format) => \`Exportar registro como ${format.toUpperCase()}\``.
    - `EXPORT_FORMAT_HINT_JSON_PT_BR = "Para análise em outras ferramentas."`.
    - `EXPORT_FORMAT_HINT_PDF_PT_BR = "Documento formatado para impressão ou compartilhamento."`.
    - `EXPORT_DOWNLOAD_TTL_SECONDS = 3600` (signed-URL TTL).
    - `EXPORT_POLL_INTERVAL_MS = 2000`.
    - `EXPORT_FILE_LIFETIME_MS = 24 * 60 * 60 * 1000` (24h — for client display only; server's `expires_at` is authoritative).
    - `EXPORT_JSON_SCHEMA_VERSION = "1.0.0"`.
    - Zod schemas: `requestExportInputSchema`, `requestExportOutputSchema`, `getExportInputSchema`, `getExportOutputSchema`. Use `EXPORT_FORMATS`/`EXPORT_STATUSES` as the enum sources.
  - [ ] T2.2 Audit constants:
    - `SHARING_AUDIT_EXPORT_QUEUED = "export.queued"`.
    - `SHARING_AUDIT_EXPORT_GENERATED = "export.generated"`.
    - `SHARING_AUDIT_EXPORT_FAILED = "export.failed"`.
    - `SHARING_AUDIT_RECORD_EXPORTED = "record.exported"` (the patient-surfaced one per AC5 verbatim).
  - [ ] T2.3 Extend `ACCESS_LOG_EVENT_KINDS` (Story 5.3) to include `record.exported`.
  - [ ] T2.4 Extend `ACCESS_LOG_EVENT_LABEL_PT_BR_FN` with the `record.exported` case: `"Você exportou seu registro completo ({format.toUpperCase()})."` — accepts `format` from `metadata.format`.
  - [ ] T2.5 Re-export from `packages/validators/src/index.ts`.

- [ ] **T3. Router — `requestExport` + `getExport` (AC6, AC7, AC10).** (AC: 6, 7, 10)
  - [ ] T3.1 `packages/api/src/router/sharing.ts` — add `requestExport` `protectedProcedure.mutation` per AC6. **NO premium gate** (LGPD exception per AC6 dev note). Tx wraps INSERT + outbox + audit per Story 5.2 pattern.
  - [ ] T3.2 Same file — add `getExport` `protectedProcedure.query` per AC7. Generates signed URL via the service-role Supabase client (re-use the same pool Story 5.1 used for verifyShareToken, or instantiate via `createServerSupabaseClient` from `packages/auth`).
  - [ ] T3.3 Update `packages/api/src/sharing.ts` helpers if any export-specific shape goes there (e.g. a `validateExportFormat` helper — likely overkill; skip unless tests demand).

- [ ] **T4. `services/llm` consumer + react-pdf (AC4, AC8).** (AC: 4, 8)
  - [ ] T4.1 `services/llm/package.json` — add `@react-pdf/renderer` dep (latest stable). Query Context7 for current major version. Verify Node 22 compatibility.
  - [ ] T4.2 `services/llm/src/consumers/generate-export.ts` (NEW) — pg-boss handler per AC8. Service-role connection. JSON path via `JSON.stringify(payload, null, 2)` with `﻿` BOM. PDF path via react-pdf streaming to Buffer.
  - [ ] T4.3 `services/llm/src/pdf/RecordExportPdf.tsx` (NEW) — react-pdf JSX layout per AC4 (cover page + 4 sections + footer page numbers). Lora + DM Sans loaded via `Font.register({ family: 'Lora', src: ... })`.
  - [ ] T4.4 `services/llm/src/index.ts` — register the new queue `record.export.generate` with `retryLimit: 3, retryDelay: 30, retryBackoff: true` (mirror `letter.generate`). Call `registerGenerateExportConsumer(boss, { sql, supabase })`.
  - [ ] T4.5 Supabase service-role client wiring in `services/llm/src/supabase.ts` (NEW or extend existing) — uses `SUPABASE_SERVICE_ROLE_KEY` env. Confirm the key is already loaded in services/llm; if not, add to `.env.example` + CLAUDE.md required-vars.
  - [ ] T4.6 Unit test `services/llm/__tests__/consumers/generate-export.test.ts` — stub Supabase Storage upload; assert JSON shape matches AC3; assert state transitions (queued → generating → ready); assert failure path writes `status='failed'` + audit.
  - [ ] T4.7 PDF rendering smoke test `services/llm/__tests__/pdf/render-export.test.ts` — render with a small fixture, assert output starts with `%PDF-` magic bytes; assert page count >= 2 (cover + at least one content page).

- [ ] **T5. UI — screen + ExportProgressCard (AC1, AC2).** (AC: 1, 2)
  - [ ] T5.1 `packages/ui/src/components/ExportFormatOption/ExportFormatOption.tsx` (NEW or reuse `DurationOption`). Radio-style card with label + hint.
  - [ ] T5.2 `packages/ui/src/components/ExportProgressCard/ExportProgressCard.tsx` (NEW). Renders `queued`/`generating`/`ready`/`failed` states. "Baixar" button (`ready`), "Tentar novamente" button (`failed`). Indeterminate progress for non-ready states (Tamagui Spinner).
  - [ ] T5.3 `apps/expo/src/app/configuracoes/dados/exportar.tsx` (NEW; verify the `configuracoes/dados/` route group exists — if not, create the layout + parent index). Renders the format selector + Exportar button. On submit: tracks `exportId` in local state. Polls `getExport` via `useQuery({refetchInterval: 2000})`. Persists `exportId` to AsyncStorage so re-entry resumes polling.
  - [ ] T5.4 `apps/web/src/app/configuracoes/dados/exportar/page.tsx` (NEW) — web parity. `exportId` lives in URL query param (`?exportId=...`) so page refresh resumes.
  - [ ] T5.5 Download trigger: Expo uses `Share.share({ url })` from RN `Share`; web uses `<a href={downloadUrl} download={filename}>` programmatic click. Filename: `healthtracker-export-{YYYY-MM-DD}.{format}`.

- [ ] **T6. Tests across the seam.** (AC: all)
  - [ ] T6.1 Validator unit tests — `requestExportInputSchema` accepts json/pdf, rejects other; `EXPORT_FORMAT_OPTIONS` array length === 2.
  - [ ] T6.2 Integration test for `requestExport` — `it.todo()` placeholders for testcontainer cases.
  - [ ] T6.3 RLS test T1.7.
  - [ ] T6.4 Schema integration test T1.6.
  - [ ] T6.5 Consumer + PDF smoke tests T4.6, T4.7.
  - [ ] T6.6 ExportProgressCard snapshot scaffold (per `ShareBiomarkerToggle.test.tsx` precedent).

- [ ] **T7. Env + docs.**
  - [ ] T7.1 `.env.example` — confirm `SUPABASE_SERVICE_ROLE_KEY` is present (it should be, from prior epics). No new vars.
  - [ ] T7.2 CLAUDE.md — append "Export discipline (Story 5.5)" paragraph: async pg-boss + Supabase Storage; LGPD Art. 18 exemption from premium gate; signed-URL TTL 1h, file lifetime 24h; re-request is cheap (no dedup).
  - [ ] T7.3 `docs/rls-review-checklist.md` — add `exports` to the patient-only-RLS table list.

## Dev Notes

### Architecture references (authoritative)

- **LGPD Art. 18 data portability:** non-negotiable patient right; export must be available to all patients (no premium gate). The only sharing-related action that's free-for-all.
- **Async pg-boss pattern:** `_bmad-output/implementation-artifacts/4-1-...md` letter generation + `_bmad-output/implementation-artifacts/5-2-...md` conversation_starter pre-gen are the precedents. Outbox INSERT into `pgboss.job` inside the same tx as the `exports` INSERT; singleton_key per export id to dedupe.
- **Supabase Storage signed URLs:** TTL bound; we choose 1h for download convenience but ~24h file lifetime so the patient can re-request a fresh URL without re-generating. Lifecycle cleanup is deferred (Story 5.x or Storage rules).
- **`record.exported` patient-actor audit:** per AC5 verbatim — extends Story 5.3 Access Log's allowlist.
- **Existing `services/llm` Railway worker:** already on Node 22; already has Anthropic SDK; adding `@react-pdf/renderer` is additive.

### UX references

- **Configurações tab UX:** existing Story 1.x privacy/consent settings; mirror that pattern for the new Dados subsection.
- **Tier-2 sharing buttons:** UX-DR13 — "Exportar" is Tier 2 (not Tier 1) even though it's not technically a sharing action. Consistent with the rest of Epic 5.
- **No alarmist copy:** patient gets a calm "Gerando seu registro… (até 60 segundos)" — no urgency, no fear.

### Patterns to copy (don't reinvent)

- **`ctx.db.transaction` + outbox INSERT into `pgboss.job`** — Story 5.2 createShareToken precedent.
- **`writeAuditLog(tx, ...)`** in same tx.
- **404 not 403** on cross-patient lookup — Story 5.1 discipline.
- **Narrow catches** — Story 5.1 R1 / 5.4 R1 discipline.
- **Stub adapter pattern** — N/A here (no LLM call); the PDF/JSON generation is deterministic.
- **Cursor pagination** — N/A; getExport is single-row.
- **`ACCESS_LOG_EVENT_KINDS` allowlist + `_LABEL_PT_BR_FN`** — extend; Story 5.3 R1 pattern.
- **`pgEnum`** for `format` and `status` — Story 5.2 R1 pattern (`shareDurationEnum`).
- **`@ts-nocheck` test scaffold pattern** — Story 5.3/5.4 ui-package precedent.
- **AsyncStorage persistence on Expo** — Story 3.4 `query-cache-persister.ts` precedent (different mechanism; here we just persist `exportId` strings).

### Anti-patterns explicitly forbidden in 5.5

- Do **NOT** return JSON/PDF bytes in tRPC responses. All artifact bytes flow through Supabase Storage.
- Do **NOT** add a premium gate to `requestExport`. LGPD Art. 18 right.
- Do **NOT** broad-catch `(err)` in the consumer. Narrow to known shapes; rethrow programmer errors.
- Do **NOT** include raw PII (email, displayName) in the JSON export's `patient` object. UUID only.
- Do **NOT** cache the signed URL on the client. Every "Baixar" tap fetches a fresh URL via `getExport`.
- Do **NOT** add a CHECK constraint or partial unique index that prevents re-request. Spec allows multiple concurrent exports.
- Do **NOT** delete the `exports` row when the file expires — the audit trail depends on row existence. Cleanup job removes the storage object only.
- Do **NOT** ship a public bucket. Storage bucket `exports` is private; reads via signed URLs only.
- Do **NOT** use Tier-1 styling for "Exportar". UX-DR13.
- Do **NOT** inline pt-BR strings — all copy in `packages/validators/src/sharing.ts`.

### Latest tech notes

- **`@react-pdf/renderer`** — query Context7 for the current major version. Supports streaming to Buffer / Node Readable. Font loading via `Font.register(...)`. UTF-8 by default. Verify Node 22 compatibility (no native deps).
- **Supabase Storage `createSignedUrl`** — verify the current TS signature on `@supabase/supabase-js@2.x`. Should be `supabase.storage.from('exports').createSignedUrl(path, expiresInSeconds)` returning `{ data: { signedUrl }, error }`.
- **`useQuery({refetchInterval})`** TanStack v5 — `refetchInterval` can be a function `(query) => (query.state.data?.status === 'ready' || 'failed') ? false : 2000` to stop polling once terminal. Document the pattern in the screen.

### Previous story intelligence

- **Story 5.1 R1**: narrow catches, audit-in-tx, validators-as-truth, 404-not-403.
- **Story 5.2 R1**: outbox INSERT into pgboss.job in-tx; SELECT FOR UPDATE; pgEnum for category columns; idempotent UPDATE pattern.
- **Story 5.3 R1**: cursor pagination tuple compare; throttled refetch; invalidateQueries; suppressed-kind allowlist surface alignment.
- **Story 5.4 R1**: onError surfaces toast on failure; UPDATE with `WHERE ... RETURNING` for single-clock alignment; client/server enum split for status types.

### Project Structure Notes

- `packages/db/src/schema/sharing.ts` — extended in-place (one-feature-per-file precedent).
- `packages/db/policies/custom_rls_exports.sql` — matches `custom_rls_<table>.sql` naming.
- `packages/db/policies/supabase_storage_exports.sql` — matches `custom_storage_lab_uploads_policy.sql` precedent.
- `packages/api/src/router/sharing.ts` — extended in-place.
- `services/llm/src/consumers/generate-export.ts` + `services/llm/src/pdf/RecordExportPdf.tsx` — match `generate-letter.ts` + `prompts/anvisa-system.ts` per-feature precedent.
- `apps/expo/src/app/configuracoes/dados/exportar.tsx` + web parity — extends existing Configurações tab.
- `packages/ui/src/components/ExportFormatOption/`, `ExportProgressCard/` — barrel dirs.

No structural conflicts.

### Testing standards summary

- **DB integration + RLS:** testcontainer + new exports schema test + 3-identity RLS matrix.
- **API integration:** `it.todo()` placeholders; CI runs.
- **services/llm consumer:** unit test with stubbed Supabase Storage + stubbed sql client.
- **PDF render smoke:** assert magic bytes + minimum page count.
- **UI snapshot:** scaffold per ui-package precedent.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.5 lines 1320–1350]
- [Source: _bmad-output/planning-artifacts/architecture.md#LGPD Art. 18 portability]
- [Source: _bmad-output/implementation-artifacts/4-1-...md — services/llm worker + pg-boss queue precedent]
- [Source: _bmad-output/implementation-artifacts/5-2-...md — outbox INSERT into pgboss.job in-tx + pgEnum]
- [Source: _bmad-output/implementation-artifacts/5-3-...md — ACCESS_LOG_EVENT_KINDS allowlist extension]
- [Source: _bmad-output/implementation-artifacts/5-4-...md — onError toast pattern; UPDATE RETURNING discipline]
- [Source: packages/db/policies/custom_storage_lab_uploads_policy.sql — Supabase Storage RLS precedent]
- [Source: packages/api/src/audit.ts — writeAuditLog signature]
- [Source: CLAUDE.md — narrow catches, validators-as-truth, audit-in-tx discipline]

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Review fixes applied (2026-05-27)

All 11 "Patch (apply before merge)" items plus the three resolved decisions (A: partial unique index dedup; B: `LEFT JOIN loinc_ref` with `coalesce(biomarker_name_pt, biomarker_name)`; C: 5-minute client-side polling timeout) were applied.

- **Decision A — partial unique index `exports_active_uq`:** added on `packages/db/src/schema/sharing.ts` over `(patient_id) WHERE status IN ('queued','generating')`. `requestExport` wraps the INSERT in a narrow `23505` catch, re-SELECTs the racing active row via `inArray(Exports.status, ["queued","generating"])`, and skips the outbox enqueue + audit on the conflict path (the winning tx already did them). Mirrors `createShareToken` (Story 5.1 R1). `inArray` added to the `@healthtracker/db` re-exports.
- **Decision B — `LEFT JOIN loinc_ref`:** `loinc_ref` column verified as `biomarker_name_pt` (not `display_name_pt_br`; the spec text in resolved-decision-B was prescriptive but the actual schema name is what shipped). Consumer `loadObservations` now SELECTs `coalesce(lr.biomarker_name_pt, observations.biomarker_name)`. Existing test fixture unchanged (the SELECT now returns the coalesced value via the same `biomarker_name` column alias).
- **Decision C — `EXPORT_POLL_TIMEOUT_MS = 5 * 60_000`:** new constant in validators + new `EXPORT_STUCK_PT_BR` + `EXPORT_STUCK_BUTTON_PT_BR` copy. Both clients store `pollStartAt` in a ref and stop polling once elapsed (via `refetchInterval: false`). The Expo and web screens render the stuck CTA via new `stuck` prop on `ExportProgressCard` (web inlines the JSX).
- **Patch #1 (HIGH expired-ready):** `getExportOutputSchema` extended with `expired: boolean`. Resolver computes `expired = status === 'ready' && expiresAt <= now()`. Both clients render `EXPORT_EXPIRED_PT_BR` + "Tentar novamente" CTA when set; `ExportProgressCard` gained an `expired` prop.
- **Patch #2 (HIGH programmer-error retry):** final attempt (`retrycount + 1 >= RETRY_LIMIT`) now persists `status='failed'` + emits `export.failed` audit regardless of error recognition, then rethrows so Sentry still records programmer errors. `failure_reason` is `INTERNAL_ERROR` for unrecognised shapes (vs. `DB_ERROR` / `NETWORK_ERROR`). Added a new unit test covering `TypeError` final-attempt → `failed`.
- **Patch #3 (HIGH storage orphan):** wrapped the post-upload tx in inner try/catch. Tx failure AND final-attempt-failed branch both call `tryDeleteStorageObject(supabase, uploadedObjectPath)` — best-effort delete, swallowed cleanup error.
- **Patch #4 (HIGH worker-clock requestedAt):** consumer SELECT now also fetches `requested_at::text`; the `record.exported` audit metadata writes `row.requested_at` verbatim instead of `deps.now()`. Both fixtures updated.
- **Patch #5 (MEDIUM cross-origin filename):** `createExportDownloadSignedUrl` accepts a `filename?: string` arg and forwards `{ download: filename }` to `supabase.storage.createSignedUrl`. `getExport` computes the filename via `exportFilename(row.format, row.completedAt ?? row.expiresAt)`.
- **Patch #6 (MEDIUM client filename mid-poll switch):** both clients use `pollQuery.data?.format ?? format` when computing the download filename.
- **Patch #7 (MEDIUM Number precision/NaN):** new `parseNumericOrNull` helper preserves the parse-or-null contract for JSON exports. Documented in a banner comment.
- **Patch #8 (MEDIUM eager Supabase env):** `services/llm/src/index.ts` calls `getSupabaseClient()` once at boot after queue creation; failure aborts the process.
- **Patch #9 (LOW CLAUDE.md):** new "Export discipline (Story 5.5)" paragraph added under the code-review-discipline section.
- **Patch #10 (LOW rls-review-checklist):** `docs/rls-review-checklist.md` is identity-based, not table-list-based — skipped per the spec's "if it doesn't exist, skip" guidance.
- **Patch #11 (LOW spec text):** AC3 "eight required fields" → "seven required fields"; matching test comment updated.

**Verification gates:**

- `pnpm typecheck` — 17/17 PASS
- `pnpm lint` — 15/15 PASS (one transient warning about `Number.isFinite` narrowing was fixed by dropping the redundant `undefined` branch from `parseNumericOrNull`)
- `pnpm --filter @healthtracker/api test:unit` — 220/220 PASS
- `pnpm --filter @healthtracker/llm-service test:unit` — 26/26 PASS (added 1 new test for Patch #2 programmer-error final-attempt failed)

### Review Findings (2026-05-27)

Three-layer adversarial review. Two convergent issues: **expired-ready silent no-op** (Blind HIGH + Edge LOW) and **`record.exported` audit time uses worker clock, not request clock** (Blind + Edge). Plus several unique findings.

#### Decision-needed

- [ ] [Review][Decision] **Concurrent "Exportar" double-tap dedup** — `singleton_key = record.export.${exportId}` is per-row (exportId is freshly minted each resolver call) → useless for dedup. Two rapid taps create two rows + two jobs + two `record.exported` audit rows (duplicate Access Log entries) + two Storage uploads. Options: (a) client-side debounce (e.g. `mutation.isPending` already guards within one screen but not cross-device; add a 5s grace period after a successful submit); (b) partial unique index `ON exports (patient_id) WHERE status IN ('queued','generating')` — server-enforced single-in-flight; (c) accept and document (audit log will show duplicate "Você exportou" rows which is true history).
- [ ] [Review][Decision] **`biomarkerName` provenance** — spec said "resolved from `loinc_ref` table; falls back to `observations.biomarker_name`". Implementation skips the JOIN entirely, always uses `observations.biomarker_name`. Options: (a) add the `LEFT JOIN loinc_ref ON loinc_ref.loinc_code = observations.loinc_code` and coalesce; (b) keep current (`biomarker_name` is already pt-BR populated for extracted rows — `loinc_ref` adds nothing for most cases); (c) follow up in Story 5.x polish.
- [ ] [Review][Decision] **Stuck-export UX escape hatch** — polling runs forever if the worker is dead and the row stays at `queued`/`generating`. Options: (a) add a 5-minute client-side timeout that surfaces "Geração demorando mais que o esperado — pode tentar novamente" with a "Tentar novamente" CTA; (b) server-side reconciliation job (Story 5.7 / out of scope); (c) keep current — operator detects via metrics + pg-boss's 15-min `expireInSeconds` will reclaim the job.

#### Patch (apply before merge)

- [ ] [Review][Patch] **HIGH — Expired-ready silent no-op** — `packages/api/src/router/sharing.ts:660-670`, `apps/expo/.../exportar.tsx:122-127`, web `:295-306`. When `status === 'ready'` but `expires_at < now()`, `downloadUrl` is null; UI still renders "Pronto + Baixar" but tap silently no-ops. Fix: resolver returns a new `status='expired'` (or wraps `status='ready' + downloadUrl=null` with a flag), and the screen renders an `EXPORT_EXPIRED_PT_BR` ("Este link expirou. Toque em 'Exportar' novamente.") + a Tier-2 "Tentar novamente" button that resets `exportId=null` and surfaces the format picker again.
- [ ] [Review][Patch] **HIGH — Programmer-error retry never reaches `failed`** — `services/llm/src/consumers/generate-export.ts:2981-2991`. Unrecognised error shapes (TypeError/ReferenceError/SyntaxError) re-throw on every attempt including the last — never persist `status='failed'`, never write `export.failed` audit, row stuck at `queued` forever. Fix: the retry-budget check (`retrycount + 1 < RETRY_LIMIT`) must gate the rethrow ONLY (not the `UPDATE status='queued'`); on the final attempt, persist `failed` + audit + rethrow. OR: programmer errors are also persisted as `failed` (Sentry catches the rethrow either way; the row terminal state matters for the patient).
- [ ] [Review][Patch] **HIGH — Storage object orphaned on tx failure** — `services/llm/src/consumers/generate-export.ts:2915-2924`. Upload happens BEFORE the tx; if the tx fails (UPDATE deadlock, etc.) the file remains in Storage with no row pointer. Fix: on tx failure in the success path, `supabase.storage.from(EXPORTS_BUCKET).remove([objectPath])` before re-queueing. Same on final-attempt-failed branch.
- [ ] [Review][Patch] **HIGH — `record.exported.metadata.requestedAt` is worker time, not request time** — `services/llm/src/consumers/generate-export.ts:2965`. Patient-actor audit row's metadata claims `requestedAt` from `deps.now()` (worker clock), but the actual request time is `Exports.requestedAt` (resolver-time INSERT default). Fix: SELECT `requested_at` from the `exports` row at the start of `processOne` and use that value in the metadata. The Access Log will then surface the patient's actual request time, not the generation completion time.
- [ ] [Review][Patch] **MEDIUM — Web `<a download>` is advisory for cross-origin URLs** — `apps/web/.../exportar-client.tsx:299-305`. Supabase signed URLs are cross-origin; browsers ignore the `download` attribute filename and use the URL path basename (`{exportId}.json`). Fix: pass `{download: filename}` as the 3rd arg to `supabase.storage.from(...).createSignedUrl(path, ttl, {download: filename})` — this sets `Content-Disposition: attachment; filename=...` server-side. The filename helper output is then authoritative.
- [ ] [Review][Patch] **MEDIUM — Filename uses client-side `format` state not `pollQuery.data.format`** — `apps/expo/.../exportar.tsx:141`, web `:301`. If patient picks JSON, taps Exportar, switches the radio to PDF mid-poll, then taps Baixar — the filename says `.pdf` but the artifact is JSON. Fix: derive filename from `pollQuery.data?.format` (server is authoritative).
- [ ] [Review][Patch] **MEDIUM — `Number(value_numeric)` precision loss + NaN→null** — `services/llm/src/consumers/generate-export.ts:3052`. `value_numeric` is `::text` in the SELECT then re-parsed via `Number(...)`. High-precision decimals lose digits; non-numeric/null become NaN which JSON.stringify emits as `null`. Fix: keep `value_numeric` as a string in the JSON payload (preserves fidelity); or use `parseFloat` with NaN guard `Number.isFinite(n) ? n : null` and document the precision contract.
- [ ] [Review][Patch] **MEDIUM — Supabase env check is lazy** — `services/llm/src/supabase.ts:3545-3565`. `getSupabaseClient()` reads env only on first call. A misconfigured production worker boots happily, accepts jobs, then explodes on first export with retries. Fix: eagerly invoke `getSupabaseClient()` in `services/llm/src/index.ts` after queue creation; failure aborts boot.
- [ ] [Review][Patch] **LOW — CLAUDE.md "Export discipline" + `docs/rls-review-checklist.md`** — T7.2 + T7.3 from the spec were missed. Append a one-paragraph "Export discipline (Story 5.5)" note to CLAUDE.md (LGPD exception from premium gate; signed-URL TTL 1h; file lifetime 24h; deferred-server-write/multi-device gap; orphan-cleanup is post-merge work). Add `exports` to the patient-only-RLS table list.
- [ ] [Review][Patch] **LOW — Singleton-key comment misleading** — `packages/api/src/router/sharing.ts:602`. Comment says "Singleton key per row dedups". pg-boss only enforces singleton_key with `singleton_seconds`/etc., and the ON CONFLICT clause matches no unique constraint. Either fix the comment ("inert — exportId is fresh per call; reserved for future per-patient dedup") or wire actual dedup (decision #1 above).
- [ ] [Review][Patch] **LOW — Spec AC3 says "eight required fields" but enumerates 7** — `_bmad-output/.../5-5-...md` AC3. The example shape has 7. Implementation emits 7. Fix the spec text: change "eight" to "seven" so future readers don't hunt for a missing field.

#### Deferred (pre-existing or out-of-scope)

- [x] [Review][Defer] **PDF Lora/DM Sans fonts** — no font files in repo (spec assumed Story 4.1 bundled them). Uses built-in Helvetica. Story 5.x polish.
- [x] [Review][Defer] **Multi-device export discovery** — no `listMyExports` query. Patient on mobile can't see an in-flight export from web. Acceptable for v1.
- [x] [Review][Defer] **PDF `wrap={false}` overflow on dates with hundreds of biomarkers** — typical scale OK; document.
- [x] [Review][Defer] **JSON BOM** — by design (Excel UTF-8 interop); JSON.parse consumers must strip.
- [x] [Review][Defer] **`exportFilename` uses UTC date** — minor cosmetic drift on midnight-boundary downloads.
- [x] [Review][Defer] **Test non-null assertion `parsed.observations[0]!`** — fragile if fixture trimmed; currently safe.
- [x] [Review][Defer] **Drive-by lint fix in `biomarker-suggestion.test.ts`** — 5 unnecessary casts auto-removed by `lint:fix`. Type-safe; pre-existing debt.
- [x] [Review][Defer] **Reference range columns SELECTed but discarded from JSON** — runtime-safe (columns exist); minor waste.
- [x] [Review][Defer] **Storage object cleanup post-`expires_at`** — Supabase Storage lifecycle rule OR scheduled `record.export.cleanup` job; tracked in deferred-work.
- [x] [Review][Defer] **`Share.share({url, message: url})` redundancy** — cross-platform parity; harmless.

### Known infra blockers (out-of-code)

- **Production migration still deferred.** Story 5.7 lands `exports` table + `custom_rls_exports.sql` + `supabase_storage_exports.sql` + the `record.export.generate` pg-boss queue init.
- **Supabase Storage `exports` bucket** must exist in dev/staging/prod. Dev applies via `psql -f packages/db/policies/supabase_storage_exports.sql`.
- **File-lifetime cleanup job** is out of scope. Either a Supabase Storage lifecycle rule or a scheduled pg-boss `record.export.cleanup` job. Tracked in deferred-work.
- **`@react-pdf/renderer` Node 22 / Hermes compatibility** — server-side only (no React Native dep). Verify at install time; if it has unexpected native deps, the Railway worker may need rebuild.
- **Life events (Epic 7)** — JSON schema slot exists (`lifeEvents: []`); PDF section has empty-state copy. When Epic 7 lands, the consumer joins `life_events` table; export schema doesn't change.
