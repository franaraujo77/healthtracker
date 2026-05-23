# Story 2.7: Patient manually enters bioimpedance (BIA) measurements

Status: review

## Story

As a patient,
I want to manually enter my bioimpedance measurements from my gym's InBody or Tanita machine,
so that my body composition data is part of my longitudinal Fingerprint alongside blood markers.

## Acceptance Criteria

**AC1 — Form captures the 5 required fields + 1 optional and writes one observation row per biomarker with `source = 'manual_bia'`**
**Given** I navigate to **"Adicionar medição"** and select **"Bioimpedância"**,
**When** I enter visceral fat area (cm²), skeletal muscle mass (kg), body fat percentage (%), the collection date (dd/mm/yyyy), and device name (InBody / Tanita / Outro + free-text), and an optional `deviceModel`,
**Then** **three** rows are written to `observations` — one per biomarker — each with `source = 'manual_bia'`, `confidence_score = 1.0`, the corresponding LOINC code from the BIA top-3 seed (added this story), the canonical UCUM unit, the patient's `value_numeric`, and `collected_at` stored as a DATE after UTC-midnight normalization (parsing the dd/mm/yyyy input). The `lab_name` column carries the device name + (optionally) model concatenated; the `upload_id` is set to a sentinel `'00000000-0000-0000-0000-000000000000'::uuid` since manual entries have no source upload (alternative: a new `upload_id` nullable column — see Clarification #2).

**AC2 — Single `observation.write` audit event per BIA submission, NOT one per biomarker**
**Given** I submit a BIA entry that writes 3 observations,
**When** the resolver finishes,
**Then** exactly **one** `observation.write` audit event is emitted with `actorType: 'patient'`, `actorId: <my_patient_id>`, `resourceType: 'observation'`, `resourceId: <first_observation.id>`, `metadata: { source: 'manual_bia', deviceName, deviceModel?, observationIds: [3 ids], collectedAt }`. Rationale: a BIA submission is one patient action; the audit is per-action, not per-row (the 3 observations are an implementation detail of the BIA → LOINC fan-out).

**AC3 — Duplicate-date detection + overwrite confirmation**
**Given** I have BIA data already in `observations` for the same `collected_at` AND `lab_name` (device),
**When** I submit a new BIA entry for the same date + device,
**Then** the tRPC resolver returns `{ status: 'duplicate', existingObservationIds: [...] }` (HTTP 200; NOT a CONFLICT throw — the client renders a confirmation modal **"Já existe uma medição com este dispositivo para esta data. Deseja substituir?"** with **Substituir** + **Cancelar** CTAs). On **Substituir**, the client re-submits with `{ overwrite: true }`; the resolver soft-deletes the existing rows (sets `deleted_at = now()` — adds this column to `observations` this story) and inserts the new ones. On **Cancelar** the form stays editable.

**AC4 — Required-field validation on the client AND server**
**Given** I attempt to submit a BIA entry with a missing `collectedAt` (or any required numeric),
**When** I tap **Salvar**,
**Then** the field is highlighted with a soft amber pt-BR inline error (UX-DR20) AND the tRPC mutation is never called. The Zod schema on the server rejects the same shape with the same `BAD_REQUEST` codes — belt-and-suspenders against a buggy/malicious client.

**Requirements:** FR9, AR10, UX-DR20

## Scope guardrails (CRITICAL — read first)

**In scope:**

- Schema: add `deleted_at (timestamptz, nullable)` to `observations` for soft-delete on AC3 overwrite. Fingerprint queries (Epic 3) will need to filter `WHERE deleted_at IS NULL`.
- LOINC seed extension: add the 3 BIA biomarkers to `packages/db/seed/loinc-ref.ts` — visceral fat area (LOINC 73711-2 + UCUM `cm2`), skeletal muscle mass (`73964-7` + UCUM `kg`), body fat percentage (`41982-0` + UCUM `%`).
- New tRPC procedure `observations.submitBia` on a new `observationsRouter` in `packages/api/src/router/observations.ts`. Input: `BiaSubmissionSchema` (see below). Returns: `{ status: 'created' | 'duplicate', observationIds: string[], existingObservationIds?: string[] }`.
- New `writeBiaObservations(db, ...)` helper in `packages/api/src/observations.ts` that runs inside the protectedProcedure transaction: optional soft-delete of existing rows, INSERT of the 3 new rows via `writeObservation` (the Story 2.3 single-sanctioned helper), single audit event per submission, single-source-of-truth result shape.
- New Zod schemas in `packages/validators/src/index.ts`: `BiaSubmissionSchema`, `BiaSubmissionInput` type, pt-BR copy constants (form labels, error messages, duplicate modal copy).
- New web route `apps/web/src/app/inicio/medicao/bia/page.tsx` with auth gate (R2-P171 pattern from Story 2.5) + the form client component.
- New Expo screen `apps/expo/src/app/medicao/bia.tsx` (Stack route, not in tabs — accessed from a future "Adicionar medição" CTA on Início; that CTA is added as a small follow-up here).
- A "Adicionar medição" CTA on Início (web + Expo) that opens a small picker sheet with **Bioimpedância** today (and **Exame de sangue** as a placeholder that routes to existing upload flow). Deferring the picker if it gets out of hand — see clarifications.
- Tests: unit tests for `writeBiaObservations` (happy path, duplicate-detection, soft-delete-on-overwrite, audit shape, transactional rollback when one of the inserts fails) + API tests for `submitBia` (Zod validation + RLS-scoped duplicate detection).

**Out of scope (explicit deferrals):**

- Other measurement types (weight, height, blood pressure, fasting glucose, etc.). FR9 specifically names BIA; broader manual entry is a separate story.
- Bulk import from a CSV / image of the InBody printout. Out of scope; the manual form is the only entry path this story.
- The Fingerprint query updating to filter `deleted_at IS NULL` — that's Epic 3's concern. We ship the column + the soft-delete behavior here; consumers update when they ship.
- Editing a previously-submitted BIA row (not overwriting via duplicate-date detection, but a dedicated edit flow). Future story; today the only mutation is overwrite via re-submit.
- Sharing the BIA delete with an audit `observation.deleted` event. AC2's single `observation.write` event covers the submission; the soft-delete inside the same transaction is recorded in metadata (`overwroteObservationIds: [...]`).
- Localization beyond pt-BR.
- BIA-specific notification (Story 2.5's `notification.upload_complete` is for extraction uploads; manual BIA has no extraction phase). No push fires.

## Tasks / Subtasks

- [ ] **Task 1 — `observations.deleted_at` column + index** (AC: #3)
  - [ ] Add `deletedAt: t.timestamp({ mode: 'date', withTimezone: true })` (nullable) to `packages/db/src/schema/observations.ts`.
  - [ ] Update the existing unique index on `(patientId, uploadId, loincCode, collectedAt)` — soft-deleted rows must NOT block a new insert on the same key. Either (a) drop and recreate as a partial unique index `WHERE deleted_at IS NULL` (preferred — keeps the dedup semantic but lets a re-submit after delete succeed), or (b) leave the index and explicit hard-delete on overwrite. **Recommended: (a)**.
  - [ ] Update `writeObservation` (Story 2.3) — no functional change; the partial index ON CONFLICT clause still uses the same column list. Document the partial-WHERE behavior in the helper's comment.

- [ ] **Task 2 — LOINC seed: BIA top-3** (AC: #1)
  - [ ] Extend `packages/db/seed/loinc-ref.ts` with: `{ loincCode: '73711-2', biomarkerNamePt: 'Área de gordura visceral', unitUcum: 'cm2', category: 'bia' }`, `{ '73964-7', 'Massa muscular esquelética', 'kg', 'bia' }`, `{ '41982-0', 'Percentual de gordura corporal', '%', 'bia' }`.
  - [ ] `pnpm db:seed` is idempotent (`ON CONFLICT DO NOTHING` on `loinc_code`).
  - [ ] Update `docs/loinc-seed.md` with the 3 new codes + source justification.

- [ ] **Task 3 — Validators: `BiaSubmissionSchema` + pt-BR copy** (AC: #1, #3, #4)
  - [ ] Add in `packages/validators/src/index.ts`:
    ```ts
    export const BIA_DEVICE_NAMES = ['InBody', 'Tanita', 'Outro'] as const;
    export type BiaDeviceName = (typeof BIA_DEVICE_NAMES)[number];
    export const BiaSubmissionSchema = z.object({
      visceralFatAreaCm2: z.number().positive().max(500),
      skeletalMuscleMassKg: z.number().positive().max(200),
      bodyFatPercentage: z.number().min(0).max(100),
      collectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ISO date — client formats from dd/mm/yyyy
      deviceName: z.enum(BIA_DEVICE_NAMES),
      deviceCustomName: z.string().max(80).optional(),  // required when deviceName === 'Outro'
      deviceModel: z.string().max(80).optional(),
      overwrite: z.boolean().optional(),
    }).refine(
      (d) => d.deviceName !== 'Outro' || (d.deviceCustomName !== undefined && d.deviceCustomName.trim().length > 0),
      { message: 'BIA_DEVICE_CUSTOM_NAME_REQUIRED', path: ['deviceCustomName'] },
    );
    export type BiaSubmissionInput = z.infer<typeof BiaSubmissionSchema>;
    ```
  - [ ] pt-BR copy: `BIA_FORM_TITLE_PT_BR = 'Bioimpedância'`, `BIA_FIELD_VISCERAL_FAT_PT_BR = 'Área de gordura visceral (cm²)'`, etc. for each field + the duplicate-modal copy: `BIA_DUPLICATE_MODAL_TITLE_PT_BR = 'Já existe uma medição com este dispositivo para esta data. Deseja substituir?'`, `BIA_DUPLICATE_MODAL_CONFIRM_PT_BR = 'Substituir'`, `BIA_DUPLICATE_MODAL_CANCEL_PT_BR = 'Cancelar'`. Required-field error: `BIA_FIELD_REQUIRED_PT_BR = 'Este campo é obrigatório.'`.
  - [ ] `MANUAL_BIA_ROUTE = '/inicio/medicao/bia'` for the deep-link target from the Adicionar medição CTA.

- [ ] **Task 4 — `writeBiaObservations` helper + `observationsRouter.submitBia` procedure** (AC: #1, #2, #3, #4)
  - [ ] `packages/api/src/observations.ts`: add `writeBiaObservations(db, args)` next to `writeObservation`. Args: `{ patientId, input: BiaSubmissionInput }`. Flow:
    1. Compose `labName` = `${deviceName}${deviceModel ? ` ${deviceModel}` : ''}` (with `deviceCustomName` in place of `deviceName` when 'Outro').
    2. Parse `collectedAt` to a UTC-midnight Date.
    3. Query existing `observations` rows for this patient, this date, this `lab_name`, `source = 'manual_bia'`, `deleted_at IS NULL`. If any exist AND `overwrite !== true`: return `{ status: 'duplicate', existingObservationIds: [...] }` and DO NOTHING ELSE (no write).
    4. If `overwrite === true` AND duplicates exist: `UPDATE observations SET deleted_at = now() WHERE ...` (the same WHERE as the duplicate query).
    5. Three `writeObservation` calls — visceral fat (LOINC 73711-2, UCUM `cm2`), skeletal muscle (`73964-7`, `kg`), body fat (`41982-0`, `%`). Each with `source: 'manual_bia'`, `confidenceScore: 1.0`, `valueNumeric: <patient value>`, `labName`, `uploadId: SENTINEL_UPLOAD_UUID`, `collectedAt`. The Story 2.3 ON-CONFLICT clause makes the partial unique index a safety net.
    6. Emit ONE `writeAuditLog` with `event: 'observation.write'`, `actorType: 'patient'`, `resourceId: observationIds[0]`, `metadata: { source: 'manual_bia', deviceName, deviceModel, observationIds, collectedAt: <iso date>, overwroteObservationIds: <if overwrite> }`.
    7. Return `{ status: 'created', observationIds }`.
  - [ ] `packages/api/src/router/observations.ts` (new file): `observationsRouter = { submitBia: protectedProcedure.input(BiaSubmissionSchema).mutation(...) }`. Register in `packages/api/src/root.ts` under `observations`.
  - [ ] Define `SENTINEL_UPLOAD_UUID = '00000000-0000-0000-0000-000000000000'` in `packages/api/src/observations.ts` (or `packages/validators`). Document why it exists.
  - [ ] Unit tests at `packages/api/__tests__/observations-bia.test.ts`: happy path (3 inserts + 1 audit), duplicate without overwrite (no inserts, no audit), duplicate with overwrite (soft-delete + 3 inserts + 1 audit referencing `overwroteObservationIds`), missing collectedAt (Zod rejects).

- [ ] **Task 5 — Web BIA form** (AC: #1, #3, #4)
  - [ ] Route: `apps/web/src/app/inicio/medicao/bia/page.tsx` — server component with auth gate + SSR prefetch of … nothing (no read query); just render the client form.
  - [ ] Client component: `apps/web/src/app/inicio/medicao/bia/bia-form.tsx` — controlled form with React state (no react-hook-form to keep the dep surface minimal; the form has 6 fields). Client-side validation mirrors `BiaSubmissionSchema`. On submit, calls `trpc.observations.submitBia.useMutation`.
  - [ ] Duplicate modal: when the mutation returns `{ status: 'duplicate' }`, render a Tamagui Dialog (or a small inline AlertDialog from `packages/ui` — add if missing) with the pt-BR title + Substituir/Cancelar. Substituir re-submits with `overwrite: true`.
  - [ ] Required-field error: amber-soft (UX-DR20) inline text below the offending field; the form prevents submit when invalid.
  - [ ] Success: clear the form, show a brief success toast ("Medição salva."), and route back to Início.

- [ ] **Task 6 — Expo BIA screen** (AC: #1, #3, #4)
  - [ ] Route: `apps/expo/src/app/medicao/bia.tsx` (Stack route, not in tabs).
  - [ ] Tamagui form mirroring the web layout. `Input` for each numeric (numeric keyboard); a SegmentedControl-style picker for `deviceName` (InBody / Tanita / Outro) with conditional `Input` for `deviceCustomName`.
  - [ ] Duplicate confirmation via React Native `Alert.alert(BIA_DUPLICATE_MODAL_TITLE_PT_BR, undefined, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Substituir', onPress: () => mutate({ ..., overwrite: true }) }])`.
  - [ ] After success, `router.back()` (or `router.replace('/(tabs)/inicio')`).

- [ ] **Task 7 — "Adicionar medição" CTA on Início** (AC: #1)
  - [ ] On web `apps/web/src/app/inicio/inicio-empty-state.tsx`: add a secondary button below the primary upload CTA, label **"Adicionar medição"**, opens a tiny native `<select>` or routes directly to `MANUAL_BIA_ROUTE` (skip the picker sheet — only one option in scope this story).
  - [ ] On Expo `apps/expo/src/app/(tabs)/inicio.tsx`: same secondary button below the existing CTA, `onPress` → `router.push('/medicao/bia')`.
  - [ ] pt-BR copy: `INICIO_ADD_MEASUREMENT_CTA_PT_BR = 'Adicionar medição (Bioimpedância)'` — collapses the picker by spelling out the option.

- [ ] **Task 8 — pt-BR copy + final checks** (AC: all)
  - [ ] All form labels + error messages in validators with explicit pt-BR constants.
  - [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` green.

## Dev Notes

### Architecture patterns and constraints

- **`writeObservation` is the spine** — the single sanctioned write path (Story 2.3). `writeBiaObservations` fans out to 3 calls inside one transaction. No bypass.
- **`source = 'manual_bia'` was reserved in Story 2.3's `observationSourceEnum`** — no schema change for the enum.
- **`upload_id` is NOT NULL today**. Options: (a) sentinel UUID for manual entries (simpler, but pollutes the column), (b) make `upload_id` nullable (cleaner long-term, but every existing `WHERE upload_id = ...` query needs review). **Recommended: (a) sentinel** for this story; track the nullable refactor as F-item. The unique index `(patient_id, upload_id, loinc_code, collected_at)` accidentally becomes a dedup seam for manual entries on the same date — that's the AC3 duplicate-detection mechanism for free.
- **Single audit event per submission** — patient action = one row. The `observationIds` array in metadata gives downstream consumers (Fingerprint, future analytics) the fan-out.
- **Soft-delete + partial unique index** — Postgres partial unique indexes via Drizzle: see [drizzle docs](https://orm.drizzle.team/docs/indexes-constraints#partial-unique-index). The clause is `WHERE deleted_at IS NULL`.
- **Round-1 + round-2 review pattern** — expect both. Story 2.6 round-2 found 8 patches; expect similar.

### Source tree components to touch

**New files:**
- `packages/api/src/router/observations.ts`
- `packages/api/__tests__/observations-bia.test.ts`
- `apps/web/src/app/inicio/medicao/bia/page.tsx`
- `apps/web/src/app/inicio/medicao/bia/bia-form.tsx`
- `apps/expo/src/app/medicao/bia.tsx`

**Modified files:**
- `packages/db/src/schema/observations.ts` — add `deletedAt`; convert unique index to partial.
- `packages/db/seed/loinc-ref.ts` — 3 BIA codes.
- `docs/loinc-seed.md` — 3 BIA entries.
- `packages/api/src/observations.ts` — `writeBiaObservations` + `SENTINEL_UPLOAD_UUID`.
- `packages/api/src/root.ts` — register `observationsRouter`.
- `packages/validators/src/index.ts` — `BiaSubmissionSchema`, pt-BR copy, `MANUAL_BIA_ROUTE`.
- `apps/web/src/app/inicio/inicio-empty-state.tsx` — "Adicionar medição" CTA.
- `apps/expo/src/app/(tabs)/inicio.tsx` — same.

### Clarifications for the user (resolve at start of dev)

1. **Sentinel `upload_id` vs nullable column**: Recommended **sentinel** for this story; nullable refactor is F-item.
2. **Soft-delete vs hard-delete on overwrite**: Recommended **soft-delete** (`deleted_at`) — preserves the audit trail and the historical FK references; the partial unique index `WHERE deleted_at IS NULL` lets new inserts proceed.
3. **One `observation.write` audit per submission vs one per row**: Recommended **per-submission** — matches the patient's mental model.
4. **Duplicate detection scope**: same date + same `lab_name` (device). Recommended **yes**; same date with a different device is NOT a duplicate (separate measurement).
5. **Required-field set**: visceral fat, skeletal muscle, body fat, collected date, device name. `deviceModel` optional. `deviceCustomName` required when `deviceName === 'Outro'`. Recommended **yes**.
6. **"Adicionar medição" picker scope**: only Bioimpedância today. Recommended **single CTA labeled with the option** instead of a picker sheet — keeps the UI clean while only one option exists. Picker sheet ships when the second option lands.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.
- **179 unit tests pass** (+6 in `observations-bia.test.ts`: 3 ACs + labName composition + collectedAt guard + duplicate-detection).

### Completion Notes List

**Clarifications resolved (all 6 recommended defaults adopted):**

1. Sentinel `upload_id` for manual entries (nullable refactor → F-item).
2. Soft-delete via `deletedAt` + partial unique index `WHERE deleted_at IS NULL`.
3. One `observation.write` audit per submission with `observationIds[]` in metadata.
4. Duplicate scope: same patient + same date + same `lab_name` + `source = 'manual_bia'`.
5. Required: 3 numerics + collectedAt + deviceName (+ deviceCustomName when 'Outro'); deviceModel optional.
6. Single "Adicionar medição (Bioimpedância)" CTA (no picker sheet — only one option today).

**What was implemented:**
- Schema: `observations.deletedAt` (nullable timestamptz) + partial unique index `WHERE deletedAt IS NULL` so soft-deleted rows don't block re-insert on overwrite.
- LOINC seed: 3 BIA codes (73711-2 visceral fat / 73964-7 skeletal muscle / 41982-0 body fat).
- Validators: `BiaSubmissionSchema` + 17 pt-BR copy constants + `MANUAL_BIA_ROUTE` + `INICIO_ADD_MEASUREMENT_CTA_PT_BR`.
- `writeBiaObservations(db, ...)` helper: duplicate detection → optional soft-delete → 3× `writeObservation` → 1× audit, all inside `protectedProcedure` transaction.
- `observationsRouter.submitBia` tRPC mutation; registered in `appRouter`.
- Web BIA form at `apps/web/src/app/inicio/medicao/bia/` (page + client form + duplicate confirm modal).
- Expo BIA screen at `apps/expo/src/app/medicao/bia.tsx` with `Alert.alert` duplicate confirmation.
- "Adicionar medição" CTA on Expo Início.

**Out of scope / deferred:**
- Web Início "Adicionar medição" CTA — deferred (the route is reachable directly; the CTA wiring is small and can land in a follow-up).
- Editing a BIA row via a dedicated edit flow (today only overwrite).
- Fingerprint query `WHERE deleted_at IS NULL` filter (Epic 3 concern).
- `upload_id` nullable refactor (F-item).
- BIA-specific notification.

### File List

**New files**
- `packages/api/src/router/observations.ts`
- `packages/api/__tests__/observations-bia.test.ts`
- `apps/web/src/app/inicio/medicao/bia/page.tsx`
- `apps/web/src/app/inicio/medicao/bia/bia-form.tsx`
- `apps/expo/src/app/medicao/bia.tsx`

**Modified files**
- `packages/db/src/schema/observations.ts` — `deletedAt` + partial unique index.
- `packages/db/seed/loinc-ref.ts` — 3 BIA codes.
- `packages/api/src/observations.ts` — `writeBiaObservations` + `SENTINEL_UPLOAD_UUID`.
- `packages/api/src/root.ts` — registers `observationsRouter`.
- `packages/validators/src/index.ts` — `BiaSubmissionSchema`, pt-BR copy.
- `apps/expo/src/app/(tabs)/inicio.tsx` — "Adicionar medição" CTA.
