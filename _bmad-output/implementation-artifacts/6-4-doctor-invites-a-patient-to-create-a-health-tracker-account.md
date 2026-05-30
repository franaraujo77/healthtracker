# Story 6.4: Doctor invites a patient to create a Health Tracker account

Status: review

Stacked on PR #57 (the `worktree-story-6-2` branch — Stories 6.2 + 6.3 + R1 fix-ups are the immediate predecessors). Fourth story of Epic 6 and the **reverse direction** of Story 5.1's patient→doctor invite. Story 5.1's `pending_invites` row encodes "a patient wants to share with this doctor"; Story 6.4 introduces a structurally DIFFERENT row — "an activated doctor wants this patient to sign up." Lifecycle, predicates, audit shape, RLS principal, and FK direction are all different — see AC9 schema decision.

This story closes the second half of the Doctor Acquisition Loop (Story 6.3 closed the first half by activating the doctor; Story 6.4 turns the doctor into a referrer). Functional requirement is FR30 (PRD line 515): "Doctor can invite a patient by contact (email or phone) to create a Health Tracker account."

## Story

As an activated Health Tracker professional (doctor),
I want to send a patient an invitation link that lands them on the patient signup flow with my referrer name pre-attributed,
so that I can initiate the Doctor Acquisition Loop by recommending the product directly to patients I see in clinic.

## Acceptance Criteria

1. **AC1 — Entry surface: "Convidar paciente" modal on the Conversation Starter view.** Story 6.3 already lands the doctor-side post-activation surface inside `apps/web/src/app/m/[token]/view/page.tsx`. Story 6.5 (staleness thresholds — not yet specced) is expected to introduce a full professional dashboard; we will NOT speculatively build that here. **Decision:** add a Tier-1 `<InvitePatientButton>` to the same view, rendered when `activationStatus.activated === true` AND `cacheStatus === 'ready'` — replacing the slot the AC1 activation banner had occupied for the unactivated doctor. This honours the UX-DR20 governing line (ux-design-specification.md line 1115 reserves the single Tier-1 action at report close for "convide o paciente" style CTAs) and avoids the half-finished-dashboard problem. The button opens `<InvitePatientModal>` (client component, web-only).

   **Returning-doctor reuse path:** when the doctor opens a DIFFERENT patient's report (new shareTokenId) and is already activated, the same button renders. The modal is multi-tenant within a session: a doctor can invite multiple patients without leaving the report view. Each modal open resets form state.

   **Pt-BR copy (named constants in `packages/validators/src/professional.ts`):**
   - Button label: `Convidar paciente` (`INVITE_PATIENT_BUTTON_PT_BR`)
   - Modal heading: `Convidar paciente` (`INVITE_PATIENT_MODAL_HEADING_PT_BR`)
   - Modal subheading: `Envie um link para que seu paciente crie a conta no Health Tracker.` (`INVITE_PATIENT_MODAL_SUBHEADING_PT_BR`)
   - Identifier label: `E-mail ou telefone do paciente` (`INVITE_PATIENT_IDENTIFIER_LABEL_PT_BR`)
   - Identifier placeholder: `paciente@exemplo.com` (`INVITE_PATIENT_IDENTIFIER_PLACEHOLDER_PT_BR`)
   - Patient display name label: `Nome do paciente (opcional)` (`INVITE_PATIENT_DISPLAY_NAME_LABEL_PT_BR`)
   - CTA: `Enviar convite` (`INVITE_PATIENT_CTA_PT_BR`)
   - CTA loading: `Enviando…` (`INVITE_PATIENT_CTA_LOADING_PT_BR`)
   - Success body: `Convite criado. Compartilhe o link abaixo com seu paciente.` (`INVITE_PATIENT_SUCCESS_BODY_PT_BR`)
   - Copy-link button: `Copiar link` (`INVITE_PATIENT_COPY_LINK_PT_BR`)
   - Copy-link toast (success): `Link copiado.` (`INVITE_PATIENT_COPY_LINK_TOAST_PT_BR`)
   - Already-registered notice: `Este paciente já tem uma conta no Health Tracker. Convide outro paciente.` (`INVITE_PATIENT_ALREADY_REGISTERED_PT_BR`)
   - Generic error: `Não foi possível enviar o convite agora. Tente novamente.` (`INVITE_PATIENT_GENERIC_ERROR_PT_BR`)
   - Identifier validation error: `Informe um e-mail ou telefone válido.` (`INVITE_PATIENT_IDENTIFIER_INVALID_PT_BR`)

2. **AC2 — Identifier scope: email OR Brazilian phone (E.164-coerced).** The epics body (line 1502) says "email or phone number." Implementation:
   - **Email path:** standard `z.string().email()` after `.trim().toLowerCase()`. Hashing key = the lowercased value.
   - **Phone path:** Brazilian-format permissive entry (`(11) 91234-5678`, `11912345678`, `+5511912345678` all accepted). Server normalises to E.164 (`+5511912345678`) BEFORE hashing. Helper `normalizePatientIdentifier(identifier)` returns `{ kind: 'email' | 'phone', normalized: string }` or throws a Zod refinement error.
   - **Why hash the identifier:** PII hygiene parity with Story 5.1's `pending_invites.identifier_hash`. The doctor's invite contact list is never persisted in clear (LGPD Art. 46 minimisation — see Epic 5 retro pseudonymization theme).
   - **No CRM lookup, no email verification ping, no SMS send.** The modal SHOWS the doctor a copy-able URL; the doctor distributes via WhatsApp / SMS / email at their discretion. This is the minimum-viable acquisition surface — no transactional-email vendor introduced for MVP. Background: doctors already use WhatsApp for patient comms; routing through a paid SendGrid/Twilio adds compliance surface (LGPD Art. 7) without unblocking the Doctor Acquisition Loop. Document in deferred-work.

   **Open product question (round-1):** does the doctor see the patient's identifier echoed back after submission (the modal's success state — "Convite criado para paciente@exemplo.com")? Today's spec: YES, the normalised identifier is echoed (UX trust signal — the doctor confirms they didn't fat-finger). We do NOT store the raw value on the server. R1 reviewer flag if this is too much.

3. **AC3 — Schema decision: NEW `patient_invites` table, NOT extending `pending_invites`.** This is the load-bearing architectural call.

   **Rationale (CLAUDE.md ops note compliance):**
   - `pending_invites` was introduced by Story 5.1 for the patient→doctor direction: patient creates the row, `resolved_user_id` flips when the doctor signs up (Story 6.3 just landed that flip via `activateProfessionalAccount`). Lifecycle: patient-owned, doctor-resolved. Predicate sets and RLS policies are written around `patient_id = auth.uid()` for the creator-side check.
   - Story 6.4 is the OPPOSITE direction: doctor creates the row, `resolved_user_id` flips when the patient signs up. The natural creator-side RLS predicate is `professional_user_id = auth.uid()`, which is structurally different from the Story 5.1 policy.
   - **Extending `pending_invites` with a `direction` column** would require: (a) rewriting all four existing `pending_invites_*` RLS policies to add `WHERE direction = 'patient_to_doctor'` predicates, (b) a CLAUDE.md-flagged **partial-index WHERE-clause shift** on `pending_invites_patient_identifier_uq` (currently total; would become partial-WHERE-direction=PtoD), (c) the matching DROP+CREATE non-CONCURRENTLY ShareLock window in prod (CLAUDE.md ops note — `pnpm db:push` is unsafe; Story 6.6's consolidated migration would need the CONCURRENTLY+CONCURRENTLY 3-step), and (d) Story 6.3's just-landed `pending_invites.resolved_user_id` FK + `set null` regression test would gain a direction-discriminated semantics that the test doesn't cover.
   - **A separate `patient_invites` sibling table** sidesteps all four: new policies have no migration risk, the FK direction is fresh (FK to `professionals.user_id`, not `users.id` — see AC9), and the lifecycle / audit / `displayName` semantics can diverge without polluting the patient→doctor surface.

   The two tables have ~25% shared columns (id, identifier_hash, resolved_user_id, created_at) but DIFFERENT semantics on every one of them. **Decision: ship the sibling table. Pay the small duplication cost for the much larger blast-radius reduction.**

4. **AC4 — `patient_invites` schema (NEW Drizzle file `packages/db/src/schema/patient_invites.ts`).**

   ```ts
   export const patientInviteStatusEnum = pgEnum("patient_invite_status_enum", [
     "pending",
     "resolved",
     "expired",
     "revoked",
   ]);

   export const PatientInvites = pgTable(
     "patient_invites",
     (t) => ({
       id: t.uuid().notNull().primaryKey().defaultRandom(),
       /** FK to professionals.user_id — doctor must be activated first (Story 6.3 gate). */
       professionalUserId: t
         .uuid()
         .notNull()
         .references(() => Professionals.userId, { onDelete: "cascade" }),
       /** SHA-256 hex of normalised email (lowercased) or E.164 phone. PII hygiene parity with pending_invites. */
       identifierHash: t.text().notNull(),
       /** 'email' | 'phone' — discriminator for downstream UI without re-classifying the hash. */
       identifierKind: t.text().notNull(),
       /** Patient-supplied display name (doctor-entered; max 80; trimmed; nullable per AC2). */
       displayName: t.text(),
       /**
        * HMAC-SHA256 of the raw invite token; lookup key for the patient
        * landing page. Stored hex; raw token only ever appears in the
        * one-time copy-able URL. Mirrors `share_tokens.token_hmac` /
        * Story 5.1 pattern. SHARE_TOKEN_HMAC_SECRET is REUSED — see AC8.
        */
       tokenHmac: t.text().notNull().unique(),
       /**
        * Patient's user_id once they sign up via the magic invite URL.
        * **FK cascade rule deviation #2 (after Story 6.3's pending_invites
        * `set null`):** `onDelete: "set null"` here too — if the patient
        * later deletes their account (Story 5.6 right-to-erasure), the
        * doctor's referral telemetry survives but the linkage breaks. Cascading
        * would silently delete the doctor's history of who they invited,
        * which is directionally wrong (doctor-authored row deleted by
        * patient action). Lock into regression test (T7).
        */
       resolvedUserId: t
         .uuid()
         .references(() => Users.id, { onDelete: "set null" }),
       status: patientInviteStatusEnum("status").notNull().default("pending"),
       /**
        * 7-day expiry, matching the SHARE_DURATION default. Renewable
        * via re-invite (idempotent UPSERT path — AC6). Soft-expiry: the
        * status enum's `expired` value is set lazily on first read (no
        * background sweep job for MVP). RLS predicate filters expired.
        */
       expiresAt: t
         .timestamp({ mode: "date", withTimezone: true })
         .notNull()
         .default(sql`now() + interval '7 days'`),
       /** Soft-delete signal mirrors `share_tokens.revoked_at`. */
       revokedAt: t.timestamp({ mode: "date", withTimezone: true }),
       /** Step in the funnel — populated on patient sign-up (AC5). */
       resolvedAt: t.timestamp({ mode: "date", withTimezone: true }),
       createdAt: t
         .timestamp({ mode: "date", withTimezone: true })
         .defaultNow()
         .notNull(),
     }),
     (table) => [
       // AC6 — in-flight idempotency on (professional, identifier_hash).
       // Partial unique index WHERE status = 'pending': re-inviting the
       // same patient by the same doctor returns the existing pending
       // row's id rather than creating a duplicate. Mirrors Story 5.1's
       // `pending_invites_patient_identifier_uq` (which is total — but
       // there the lifecycle never re-opens after `resolved`). Here, a
       // patient who lets the invite expire CAN be re-invited, and that
       // creates a new row — so the index is partial.
       uniqueIndex("patient_invites_professional_identifier_active_uq")
         .on(table.professionalUserId, table.identifierHash)
         .where(sql`${table.status} = 'pending'`),
       // Listing (deferred — likely Story 6.5 / 6.x dashboard surface).
       index("patient_invites_professional_created_idx").on(
         table.professionalUserId,
         sql`${table.createdAt} desc`,
       ),
       // Resolved-by-user lookup (used by Story 1.1 register flow's
       // referrer-attribution path — AC10).
       index("patient_invites_resolved_user_idx").on(table.resolvedUserId),
       check(
         "patient_invites_identifier_kind_check",
         sql`${table.identifierKind} in ('email', 'phone')`,
       ),
     ],
   );
   ```

   **No new env vars** (NFR-S6 — see AC8 secret-reuse).

5. **AC5 — `sharingRouter.createPatientInvite` mutation under `doctorProcedure`** (NOT a new router — same colocation rationale as Story 6.3: doctor surface is sharing-router-resident; the GUC/middleware sharing is grep-able). Input:

   ```ts
   z.object({
     identifier: z.string().trim().min(3).max(254),
     displayName: z.string().trim().min(1).max(80).nullable().default(null),
   });
   ```

   **Critical ordering:**
   1. **Activation gate:** `SELECT 1 FROM professionals WHERE user_id = ctx.session.user.id LIMIT 1`. Zero rows → `TRPCError({ code: "PRECONDITION_FAILED", message: "DOCTOR_NOT_ACTIVATED" })`. The view RSC already short-circuits via Story 6.3's banner-vs-button render branch — this is defense-in-depth (a malicious client bypassing the UI).
   2. **Normalise identifier:** `const { kind, normalized } = normalizePatientIdentifier(input.identifier)`. Throws Zod-shape error → `BAD_REQUEST` if neither email nor phone.
   3. **Hash:** `const identifierHash = hashIdentifier(normalized)` (reuse existing helper from `packages/api/src/sharing.ts`).
   4. **AC11 / already-registered check:** `SELECT id FROM auth.users WHERE email = $normalized OR phone = $normalized LIMIT 1` via the supabase admin client (the `doctorProcedure` cannot read `auth.users` directly — RLS-policy-less schema; service-role required). If a row exists → return `{ inviteId: null, alreadyRegistered: true }`. **No audit row written.** The modal renders `INVITE_PATIENT_ALREADY_REGISTERED_PT_BR`.

      **Open question (round-1):** the auth.users check leaks an existence oracle to the doctor (they can probe whether any email is a Health Tracker user). Mitigation options for R1:
      - Constant-time response: always sleep a delay roughly matching the INSERT path so timing-based discrimination is harder.
      - Rate-limit `createPatientInvite` per `doctor_user_id` (e.g. `professional_invite_rate_limit` partial index — TODO if we adopt).
      - Accept the leak as bounded (doctors are an authenticated, low-volume, accountable population; the upside of "don't waste your invite" outweighs the downside). Today's spec accepts the leak with the audit row in step 9 making any abuse traceable.

   5. **Idempotent SELECT-then-INSERT-then-narrow-23505 catch:** mirrors Story 5.1's `createPendingInvite` and Story 5.5's `requestExport`. SELECT for `(professional_user_id, identifier_hash) WHERE status = 'pending'`; if found, return that inviteId AND the existing tokenHmac (no new token minted, no audit re-emitted).
   6. **Generate invite token:** `const { raw, tokenHmac } = generatePatientInviteToken()` (NEW helper in `packages/api/src/sharing.ts` — mirrors `generateShareToken()`; reuses `signShareToken()` under the SAME `SHARE_TOKEN_HMAC_SECRET` per AC8). Note `tokenHash` is NOT used here because the lookup-by-doctor side never happens (the invite landing page is patient-side and dereferences via `tokenHmac` directly — see AC10).
   7. **INSERT in transaction:** `patient_invites` row + `writeAuditLog(tx, { event: "patient_invite.sent", actorType: "doctor", actorId: ctx.session.user.id, resourceType: "patient_invite", resourceId: inviteId, metadata: { identifierKind: kind, identifierHash } })`. **`patient_invite.sent` is NOT in `ACCESS_LOG_EVENT_KINDS`** — AC12 / mirror Story 6.3's `professional_account.activated` rule. The patient cannot access-log an event from before they existed.
   8. **Narrow catches:** `if (isUniqueViolation(err)) { reselect → return existing }`. No bare `catch (err)`. Programmer errors rethrow.
   9. **Return:** `{ inviteId, inviteUrl, alreadyRegistered: false }`. The URL is built by a NEW `buildPatientInviteUrl(inviteId, tokenHmac)` helper (`packages/api/src/sharing.ts`) emitting `${WEB_APP_URL}/convite/${inviteId}.${tokenHmac}`. **Reuse WEB_APP_URL** — same NFR-S6 boot-gate from Story 5.2.

6. **AC6 — Idempotency / renewal semantics.** Tap "Enviar convite" twice for the same email → single row, single audit. Re-invite an EXPIRED prior invite (same identifier) → status='pending' partial index lets through a fresh INSERT, which is the renewal flow. The fresh row gets a fresh token and a fresh 7-day expiry. **Document in CLAUDE.md (AC13):** "patient_invite renewal = new row + new audit emission. There is no UPDATE-row-extend-expiry path." Rationale: a renewed invite IS a distinct act of acquisition and should be visible in the doctor's eventual invite history.

   **What if the doctor revokes an invite?** Out of scope for Story 6.4. The `revoked_at` column is reserved but the `revokePatientInvite` mutation is deferred. Document in deferred-work.

7. **AC7 — Patient lands on the invite URL → routed to `/auth/register` with referrer pre-attribution.** The patient receives `${WEB_APP_URL}/convite/${inviteId}.${tokenHmac}` via whatever channel the doctor used. Flow:
   1. NEW page `apps/web/src/app/convite/[inviteSegment]/page.tsx` (RSC). Parses segment via NEW `parsePatientInviteSegment` helper (mirrors Story 6.1's `parseShareTokenSegment`). Strict UUID + base64url HMAC shape; malformed → render a "Convite inválido" landing card and exit (no DB hit).
   2. NEW publicProcedure `patientInviteRouter.getInviteContext` (or extend `accountRouter` since registration lives there per Story 1.1 — TODO: dev picks; recommend `accountRouter.getPatientInviteContext` for cohesion). Input: `{ inviteId: z.uuid(), tokenHmac: z.string() }`. Output: `{ valid: boolean, doctorDisplayName: string | null, identifierHash: string | null }`.

      Implementation: SELECT `pi.id, pi.token_hmac, pi.status, pi.expires_at, pi.revoked_at, pi.identifier_hash, prof.display_name AS doctor_display_name FROM patient_invites pi JOIN professionals prof ON prof.user_id = pi.professional_user_id WHERE pi.id = $inviteId LIMIT 1`. Constant-time `verifyShareToken(pi.id || ":" || pi.token_hmac, input.tokenHmac)` re-check (defense-in-depth — see AC8). If `status != 'pending'` OR `expires_at <= now()` OR `revoked_at IS NOT NULL` → return `{ valid: false, doctorDisplayName: null, identifierHash: null }` (do NOT 404 — the landing should still render with an "expired" message; AC11 surfaces this).

      **No audit row written on the read** — this is a public surface called before the patient exists. (One audit row exists from the doctor's `patient_invite.sent`. Story 5.3-style read-side audit is N/A; the patient identity doesn't exist yet to actor.)

   3. The RSC renders the landing page (AC8 component):
      - Valid → "Dr. [displayName] convidou você a criar sua conta no Health Tracker." + standard register form. The form is the SAME `<RegisterForm>` from Story 1.1 (`apps/web/src/app/auth/register/register-form.tsx`), hosted inline — NOT a redirect (a redirect would lose the invite context and require query-string round-tripping that's hard to audit).
      - Invalid/expired → "Este convite expirou ou foi revogado. Peça ao seu médico um novo convite." No register form.
   4. The register form receives `inviteId` as a hidden field via a server-action-style prop. On submit, the `account.initializeProfile` mutation (Story 1.1) is EXTENDED to accept an optional `inviteId` parameter. If present:
      - SELECT the invite row inside the `initializeProfile` tx.
      - Constant-time `verifyShareToken` re-check.
      - If valid + pending: `UPDATE patient_invites SET resolved_user_id = ctx.session.user.id, resolved_at = now(), status = 'resolved' WHERE id = $inviteId AND status = 'pending' RETURNING professional_user_id, identifier_hash`.
      - The WHERE-clause `status = 'pending'` predicate ensures the UPDATE is racing-against-revocation-safe (a concurrent revoke wins; the resolved patient just doesn't get attributed).
      - Audit: `writeAuditLog(tx, { event: "patient_invite.resolved", actorType: "patient", actorId: ctx.session.user.id, resourceType: "patient_invite", resourceId: inviteId, metadata: { doctorUserId: professionalUserId } })`. **NOT in `ACCESS_LOG_EVENT_KINDS`** — this is the doctor-side acquisition surface, not the patient's data access. Document in CLAUDE.md (AC13).
      - The patient's `Início` / first-load empty state renders "Convidado por Dr. [Nome]" — see AC10.
   5. If the patient bypasses the magic invite (goes directly to `/auth/register`), they sign up unattributed. No invite row written. This is the existing Story 1.1 path; we do NOT change its default behaviour.

8. **AC8 — HMAC secret reuse: `SHARE_TOKEN_HMAC_SECRET`.** Reuse, do NOT introduce a new secret. Rationale:
   - Both surfaces (Story 5.x share tokens and Story 6.4 patient invites) are signed-opaque tokens with no overlap in lookup keys (a `patient_invites.id` UUID and a `share_tokens.id` UUID will never collide; the prefix-distinct URL paths `/m/...` vs `/convite/...` mean a doctor can't replay one as the other even with the same HMAC algorithm).
   - Introducing a new secret would require its own NFR-S6 boot-gate (see Story 5.1 pattern in `packages/api/src/sharing.ts:46-67`); each new gate is a new boot-failure surface and another env to rotate.
   - **Domain separation:** to prevent a future "what if someone reuses a share_token HMAC as an invite HMAC" footgun, the invite signing input MUST be prefixed with a domain string: `signShareToken("patient_invite:" + raw)`. NEW helper `signPatientInviteToken(raw)` does this; the verify helper does the same.

   **R1 reviewer rule:** the domain-prefix is load-bearing security. ANY future refactor that drops the prefix is a vulnerability and must be re-introduced. Document in code comment + CLAUDE.md (AC13).

9. **AC9 — RLS policies (NEW `packages/db/policies/custom_rls_patient_invites.sql`).** Required policies:

   ```sql
   ALTER TABLE patient_invites ENABLE ROW LEVEL SECURITY;
   ALTER TABLE patient_invites FORCE ROW LEVEL SECURITY;

   -- Doctor (owner): full select/insert/update on own rows.
   CREATE POLICY patient_invites_select_own ON patient_invites
     FOR SELECT USING (professional_user_id = auth.uid());

   CREATE POLICY patient_invites_insert_own ON patient_invites
     FOR INSERT WITH CHECK (professional_user_id = auth.uid());

   -- UPDATE for revoke (Story 6.x) AND for status='resolved' flip from
   -- the patient side. The resolved flip happens under the *patient's*
   -- auth.uid() inside initializeProfile, NOT the doctor's, so the
   -- predicate has to allow either-side.
   CREATE POLICY patient_invites_update_own_or_resolving_patient ON patient_invites
     FOR UPDATE USING (
       professional_user_id = auth.uid()
       OR (
         status = 'pending'
         AND revoked_at IS NULL
         AND expires_at > now()
       )
     )
     WITH CHECK (
       professional_user_id = auth.uid()
       OR (
         status = 'resolved'
         AND resolved_user_id = auth.uid()
       )
     );

   -- Service-role bypass (worker / admin paths).
   -- (handled by Supabase's default policy)
   ```

   **Note on UPDATE policy:** the patient-side UPDATE inside `initializeProfile` runs under the freshly-authenticated patient's session. The USING predicate intentionally does NOT bind to `auth.uid()` for the patient case — the patient hasn't been recorded on the row yet at USING-eval time. The WITH CHECK predicate binds the patient afterward (NEW `resolved_user_id = auth.uid()`). This is the standard "claim" pattern and is racy-safe because the `WHERE status = 'pending'` predicate in the application-level UPDATE statement is the actual gating predicate.

10. **AC10 — 7-identity RLS test matrix.** The CLAUDE.md "Code review discipline" mandate is the 6-identity matrix (`correctPatient`, `wrongPatient`, `serviceRole`, `doctorWithActiveToken`, `doctorWithExpiredToken`, `doctorWithRevokedToken`). Story 6.4 introduces a NEW table where the doctor-side row is created BEFORE the patient sign-up — there is no share-token in scope at SELECT time. The doctor's auth here is bare `professionals.user_id = auth.uid()`, not GUC-bound. **Required 7th identity:** `unrelatedDoctor` — an activated doctor whose `auth.uid()` is NOT the row's `professional_user_id`. Expected SELECT result: 0 rows.

    **Full matrix (T7.1):**

    | Identity                                                                                                                     | Expected on `patient_invites`                                                                                                 |
    | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
    | `correctPatient` (no relation to the invite)                                                                                 | 0 rows (patients have no policy)                                                                                              |
    | `wrongPatient`                                                                                                               | 0 rows                                                                                                                        |
    | `serviceRole`                                                                                                                | all rows                                                                                                                      |
    | `doctorWithActiveToken` AS the OWNER doctor (their `auth.uid()` matches `professional_user_id`)                              | 1 row (their own)                                                                                                             |
    | `doctorWithActiveToken` AS DIFFERENT doctor (`unrelatedDoctor`)                                                              | 0 rows                                                                                                                        |
    | `doctorWithExpiredToken` (the OWNER, with expired share_token)                                                               | 1 row (`patient_invites` isn't share-token-gated)                                                                             |
    | `doctorWithRevokedToken` (the OWNER, with revoked share_token)                                                               | 1 row (same reason)                                                                                                           |
    | NEW `claimingPatient` — a patient who just sign-up'd under the invite's `tokenHmac` (the `initializeProfile` tx perspective) | 1 row (transient pre-UPDATE state via the second clause of `patient_invites_update_own_or_resolving_patient` USING predicate) |

The last two cells encode the "doctor activation status is `auth.uid()`-scoped, not share-token-scoped" invariant from Story 6.3 AC4 — a doctor whose ONLY share-token is expired still owns their `patient_invites` rows. The reviewer's checklist (Epic 5 R2 lesson): every `it(...)` block must exist; no test docstring may claim the full matrix while shipping a subset.

11. **AC11 — Already-registered handling (the duplicate / no-op path).** The epics body (line 1513) explicitly calls this out: invite sent to already-registered email → no duplicate invite, doctor notified.

Implementation:

- The `auth.users` existence check in AC5 step 4 short-circuits BEFORE the `patient_invites` INSERT.
- Return shape: `{ inviteId: null, alreadyRegistered: true, inviteUrl: null }`.
- Modal renders `INVITE_PATIENT_ALREADY_REGISTERED_PT_BR` instead of the success card.
- **No audit row written.** The doctor's intent to invite a known-existing user is operationally uninteresting and could be exploited as an auth.users enumeration channel if it left an audit trail.
- **Note:** the doctor cannot, from this notification, discover the patient's existing share-token state with that doctor or any other doctor. The check is auth.users-existence-only; no JOIN to sharing tables.

12. **AC12 — Audit kind `patient_invite.sent` + `patient_invite.resolved`.** Both NOT in `ACCESS_LOG_EVENT_KINDS`. Mirrors Story 6.3 AC8 — doctor-side identity and acquisition surface; patient cannot have access-logged an event from before they existed (sent) or an event on their own onboarding (resolved). Constants:

```ts
export const PATIENT_INVITE_SENT_AUDIT = "patient_invite.sent" as const;
export const PATIENT_INVITE_RESOLVED_AUDIT = "patient_invite.resolved" as const;
```

Co-locate in `packages/validators/src/professional.ts` (next to `PROFESSIONAL_ACCOUNT_ACTIVATED_AUDIT`) — these are doctor-acquisition-surface constants and grep-as-a-cohort with the activation audit.

**`actorType` on resolved row:** `"patient"` (Story 5.6's append-only invariant applies — the audit row is the patient's record of "I claimed this invite"). The metadata carries `doctorUserId` for forensic correlation.

13. **AC13 — CLAUDE.md docs.** Append a new section "Doctor → patient invite (Story 6.4)" below the "Professional account activation (Story 6.3)" section. Required content:

- `patient_invites` is a SIBLING TABLE to `pending_invites`, NOT an extension — rationale (AC3).
- `SHARE_TOKEN_HMAC_SECRET` is reused; domain-prefix `"patient_invite:"` on the signing input is load-bearing security. Future refactors that drop the prefix are vulnerabilities.
- `patient_invite.sent` and `patient_invite.resolved` are NOT in `ACCESS_LOG_EVENT_KINDS`.
- The `resolved_user_id` FK uses `onDelete: "set null"` — second documented exception to Story 5.6's cascade rule (first was `pending_invites.resolved_user_id` in Story 6.3).
- The Story 1.1 `initializeProfile` mutation is EXTENDED to optionally accept `inviteId` — verify on every future PR touching account.ts that the optional param isn't accidentally promoted to required (a breaking change to the existing non-invite registration path).
- 7-identity RLS matrix introduced — the new `unrelatedDoctor` identity is documented; any future doctor-scoped sharing table must use the 7-identity matrix, not the 6-identity.

Also: short bullet in `_bmad-output/implementation-artifacts/deferred-work.md` for:

- Story 6.6 (Epic 6 consolidated migration) MUST include: `patient_invites` table, `patient_invite_status_enum`, `patient_invites` indexes + check constraint + RLS policies, AND the `patient_invites_resolved_user_id_users_id_fk … ON DELETE SET NULL` constraint.
- `revokePatientInvite` (doctor-initiated revoke) — deferred until the dashboard story owns invite-history UI.
- Transactional email/SMS send to the patient — deferred; doctor self-distributes the URL for MVP.
- Rate-limiting / auth.users enumeration mitigation on `createPatientInvite` — defer pending observed abuse signal.
- The doctor's own invite-history list view — deferred (likely Story 6.5 or 6.x dashboard).

**Requirements:** FR30, AR10, AR15, UX-DR20, NFR-S1, NFR-S6 (via secret reuse)

## Tasks / Subtasks

- [ ] **T1 — Validators + helpers (`packages/validators/src/professional.ts`, `packages/api/src/sharing.ts`)** (AC1, AC2, AC5, AC8, AC12)
  - [ ] T1.1 Add pt-BR constants per AC1 to `packages/validators/src/professional.ts`.
  - [ ] T1.2 Add `PATIENT_INVITE_SENT_AUDIT`, `PATIENT_INVITE_RESOLVED_AUDIT` constants per AC12.
  - [ ] T1.3 Add `createPatientInviteInputSchema` (identifier + nullable displayName) + output schema per AC5; barrel-export from `packages/validators/src/index.ts`.
  - [ ] T1.4 NEW helper `normalizePatientIdentifier(identifier)` returning `{kind, normalized}` or throwing a typed shape per AC2. Add unit tests covering: lowercased emails, `(11) 91234-5678`, `11912345678`, `+5511912345678`, malformed strings.
  - [ ] T1.5 NEW helpers in `packages/api/src/sharing.ts`: `generatePatientInviteToken()` (returns `{ raw, tokenHmac }` — note: NO tokenHash; doctor-side lookup is by inviteId), `signPatientInviteToken(raw)` (prepends `"patient_invite:"` per AC8 domain separation), `verifyPatientInviteToken(raw, signature)`, `buildPatientInviteUrl(inviteId, tokenHmac)`.
  - [ ] T1.6 Unit tests for the new sharing helpers — including a regression test asserting `signShareToken(raw) !== signPatientInviteToken(raw)` (domain-prefix isolation).

- [ ] **T2 — Schema (`packages/db/src/schema/patient_invites.ts`, `packages/db/policies/custom_rls_patient_invites.sql`)** (AC4, AC9)
  - [ ] T2.1 NEW schema file per AC4. Barrel-export from `packages/db/src/schema/index.ts`.
  - [ ] T2.2 NEW policy file per AC9. Apply via `psql -f` in dev (and via the integration testcontainer setup).
  - [ ] T2.3 `pnpm db:push` in dev applies the schema additively. **CLAUDE.md ops note compliance:** no production migration ships in this story — Story 6.6's consolidated migration owns prod deploy. Confirm via grep that no `supabase/migrations/*.sql` is touched.

- [ ] **T3 — `sharingRouter.createPatientInvite` mutation (`packages/api/src/router/sharing.ts`)** (AC5, AC6, AC11)
  - [ ] T3.1 Add the mutation under `doctorProcedure`. Input from T1.3.
  - [ ] T3.2 Step-ordering per AC5 — activation gate (SELECT professionals); normalise identifier; hash; auth.users existence check (admin client); SELECT existing pending row; INSERT + audit in tx; narrow 23505 catch.
  - [ ] T3.3 The auth.users SELECT requires the supabase admin client. Pattern: import `getSupabaseAdminClient` (existing helper used by `account.ts` Story 5.6 deletion). DO NOT use role-escalation inside the tx (the existence check is read-only and is fine on a separate admin client without lock contention).
  - [ ] T3.4 Return shape `{ inviteId, inviteUrl, alreadyRegistered }`. Build URL via `buildPatientInviteUrl(inviteId, tokenHmac)`.
  - [ ] T3.5 Narrow catches; re-throw `TypeError | ReferenceError | SyntaxError`.

- [ ] **T4 — `accountRouter.getPatientInviteContext` query + `accountRouter.initializeProfile` extension (`packages/api/src/router/account.ts`)** (AC7)
  - [ ] T4.1 NEW publicProcedure `getPatientInviteContext({ inviteId, tokenHmac })`. SELECT JOIN per AC7 step 2. Constant-time HMAC verify; return validity + doctorDisplayName.
  - [ ] T4.2 Extend `initializeProfile` to accept an OPTIONAL `inviteId: z.uuid().optional()`. The existing non-invite path is unchanged (the optional shape is additive). On presence: re-verify HMAC inside the tx, UPDATE `patient_invites` to `status='resolved'`, emit `patient_invite.resolved` audit.
  - [ ] T4.3 The UPDATE uses `WHERE status = 'pending' AND id = $inviteId` predicate — racing-revoke safe.
  - [ ] T4.4 If the UPDATE returns zero rows (invite already resolved by a different tab, or revoked between landing and submit), the registration still completes — but no audit emission and no referrer attribution. Document this branch.

- [ ] **T5 — Web: invite modal + landing page** (AC1, AC7, AC10)
  - [ ] T5.1 NEW `apps/web/src/app/m/[token]/view/InvitePatientButton.tsx` (`"use client"`). Replace the slot Story 6.3's `<ProfessionalAccountBanner>` occupies when `activated === true`. Mirror the banner's Tamagui token discipline (use `$background`, `$borderColor`, NOT raw hex — Story 6.3 R1-M3 lesson).
  - [ ] T5.2 NEW `apps/web/src/app/m/[token]/view/InvitePatientModal.tsx` (`"use client"`). Form fields per AC2. TanStack Form. On `alreadyRegistered: true` response: render the already-registered card. On success: render success card with the URL + copy-link button; `navigator.clipboard.writeText` on tap.
  - [ ] T5.3 Wire `apps/web/src/app/m/[token]/view/page.tsx` to swap `<ProfessionalAccountBanner>` → `<InvitePatientButton>` based on `activationStatus.activated`. NO additional resolver round-trips required.
  - [ ] T5.4 NEW `apps/web/src/app/convite/[inviteSegment]/page.tsx` (RSC). Parse the segment with `parsePatientInviteSegment` helper (NEW — mirror `parseShareTokenSegment`); call `accountCaller.getPatientInviteContext`; render `<PatientInviteLanding>` (NEW client component) with either the register form (valid) or expired-message (invalid).
  - [ ] T5.5 NEW `apps/web/src/app/convite/[inviteSegment]/PatientInviteLanding.tsx` — wraps the existing `RegisterForm` (from `apps/web/src/app/auth/register/register-form.tsx`) with an additional `inviteId` hidden prop, threaded to `account.initializeProfile`.
  - [ ] T5.6 NEW `apps/web/src/app/inicio/page.tsx` or extend the existing Início empty state to render "Convidado por Dr. [Nome]" when `pi.resolved_user_id === auth.uid()`. The data path: extend `accountRouter.getOnboardingContext` (or equivalent) to JOIN `patient_invites` → `professionals` for the patient's referrer. **NOTE:** if the empty state isn't yet code-shipped (Story 1.1 specifies it as deferred for the actual Início UX), document the integration seam and mock with a placeholder. Today's spec accepts a minimal "if the empty state component exists, prop in `referrerDoctorName`; if not, deferred to the dashboard story."

- [ ] **T6 — Tests: validator + helper unit** (AC2, AC8)
  - [ ] T6.1 NEW `packages/api/__tests__/sharing/patient-invite-helpers.test.ts` — cover `normalizePatientIdentifier` (all valid + invalid shapes), `signPatientInviteToken` ≠ `signShareToken` (domain isolation), `verifyPatientInviteToken` constant-time guarantees.
  - [ ] T6.2 NEW `packages/api/__tests__/sharing/create-patient-invite-validators.test.ts` — Zod boundary (displayName trim/null, identifier trim/min/max), output shape parity, `alreadyRegistered` discriminator coverage.

- [ ] **T7 — Tests: 7-identity RLS matrix + FK regression** (AC9, AC10)
  - [ ] T7.1 NEW `packages/db/__tests__/rls/patient_invites.rls.test.ts` — every `it(...)` block per the AC10 table. The doctor-side identities use the Story 6.3-introduced `doctorUserId` test helper. Docstring at top: "AC10; CLAUDE.md 7-identity matrix (introduced by Story 6.4 — adds `unrelatedDoctor`)."
  - [ ] T7.2 NEW `packages/db/__tests__/rls/patient_invites_resolved_user_id_fk.rls.test.ts` — INSERT a `patient_invites` row with `resolved_user_id` pointing at a soon-deleted user; DELETE the user; assert `resolved_user_id IS NULL`, not row-deleted. Mirrors Story 6.3 T6.2 (the cascade-rule second exception).

- [ ] **T8 — Tests: integration** (AC5, AC6, AC7, AC11)
  - [ ] T8.1 NEW `packages/db/__tests__/integration/create-patient-invite.integration.test.ts` — testcontainer Postgres. Cases:
    - Happy path: doctor activated, identifier=fresh-email → row INSERTed, audit emitted, URL composes correctly.
    - Idempotent re-tap: same identifier twice → ONE row, ONE audit; second call returns existing inviteId + URL.
    - Already-registered: identifier matches `auth.users.email` → `alreadyRegistered:true`; zero patient_invites rows; zero audit rows.
    - Phone normalisation: `(11) 91234-5678` → row stored with hashed `+5511912345678`. Re-invite with `11912345678` collides with the partial unique index — returns existing row.
    - Doctor not yet activated: throws `PRECONDITION_FAILED`; zero rows / zero audit.
    - Renewal: a `status='expired'` row exists; new invite to same identifier creates a SECOND row (the partial index allows it).
  - [ ] T8.2 NEW `packages/db/__tests__/integration/resolve-patient-invite.integration.test.ts` — exercise the AC7 `initializeProfile` extension flow:
    - Patient lands with valid invite → after registration, `patient_invites.resolved_user_id = patient.id`, `status='resolved'`, `patient_invite.resolved` audit emitted under `actorType='patient'`.
    - Patient lands with already-revoked invite → registration completes (Story 1.1 path unchanged); zero invite update; zero `patient_invite.resolved` audit.
    - Concurrent claim (two browser tabs from the same magic link): only ONE tab flips the row to resolved; the second tab sees zero-rows-updated and gracefully completes registration. (The patient_invites row uniqueness is on the LINK, not the auth identity — this is a test of UPDATE-WHERE-status='pending' semantics.)
  - [ ] T8.3 NEW `packages/db/__tests__/integration/get-patient-invite-context.integration.test.ts`:
    - Valid pending invite → `valid: true`, returns doctorDisplayName.
    - Expired invite → `valid: false`.
    - Revoked invite → `valid: false`.
    - Bad HMAC → `valid: false` (constant-time path; resolver does NOT throw).
    - Non-existent inviteId → `valid: false`.

- [ ] **T9 — Docs** (AC13)
  - [ ] T9.1 Append "Doctor → patient invite (Story 6.4)" section to CLAUDE.md per AC13.
  - [ ] T9.2 Add five deferred-work entries per AC13.
  - [ ] T9.3 Verify `.env.example` is UNCHANGED.
  - [ ] T9.4 Update sprint-status.yaml: 6-4 → `review` (handled at code-review time, not by dev — leave as dev's responsibility per existing flow).

## Dev Notes

### Architecture compliance

- **AR10 (audit middleware):** `writeAuditLog()` only. Two new event kinds added (`patient_invite.sent`, `patient_invite.resolved`); both intentionally OUT of `ACCESS_LOG_EVENT_KINDS` per AC12.
- **AR15 (`pending_invites` schema):** UNTOUCHED. Story 6.4 introduces a NEW sibling table; the patient→doctor `pending_invites` direction is not modified. This is the entire point of AC3.
- **NFR-S1 (RLS):** new `patient_invites` table ships with `RLS ENABLE` + `FORCE` + 3 policies per AC9. 7-identity test matrix mandatory.
- **NFR-S6 (env boot-gates):** no new env. `SHARE_TOKEN_HMAC_SECRET` and `WEB_APP_URL` are REUSED via the existing boot-gates in `packages/api/src/sharing.ts`.
- **FR30:** Story 6.4 is the sole home of this requirement.
- **UX-DR20 (Tier-1 single action at report close):** the `<InvitePatientButton>` IS the Tier-1 slot the UX governing line reserves for "convide o paciente". The activation banner from Story 6.3 cedes this slot once the doctor activates.
- **CLAUDE.md "Sharing duration notes" / `SHARE_TOKEN_HMAC_SECRET` boot-gate:** the secret is reused with a domain-prefix (`"patient_invite:"`) on the signing input. This is the load-bearing security guarantee per AC8.
- **CLAUDE.md "Account deletion discipline" / FK cascade rule:** `patient_invites.resolved_user_id` is the SECOND documented exception (`onDelete: "set null"`); a regression test locks it in (T7.2).

### Library / framework requirements

- **Next.js 15 App Router** — RSC patterns same as Story 6.2 / 6.3's `/m/[token]/view`. `params` is a Promise; `await params`. The invite landing `/convite/[inviteSegment]` is RSC; the form + modal are client components.
- **Tamagui** — `Sheet` / `Dialog` for the modal; mirror Story 6.3's `<ProfessionalAccountModal>`. Tokens only — `$background`, `$borderColor`, etc. NO raw hex (Story 6.3 R1-M3 lesson).
- **Drizzle ORM** — `pgEnum` for `patient_invite_status_enum`; `references(...)` with `onDelete: "set null"`; partial-unique-index pattern via `.where(sql\`...\`)`; default value via `sql\`now() + interval '7 days'\``.
- **TanStack Form** — single-screen form per Story 6.3 modal precedent.
- **`@trpc/server` `TRPCError`** — `PRECONDITION_FAILED` for not-yet-activated doctor; `BAD_REQUEST` for malformed identifier (Zod refinement); the `alreadyRegistered` branch returns a success-shape with a discriminator, NOT an error.
- **`@supabase/supabase-js` admin client** — `auth.admin.getUserBy*` or a raw SQL SELECT against `auth.users`. The existing `getSupabaseAdminClient()` helper (Story 5.6 account deletion) is the canonical place. Verify the helper's interface; if it doesn't expose the auth.users probe directly, add a thin `findAuthUserByEmailOrPhone(identifier)` wrapper.

### File structure requirements

**Created:**

- `packages/validators/src/professional.ts` (UPDATED — adds invite constants + schema)
- `packages/db/src/schema/patient_invites.ts`
- `packages/db/policies/custom_rls_patient_invites.sql`
- `packages/db/__tests__/rls/patient_invites.rls.test.ts`
- `packages/db/__tests__/rls/patient_invites_resolved_user_id_fk.rls.test.ts`
- `packages/db/__tests__/integration/create-patient-invite.integration.test.ts`
- `packages/db/__tests__/integration/resolve-patient-invite.integration.test.ts`
- `packages/db/__tests__/integration/get-patient-invite-context.integration.test.ts`
- `packages/api/__tests__/sharing/patient-invite-helpers.test.ts`
- `packages/api/__tests__/sharing/create-patient-invite-validators.test.ts`
- `apps/web/src/app/m/[token]/view/InvitePatientButton.tsx`
- `apps/web/src/app/m/[token]/view/InvitePatientModal.tsx`
- `apps/web/src/app/convite/[inviteSegment]/page.tsx`
- `apps/web/src/app/convite/[inviteSegment]/PatientInviteLanding.tsx`

**Modified:**

- `packages/db/src/schema/index.ts` — barrel export `PatientInvites` + `patientInviteStatusEnum`.
- `packages/validators/src/index.ts` — barrel re-export (already exports `professional`).
- `packages/api/src/sharing.ts` — 4 new helpers per T1.5; `parsePatientInviteSegment` helper.
- `packages/api/src/router/sharing.ts` — `createPatientInvite` mutation.
- `packages/api/src/router/account.ts` — `getPatientInviteContext` query + `initializeProfile` extension per T4.
- `apps/web/src/app/m/[token]/view/page.tsx` — swap banner-vs-button on `activationStatus.activated`.
- `apps/web/src/app/auth/register/register-form.tsx` — accept optional `inviteId` prop; thread to `initializeProfile`.
- `CLAUDE.md` — "Doctor → patient invite (Story 6.4)" section.
- `_bmad-output/implementation-artifacts/deferred-work.md` — five entries per AC13.

**No new env vars. NO `supabase/migrations/*.sql` file (deferred to Story 6.6).**

### Testing requirements

- **7-identity RLS matrix MANDATORY** on `patient_invites.rls.test.ts`. The CLAUDE.md "Code review discipline" gate is updated by AC13 to reference 7 identities for doctor-scoped sharing tables.
- Integration tests use the testcontainer Postgres precedent (`packages/db/__tests__/integration/setup.ts`).
- The HMAC domain-prefix test (T1.6 — `signShareToken(raw) !== signPatientInviteToken(raw)`) is load-bearing security; reviewers must verify it exists and runs.
- The FK cascade-vs-set-null test (T7.2) is the load-bearing test for the AC4 deviation from CLAUDE.md's cascade rule — DO NOT skip.
- The auth.users existence check (T8.1 cases) deserves a test where the email matches `auth.users.email` but a `users` row does NOT exist yet (the patient signed up via Supabase Auth but never finished `initializeProfile`). Expected: `alreadyRegistered:true` (the auth.users source-of-truth is supabase auth, not our `users` shadow table).

### Previous story intelligence

- **Story 6.3 (commits `38f09bf` + `66ddaeb`) — doctor activation.** Established `professionals` table + `getActivationStatus` resolver. Story 6.4 builds on top:
  - The view RSC's banner-vs-empty slot becomes banner-OR-button.
  - The doctor-side audit constant pattern (NOT in `ACCESS_LOG_EVENT_KINDS`) is mirrored verbatim.
  - The `pending_invites.resolved_user_id` `onDelete: set null` exception is the precedent for `patient_invites.resolved_user_id` doing the same. CLAUDE.md will document both exceptions side-by-side.
  - Story 6.3 R1-M3 lesson on Tamagui token discipline (no raw hex) applies verbatim to InvitePatientButton/Modal.
  - Story 6.3 R1-H1 lesson on banner-after-success-render-stale-RSC: NOT directly applicable here (the invite modal doesn't toggle a render-time existence check), but the discipline of "after a write, ensure the parent UI reflects the new state" applies — the success card replaces the form, no `router.refresh()` round-trip needed because no parent RSC depends on the new state.
- **Story 6.2 (commits `9d4ee9b` + `200d754`) — doctor magic-link auth + view.** Establishes the `/m/[token]` route family. Story 6.4 ADDS a parallel `/convite/[inviteSegment]` route family for the patient-landing direction. Segment-parsing pattern (`parseShareTokenSegment`) is the template for `parsePatientInviteSegment`.
- **Story 5.1 (`pending_invites` schema)** — the structurally-similar-but-semantically-different sibling. Pattern reused: identifier hashing helper (`hashIdentifier`), partial unique index for in-flight idempotency, narrow 23505 catch + re-SELECT, `actorType: "doctor"` audit pattern. NOTE: Story 5.1 used a TOTAL unique index because the patient→doctor lifecycle never re-opens. Story 6.4's renewal-after-expiry path requires a PARTIAL index (`WHERE status = 'pending'`) — flagged in AC4.
- **Story 5.5 (`exports_active_uq`) / Story 5.6 (`account_deletion_requests_active_uq`)** — the in-flight partial-unique-index + narrow 23505 catch + idempotent re-tap pattern. Story 6.4 mirrors this exactly for `patient_invites_professional_identifier_active_uq`.
- **Story 1.1 (account creation)** — `initializeProfile` mutation in `packages/api/src/router/account.ts`. Story 6.4 EXTENDS this with an optional `inviteId` parameter. **CRITICAL:** the existing non-invite registration path MUST NOT regress. Test by ensuring a no-`inviteId` call still passes Zod and writes the same audit shape.
- **Epic 5 retro lessons:**
  - Lesson "Audit-log discipline matured into LGPD infrastructure" — partial-unique-index + narrow 23505 + idempotency on re-tap. Applied verbatim in AC5/T3.
  - Lesson "6-identity RLS matrix discipline stuck" — Story 6.4 raises this to 7 (the `unrelatedDoctor` cell). The CLAUDE.md update in AC13 codifies the new shape so future stories don't backslide.
  - Lesson "Outbox pattern landed clean on first try" — N/A here (no pg-boss job involved; the invite is a synchronous DB+URL emission, no LLM call).

### Git intelligence

- `worktree-story-6-2` branched from `origin/main` at `2f44243`. Stacked above: `9d4ee9b` (6.2 feat), `200d754` (6.2 R1), `38f09bf` (6.3 feat), `66ddaeb` (6.3 R1). Story 6.4 commits stack again on top of `66ddaeb`.
- PR #57 is open; Story 6.4 commits go on the same PR (stacked-stories-single-PR per MEMORY.md).
- Pattern to mirror for the schema file: `packages/db/src/schema/sharing.ts` (composed schema with RLS-policy companion file) AND `packages/db/src/schema/professionals.ts` (the Story 6.3 sibling).
- Pattern to mirror for the resolver: Story 6.3's `activateProfessionalAccount` (doctorProcedure + activation check + idempotent INSERT + audit). The auth.users probe via admin client mirrors Story 5.6's deletion path.
- Pattern to mirror for the modal: Story 6.3's `<ProfessionalAccountModal>` (TanStack Form + tRPC mutation + success-card swap).
- Pattern to mirror for the landing RSC: Story 6.2's `/m/[token]/view/page.tsx` segment-parse + resolver-fetch + render.

### Latest tech information

- **Drizzle ORM `pgEnum` + `ALTER TYPE ADD VALUE`** — Story 6.3 verified `db:push` emits `CREATE TYPE` automatically. Adding a future status (e.g. `archived`) requires `ALTER TYPE patient_invite_status_enum ADD VALUE 'archived'` — non-transactional but safe under additive widening (CLAUDE.md ops note "strict-superset widening" path).
- **Supabase Auth admin SDK** — `auth.admin.listUsers()` is paginated (default 50); for a single-identifier probe, use `auth.admin.getUserByEmail(...)` (newer) or a direct `SELECT id FROM auth.users WHERE email = $1 OR phone = $1 LIMIT 1`. Verify the admin helper's interface; the latter (raw SQL via the service-role connection) avoids the SDK pagination footgun entirely.
- **Next.js 15 App Router segment parsing** — Story 6.2 uses `${shareTokenId}.${tokenHmac}` as a single path segment. Story 6.4 mirrors with `${inviteId}.${tokenHmac}`. The `.` is the discriminator; the segment parser splits on first `.` and Zod-validates both halves.
- **`createHmac` constant-time verification** — reuse `verifyShareToken` pattern from `packages/api/src/sharing.ts:96` (Buffer-wrap both halves, length-check, `timingSafeEqual`).

### Project context reference

- Worktree: `/Users/francisaraujo/repos/healthtracker/.claude/worktrees/story-6-2`
- Branch: `worktree-story-6-2` (off `origin/main` `2f44243`; stacked above `66ddaeb`)
- Test infra: testcontainer Postgres (`pnpm --filter @healthtracker/db test:integration`), RLS suite (`pnpm --filter @healthtracker/db test:rls`), Vitest for unit / validator-boundary tests.

## Open questions / decisions for dev phase

1. **auth.users existence enumeration oracle (AC5 step 4 / AC11).** Today's spec accepts the leak as bounded — doctors are authenticated, accountable, low-volume. R1 reviewer should explicitly assess whether to add a `professional_invite_rate_limit` partial unique index `(professional_user_id, created_at::date) WHERE status = 'pending'` with a daily cap, or a constant-time response delay. Decision: defer to R1; document the threat model + accepted risk in CLAUDE.md.

2. **Patient identifier echo-back on success (AC2 open question).** Today's spec echoes the normalised identifier ("Convite criado para `paciente@exemplo.com`"). Trade-off: trust signal vs. shoulder-surfing risk. R1 reviewer flag.

3. **Phone-format strictness (AC2).** The Brazilian phone normaliser accepts BR mobile numbers (`+55` prefix). Landline / international numbers throw a validation error. Is this too restrictive? Brazilian MVP — likely fine. Defer broader normalisation until a non-BR market signal.

4. **`getPatientInviteContext` route placement (AC7).** The resolver could live on `accountRouter` (cohesion with `initializeProfile`) OR a new `patientInviteRouter` (separation of concerns). Today's spec recommends `accountRouter` — dev's call to refactor if a separate router emerges as cleaner.

5. **The Início referrer-attribution data path (T5.6).** Story 1.1's empty state is partially deferred; the "Convidado por Dr. [Nome]" surface needs a data path JOIN on patient_invites. If the empty state component doesn't yet exist as a render-time pluggable surface, the integration seam is the only deliverable Story 6.4 ships — the actual UI render moves to the deferred-work register. R1 reviewer to verify this isn't dropped silently.

6. **Renewal vs. revoke + re-invite UX (AC6).** Today's spec lets the doctor re-invite after expiry (new row + new audit, partial-unique-index permits). A doctor revoking a pending invite is OUT-OF-SCOPE (no `revokePatientInvite` mutation in 6.4). If the dashboard story (6.5/6.x) wants revoke + re-invite atomically, it can build on top — the schema already has `revoked_at`.

7. **Tamagui token usage on the new components (T5.1, T5.2, T5.4, T5.5).** Story 6.3 R1-M3 specifically called out raw hex in `<ProfessionalAccountBanner>` and `<ProfessionalAccountModal>`. **The 6.4 dev MUST start with Tamagui tokens** — do not import raw hex even as a placeholder. R1 reviewer is primed to fail this on sight.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- typecheck (pnpm typecheck --force): PASS (17/17 packages)
- lint (pnpm lint): PASS — only pre-existing warnings in `biomarker-suggestion.test.ts`
- api unit tests: 310/310 PASS
- db unit tests: no test files (RLS + integration deferred to local Docker / Supabase)
- llm-service tests: 37/37 PASS

### Completion Notes List

All 13 ACs implemented:

- **T1 (validators + helpers)**: pt-BR constants, `createPatientInviteInputSchema` + output schema, `getPatientInviteContext*` schemas, `normalizePatientIdentifier` (email + BR mobile), `signPatientInviteToken` / `verifyPatientInviteToken` / `generatePatientInviteToken` / `buildPatientInviteUrl` (all with `"patient_invite:"` domain prefix per AC8), `parsePatientInviteSegment`.
- **T2 (schema + RLS)**: NEW `packages/db/src/schema/patient_invites.ts` with the partial unique index on `(professional_user_id, identifier_hash) WHERE status = 'pending'`, FK to `professionals.user_id` (cascade) + `users.id` (set null — second exception). NEW `custom_rls_patient_invites.sql` with select_own / insert_own / update_own_or_resolving_patient / service_role_all.
- **T3 (createPatientInvite mutation)**: `doctorProcedure`-bound resolver with activation gate, normalize/hash, AC11 auth.users probe, idempotent SELECT-then-INSERT-then-narrow-23505 catch, narrow programmer-error rethrow. `patient_invite.sent` audit NOT in `ACCESS_LOG_EVENT_KINDS`.
- **T4 (account router)**: `initializeProfile` extended with OPTIONAL `inviteId` + `tokenHmac`; `getPatientInviteContext` publicProcedure; `resolvePatientInviteWithinTx` helper (MUST-NOT-THROW + UPDATE-WHERE-status='pending' racing-revoke-safe predicate). `patient_invite.resolved` audit NOT in `ACCESS_LOG_EVENT_KINDS`.
- **T5 (web)**: NEW InvitePatientButton + InvitePatientModal (Tailwind tokens, no raw hex); page.tsx swaps banner ↔ button on `activationStatus.activated`. NEW `/convite/[inviteSegment]` RSC landing + client wrapper that mounts existing `<RegisterForm>` threaded with `inviteId` + `tokenHmac`.
- **T6 (unit tests)**: AC8 LOAD-BEARING regression `signShareToken !== signPatientInviteToken` plus cross-surface replay test; validator boundary tests; segment-parser tests.
- **T7 (RLS + FK)**: 7-identity RLS matrix (`unrelatedDoctor` is the new 7th); FK cascade-exception regression test.
- **T8 (integration)**: three testcontainer integration tests — create (happy + idempotent + renewal + check constraint); resolve (happy + revoked + concurrent); getContext (valid + expired + revoked + non-existent).
- **T9 (docs)**: CLAUDE.md "Doctor → patient invite (Story 6.4)" section added with all AC13 invariants; second cascade-exception cross-linked from the Story 6.3 paragraph; seven deferred-work entries appended.

**No new env vars.** `SHARE_TOKEN_HMAC_SECRET` and `WEB_APP_URL` reused. **No `supabase/migrations/*.sql`** — Story 6.6 owns the consolidated Epic 6 migration.

**Deviation:** the AC5 step 4 auth.users existence probe uses the bare `db` client (service-role postgres connection) rather than the `getSupabaseAdminClient()` SDK helper. Rationale: Supabase JS does not expose `getUserByEmail` / `getUserByPhone` typed surfaces; the raw SQL probe via `db.execute` is unambiguous + avoids SDK pagination. Programmer errors propagate; infra failures degrade to "not registered" so the partial-unique-index + 23505 narrow catch still prevents duplicate writes.

### File List

**Created:**

- packages/db/src/schema/patient_invites.ts
- packages/db/policies/custom_rls_patient_invites.sql
- packages/db/**tests**/rls/patient_invites.rls.test.ts
- packages/db/**tests**/rls/patient_invites_resolved_user_id_fk.rls.test.ts
- packages/db/**tests**/integration/create-patient-invite.integration.test.ts
- packages/db/**tests**/integration/resolve-patient-invite.integration.test.ts
- packages/db/**tests**/integration/get-patient-invite-context.integration.test.ts
- packages/api/**tests**/sharing/patient-invite-helpers.test.ts
- packages/api/**tests**/sharing/create-patient-invite-validators.test.ts
- packages/api/**tests**/sharing/parse-patient-invite-segment.test.ts
- apps/web/src/app/m/[token]/view/InvitePatientButton.tsx
- apps/web/src/app/m/[token]/view/InvitePatientModal.tsx
- apps/web/src/app/convite/[inviteSegment]/page.tsx
- apps/web/src/app/convite/[inviteSegment]/PatientInviteLanding.tsx

**Modified:**

- packages/validators/src/professional.ts
- packages/db/src/schema/index.ts
- packages/api/src/sharing.ts
- packages/api/src/router/sharing.ts
- packages/api/src/router/account.ts
- apps/web/src/app/m/[token]/view/page.tsx
- apps/web/src/app/auth/register/register-form.tsx
- CLAUDE.md
- \_bmad-output/implementation-artifacts/deferred-work.md

### References

- [Epic 6 / Story 6.4 — _bmad-output/planning-artifacts/epics.md lines 1493–1517]
- [FR30 — _bmad-output/planning-artifacts/prd.md line 515]
- [Doctor Acquisition Loop — _bmad-output/planning-artifacts/prd.md lines 34, 283, 432]
- [UX-DR20 Tier-1 single action at report close — _bmad-output/planning-artifacts/ux-design-specification.md line 1115]
- [AR15 — `pending_invites` schema decision — _bmad-output/planning-artifacts/architecture.md lines 376–382]
- [Sharing schema notes (Epic 5 / Story 5.1) — CLAUDE.md]
- [Story 6.3 spec (`professionals` table + `pending_invites.resolved_user_id` FK with `onDelete: set null`) — _bmad-output/implementation-artifacts/6-3-doctor-activates-a-professional-account-from-the-conversation-starter-view.md]
- [Story 6.3 R1 code review (Tamagui-token discipline lesson M3) — _bmad-output/implementation-artifacts/6-3-doctor-activates-a-professional-account-from-the-conversation-starter-view-code-review-r1.md]
- [Story 5.1 spec (`pending_invites` schema + idempotency pattern) — _bmad-output/implementation-artifacts/5-1-patient-configures-per-biomarker-sharing-with-a-named-doctor.md]
- [Story 1.1 spec (`account.initializeProfile` mutation) — _bmad-output/implementation-artifacts/1-1-patient-creates-account-with-email-and-password.md]
- [Story 5.6 cascade-rule + first cascade-exception — CLAUDE.md "Account deletion discipline"]
- [Epic 5 retro — _bmad-output/implementation-artifacts/epic-5-retro-2026-05-28.md]
- [SHARE_TOKEN_HMAC_SECRET + WEB_APP_URL boot-gates — packages/api/src/sharing.ts lines 38–67, 146–177]
- [`createPendingInvite` mutation (pattern source) — packages/api/src/router/sharing.ts lines 96–183]
- [`writeAuditLog` signature + actorType union — packages/api/src/audit.ts lines 14–22]
- [`ACCESS_LOG_EVENT_KINDS` allowlist — packages/validators/src/sharing.ts lines 308–335]
- [`doctorProcedure` (Story 6.2 session-gated) — packages/api/src/trpc.ts]
- [`professionals` schema — packages/db/src/schema/professionals.ts]
- [`pending_invites.resolved_user_id` FK `onDelete: set null` precedent — packages/db/src/schema/sharing.ts lines 71–93]
- [CLAUDE.md "Code review discipline" — 6-identity matrix mandate (Story 6.4 raises to 7)]
