# Story 5.3: Patient views the Access Log

Status: ready-for-dev

> **Stacked on Stories 5.1 + 5.2 / PR #56.** Read-only surface that lights up the audit trail Stories 5.1 + 5.2 have been writing. No new mutating procedures. Adds: `sharingRouter.listAccessLog` (paginated query), an RLS extension on the existing `audit_log` table so a patient sees rows whose `resource_id` points at one of their share_tokens (not just rows where they're the actor), `AccessLogItem` component (compact + expanded states), and the Acessos tab.
>
> **Out of scope (per user direction):** Production migration still deferred to the last story of Epic 5. Dev applies new RLS via `psql -f packages/db/policies/custom_rls_audit_log.sql` (file replaced atomically — DROP POLICY IF EXISTS + CREATE POLICY).
>
> **ADR resolutions locked in this story (user-confirmed):**
>
> 1. `AccessLogItem` shows the patient-chosen `displayName` only (no raw email/CRM). Raw identifiers were never stored in Story 5.1 by design (PII discipline — only SHA-256 hash on `pending_invites.identifier_hash`). The spec's "name/email" language gets reinterpreted as "name".
> 2. The Access Log shows **all share-related events for this patient**: `pending_invite.created`, `share_token.created`, `sharing.configured`, `conversation_starter.queued`/`generated`/`failed`, plus (forward-compat) future `share_token.revoked` (Story 5.4) and `share_token.read` (Epic 6). Grouped by `share_token_id` where applicable.
> 3. `access_log` is a **logical view onto `audit_log`**, not a new table. AC4's `access_log` naming is satisfied by the audit_log surface filtered to share-scope. No new schema.

## Story

**As a** patient,
**I want** to see a complete log of who accessed which parts of my record and when,
**so that** I have full transparency over who has viewed my health data.

## Acceptance Criteria

1. **AC1 — Acessos tab + reverse-chronological list.** Given the patient taps the **Acessos** tab (4th tab per UX-DR11), when the screen loads at `apps/expo/src/app/(tabs)/acessos/index.tsx` (and `apps/web/src/app/acessos/page.tsx`), then the patient sees all share-related audit events for their patient_id in reverse chronological order, paginated (page size 20, infinite scroll / load-more). Each event renders as an `AccessLogItem` (compact variant on the list). Empty state copy: `"Nenhum acesso registrado ainda."` (constant `ACCESS_LOG_EMPTY_PT_BR` — T6.1).

2. **AC2 — `AccessLogItem` content & states.** Each `AccessLogItem` displays:
   - **Header:** `displayName` (from joined `pending_invites.display_name`) when the event is tied to a share — falls back to `"Você"` for patient-self events (`pending_invite.created`, `share_token.created`, `sharing.configured`, `share_token.revoked` — actor is patient).
   - **Action description (event-specific, pt-BR):** mapped per event kind via `ACCESS_LOG_EVENT_LABEL_PT_BR_FN(event, count)` (T6.1). Examples:
     - `pending_invite.created` → `"Você adicionou {displayName}."`
     - `share_token.created` → `"Você criou um compartilhamento com {displayName} por {duração}."`
     - `sharing.configured` → `"Você atualizou as visibilidades para {displayName} ({N} alterações)."`
     - `conversation_starter.queued` → `"Sumário pré-gerado para {displayName}."` (suppress from the visible list by default — see AC3; surface only on expanded view)
     - `conversation_starter.generated` → same — collapsed by default
     - `conversation_starter.failed` → `"Não foi possível pré-gerar o sumário para {displayName}."` (visible — surface failures)
     - `share_token.revoked` (Story 5.4) → `"Você revogou o acesso de {displayName}."`
     - `share_token.read` (Epic 6) → `"{displayName} visualizou seus dados."`
   - **Timestamp:** relative form via `formatRelativeTime(date)` (e.g. `"há 2 horas"`, `"há 3 dias"`) — pt-BR; on tap, expands to absolute `"23 de maio de 2026 às 14:32"`. Format helper goes in `packages/validators/src/dates.ts` (NEW) if no equivalent exists; reuse if it does.
   - **Token status badge (when applicable):** computed from the joined `share_tokens` row — `"ativo"` / `"expirado"` / `"revogado"` / `"sem prazo"`. States via Tamagui semantic tokens `$accessLogActive` / `$accessLogExpired` / `$accessLogRevoked` (T4.3). No red token (UX line 1079).
   - **Biomarker chips (expanded view only):** when the row is `sharing.configured`, expand reveals the per-biomarker visible/hidden state at the time of the change. Pulled from the audit_log `metadata.biomarkerCategories` payload (Story 5.1 AC9 shape).
   - **a11y:** `accessibilityRole="listitem"` within a parent `role="list"`. Expand toggle has `accessibilityLabel`. Revoke button (Story 5.4) carries its own a11y — out of scope here.

3. **AC3 — Compact / expanded states (UX-DR6).** `AccessLogItem` has `compact` (default) and `expanded` (tap-to-expand) variants. `compact` shows header, action description, timestamp (relative), token-status badge. `expanded` adds: absolute timestamp, biomarker chip list (when `metadata.biomarkerCategories` exists), and a link to the share's biomarker-config screen (`/compartilhar/${shareTokenId}/biomarcadores`) for active shares (read-only browsable — Story 5.4 owns the revoke button). Tap toggles expansion; state lives in the item's local `useState`.

4. **AC4 — `sharingRouter.listAccessLog` paginated query.** New `protectedProcedure` (NOT `premiumProcedure` — see AC5; premium gate fires only on read of the _content_, but the query runs anyway and returns an empty list for free-tier patients along with the AC5 gate signal):
   - Input: `z.object({ cursor: z.string().optional(), pageSize: z.number().int().min(1).max(50).default(20) })`. Cursor is the ISO timestamp of the last item from the previous page; the resolver returns rows older than the cursor.
   - Output: `z.object({ items: z.array(AccessLogItemRowSchema), nextCursor: z.string().nullable(), upgradeRequired: z.boolean() })`. `upgradeRequired = true` for free-tier patients (AC5).
   - SQL: SELECT from `audit_log` joined LEFT to `share_tokens` joined LEFT to `pending_invites` to attach `displayName` + token status. Filter to event kinds in the share-event allowlist: `pending_invite.created`, `share_token.created`, `sharing.configured`, `conversation_starter.queued`, `conversation_starter.generated`, `conversation_starter.failed`, `share_token.revoked`, `share_token.read`. Order by `audit_log.created_at DESC`. WHERE `created_at < cursor`. LIMIT pageSize + 1 (the +1 detects "has more"; trim before returning).
   - Cursor encoding: ISO timestamp string (the row's `created_at`). On the call site, ties are broken by `created_at DESC, id DESC` — include the row id in the cursor as `{ts}|{id}` to make pagination stable under same-millisecond rows.
   - The query relies on the RLS update from AC6 — the resolver itself does NOT add `WHERE actor_id = …` clauses (let RLS scope rows authoritatively). Defense-in-depth: also add `AND patient_id_scope = $1` where the SELECT joins through to confirm — discussed in T3.
   - Audit emission: this is a read-only patient query. Per CLAUDE.md, audit reads of one's own data is over-instrumentation. Do **NOT** emit `access_log.viewed` audit (would generate self-referential noise — every Acessos tap creates a row that appears in the next tap's list).

5. **AC5 — Premium gate (free-tier upgrade prompt).** When `ctx.session.user.subscriptionTier !== "premium"`, the resolver returns `{ items: [], nextCursor: null, upgradeRequired: true }`. The screen renders `ACCESS_LOG_PREMIUM_REQUIRED_PT_BR` (T6.1) — pt-BR copy with a Tier-2 upgrade CTA. No log entries are shown. **Implementation rationale:** the resolver uses `protectedProcedure` and inlines the premium check so the screen can render a friendly upgrade prompt instead of a thrown `PRECONDITION_FAILED`. Story 4.1's `premiumProcedure` middleware is the alternative shape; the inline check is chosen here because the UX wants graceful degradation (an empty list + upgrade prompt) not an error toast.

6. **AC6 — RLS extension on `audit_log` so patient sees rows referencing their share_tokens.** Today (Stories 1.x → 5.2) the `audit_log_select_own` policy in `packages/db/policies/custom_rls_audit_log.sql` is:

   ```sql
   actor_id::text = current_setting('app.current_patient_id', true)
   ```

   This shows rows where the _patient_ is the actor. It does NOT show rows where a _doctor_ is the actor against the patient's share_token. Extend the policy:

   ```sql
   DROP POLICY IF EXISTS "audit_log_select_own" ON "audit_log";
   CREATE POLICY "audit_log_select_own" ON "audit_log"
     FOR SELECT
     USING (
       actor_id::text = current_setting('app.current_patient_id', true)
       OR (
         resource_type IN ('share_token', 'conversation_starter_cache')
         AND EXISTS (
           SELECT 1 FROM share_tokens
           WHERE share_tokens.id = audit_log.resource_id::uuid
             AND share_tokens.patient_id::text = current_setting('app.current_patient_id', true)
         )
       )
     );
   ```

   `audit_log.resource_id` is currently typed `uuid` (Story 1.1) — verify with `\\d audit_log` in setup; if it's `text`, the cast becomes `audit_log.resource_id` only (no `::uuid`). Plus: confirm the existing INSERT policy is unchanged (`audit_log_insert_own` with `WITH CHECK (actor_id::text = …)` — still correct; doctor inserts come via `service_role` which bypasses RLS).

   **Append-only invariant preserved**: no UPDATE or DELETE policy exists on `audit_log` (verified in `custom_rls_audit_log.sql` — only SELECT and INSERT policies). Story 5.3 does not introduce one.

7. **AC7 — RLS test matrix extended.** New RLS tests in `packages/db/__tests__/rls/audit_log.rls.test.ts` (extend the existing file — Story 1.x): add the 4 cases:
   - `correctPatient_seesOwnActorRows` (existing — confirm still passes).
   - `correctPatient_seesShareTokenScopedDoctorRows` (NEW) — insert a `share_tokens` row owned by patient A; insert an `audit_log` row with `actor_id = <doctorB_user_id>`, `resource_type = 'share_token'`, `resource_id = <token.id>`; assert patient A sees it under `app.current_patient_id = <A>`.
   - `wrongPatient_doesNotSeeOtherPatientShareTokenRows` (NEW) — patient B with their own context sees zero rows for that audit entry.
   - `doctorRead_seesNothingViaAuditPolicies` (NEW) — a doctor connection (`app.current_share_token_id = <token.id>`) sees zero rows under the audit_log policy (the policy uses `app.current_patient_id`, which is empty for doctor connections). This is the deliberate gate: doctors don't browse audit_log.

8. **AC8 — `AccessLogItem` component (UX spec lines 910–925).** Located at `packages/ui/src/components/AccessLogItem/AccessLogItem.tsx`. Props:

   ```ts
   {
     id: string;
     event: AccessLogEvent;  // discriminated union: kind + payload
     displayName: string | null;  // null → "Você"
     timestamp: Date;
     tokenStatus: "ativo" | "expirado" | "revogado" | "sem prazo" | null;
     biomarkerCategories?: { category: string; label: string; visible: boolean }[];
     onPress?: (id: string) => void;  // expansion toggle
     expanded: boolean;
   }
   ```

   Compact: header + action + relative timestamp + status badge. Expanded: + absolute timestamp + biomarker chip grid + link to biomarker-config screen (if `event.kind === "share_token.created"` or `"sharing.configured"`). All copy via `ACCESS_LOG_EVENT_LABEL_PT_BR_FN` (T6.1). Tamagui semantic tokens — `$accessLogActive`, `$accessLogExpired`, `$accessLogRevoked`, `$accessLogNeutral` for the badges. NEVER hex literals (Story 3.4 lesson). Barrel via `index.ts`.

9. **AC9 — Acessos tab wired.** `apps/expo/src/app/(tabs)/_layout.tsx` — confirm the 4th tab "Acessos" is wired (per UX-DR11). If it currently points at a placeholder, wire it to the new screen group `apps/expo/src/app/(tabs)/acessos/`. Web parity at `apps/web/src/app/acessos/` (a top-level route; web nav uses the existing sidebar). Both surfaces render an `<AccessLogList>` component (T4) that handles pagination + empty state + loading state + upgrade prompt.

10. **AC10 — No re-render on every audit row inserted.** Story 5.4's revoke flow will insert a new row; the Acessos tab should refetch on-mount (and on focus, via `useFocusEffect` on Expo / `useEffect(window.addEventListener('focus', …))` on web) but does NOT subscribe to real-time updates (architecture explicitly leaves real-time channels out of MVP). Pull-to-refresh exists on the list (Expo: `RefreshControl`; web: a "Atualizar" Tier-3 button).

11. **AC11 — Validators audit-kind allowlist.** New constant in `packages/validators/src/sharing.ts`:

    ```ts
    export const ACCESS_LOG_EVENT_KINDS = [
      "pending_invite.created",
      "share_token.created",
      "sharing.configured",
      "conversation_starter.queued",
      "conversation_starter.generated",
      "conversation_starter.failed",
      "share_token.revoked",
      "share_token.read",
    ] as const;
    export type AccessLogEventKind = (typeof ACCESS_LOG_EVENT_KINDS)[number];
    ```

    Used as the resolver's `IN (…)` filter and as the discriminator in the `AccessLogItem` component's switch. Adding a new kind = update both ends.

12. **AC12 — Pagination stability under same-ms inserts.** The cursor is `{created_at iso}|{audit_log.id uuid}`. SQL WHERE clause becomes `(created_at, id) < (cursor_ts, cursor_id)` — a tuple compare. This is stable even when multiple audit rows land in the same millisecond (e.g. Story 5.1's tx writes 3 audit rows from a single `createShareToken` call). Without the id tiebreaker, the same row could appear on two pages or be skipped.

## Tasks / Subtasks

> **Plan:** 1) RLS extension + tests → 2) validators (kinds + copy + date helper) → 3) router + paginated query → 4) AccessLogItem + screens → 5) tests.

- [ ] **T1. RLS extension (AC6, AC7).** (AC: 6, 7)
  - [ ] T1.1 Update `packages/db/policies/custom_rls_audit_log.sql` per AC6. DROP POLICY IF EXISTS + CREATE POLICY (idempotent — the file is re-applied via `psql -f` in dev and via testcontainer setup loader). Verify the `resource_id` column type via `\\d audit_log` (if `text`, drop the `::uuid` cast).
  - [ ] T1.2 Extend `packages/db/__tests__/rls/audit_log.rls.test.ts` with the four cases listed in AC7. Reuse the existing identity factory; add `doctorActorAgainstShareToken` if not present.
  - [ ] T1.3 Document the policy change in `docs/rls-review-checklist.md` — add a bullet under "Doctor principal" noting the audit_log policy now exposes share-scoped doctor-actor rows to the patient (and the reverse — doctor connections still see nothing).

- [ ] **T2. Validators + copy + date helper (AC2, AC5, AC8, AC11).** (AC: 2, 5, 8, 11)
  - [ ] T2.1 `packages/validators/src/sharing.ts`:
    - Add `ACCESS_LOG_EVENT_KINDS` + `AccessLogEventKind` (AC11).
    - Add `ACCESS_LOG_EVENT_LABEL_PT_BR_FN(kind, { displayName, durationLabel, biomarkerChangeCount }) → string` covering all eight kinds per AC2.
    - `ACCESS_LOG_EMPTY_PT_BR = "Nenhum acesso registrado ainda."`
    - `ACCESS_LOG_PREMIUM_REQUIRED_PT_BR = "O Acesso completo está disponível no plano Premium. Toque para saber mais."`
    - `ACCESS_LOG_TOKEN_STATUS_PT_BR_FN(status) → string` returning `"Ativo"` / `"Expirado"` / `"Revogado"` / `"Sem prazo"`.
    - `ACCESS_LOG_LIST_A11Y_LABEL_PT_BR = "Lista de acessos ao seu histórico"`.
    - `ACCESS_LOG_EXPAND_A11Y_LABEL_PT_BR_FN(displayName) → string`.
    - `ACCESS_LOG_REFRESH_PT_BR = "Atualizar"`.
  - [ ] T2.2 `packages/validators/src/dates.ts` (NEW) — `formatRelativeTimePtBr(date: Date, now = new Date()): string` — buckets: `< 60s → "agora"`, `< 60m → "há {N} min"`, `< 24h → "há {N} h"`, `< 7d → "há {N} dias"`, else `formatAbsolutePtBr(date)`. `formatAbsolutePtBr(date): string` — `"23 de maio de 2026 às 14:32"` via `Intl.DateTimeFormat("pt-BR", {...})`. Unit-test both edge cases (boundary at 60s, 60m, 24h, 7d).
  - [ ] T2.3 Re-export from `packages/validators/src/index.ts`.

- [ ] **T3. Router — `listAccessLog` (AC4, AC5, AC11, AC12).** (AC: 4, 5, 11, 12)
  - [ ] T3.1 `packages/api/src/router/sharing.ts` — add `listAccessLog` `protectedProcedure.query`. Input/output per AC4. Premium check inline (return `upgradeRequired: true` instead of throwing). SQL:
    ```sql
    SELECT al.id, al.event, al.actor_id, al.actor_type, al.resource_id, al.resource_type, al.metadata, al.created_at,
           st.expires_at, st.revoked_at,
           pi.display_name
    FROM audit_log al
    LEFT JOIN share_tokens st ON al.resource_type = 'share_token' AND al.resource_id::uuid = st.id
    LEFT JOIN pending_invites pi ON st.invite_id = pi.id
    WHERE al.event = ANY($1::text[])  -- the AC11 allowlist
      AND ((al.created_at, al.id) < ($2::timestamptz, $3::uuid) OR $2 IS NULL)
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT $4
    ```
    Use Drizzle's `sql` template for the tuple compare. Decode cursor from `{ts}|{id}` string at the resolver entry; encode the new cursor as the same format from the last row of the (pageSize) trimmed result.
  - [ ] T3.2 Output `AccessLogItemRowSchema` (Zod) — exported from `packages/validators/src/sharing.ts`. Shape mirrors the SQL projection above plus a derived `tokenStatus: "ativo" | "expirado" | "revogado" | "sem prazo" | null`. Token-status computation lives in the resolver (compose from `expires_at` + `revoked_at` + `now()`).
  - [ ] T3.3 No audit emission for this read (AC4 rationale). Inline a code comment explaining.
  - [ ] T3.4 Unit tests at `packages/api/__tests__/sharing/access-log-pagination.test.ts` — assert cursor stability under same-ms rows; assert event-allowlist filter; assert premium gate returns `upgradeRequired: true` + empty items.

- [ ] **T4. UI — `AccessLogItem` + `AccessLogList` + screens (AC1, AC2, AC3, AC8, AC9, AC10).** (AC: 1, 2, 3, 8, 9, 10)
  - [ ] T4.1 `packages/ui/src/components/AccessLogItem/AccessLogItem.tsx` (NEW) per AC8. Barrel via `index.ts`.
  - [ ] T4.2 `packages/ui/src/components/AccessLogList/AccessLogList.tsx` (NEW) — list wrapper rendering `AccessLogItem` rows + pagination + empty state + upgrade prompt + pull-to-refresh handle. Props: `{ data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, upgradeRequired }`. Cross-platform (Tamagui RNW; web maps `FlatList` to a styled `YStack` or uses `react-virtuoso` only if already present — check; otherwise plain mapped list with a "Carregar mais" button at the bottom).
  - [ ] T4.3 `packages/ui/src/theme/tokens.ts` — add `$accessLogActive`, `$accessLogExpired`, `$accessLogRevoked`, `$accessLogNeutral`. Wire into `themes.ts` light + dark.
  - [ ] T4.4 `apps/expo/src/app/(tabs)/acessos/index.tsx` (NEW or REPLACE existing placeholder) — fetches via `trpc.sharing.listAccessLog.useInfiniteQuery({ pageSize: 20 }, { getNextPageParam: (last) => last.nextCursor })`. Renders `<AccessLogList />`. Uses `useFocusEffect` to refetch on tab focus.
  - [ ] T4.5 `apps/web/src/app/acessos/page.tsx` (NEW) — web parity. Use `useInfiniteQuery` via tRPC; render the same `AccessLogList`. Uses a `useEffect` with `window.addEventListener('focus', refetch)` for tab-focus refetch on web.
  - [ ] T4.6 `apps/expo/src/app/(tabs)/_layout.tsx` — wire the Acessos tab to the new screen group. Verify it's positioned 4th (Início / Histórico / Compartilhar / **Acessos**) per UX-DR11.

- [ ] **T5. Tests (every AC).** (AC: all)
  - [ ] T5.1 Validator unit tests — `ACCESS_LOG_EVENT_LABEL_PT_BR_FN` covers all 8 kinds; date helpers cover boundary cases.
  - [ ] T5.2 Integration test for `listAccessLog` — testcontainer + tRPC caller; seed audit_log + share_tokens + pending_invites; assert cursor pagination, event allowlist filter, premium gate. (Authored at `packages/api/__tests__/sharing/list-access-log.integration.test.ts` with `it.todo()` placeholders if Docker unavailable, plus the synchronous pagination unit test in T3.4.)
  - [ ] T5.3 RLS tests T1.2 above.
  - [ ] T5.4 Component snapshot `AccessLogItem` × 5 states: `compact-active`, `compact-expired`, `compact-revoked`, `compact-no-expiry`, `expanded-with-biomarkers`. Use the same scaffold-with-`@ts-nocheck` pattern as `ShareBiomarkerToggle.test.tsx` if no test runner is wired in `packages/ui`.
  - [ ] T5.5 Behavior — `AccessLogList` empty / loading / upgrade-required / error states render correctly.

## Dev Notes

### Architecture references (authoritative)

- **`audit_log` table is the source.** `packages/db/src/schema/audit.ts` — schema; `packages/db/policies/custom_rls_audit_log.sql` — RLS to extend.
- **Append-only invariant (NFR-S4):** no UPDATE / DELETE policies exist; Story 5.3 preserves.
- **`writeAuditLog` is the only sanctioned write path** (`packages/api/src/audit.ts`). Story 5.3 is read-only; no new writes.
- **Premium gate precedent:** Story 4.1 `premiumProcedure` is one option; Story 5.3 uses an inline check inside `protectedProcedure` because the UX wants graceful degradation (empty list + upgrade prompt) not `PRECONDITION_FAILED`. Document the precedent split in code comments.
- **No real-time subscriptions in MVP** (architecture decision) — pagination + refetch-on-focus is the pattern.

### UX references (authoritative)

- **`AccessLogItem` spec:** `_bmad-output/planning-artifacts/ux-design-specification.md` lines 910–925. Five states: `active`, `expired`, `revoked-pending`, `revoked`, plus implicit `no_expiry` from Story 5.2. `revoked-pending` is Story 5.4's territory (5-second undo window) — render hook in place but don't drive it from this story's data.
- **Privacy-as-primary-UI (UX-DR6):** the Access Log is a first-class tab, not a settings hideaway.
- **No red badges:** `$accessLogRevoked` is muted neutral; red is reserved for system failures.
- **Doctor identity rendering:** `displayName` only per ADR. UX spec line 1097 says "doctor name + specialty" — specialty isn't stored anywhere; punt to Epic 6 (when doctors sign up they can self-declare specialty) and surface only displayName here.

### Patterns to copy (don't reinvent)

- **RLS policy idempotent re-apply:** DROP POLICY IF EXISTS + CREATE POLICY in the same file. Testcontainer setup loader picks up the change.
- **Cursor-based pagination with tuple compare:** stable under same-ms inserts. Story 2.x / 3.x precedents — check `packages/api/src/router/observations.ts` `getRecord` for the existing cursor shape if present; otherwise this story establishes the pattern.
- **`tokenStatus` computation:** derive from `expires_at` + `revoked_at` + `now()` in the resolver — never expose those raw fields without composing into the discrete status enum, so consumers can't write conflicting predicates.
- **No audit on patient-self read** (CLAUDE.md philosophy). The Access Log itself doesn't appear in the Access Log.

### Anti-patterns explicitly forbidden in 5.3

- Do **NOT** include the raw `tokenHmac` or any identifier in `AccessLogItemRowSchema`. Only the resolved `displayName` from `pending_invites`.
- Do **NOT** show the doctor's raw email or CRM. Only the patient's chosen `displayName`. (PII discipline.)
- Do **NOT** emit `access_log.viewed` audit on every list render (self-referential noise).
- Do **NOT** add a new `access_log` table — `audit_log` is the source.
- Do **NOT** broad-catch in the resolver — narrow per Story 2.5/5.1 precedent.
- Do **NOT** inline pt-BR strings — all copy in `packages/validators/src/sharing.ts` (Epic 2 retro).
- Do **NOT** use a red Tamagui token for the `revogado` state. Use the muted neutral.
- Do **NOT** make the upgrade-prompt CTA Tier 1 (UX-DR13 — sharing/upgrade prompts never Tier 1).
- Do **NOT** drop the Story 1.x `audit_log_insert_own` policy — Story 5.3 only changes SELECT.

### Latest tech notes (query Context7 before locking versions)

- **`@tanstack/react-query` v5 `useInfiniteQuery`** — confirm the `getNextPageParam: (last) => last.nextCursor` shape. Story 3.4 already uses TanStack v5.
- **`Intl.DateTimeFormat("pt-BR", {...})`** — verify all four bucket boundaries render correctly on Node 22 and on Hermes (Expo). Hermes ICU support varies by version; if `Intl.DateTimeFormat` is incomplete on RN Hermes, fall back to a manual format.

### Previous story intelligence

- **Story 5.1 R1 patches:** narrow catches, audit-in-tx, validators-as-shared-truth, 404-not-403. Story 5.3 is read-only — no new tx work — but the narrow-catch + validators discipline applies.
- **Story 5.2 R1 patches:** nullable `expires_at` everywhere; `getShareUrl` filters on expiry; persisted `duration` column. Token-status computation in `listAccessLog` MUST handle nullable `expires_at` (the `sem prazo` branch).
- **Existing Acessos tab placeholder.** If the (tabs)/\_layout.tsx already declares the Acessos tab from Story 5.1, this story fills in the route group. Verify the existing screen file isn't load-bearing for something else.

### Project Structure Notes

- `apps/expo/src/app/(tabs)/acessos/` — new screen group (mirrors `compartilhar/`).
- `apps/web/src/app/acessos/` — new top-level route (matches the web sidebar convention; not in an `(authenticated)/` group since web doesn't appear to use one for other tabs — verify).
- `packages/ui/src/components/AccessLogItem/`, `AccessLogList/` — barrel directories matching `ShareBiomarkerToggle/` precedent.
- `packages/validators/src/dates.ts` — NEW shared module (if no existing dates helper). Re-export from `index.ts`.

No structural conflicts.

### Testing standards summary

- **DB RLS:** testcontainer + `pnpm --filter @healthtracker/db test:rls`. Extend the existing `audit_log.rls.test.ts`.
- **API integration:** testcontainer + tRPC caller; assert pagination + premium gate + RLS scoping.
- **API unit:** synchronous pagination cursor logic with mocked DB; no testcontainer needed.
- **UI snapshot:** scaffold per Story 5.1 precedent.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3 lines 1268-1294]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#AccessLogItem lines 910-925]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Access Log surfacing lines 1097, 1219]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#listitem role line 1320]
- [Source: _bmad-output/planning-artifacts/architecture.md#append-only audit_log NFR-S4]
- [Source: packages/db/policies/custom_rls_audit_log.sql — existing policy to extend]
- [Source: packages/api/src/audit.ts — writeAuditLog signature]
- [Source: _bmad-output/implementation-artifacts/5-1-...md — Epic 5 schema + RLS precedents]
- [Source: _bmad-output/implementation-artifacts/5-2-...md — nullable expires_at + duration column + R1 patches]
- [Source: CLAUDE.md — narrow catches, validators-as-truth, no-audit-on-self-read]

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Known infra blockers (out-of-code)

- **Production migration still deferred.** The amended `custom_rls_audit_log.sql` body lands in the last story of Epic 5's batched migration. Dev applies via `psql -f packages/db/policies/custom_rls_audit_log.sql`.
- **Hermes `Intl.DateTimeFormat`** — verify on the target Expo SDK 54 / Hermes build. If broken, T2.2 falls back to manual format.
- **No real-time access-log updates.** Story 5.3 ships with refetch-on-focus only; Story 5.x or a follow-up adds real-time if the product needs it.
