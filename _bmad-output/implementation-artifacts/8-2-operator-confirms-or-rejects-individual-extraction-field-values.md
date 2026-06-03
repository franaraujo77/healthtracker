# Story 8.2: Operator confirms or rejects individual extraction field values

Status: review

<!-- Second story of Epic 8. STACKS on Story 8.1 (operator read surface) — same worktree `worktree-story-8-1-operator-review-queue`, same PR branch (stacked-stories memory: do NOT open a new PR while 8.1 is unmerged). -->
<!-- Builds on the 8.1 operator principal: reuses `operatorProcedure`, the `/operador/fila/[uploadId]` detail page, `extraction_review_queue` (reason='loinc_unresolved'), and `app.current_operator_id`. -->
<!-- TWO load-bearing decisions confirmed with Francis at story-creation (2026-06-02): -->
<!--   (1) Operator WRITES escalate to `SET LOCAL ROLE postgres` INSIDE the operatorProcedure transaction, paired with `SET LOCAL ROLE NONE` in a `finally` (the `sharing.ts` activateProfessionalAccount precedent). NO new operator write RLS policies on observations/uploads/extraction_review_queue — the allowlist gate in `operatorProcedure` is the trust boundary. -->
<!--   (2) "Confirmar" publishes the extracted VALUE with `loinc_code = NULL` (the row is `loinc_unresolved` by definition; observations.loinc_code is nullable). The operator does NOT map a LOINC. source='operator_confirmed', confidence=1.0. -->

## Story

As an **operator**,
I want **to confirm or reject each flagged (`loinc_unresolved`) field in the manual review queue — confirming publishes the extracted value to the patient's record, rejecting marks it with a reason and tells the patient to enter it manually**,
so that **accurate values reach the patient's record and inaccurate ones are excluded with an auditable reason, at scale, without me ever seeing patient personal data**.

## Carried-forward context from Story 8.1 (read first)

- The operator acts ONLY on `extraction_review_queue` rows with `reason = 'loinc_unresolved'` (Story 8.1 scope; `low_confidence` is patient-facing via Story 2.4). Confirm/reject in 8.2 operate on the **same** `loinc_unresolved` rows the 8.1 detail page renders.
- `operatorProcedure` (Story 8.1) gates the session + `OPERATOR_USER_IDS` allowlist and binds `app.current_user_role='operator'` + `app.current_operator_id`. 8.1 left a TODO: the `app.current_operator_id` GUC exists precisely for **this** story's audit `actor_id`.
- 8.1 is read-only. **8.2 is the first operator WRITE surface.** Because the operator RLS principal has no write policy on `observations`/`uploads`/`extraction_review_queue` (and RLS hides `low_confidence` rows from it), every mutation in 8.2 runs under an in-transaction privilege escalation to the `postgres` role (decision 1 above), which BOTH bypasses the missing write policies AND lets the finalization count see ALL unresolved rows (both reasons) so the upload only completes when the patient's `low_confidence` rows are also done.

## Acceptance Criteria

> AC1–AC4 are lifted verbatim from `_bmad-output/planning-artifacts/epics.md` lines 1819–1837 (Story 8.2). AC5–AC12 are implementation-contract ACs locking the Epic 8 operator-write architecture.

1. **AC1 — Confirm publishes + finalizes + notifies.**
   **Given** I am reviewing a queue item with flagged fields,
   **When** I tap **"Confirmar"** on a field whose extracted value is correct,
   **Then** the field is published to `observations` (with the extracted value parsed from `value_text`, `loinc_code = NULL`, `unit_ucum` from `unit_text`, `source = 'operator_confirmed'`, `confidence_score = 1.0`, `collected_at` derived from `collected_at_text` or the upload date), the review-queue row is marked resolved, and — **if all review rows for that upload are now resolved** — the upload transitions `pending_review → complete` via `applyUploadTransition` and the patient receives the **"Seus resultados estão prontos"** notification.

2. **AC2 — Reject marks the field with a reason + notifies for manual entry.**
   **Given** I tap **"Rejeitar"** on a field whose extracted value is wrong,
   **When** I pick a reason from the predefined list (**"Separador decimal incorreto"**, **"Valor ilegível"**, **"Unidade incorreta"**) and confirm,
   **Then** the row is marked `rejected` (the new `rejection_reason` column is set; `resolved_at` stamped; **no** `observations` row is written), and — at upload finalization — the patient is notified that some values need manual entry.

3. **AC3 — Confirm writes `extraction_field.operator_confirmed` audit.**
   **Given** an operator confirms a field,
   **When** the action is persisted,
   **Then** `writeAuditLog()` records `event = 'extraction_field.operator_confirmed'` with `actorType = 'operator'`, `actorId = <operator auth.uid()>` (a UUID — anonymised as role, never the operator's name), and `metadata = { patientId, loincCode: <null for these rows>, uploadId, reviewQueueId }` + timestamp (the audit row's `created_at`). Reject writes the sibling `extraction_field.operator_rejected` with the same shape plus `rejectionReason`.

4. **AC4 — Mixed confirm/reject finalizes with confirmed fields only.**
   **Given** an upload has a mix of confirmed and rejected fields,
   **When** all of its review rows are resolved,
   **Then** the upload finalizes (`→ complete`) with **only the confirmed fields** in `observations` (rejected fields are excluded), and the completion notification tells the patient **which / how many** values need manual entry (the `manual_entry_required` notification, AC8).

5. **AC5 — In-transaction privilege escalation (the security core).**
   **Given** the operator RLS principal has no write policy on `observations`/`uploads`/`extraction_review_queue` and RLS hides `low_confidence` rows from it,
   **Then** both resolvers (`confirmReviewFieldAsOperator`, `rejectReviewFieldAsOperator`) execute their data mutations inside the `operatorProcedure` transaction wrapped as:

   ```ts
   await tx.execute(sql`SET LOCAL ROLE postgres`);
   try {
     // fetch target row, validate, write observation (confirm only),
     // UPDATE the review row, count ALL unresolved rows (both reasons),
     // attempt the transition, emit notification + audit
   } finally {
     await tx.execute(sql`SET LOCAL ROLE NONE`);
   }
   ```

   The `finally` reset is **mandatory** (CLAUDE.md "Privilege escalation must always reset in the same tx scope" — mirrors `sharingRouter.activateProfessionalAccount`, `packages/api/src/router/sharing.ts:1834/1874`). **No new operator write RLS policy** is added to any table — the `OPERATOR_USER_IDS` allowlist gate in `operatorProcedure` is the trust boundary, and escalation is the write mechanism. A regression test asserts the role is reset after the resolver returns AND after it throws.

6. **AC6 — Schema additions on `extraction_review_queue`.**
   **Given** rejections need a reason and operator resolutions need attribution,
   **Then** `packages/db/src/schema/extraction_review_queue.ts` gains:
   - a NEW `pgEnum` `rejection_reason_enum` with values `decimal_separator`, `illegible`, `wrong_unit` (closed set; pt-BR labels live in validators per AC10).
   - `rejectionReason: rejectionReasonEnum('rejection_reason')` (nullable). **`rejection_reason IS NOT NULL` is the discriminator for a rejected row**; a resolved row with `rejection_reason IS NULL` and `resolved_by_operator_id IS NOT NULL` is operator-confirmed.
   - `resolvedByOperatorId: t.uuid()` (nullable, **no FK** — mirrors the existing bare-uuid `resolvedByPatientId`; the operator's account deletion must not cascade-delete the patient's review row, and a bare uuid sidesteps the FK-cascade rule entirely).
     The existing `resolvedAt` is reused to stamp BOTH confirm and reject (consistent with the patient path). No `rejected_at` column.

7. **AC7 — `observations.source` gains `operator_confirmed`.**
   **Given** operator-confirmed observations need distinct provenance,
   **Then** `observation_source_enum` (`packages/db/src/schema/observations.ts`) is widened with `'operator_confirmed'` (additive `ALTER TYPE ... ADD VALUE` — a strict-superset WIDENING, safe via `db:push` per CLAUDE.md migration discipline). The `writeObservation` `ObservationInsert.source` union is widened to include it. **Verify** the existing `observations` partial-unique index predicate (`... AND source = 'manual_bia'`) is NOT affected by the new value (it isn't — the new value only adds a provenance label).

8. **AC8 — `manual_entry_required` notification kind.**
   **Given** rejected fields need the patient to act,
   **Then** a NEW notification kind `manual_entry_required` is added to `NotificationKind` (`packages/api/src/notifications.ts`), `NOTIFICATION_KIND_TO_PREFERENCE` + the validators `NotificationKind` (`packages/validators/src/index.ts`, mapped to the `reviewRequired` preference — it is an action-needed prompt, mirroring `pending_review`), and the push-send worker's kind→body map (`services/extraction` / wherever the notification body is built) with copy **"Alguns valores precisam ser inseridos manualmente"** (greppable, in validators). At finalization: if ≥1 field of the upload was rejected → emit `manual_entry_required`; else → emit `complete` ("Seus resultados estão prontos"). Exactly one finalization notification per upload (singleton-keyed `(uploadId, kind)`; the kind differs, so confirm-only vs has-rejection are distinct singletons — never both for one upload because the branch is exclusive at finalization).

9. **AC9 — Idempotency + concurrency.**
   **Given** double-taps and crash-recovery,
   **Then**: confirming an already-resolved row is a no-op (re-fetch under escalation; `CONFLICT`/`ALREADY_RESOLVED` if `resolved_at IS NOT NULL`, mirroring `confirmReviewFieldAsPatient`); the review-row UPDATE carries a `WHERE resolved_at IS NULL` optimistic guard; `writeObservation`'s ON-CONFLICT `(patient_id, upload_id, loinc_code, collected_at)` partial index is the publish idempotency seam (NOTE: with `loinc_code = NULL`, the unique index does NOT dedup two confirmed null-LOINC fields of the same upload+date — that is correct: distinct biomarkers with unresolved LOINC are distinct observations; document this explicitly); the `applyUploadTransition` optimistic lock (`WHERE status = 'pending_review'`) makes a concurrent finalizer a no-op; the completion-audit `notification.*` write tolerates the `23505` partial-unique race (catch + skip enqueue, exactly as the patient path does).

10. **AC10 — Rejection-reason enum + pt-BR labels + operator input schemas (greppable copy).**
    **Given** AC11 greppable-copy discipline,
    **Then** `packages/validators/src/operator.ts` (created in 8.1) gains: `OPERATOR_REJECTION_REASONS = ['decimal_separator','illegible','wrong_unit'] as const`; `OPERATOR_REJECTION_REASON_LABELS_PT_BR` (`decimal_separator → "Separador decimal incorreto"`, `illegible → "Valor ilegível"`, `wrong_unit → "Unidade incorreta"`); `confirmReviewFieldAsOperatorInputSchema = z.object({ reviewQueueId: z.uuid() }).strict()`; `rejectReviewFieldAsOperatorInputSchema = z.object({ reviewQueueId: z.uuid(), rejectionReason: z.enum(OPERATOR_REJECTION_REASONS) }).strict()`; and the confirm/reject button + sheet pt-BR copy (`OPERATOR_CONFIRM_CTA_PT_BR = "Confirmar"`, `OPERATOR_REJECT_CTA_PT_BR = "Rejeitar"`, `OPERATOR_REJECT_REASON_PROMPT_PT_BR`, `OPERATOR_REJECT_CONFIRM_CTA_PT_BR`, `OPERATOR_ACTION_ERROR_PT_BR`, success copy). No hard-coded pt-BR literal in components.

11. **AC11 — Audit kinds excluded from the Access Log.**
    **Given** operator actions are NOT patient-access events,
    **Then** `extraction_field.operator_confirmed` and `extraction_field.operator_rejected` are **NOT** added to `ACCESS_LOG_EVENT_KINDS` (`packages/validators/src/sharing.ts`). A validators regression test asserts each is absent (the `expect(...).not.toContain(...)` pattern the Audit-log conventions mandate). They are operational telemetry; the patient's Access Log narrates doctor access only.

12. **AC12 — Web confirm/reject UI on the 8.1 detail page (client island).**
    **Given** the 8.1 detail page (`/operador/fila/[uploadId]`) is a server component,
    **Then** a NEW client component (`OperatorFieldActions.tsx`, `"use client"`) renders per-field **"Confirmar"** / **"Rejeitar"** buttons (Reject opens a reason `<select>` over `OPERATOR_REJECTION_REASON_LABELS_PT_BR` + a confirm button), calling `operator.confirmField` / `operator.rejectField` via the web tRPC react client (mirror `apps/web/src/app/profissional/configuracoes/limiares/StalenessThresholdsForm.tsx`). On success it refreshes the route (`router.refresh()`); on error shows `OPERATOR_ACTION_ERROR_PT_BR`. The RSC detail page passes each field's `id` + `reviewQueueId` to the island. After a field resolves it disappears from the (re-fetched) `loinc_unresolved` list; when the last one resolves the page shows the 8.1 empty state.

**Requirements traceability:** FR39 (confirm/reject), FR40 (confirmed published + patient notified), FR41 (immutable audit of the action), AR10 (review-queue workflow), AR14 (audit trail), NFR-S4 (audit append-only; operator events excluded from Access Log), NFR-S7 (operator never sees PII — escalation writes are server-side; the operator UI still only renders anonymised fields), UX-DR20 (pt-BR + WCAG AA).

---

## Tasks / Subtasks

- [x] **Task 1 — Schema: rejection enum + operator-resolution columns + observation source (AC6, AC7)**
  - [x] 1.1 In `packages/db/src/schema/extraction_review_queue.ts`: add `rejectionReasonEnum = pgEnum("rejection_reason_enum", ["decimal_separator","illegible","wrong_unit"])`; add columns `rejectionReason: rejectionReasonEnum("rejection_reason")` (nullable) and `resolvedByOperatorId: t.uuid()` (nullable, no FK — mirror `resolvedByPatientId`). Update the JSDoc to document the confirm-vs-reject discriminator (`rejection_reason IS NOT NULL` ⇒ rejected).
  - [x] 1.2 In `packages/db/src/schema/observations.ts`: add `'operator_confirmed'` to `observationSourceEnum`. Confirm the partial-unique index predicate (`... source = 'manual_bia'`) is unaffected.
  - [x] 1.3 `pnpm db:push` (additive columns + enum widening — safe). **DEFER the live push** if no `DATABASE_URL` in the worktree (Epic 6/7 carry-forward) — document; ships in Story 8.3 migration.
  - [x] 1.4 Both schema deltas go on the Story 8.3 migration checklist (Dev Notes).

- [x] **Task 2 — Validators: rejection reasons, input schemas, pt-BR copy, audit kinds (AC10, AC11)**
  - [x] 2.1 Extend `packages/validators/src/operator.ts` with `OPERATOR_REJECTION_REASONS`, `OPERATOR_REJECTION_REASON_LABELS_PT_BR`, `confirmReviewFieldAsOperatorInputSchema`, `rejectReviewFieldAsOperatorInputSchema` (both `.strict()`, `z.uuid()`), and the AC10 button/sheet copy constants.
  - [x] 2.2 Add audit-kind constants `EXTRACTION_FIELD_OPERATOR_CONFIRMED = "extraction_field.operator_confirmed"` and `..._REJECTED = "extraction_field.operator_rejected"` (in operator.ts or alongside other audit kinds). Do **NOT** add either to `ACCESS_LOG_EVENT_KINDS` — add an inline `// AC11: deliberately excluded` comment.
  - [x] 2.3 Add `manual_entry_required` to the validators `NotificationKind` + `NOTIFICATION_KIND_TO_PREFERENCE` (→ `reviewRequired`). Add the body copy `MANUAL_ENTRY_REQUIRED_BODY_PT_BR = "Alguns valores precisam ser inseridos manualmente"` and reuse/confirm `RESULTS_READY_BODY_PT_BR` ("Seus resultados estão prontos") exists; if not, add it.

- [x] **Task 3 — Audit + notification plumbing (AC3, AC8)**
  - [x] 3.1 Widen `AuditLogEntry.actorType` (`packages/api/src/audit.ts`) to include `"operator"`. (`audit_log.actor_type` is free `text` — no DB enum change.)
  - [x] 3.2 Add `manual_entry_required` to `NotificationKind` in `packages/api/src/notifications.ts` and thread it through `enqueueNotificationSend` (singleton key `(uploadId, kind)` already generic).
  - [x] 3.3 Find the push-send worker's kind→body map (grep `pending_review`/`complete` body copy under `services/extraction` + `services/llm` + `packages/api`) and add the `manual_entry_required` and (if missing) the `complete`→"Seus resultados estão prontos" body. Pull copy from validators.

- [x] **Task 4 — API: operator confirm/reject helpers with escalation (AC1, AC2, AC4, AC5, AC9)**
  - [x] 4.1 Create `packages/api/src/operator-resolve.ts` (helper layer; mirrors `uploads-review.ts`):
    - `confirmReviewFieldAsOperator(tx, operatorId, { reviewQueueId })`: **assumes the caller already escalated to `postgres`** (the resolver owns the SET ROLE / finally). Steps: re-fetch the row (`reason='loinc_unresolved'`, `resolved_at IS NULL` else `CONFLICT`); parse `valueText` via `parseBrazilianDecimal` (`BAD_REQUEST`/`UNPARSEABLE_VALUE` if not finite); resolve `collectedAt` from `collected_at_text` (fallback upload `created_at`) reusing the patient path's date logic; `writeObservation({ patientId: row.patientId, uploadId: row.uploadId, loincCode: null, biomarkerName, valueNumeric, unitUcum: row.unitText ?? '' (→ guard: if empty, BAD_REQUEST/UNIT_UNRESOLVED), collectedAt, confidenceScore: 1.0, source: 'operator_confirmed', labName: row.labName ?? undefined })`; UPDATE the row `SET resolved_at=now(), resolved_by_operator_id=operatorId WHERE id=… AND resolved_at IS NULL`; `writeAuditLog({ actorId: operatorId, actorType: 'operator', event: EXTRACTION_FIELD_OPERATOR_CONFIRMED, resourceId: reviewQueueId, resourceType: 'extraction_review_queue', metadata: { patientId, loincCode: null, uploadId, reviewQueueId } })`; then `finalizeUploadIfResolved(tx, row.uploadId, row.patientId)`.
    - `rejectReviewFieldAsOperator(tx, operatorId, { reviewQueueId, rejectionReason })`: re-fetch + ALREADY_RESOLVED guard; UPDATE `SET resolved_at=now(), resolved_by_operator_id=operatorId, rejection_reason=$reason WHERE id=… AND resolved_at IS NULL`; **no** `writeObservation`; `writeAuditLog({ event: EXTRACTION_FIELD_OPERATOR_REJECTED, metadata: { …, rejectionReason } })`; then `finalizeUploadIfResolved(...)`.
    - `finalizeUploadIfResolved(tx, uploadId, patientId)`: COUNT `extraction_review_queue WHERE upload_id=$uploadId AND resolved_at IS NULL` (ALL reasons — visible because we're escalated to postgres). If 0: `applyUploadTransition(pending_review → complete, metadata:{ completedBy:'operator_review_finalized' })`; if it transitioned (or upload already `complete`), determine the notification kind: COUNT rejected rows (`rejection_reason IS NOT NULL`) for the upload → ≥1 ⇒ `manual_entry_required`, else `complete`; write the `notification.upload_complete` audit (tolerate `23505`, skip enqueue on dup) and `enqueueNotificationSend({ uploadId, patientId, kind })`. Also `enqueueLetterGeneration` only on the all-confirmed `complete` path (a partially-manual upload is not "results ready" for a letter; document the choice).
  - [x] 4.2 Add `confirmField` / `rejectField` to `packages/api/src/router/operator.ts` (`operatorProcedure.input(...).mutation(...)`). Each mutation body: `return ctx.db.transaction-is-already-open` — `operatorProcedure` already wraps the resolver in a tx (`ctx.db` is the tx handle). So in the mutation: `await ctx.db.execute(sql\`SET LOCAL ROLE postgres\`); try { return await confirmReviewFieldAsOperator(ctx.db, ctx.session.user.id, input); } finally { await ctx.db.execute(sql\`SET LOCAL ROLE NONE\`); }`. (The GUC `app.current_operator_id`is already bound by the middleware; pass`ctx.session.user.id` explicitly for clarity.)
  - [x] 4.3 **Verify** `operatorProcedure` already opens a transaction (Story 8.1 — it does: `ctx.db.transaction(...)`). The escalation rides inside it. Confirm `SET LOCAL ROLE postgres` is permitted for the `authenticated` role in this Supabase setup (the `sharing.ts` precedent proves it is).

- [x] **Task 5 — Web: confirm/reject client island on the detail page (AC12)**
  - [x] 5.1 Create `apps/web/src/app/operador/fila/[uploadId]/OperatorFieldActions.tsx` (`"use client"`): props `{ reviewQueueId: string }`. Renders "Confirmar" + "Rejeitar"; Reject reveals a `<select>` over `OPERATOR_REJECTION_REASON_LABELS_PT_BR` + a confirm button. Uses the web tRPC react client (`api.operator.confirmField.useMutation()` / `rejectField`) — mirror `StalenessThresholdsForm.tsx` for the client/provider wiring. `onSuccess` → `router.refresh()`. Error → inline `OPERATOR_ACTION_ERROR_PT_BR`. Disable buttons while pending.
  - [x] 5.2 In `[uploadId]/page.tsx` (RSC), render `<OperatorFieldActions reviewQueueId={field.id} />` under each field. (The `field.id` IS the `reviewQueueId`.)
  - [x] 5.3 No new route; reuse the 8.1 empty-state when the list drains.

- [x] **Task 6 — RLS: confirm NO new write policy needed; verify escalation path (AC5)**
  - [x] 6.1 Confirm **no** operator INSERT/UPDATE policy is added to `observations`/`uploads`/`extraction_review_queue` — escalation handles writes. Add a one-line comment to `custom_rls_extraction_review_queue.sql` noting that operator WRITES go through the `postgres`-role escalation in `operator-resolve.ts`, not a policy.
  - [x] 6.2 The 8.1 operator SELECT policy is unchanged. The new columns (`rejection_reason`, `resolved_by_operator_id`) are covered by the existing `GRANT SELECT` (operator reads them via the 8.1 detail query if surfaced; not required for 8.2).

- [x] **Task 7 — Tests (AC3, AC5, AC9, AC11)**
  - [x] 7.1 Unit: `packages/api/__tests__/operator-resolve.test.ts` (mock Drizzle). Confirm: writes observation with `source='operator_confirmed'`, `loincCode:null`, `confidence:1.0`; UPDATEs the row with `resolved_by_operator_id`; writes `extraction_field.operator_confirmed` audit with `actorType:'operator'` + metadata shape (incl. `loincCode:null`); ALREADY_RESOLVED guard throws CONFLICT. Reject: NO observation insert; sets `rejection_reason`; writes `..._rejected` audit with `rejectionReason` in metadata. Finalization: counts ALL unresolved (assert the COUNT query has NO `reason` predicate); picks `manual_entry_required` when a rejected row exists, else `complete`.
  - [x] 7.2 **Escalation reset test** (AC5): a test asserting the resolver issues `SET LOCAL ROLE postgres` then `SET LOCAL ROLE NONE`, AND that `NONE` is still issued when the inner helper throws (mock the helper to throw; assert the `finally` ran). This is the load-bearing security test.
  - [x] 7.3 Validators: assert `EXTRACTION_FIELD_OPERATOR_CONFIRMED`/`_REJECTED` are NOT in `ACCESS_LOG_EVENT_KINDS` (AC11 regression). Place in `packages/api/__tests__/operator-validators.test.ts` (validators package has no runner — Story 8.1 lesson).
  - [x] 7.4 RLS integration (authored; run deferred per carry-forward): extend `extraction-review-queue-operator.rls.test.ts` — assert an operator UPDATE/INSERT WITHOUT escalation still affects 0 rows (proving no write policy leaked), and that the escalated path (service-role seed) writes correctly.
  - [x] 7.5 No new web tests unless the web package has a runner (it does not for RSC; skip per 8.1).

- [x] **Task 8 — Quality gates (mandatory)**
  - [x] 8.1 `pnpm -w typecheck` green.
  - [x] 8.2 `pnpm -w lint` green (declare any new env? none new this story).
  - [x] 8.3 `pnpm -w format` clean.
  - [x] 8.4 `pnpm --filter @healthtracker/api test:unit` green (Tasks 7.1–7.3).
  - [x] 8.5 `pnpm --filter @healthtracker/db test:integration` — DEFER if no DB (carry-forward); `rls-adversarial` GHA gates.
  - [ ] 8.6 Manual run-through (DEFERRED — needs DB + app server, not runnable headless): seed a `loinc_unresolved` row; as an allowlisted operator open the detail; Confirmar → observation appears, row drains; Rejeitar with a reason → row drains, no observation; resolve the last field → upload completes; verify the right notification kind; verify the audit rows exist and are absent from the patient Access Log.

- [x] **Task 9 — Docs (Epic 6/7 carry-forward)**
  - [x] 9.1 Extend the "Operator role (Epic 8)" CLAUDE.md stanza: 8.2 adds the WRITE surface via `postgres`-role escalation (no operator write RLS policy); confirm publishes null-LOINC `operator_confirmed` observations; reject stores `rejection_reason`; new `manual_entry_required` notification; operator audit kinds excluded from Access Log.
  - [x] 9.2 Append to the Story 8.3 migration checklist: enum `rejection_reason_enum`; columns `extraction_review_queue.rejection_reason` + `.resolved_by_operator_id`; `observation_source_enum += 'operator_confirmed'`.

---

## Dev Notes

### The two confirmed decisions (do not re-litigate)

1. **Operator writes escalate to `postgres` role inside the `operatorProcedure` transaction**, `try { … } finally { SET LOCAL ROLE NONE }`. This is the `sharing.ts:1834` precedent (`activateProfessionalAccount`). NO operator write RLS policy is added anywhere. The escalation is what makes the cross-patient writes possible AND makes the finalization count see `low_confidence` rows (so the upload only completes when the patient is also done). The `finally` reset is the single most important line in the story — a regression test guards it (Task 7.2).
2. **Confirm publishes the value with `loinc_code = NULL`** (`source='operator_confirmed'`, `confidence=1.0`). The operator does not map a LOINC. Consequence to document: null-LOINC observations land in the patient's raw record but do not join LOINC-keyed trend grouping — acceptable and matches the epic's literal text.

### Existing code to read before writing (READ ALL)

- `packages/api/src/uploads-review.ts` lines 230–633 (`confirmReviewFieldAsPatient`) — the canonical confirm flow the operator helper mirrors (re-fetch + ALREADY_RESOLVED, parse value, resolve collectedAt, writeObservation, UPDATE row, audit, re-count, transition, notify + letter, the `23505` tolerance). The operator helper is the same shape minus the LOINC-resolution requirement and plus the escalation.
- `packages/api/src/router/sharing.ts` lines 1740–1880 (`activateProfessionalAccount`) — the `SET LOCAL ROLE postgres` / `finally SET LOCAL ROLE NONE` escalation pattern Task 4.2 copies verbatim.
- `packages/api/src/observations.ts` lines 30–127 (`writeObservation` + `ObservationInsert`) — confirm `loincCode?` is nullable and `source` is the enum; Task 1.2 widens the union.
- `packages/api/src/upload-transitions.ts` lines 48–104 (`applyUploadTransition`, `UPLOAD_TRANSITIONS`) — `pending_review → complete` arc + optimistic lock.
- `packages/api/src/notifications.ts` lines 18–68 (`NotificationKind`, `enqueueNotificationSend`) — Task 3.2 adds `manual_entry_required`.
- `packages/api/src/audit.ts` lines 14–88 (`AuditLogEntry`, `writeAuditLog`, `writeAuditLogIfNew`, `EVENT_DEDUP_VALUES`) — Task 3.1 widens `actorType`; the `23505` tolerance reuses the patient-path pattern.
- `packages/validators/src/index.ts` lines 168–243 (`NOTIFICATION_KIND_TO_PREFERENCE`, `NotificationKind`) + `packages/validators/src/sharing.ts` `ACCESS_LOG_EVENT_KINDS` — Task 2.3 / 2.2.
- `packages/validators/src/operator.ts` (Story 8.1) — extend it; do not create a second operator validators file.
- `apps/web/src/app/operador/fila/[uploadId]/page.tsx` (Story 8.1) — Task 5.2 mounts the island here. Note 8.1's `BAD_REQUEST`/`FORBIDDEN` catch.
- `apps/web/src/app/profissional/configuracoes/limiares/StalenessThresholdsForm.tsx` — the `"use client"` + web tRPC react-client mutation pattern Task 5.1 mirrors (provider, `useMutation`, error handling).
- `packages/api/src/operator-review.ts` (Story 8.1) — sibling read helper; keep the write helpers in a NEW `operator-resolve.ts` (read/write split, mirrors `observations-record.ts` vs `uploads-review.ts`).

### Existing behaviour that must be preserved (regression watch)

- **Patient confirm path (Story 2.4)** — untouched. The `low_confidence` SELECT/UPDATE policies and `confirmReviewFieldAsPatient` are unchanged. The operator finalization counts ALL reasons (under escalation), so an operator finishing the `loinc_unresolved` rows will NOT prematurely complete an upload that still has unresolved patient `low_confidence` rows — and vice-versa (the patient path already tolerates operator rows blocking, `uploads-review.ts:543`).
- **Worker direct-publish complete path** — `services/extraction/src/consumers/document.ts` emits `notification.upload_complete` only when no review rows were written; mutually exclusive with this path. The `23505` partial-unique tolerance covers any race.
- **`observations` ON-CONFLICT idempotency** — unchanged. Null-LOINC operator observations do NOT dedup on the `(patient_id, upload_id, loinc_code, collected_at)` index (NULL ≠ NULL in the unique index), which is correct: two distinct unresolved biomarkers must both persist. Document so a reviewer doesn't "fix" it.
- **8.1 operator read surface** — the detail query (`getOperatorQueueItem`) still filters `loinc_unresolved`; resolved rows have `resolved_at` set but the 8.1 query does NOT filter on `resolved_at`, so a resolved row would still appear. **Add `AND resolved_at IS NULL` to the 8.1 detail + list queries** (or the resolved field lingers in the operator view) — Task 4 must update `operator-review.ts` to exclude resolved rows. (Small scope addition flagged here so it isn't missed.)

### R1 gotcha checklist (pre-baked)

- **Privilege-escalation reset** — `finally { SET LOCAL ROLE NONE }` on BOTH resolvers; Task 7.2 tests the throw path.
- **Narrow catch** — the only catch is the `23505` notification-audit race (check `err.code === '23505'`, else rethrow); the `parseBrazilianDecimal`/finite guards throw typed `TRPCError`s, not swallowed.
- **Procedure-name truthfulness** — `operatorProcedure` still delivers "allowlisted operator session + role GUC"; the escalation is inside the resolver, explicit, and reset.
- **Greppable pt-BR** — all reason labels + notification bodies + button copy in validators.
- **Audit-kind Access-Log exclusion** — Task 7.3 regression-locks both new kinds out of `ACCESS_LOG_EVENT_KINDS`.
- **FK-cascade rule** — `resolved_by_operator_id` is a bare uuid (no FK), like `resolved_by_patient_id`; no cascade concern, documented.
- **Additive enum widening** — `observation_source_enum += operator_confirmed` and the new `rejection_reason_enum` are additive; safe via `db:push`; batched into Story 8.3.
- **`.strict()` inputs** — both operator mutation schemas.
- **Dead-resolved-row filter** — add `resolved_at IS NULL` to the 8.1 read queries (regression watch above).

### Project Structure Notes

- **NEW files:** `packages/api/src/operator-resolve.ts`, `packages/api/__tests__/operator-resolve.test.ts`, `apps/web/src/app/operador/fila/[uploadId]/OperatorFieldActions.tsx`.
- **MODIFIED:** `packages/db/src/schema/extraction_review_queue.ts` (+enum, +2 cols), `packages/db/src/schema/observations.ts` (+source value), `packages/api/src/router/operator.ts` (+confirmField/rejectField), `packages/api/src/operator-review.ts` (+`resolved_at IS NULL` filter), `packages/api/src/audit.ts` (+`operator` actorType), `packages/api/src/notifications.ts` (+`manual_entry_required`), `packages/validators/src/operator.ts` (+reasons/schemas/copy/audit kinds), `packages/validators/src/index.ts` (+notification kind/pref), the push-send body map (services/\*), `packages/api/__tests__/operator-validators.test.ts` (+AC11 regression), `packages/db/__tests__/rls/extraction-review-queue-operator.rls.test.ts` (+no-write-policy assertions), `apps/web/src/app/operador/fila/[uploadId]/page.tsx` (mount island), `CLAUDE.md`.
- **NO `apps/expo` changes; NO `supabase/migrations/*.sql`** (Story 8.3).

### Open questions for Francis (surface at hand-off, do NOT block)

1. **Story 8.3** (Epic 8 batched migration) is still absent from `sprint-status.yaml`. After 8.2 the migration must capture: operator SELECT policy + `lab_name` (8.1) AND `rejection_reason_enum`, `extraction_review_queue.rejection_reason` + `.resolved_by_operator_id`, `observation_source_enum += operator_confirmed` (8.2). Append `8-3-...` to sprint-status before Epic 8 closes.
2. **Letter on partially-manual uploads** — Task 4.1 enqueues a Letter only on the all-confirmed `complete` path, not when fields were rejected (a partial record is not "results ready" for a generated letter). If product wants a letter regardless, it's a one-line change — flagged.
3. **Operator-confirmed null-LOINC observations** never join LOINC-keyed trends. If product later wants operators to MAP the LOINC at confirm time (the alternative we discussed), that is a follow-up story (adds a LOINC picker).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` L1811–1837] Story 8.2 spec (FR39/FR40/FR41, AR10/AR14, NFR-S7, UX-DR20).
- [Source: `packages/api/src/uploads-review.ts` L230–633] The patient confirm flow mirrored by the operator helpers.
- [Source: `packages/api/src/router/sharing.ts` L1740–1880] The `SET LOCAL ROLE postgres`/`finally NONE` escalation precedent.
- [Source: `packages/api/src/observations.ts` L30–127] `writeObservation` (loincCode nullable; source enum widened in 8.2).
- [Source: `CLAUDE.md` "RLS & sharing conventions" — privilege escalation must reset in same tx scope] AC5's `finally` requirement.
- [Source: `CLAUDE.md` "Audit log conventions"] AC11 Access-Log exclusion of operator events.
- [Source: `_bmad-output/implementation-artifacts/8-1-operator-views-the-anonymised-manual-review-queue.md`] The 8.1 operator principal this story extends.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story workflow)

### Debug Log References

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story + bmad-dev-story workflows)

### Debug Log References

- `pnpm -w typecheck` 17/17; `pnpm -w lint` 15/15; `pnpm -w format` clean.
- `pnpm --filter @healthtracker/api test:unit` — 394 pass (47 files), incl. operator-resolve (5), operator-escalation (2), operator-validators (extended).
- `pnpm --filter @healthtracker/extraction-worker test:unit` — 62 pass (notification COPY + preference switch + buildNotificationPayload still green with the new kind).

### Completion Notes List

- Story spec authored + implemented 2026-06-02 on `worktree-story-8-1-operator-review-queue`, STACKED on Story 8.1 (same PR branch; no new PR while 8.1 unmerged).
- Two decisions confirmed with Francis: (1) operator writes via in-tx `postgres`-role escalation (no new write RLS policy); (2) confirm publishes null-LOINC `operator_confirmed` observations (operator does not map LOINC).
- Load-bearing security item: the `finally { SET LOCAL ROLE NONE }` reset — regression-tested on the THROW path (`operator-escalation.test.ts` runs the real router with a fake tx that captures SQL and asserts NONE executes after the helper throws).
- Implemented the scope catch: added `resolved_at IS NULL` to BOTH 8.1 read queries (`operator-review.ts`) so resolved fields leave the operator view.
- `manual_entry_required` notification threaded through api + worker (COPY, deepLink default, preference switch) + validators map.
- Letters intentionally NOT enqueued on operator-finalized uploads (no patient session/consent context) — documented limitation + open question.
- Test-harness lessons applied from 8.1: `vi.hoisted` for mock spies (a plain factory ref silently fell back to the real module); RFC-valid v4 UUIDs in `z.uuid()` inputs.
- Deferred (no DB / app server headless, Epic 6/7 carry-forward): live `db:push` (Task 1.3), RLS integration run (Task 8.5 — `rls-adversarial` GHA gates), manual UI run-through (Task 8.6). Task 7.4's "no operator write policy" assertion is already covered by the 8.1 RLS matrix (operator UPDATE/DELETE → 0 rows).
- Open question carried from 8.1: Story 8.3 migration slot still missing from sprint-status; 8.2 adds `rejection_reason_enum`, two `extraction_review_queue` columns, and the `observation_source_enum` value it must capture.

### File List

**NEW**

- `packages/api/src/operator-resolve.ts`
- `packages/api/__tests__/operator-resolve.test.ts`
- `packages/api/__tests__/operator-escalation.test.ts`
- `apps/web/src/app/operador/fila/[uploadId]/OperatorFieldActions.tsx`

**MODIFIED**

- `packages/db/src/schema/extraction_review_queue.ts` (rejection_reason_enum + rejection_reason + resolved_by_operator_id)
- `packages/db/src/schema/observations.ts` (source += operator_confirmed)
- `packages/db/policies/custom_rls_extraction_review_queue.sql` (escalation note; no write policy)
- `packages/api/src/observations.ts` (ObservationInsert.source widened)
- `packages/api/src/observations-record.ts` (ObservationView.source widened)
- `packages/api/src/audit.ts` (actorType += operator)
- `packages/api/src/notifications.ts` (NotificationKind += manual_entry_required)
- `packages/api/src/operator-review.ts` (resolved_at IS NULL filter on both reads)
- `packages/api/src/router/operator.ts` (confirmField/rejectField + escalation wrapper)
- `packages/api/__tests__/operator-validators.test.ts` (AC11 + reason-label + reject-schema tests)
- `packages/validators/src/operator.ts` (reasons, labels, input schemas, audit kinds, copy)
- `packages/validators/src/index.ts` (NOTIFICATION_KIND_TO_PREFERENCE += manual_entry_required)
- `services/extraction/src/consumers/notifications.ts` (kind, COPY, preference switch)
- `apps/web/src/app/operador/fila/[uploadId]/page.tsx` (mount OperatorFieldActions)
- `CLAUDE.md` (Story 8.2 operator-write stanza)

**NO `apps/expo` changes; NO `supabase/migrations/*.sql`** (Story 8.3 migration).

## Senior Developer Review (AI)

**Reviewed:** 2026-06-02 · **Outcome:** Changes Requested → Addressed · **Method:** 3-layer adversarial (Blind Hunter, Edge Case Hunter, Acceptance Auditor). The escalation/`finally`-reset security core was independently verified correct and well-tested by all three. Two HIGH correctness bugs converged across layers; both patched.

### Action Items

- [x] **HIGH — confirm path published the observation BEFORE the optimistic claim UPDATE, ignoring its rowcount → a double-confirm race wrote duplicate null-LOINC observations** (null-LOINC never dedups on the partial unique index). **Fix:** the guarded `resolved_at IS NULL` UPDATE now runs FIRST with `.returning()`; a 0-row claim throws `CONFLICT` and the resolver aborts before `writeObservation`. Same claim-first guard applied to reject. New test: "aborts WITHOUT publishing when the claim UPDATE loses the race". (`packages/api/src/operator-resolve.ts`)
- [x] **HIGH — dead `transition.currentStatus === "complete"` branch in `finalizeUploadIfResolved`.** `applyUploadTransition` returns `currentStatus: null` on an optimistic-lock miss (verified `upload-transitions.ts:174`), so a concurrent finalizer's loser returned `pending_review` and skipped the completion notification. **Fix:** re-SELECT `uploads.status` on a transition miss to distinguish "already completed concurrently" from "still blocked" — mirrors the patient path. (`packages/api/src/operator-resolve.ts`)
- [x] **LOW — Task 7.4 negative RLS test was missing from the diff.** Added an assertion that an operator INSERT into `extraction_review_queue` WITHOUT escalation is denied by RLS (proves no write policy leaked). (`packages/db/__tests__/rls/extraction-review-queue-operator.rls.test.ts`)

### Dismissed (with rationale)

- **AC8 "distinct singleton (uploadId, kind)" claim is imprecise** — the `writeAuditLogIfNew` dedup is keyed `(resource_id, event)` (event-only), so there is exactly ONE finalization notification per upload and its kind reflects the final committed rejected-count (computed after the claim+transition). The outcome is correct; only the AC's wording about the key was off. No code change.
- **Greppable-copy: notification body hardcoded in the worker COPY map** — the worker hardcodes ALL kinds' titles/bodies; it's a separate service that does not import `@healthtracker/validators` notification copy. Sourcing only the new kind from validators would be inconsistent + dead. Matches the established pattern.
- **`UNIT_UNRESOLVED` uses `PRECONDITION_FAILED` (spec said `BAD_REQUEST`)** — matches the patient-path precedent; kept for consistency.
- **Notification preference asymmetry / no parsed-value preview / no-unit fields only rejectable** — intentional (reviewRequired is the right gate; preview + unit-entry are out of the epic's scope; reject is the escape hatch).

### Post-patch gates

`pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 · `pnpm -w format` clean · api unit **395 pass** (incl. the new race test) · worker **62 pass**. DB-live items remain deferred to dev/CI.
