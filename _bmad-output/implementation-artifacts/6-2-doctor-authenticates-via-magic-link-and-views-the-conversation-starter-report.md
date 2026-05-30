# Story 6.2: Doctor authenticates via magic link and views the Conversation Starter report

Status: ready-for-dev

Stacked on PR #56 (Epic 5 + Story 6.1 train). Second story of Epic 6 — the first production consumer of `doctorProcedure` and the first story in the project to send patient data to a real LLM (DPA-gated).

## Story

As a doctor who has tapped `Ver histórico` on a patient's pre-auth landing page,
I want to authenticate by entering my email, clicking a magic link, and immediately seeing the Conversation Starter report,
so that I can review the patient's longitudinal data before our appointment in under 90 seconds from opening the link.

## Acceptance Criteria

1. **AC1 — Magic-link request screen at `/m/[token]/auth`.** Replace the Story 6.1 T4.6 stub at `apps/web/src/app/m/[token]/auth/page.tsx` with the real magic-link request UI. This is a Next.js App Router **client component page** (it owns form state + a tRPC mutation) wrapped by a server-component layer that re-runs the Story 6.1 token-validate-and-status branch table BEFORE rendering the form. If the resolver returns `expired | revoked | invalid`, render the same dead-link state Story 6.1 ships (re-use `<PreAuthLandingCard status="expired|revoked|invalid">`) — do NOT render the email form. Reaching `/m/[token]/auth` directly via a deep-link must NOT bypass the dead-link gate.

   **Pt-BR copy (named constants in `packages/validators/src/sharing.ts`):**
   - Heading: `Receber link por e-mail` (`AUTH_REQUEST_HEADING_PT_BR`)
   - Sub-heading: `Você receberá um link para abrir o histórico de {patientFirstName}.` (`AUTH_REQUEST_SUBHEADING_FN`)
   - Email label: `E-mail` (`AUTH_REQUEST_EMAIL_LABEL_PT_BR`)
   - CTA: `Enviar link` (`AUTH_REQUEST_CTA_PT_BR`)
   - Sent confirmation: `Enviamos um link para {email}. Abra-o nesse navegador para continuar.` (`AUTH_REQUEST_SENT_FN`)
   - Resend hint: `Não recebeu? Verifique a caixa de spam ou peça outro em 60 segundos.` (`AUTH_REQUEST_RESEND_HINT_PT_BR`)
   - Generic error: `Não foi possível enviar agora. Tente novamente.` (`AUTH_REQUEST_GENERIC_ERROR_PT_BR`)

   **CRITICAL:** never branch the error message on Supabase's response. Returning "this email is already a doctor / not a doctor / etc." is an enumeration oracle on registered users.

2. **AC2 — Supabase Auth: client-side magic-link via `signInWithOtp`.** The form mutation calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } })` from the browser (`createSupabaseClient()` in `apps/web/src/auth/client.ts`). `shouldCreateUser: true` is intentional — first-time doctors land here without an account; Supabase mints the auth.users row on first verify. The `emailRedirectTo` value MUST be the absolute URL `${WEB_APP_URL}/m/[token]/auth/callback?shareTokenId=${shareTokenId}&tokenHmac=${tokenHmac}` so the verify-flow round-trips back to our token-aware callback. Reuse `WEB_APP_URL` from `apps/web/src/env.ts` (Story 5.2 added it; no new env var). **Boot-gate check:** `WEB_APP_URL` already fails boot when empty in staging/preview/production per Story 5.2 — Story 6.2 inherits the gate, adds NOTHING.

   **What the spec rejects (and why):**
   - **Anonymous Supabase session keyed off the share_token (no email).** Rejected — Epic 6's whole point is the Doctor Acquisition Loop. Doctor email is the conversion identifier; no email = no professional account in Story 6.3 = loop never closes.
   - **Token-binding without auth (just-set the share-token cookie).** Rejected — `share_token.read` audit row would have no real `auth.uid()` to attribute to the doctor, and Story 6.3 (`activate professional account`) needs the auth.users row to already exist.
   - **Doctor-distinct auth.users table (separate from patients).** Rejected — Supabase Auth is one user pool; the role distinction is in our domain (`pending_invites.resolved_user_id`, future `professionals` table per Story 6.3). Story 6.2 leaves both the FK declaration on `pending_invites.resolved_user_id` AND the actual `claimInviteByDoctor` flip to Story 6.3.

3. **AC3 — Callback route at `/m/[token]/auth/callback`.** New file `apps/web/src/app/m/[token]/auth/callback/route.ts` (Next.js Route Handler, NOT a page — same pattern as `apps/web/src/app/auth/callback/route.ts`). On GET:
   1. Read `code`, `shareTokenId`, `tokenHmac` from `searchParams`.
   2. Re-validate the share-token via `appRouter.createCaller(...).sharing.getPreAuthContext({shareTokenId, tokenHmac})` — same resolver Story 6.1 wrote. If `status !== 'active'` → redirect to `/m/{shareTokenId}.{tokenHmac}` (the Story 6.1 page renders the right dead-link state). Do NOT exchange the code if the token is dead — that would leave a half-signed-in doctor staring at a dead-link page.
   3. `supabase.auth.exchangeCodeForSession(code)` — same pattern as patient-side callback. On error → redirect to `/m/{shareTokenId}.{tokenHmac}` with the `invalid` state (do NOT redirect to `/auth/error` — that's the patient-side error page; the doctor never saw it and `error` is the wrong copy).
   4. On success → `NextResponse.redirect(`${origin}/m/${shareTokenId}.${tokenHmac}/view`)` — the report view route (AC5).
   5. **The callback MUST NOT call `account.initializeProfile`** (the patient-side callback does — that's wrong for doctors). The doctor's `users` row stays minimal until Story 6.3's `activateProfessionalAccount` flips it. Document this divergence in the route handler's docstring + CLAUDE.md (per AC11).
   6. **Open-redirect hardening:** validate `shareTokenId` is uuid-shaped and `tokenHmac` matches `/^[A-Za-z0-9_-]{1,128}$/` BEFORE composing the destination URL string. Reject otherwise → redirect to `/m/00000000-0000-0000-0000-000000000000.invalid` so Story 6.1's malformed-segment branch handles the trace.

4. **AC4 — `doctorProcedure` is the consumer.** New tRPC procedure `sharingRouter.getConversationStarter(input)` runs under `doctorProcedure`. This is the FIRST production consumer of the middleware Story 5.1 shipped. Input: `{ shareTokenId: z.uuid(), tokenHmac: z.string().min(1).max(128) }`. The `doctorProcedure` middleware reads `x-share-token` from the request headers and sets `SET LOCAL app.current_share_token_id` — so the **client MUST forward `shareTokenId` as the `x-share-token` header on this call.** The web client (`apps/web/src/trpc/server.tsx`) does NOT thread custom headers by default — the report view RSC (AC5) calls the procedure via the server-side caller pattern and MUST inject `x-share-token` into the `Headers` it passes to `createTRPCContext`. Pseudocode:

   ```ts
   // apps/web/src/app/m/[token]/view/page.tsx (RSC)
   const supabase = await createSupabaseServerClient();
   const { data: { user } } = await supabase.auth.getUser();
   if (!user) redirect(`/m/${token}/auth`);
   const heads = new Headers(await headers());
   heads.set("x-share-token", shareTokenId);
   const ctx = createTRPCContext({ headers: heads, session: { user, ... } });
   const caller = appRouter.createCaller(ctx);
   const report = await caller.sharing.getConversationStarter({
     shareTokenId,
     tokenHmac,
   });
   ```

   **In-resolver double-check (defense in depth):** even with the GUC set, the resolver MUST re-verify `tokenHmac` via `constantTimeEqualHmac` against the row's persisted HMAC. The `doctorProcedure` middleware only proves "client claims share token X"; the HMAC compare proves "client actually holds the URL the patient signed for X". Without the second check, a malicious extension that read another doctor's `x-share-token` from a different tab's request would pass RLS.

5. **AC5 — Report view at `/m/[token]/view/page.tsx` (Next.js RSC).** New file. The doctor's primary screen — pre-warmed cache renders in <3s of authentication (NFR-P4). Flow:
   1. Parse `[token]` on first `.` (reuse Story 6.1's segment-parse helper — extract to `packages/api/src/sharing.ts` if not already exported).
   2. `const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser();` — if no user, redirect to `/m/[token]/auth`. NOT `/m/[token]` (which is the pre-auth landing) — the doctor already cleared that gate.
   3. Re-run `getPreAuthContext` against the share-token first; if not `active`, redirect to `/m/[token]` so Story 6.1 renders the dead-link state. (We trust nothing — a token can be revoked between the magic-link click and the report load.)
   4. Set `x-share-token` header per AC4 and call `getConversationStarter`. If `cacheStatus === 'queued'`, render the "preparing" message (AC8). If `'failed'`, render the "failed" message (AC8). If `'ready'`, render the full report.
   5. The page is RSC (`export const dynamic = "force-dynamic"; export const revalidate = 0;`); the streaming/skeleton for `'queued'` is implemented via a client component `<ConversationStarterPolling>` that polls `getConversationStarter` every 2s until ready (max 30s; then show `failed` with retry hint).
   6. **Layout:** no app-shell (no patient sidebar, no Compartilhar tab). Top: small Health Tracker wordmark + patient first-name banner `Histórico de {patientFirstName}` (left-aligned). Body: three discussion prompts (`<ConversationStarterPrompt>` per UX spec line 932) above the fold; `<BiomarkerCard variant="report">` (UX-DR8 / UX-DR16) grid below.

6. **AC6 — Resolver `sharingRouter.getConversationStarter` shape.** Output:

   ```ts
   {
     cacheStatus: "queued" | "ready" | "failed";
     payload: ConversationStarterPayload | null; // null unless 'ready'
     patientFirstName: string;
     sharedAt: Date;
     expiresAt: Date | null;
     failureReason: string | null; // null unless 'failed'
   }
   ```

   Resolver steps (inside the doctorProcedure transaction — `tx` has the GUC set):
   1. `SELECT id, token_hmac, patient_id, expires_at, revoked_at, created_at FROM share_tokens WHERE id = $1 LIMIT 1` — RLS predicate on the doctor side filters revoked/expired automatically, so a row coming back means the token is alive AND scoped to the bound principal. **HOWEVER:** because the doctor side RLS predicate already filters non-`active` rows out, a 404 here means revoked / expired / not-owned-by-this-principal indistinguishably. That's fine for this resolver — throw `TRPCError({ code: "NOT_FOUND" })`; the calling RSC handles redirect to `/m/[token]` where Story 6.1's `publicProcedure` discriminates the dead-link state.
   2. `constantTimeEqualHmac(row.tokenHmac, input.tokenHmac)` — defense-in-depth per AC4. Mismatch → `TRPCError({ code: "NOT_FOUND" })` (same shape as missing row — no enumeration oracle).
   3. `SELECT status, payload, failure_reason FROM conversation_starter_cache WHERE share_token_id = $1` — RLS filters to the bound token's cache row + only if `status = 'ready'`. **Subtle:** for `queued`/`failed` the existing RLS policy returns ZERO rows for the doctor principal (it requires `status = 'ready'`). To surface `queued`/`failed` to the doctor UI for the AC8 inline message, we have two choices:
      - **(a) Widen the RLS predicate** to allow doctor SELECT on `queued`/`failed` rows too — risk: the doctor sees the failure_reason, which today is `LLM_API_ERROR | LLM_NETWORK_ERROR` (operator-grade strings) but could leak prompt details in future.
      - **(b) Run the cache SELECT via service-role** outside the doctor transaction, after the share-token check has already proven the doctor is allowed to see this token. Same shape Story 5.5 uses for `getExport` (signed-URL minting via service-role).
      - **Decision: (b).** Reasons: keeps the RLS predicate narrow (the existing policy is the LGPD backstop — don't dilute it); avoids leaking `failure_reason` strings; matches the established Story 5.5 pattern. The resolver opens a parallel service-role connection via `getSupabaseAdminClient()` (Story 6.1 exposed this) only for the cache-status lookup, mapping `failure_reason` to a SHORT pt-BR client string at the boundary — `LLM_API_ERROR | LLM_NETWORK_ERROR` → `"Não foi possível pré-gerar o sumário desta vez."`. Document the trade-off in the resolver docstring + CLAUDE.md (AC11).
   4. Resolve `patientFirstName` via `resolvePatientFirstName` (Story 6.1 helper). Never throw — fall back to `"Paciente"` if it returns null (NOT `"Alguém"` — the doctor is past the trust gate).
   5. Emit `share_token.read` audit row with `metadata = { phase: "post-auth", userAgent }`. Use `writeAuditLog`; actor `actorId = auth.uid()` (NOT shareTokenId — the doctor is authenticated now and the Access Log will surface this correctly to the patient). `actorType = "doctor"`, `resourceId = shareTokenId`, `resourceType = "share_token"`. **Audit fires on EVERY view of the report**, not just first view — the patient's surveillance surface wants the full timeline.

7. **AC7 — `share_token_biomarkers` doctor-side RLS exercised end-to-end.** When the report renders biomarker cards, it MUST source the per-biomarker visibility from `share_token_biomarkers` JOINed against the patient's `observations`. **This story's bound is the `ConversationStarterPayload` from the cache row** — the pre-warmed payload already encodes `visibleBiomarkers` per Story 5.2's consumer. So Story 6.2 does NOT need to re-query `observations` directly; it renders the cache payload as-is. **However:** the resolver MUST verify the cache row's `share_token_id` matches the bound principal (RLS does this implicitly) so a stale cache row from another token can't leak. This is automatic via RLS + the `share_token_id = $1` predicate. **Test (AC10) MUST include:** doctor with active token A receives the cache payload for token A and ZERO bytes of any other token's cache — even if the worker bug duplicated a payload across rows.

8. **AC8 — Cache `queued` / `failed` UI states.** The `<ConversationStarterPolling>` client component:
   - `queued`: Skeleton card with pt-BR shimmer text `Preparando o sumário…`. Poll the resolver every 2s. If 30s elapses without `ready`, surface a `failed`-style message with a `Tentar de novo` button that forces a re-fetch.
   - `failed`: Inline pt-BR message `Não foi possível pré-gerar o sumário desta vez. Você ainda pode ver os biomarcadores enviados.`. Below the message, render the biomarker cards directly from a separate fallback resolver (out of scope for 6.2 — for THIS story, the failed state shows just the message with no biomarker cards; document as a known short-cut in dev notes).

   Pt-BR constants in `packages/validators/src/sharing.ts`: `CONVERSATION_STARTER_PREPARING_PT_BR`, `CONVERSATION_STARTER_FAILED_PT_BR`, `CONVERSATION_STARTER_RETRY_CTA_PT_BR`.

9. **AC9 — Real Anthropic adapter for `generateConversationStarter` lands behind the `ANTHROPIC_API_KEY` boot-gate.** The Story 5.2 stub returns canned content; the real Anthropic call is implemented in `services/llm/src/adapters/anthropic.ts` `createAnthropicAdapter().generateConversationStarter()` (currently throws `Not implemented — Story 6.2`). Implementation:
   1. Prompt: system message frames "you are generating a non-clinical Conversation Starter for a Brazilian doctor; output JSON only, never prose; never provide medical advice; ANVISA-compliant framing." Prompt details + the exact system message live in `services/llm/src/prompts/conversation-starter.ts` (new file). Mirror the Story 4.1 prompt-file layout.
   2. Call `client.messages.create({ model: "claude-sonnet-4-5", system, messages, max_tokens: 1024 })` — NOT streaming. The Conversation Starter is one JSON payload, not a token stream.
   3. Parse the response, validate via Zod against `conversationStarterPayloadSchema` (new schema in `packages/validators/src/sharing.ts` matching `ConversationStarterPayload`). Validation failure → throw `Anthropic.APIError` (consumer's narrow catch will mark `failed`).
   4. Input to the LLM: patient's visible biomarker categories + last-3-draws of each. The consumer (`services/llm/src/consumers/generate-conversation-starter.ts`) already builds the `visibleBiomarkers` array — extend it to also fetch the last-3-draws snapshot from `observations` via service-role SQL. **Schema:** no new tables; reuse `observations`. The values feed the LLM; no values feed the rendered card unless the LLM emitted them.
   5. **DPA gate:** the `ANTHROPIC_API_KEY` env var boot-check stays as-is. When unset (dev/CI) → stub (existing Story 5.2 stub returns canned). When set (staging/prod) → real Anthropic. Per CLAUDE.md NFR-S6: real Anthropic generation is "DPA-gated" — the deploy lifecycle requires the DPA to be signed before flipping `ANTHROPIC_API_KEY` on in production. No code change enforces this; it's an ops gate. Document in CLAUDE.md (per AC11).
   6. **No new env var.** `ANTHROPIC_API_KEY` is reused from Story 4.1.

10. **AC10 — Tests: 6-identity RLS matrix MANDATORY on `conversation_starter_cache` and `share_token_biomarkers` doctor-side reads.** Two new test files:
    - `packages/db/__tests__/rls/conversation_starter_cache.rls.test.ts` — the canonical Story 5.1 R2 matrix:
      - `correctPatient`: SELECT own cache rows regardless of status (`queued`/`ready`/`failed` all returned).
      - `wrongPatient`: ZERO rows.
      - `serviceRole`: all rows (bypass).
      - `doctorWithActiveToken` + `cache.status='ready'`: 1 row.
      - `doctorWithActiveToken` + `cache.status='queued'`: 0 rows (RLS predicate requires `ready`). Documents the AC6 service-role-bypass decision.
      - `doctorWithActiveToken` + `cache.status='failed'`: 0 rows (same reason).
      - `doctorWithExpiredToken`: 0 rows.
      - `doctorWithRevokedToken`: 0 rows.
    - `packages/db/__tests__/rls/share_token_biomarkers.rls.test.ts` — the matrix on the visibility junction (Story 5.1 left this without the doctor-bound test; 6.2 closes it):
      - `correctPatient`: SELECT own rows (visible AND hidden).
      - `wrongPatient`: 0 rows.
      - `serviceRole`: all rows.
      - `doctorWithActiveToken`: only `visible = true` rows for the bound token.
      - `doctorWithActiveToken` viewing a DIFFERENT token's biomarker rows: 0 rows (cross-token leak guard — the failure mode AC7 mentions).
      - `doctorWithExpiredToken`: 0 rows.
      - `doctorWithRevokedToken`: 0 rows.

    **Plus 1 resolver-integration test** `packages/api/__tests__/sharing/get-conversation-starter.integration.test.ts` covering: `ready` → payload returned; `queued` → status field returned, payload null; `failed` → status + failureReason mapped to pt-BR; bad-HMAC against valid token → NOT_FOUND; revoked token (RLS filter) → NOT_FOUND; expired token (RLS filter) → NOT_FOUND. EVERY successful path also asserts EXACTLY ONE `share_token.read` audit row written with `metadata.phase = "post-auth"`.

11. **AC11 — Docs: CLAUDE.md "Doctor magic-link discipline (Story 6.2)" paragraph** under the existing "Pre-auth landing discipline (Story 6.1)" paragraph. Cover:
    - (a) Why `doctorProcedure` is the production consumer (the GUC + RLS principal binding pattern).
    - (b) The in-resolver `constantTimeEqualHmac` re-check as defense-in-depth above the middleware.
    - (c) The `conversation_starter_cache` RLS-narrow-predicate + service-role-bypass-for-status decision (AC6).
    - (d) `share_token.read` `phase = "post-auth"` event convention (mirror of Story 6.1's pre-auth).
    - (e) `auth.users` row creation on first magic-link verify is benign — doctor and patient share one auth pool; the domain-role distinction is `pending_invites.resolved_user_id` flipped by Story 6.3's `claimInviteByDoctor`.
    - (f) DPA gate is operational (env var ungated in code; signed DPA required before prod flips `ANTHROPIC_API_KEY` on for the conversation-starter worker).
    - (g) Story 6.2 does NOT flip `pending_invites.resolved_user_id` — that's Story 6.3 (`activateProfessionalAccount`), which also lands the FK declaration.

## Tasks / Subtasks

- [ ] **T1 — Validators (`packages/validators/src/sharing.ts`)** (AC1, AC6, AC8)
  - [ ] T1.1 Export pt-BR constants: `AUTH_REQUEST_HEADING_PT_BR`, `AUTH_REQUEST_SUBHEADING_FN(firstName)`, `AUTH_REQUEST_EMAIL_LABEL_PT_BR`, `AUTH_REQUEST_CTA_PT_BR`, `AUTH_REQUEST_SENT_FN(email)`, `AUTH_REQUEST_RESEND_HINT_PT_BR`, `AUTH_REQUEST_GENERIC_ERROR_PT_BR`, `CONVERSATION_STARTER_PREPARING_PT_BR`, `CONVERSATION_STARTER_FAILED_PT_BR`, `CONVERSATION_STARTER_RETRY_CTA_PT_BR`, `CONVERSATION_STARTER_PATIENT_FIRSTNAME_FALLBACK_PT_BR = "Paciente"`.
  - [ ] T1.2 Export `SHARE_TOKEN_READ_PHASE_POST_AUTH = "post-auth"` constant (mirror of Story 6.1's `SHARE_TOKEN_READ_PHASE_PRE_AUTH`). Verify both names exist after this story.
  - [ ] T1.3 Export `getConversationStarterInputSchema` (`{shareTokenId: z.uuid(), tokenHmac: z.string().min(1).max(128)}`) and `getConversationStarterOutputSchema` matching AC6 shape.
  - [ ] T1.4 Export `conversationStarterPayloadSchema` (Zod mirror of `ConversationStarterPayload` from `services/llm/src/adapters/anthropic.ts`). Move the TypeScript interface to derive from the Zod schema if possible (a `z.infer`). **NOTE:** `services/llm` and `packages/validators` boundary — verify the package can import from `validators` (it already does for `JobPayload`); if not, dual-declare and reference each other in a comment.

- [ ] **T2 — `doctorProcedure` middleware refresh / sanity check (`packages/api/src/trpc.ts`)** (AC4)
  - [ ] T2.1 The middleware already exists (Story 5.1). Story 6.2 adds a docstring referencing AC4 + the in-resolver HMAC re-check. NO code change to the middleware itself.
  - [ ] T2.2 Verify `x-share-token` header threading through the existing tRPC HTTP route is unchanged. The Story 6.2 caller threads it explicitly via `createTRPCContext`-with-injected-headers; no router-wide change required.

- [ ] **T3 — Resolver `sharingRouter.getConversationStarter` (`packages/api/src/router/sharing.ts`)** (AC4, AC6, AC7)
  - [ ] T3.1 Add the procedure under `doctorProcedure`. Input from T1.3. The procedure is wrapped in the transactional GUC context the middleware sets.
  - [ ] T3.2 SELECT share_tokens row (RLS auto-scoped); throw `TRPCError({code:"NOT_FOUND"})` if zero rows (resolves dead-link to a single client status; pre-auth resolver disambiguates).
  - [ ] T3.3 `constantTimeEqualHmac` re-check against `tokenHmac` from input.
  - [ ] T3.4 Cache lookup via service-role admin client (AC6 decision (b)): `getSupabaseAdminClient()` → raw SQL `select status, payload, failure_reason from conversation_starter_cache where share_token_id = $1 limit 1`. Map `failure_reason` operator strings → pt-BR `CONVERSATION_STARTER_FAILED_PT_BR`. NEVER pass operator strings to the client.
  - [ ] T3.5 `resolvePatientFirstName` with `"Paciente"` fallback (NOT `"Alguém"`).
  - [ ] T3.6 Audit row: `share_token.read`, `actorId = ctx.session.user.id` (the doctor's auth.uid — `doctorProcedure` requires both header AND session per AC4), `actorType = "doctor"`, `resourceId = shareTokenId`, `metadata = {phase: "post-auth", userAgent: <truncated 200ch>}`. Use `writeAuditLog`.
  - [ ] T3.7 Narrow catches only. Re-throw `TypeError | ReferenceError | SyntaxError`. The Supabase admin call uses the same narrow catch as Story 6.1's `resolvePatientFirstName`.

- [ ] **T4 — `doctorProcedure` requires BOTH header AND session (`packages/api/src/trpc.ts`)** (AC4)
  - [ ] T4.1 Current middleware only checks `x-share-token`. Add `if (!ctx.session?.user) throw UNAUTHORIZED` to the same middleware. **CRITICAL:** without this, a malicious extension could mint a share-token header on an unauthenticated browser and READ the report. The Story 5.1 middleware was written assuming Story 6.2 would add the session gate; this is that moment.
  - [ ] T4.2 Update the middleware docstring to record this is the Story 6.2 gate.
  - [ ] T4.3 Audit any existing `doctorProcedure` usages — confirm only the new `getConversationStarter` consumes it (sanity check; Story 6.1 deliberately used `publicProcedure`).

- [ ] **T5 — Web routes (`apps/web/src/app/m/[token]/`)** (AC1, AC3, AC5)
  - [ ] T5.1 Replace `auth/page.tsx` stub with the real magic-link request page. Server-component wrapper re-runs `getPreAuthContext` for the dead-link gate; renders `<DoctorMagicLinkForm shareTokenId tokenHmac patientFirstName>` for `active`. NO Magic link form ever renders for non-active states. `export const dynamic = "force-dynamic"`.
  - [ ] T5.2 Create `auth/DoctorMagicLinkForm.tsx` (`"use client"`) — TanStack Form + `supabase.auth.signInWithOtp`. On send → swap UI to a "sent" confirmation card with the resend-hint copy. 60s client-side resend lockout (`setTimeout`) — NO server enforcement (AC1 enumeration-oracle hygiene; rate-limit is a Vercel WAF concern deferred to infra).
  - [ ] T5.3 Create `auth/callback/route.ts` per AC3. Token re-validation → exchangeCodeForSession → redirect to `/m/[token]/view`. Open-redirect hardening per AC3.6.
  - [ ] T5.4 Create `view/page.tsx` per AC5. RSC. Auth-guard → token-status-guard → `x-share-token` header injection → caller call → render. NO app-shell layout group. `<meta name="robots" content="noindex,nofollow">`.
  - [ ] T5.5 Create `view/ConversationStarterPolling.tsx` (`"use client"`) for the `queued`/`failed` AC8 states. Uses the tRPC client (`httpBatchStreamLink` — supports custom headers via the `headers()` callback; this is the existing infra). The client component MUST pass `x-share-token: <shareTokenId>` on the polling request — verify `apps/web/src/trpc/react.tsx` `httpBatchStreamLink.headers` supports a per-request override OR add a `ShareTokenContext` provider that the polling component injects. **Sub-decision:** prefer adding a `headers` callback closure that reads from a React context to keep the doctor-side share-token threading discoverable. Document in dev notes.
  - [ ] T5.6 `view/ReportLayout.tsx` (server) — wordmark + patient-firstname banner + grid container (3-up on desktop, stack on mobile per UX line 564–571).

- [ ] **T6 — Shared UI: doctor-view BiomarkerCard + ConversationStarterPrompt** (AC5)
  - [ ] T6.1 If `<ConversationStarterPrompt>` does not yet exist (UX spec 932 — likely deferred to this story), create `packages/ui/src/components/ConversationStarterPrompt/ConversationStarterPrompt.tsx`. Tamagui. Props: `{ index: number; text: string; }`. State `default` (no `highlighted` in 6.2 — interactivity deferred). pt-BR copy via validators.
  - [ ] T6.2 `<BiomarkerCard variant="report">` (UX spec line 862 — `report` variant: static, print-optimised, no interactivity). Verify whether the component exists. If yes, ensure the `doctor-view` state (UX line 860: `read-only; no pan/zoom; optimised for desktop`) renders correctly. If no, create a thin `BiomarkerCard` covering the report variant ONLY (patient-app variants deferred). Renders `category`, `currentValue`, `previousValue`, `trendDirection` arrow, `patientBaseline` band. NO population ranges (FR27 explicitly excludes them).
  - [ ] T6.3 Add to `packages/ui/src/index.ts` barrel.
  - [ ] T6.4 Snapshot tests for both components.

- [ ] **T7 — Real Anthropic adapter for `generateConversationStarter` (`services/llm/src/adapters/anthropic.ts`)** (AC9)
  - [ ] T7.1 Replace the `throw new Error("Not implemented — Story 6.2")` with the real implementation per AC9.1–AC9.4.
  - [ ] T7.2 Create `services/llm/src/prompts/conversation-starter.ts` — system message + user-prompt builder. **System message** must include (Brazilian Portuguese): "Você gera uma síntese de conversa para um médico brasileiro a partir de dados longitudinais de exames do paciente. Não dê conselhos médicos. Não diagnostique. Use enquadramento conforme ANVISA. Saída exclusivamente em JSON conforme schema." Followed by an inline JSON-shape description.
  - [ ] T7.3 The consumer (`services/llm/src/consumers/generate-conversation-starter.ts`) needs the last-3-draws of each visible biomarker piped in. Extend the consumer's data-fetch: add `SELECT category, value, taken_at FROM observations WHERE patient_id = $1 AND category = ANY($2) ORDER BY taken_at DESC LIMIT 3 per category`. Use a window function (`ROW_NUMBER() OVER (PARTITION BY category ORDER BY taken_at DESC)`) to get the per-category top-3 in one query. **Service-role connection** (consumer already uses this).
  - [ ] T7.4 Pass the observations snapshot as a structured user prompt block. The adapter parses Anthropic's JSON response, validates via `conversationStarterPayloadSchema` (T1.4), and returns the typed payload.
  - [ ] T7.5 Failure-handling: Anthropic.APIError → re-throw (existing narrow catch in consumer handles it; AC9.3). Zod parse failure → throw `new Anthropic.APIError(...)`-shaped error so the consumer's narrow catch arm marks `failed` after retry exhaustion (mirror of Story 5.2 patch #6).
  - [ ] T7.6 NO new env vars. `ANTHROPIC_API_KEY` gate is unchanged.

- [ ] **T8 — Tests** (AC10)
  - [ ] T8.1 `packages/db/__tests__/rls/conversation_starter_cache.rls.test.ts` — 6-identity matrix + 3 cache-status branches per AC10. Each identity has its own `it(...)` block. Docstring at top: "AC10; Story 5.1 R2 retro lesson; do not collapse identities into shared describe."
  - [ ] T8.2 `packages/db/__tests__/rls/share_token_biomarkers.rls.test.ts` — 6-identity matrix + the cross-token leak guard test per AC10. Docstring as above.
  - [ ] T8.3 `packages/api/__tests__/sharing/get-conversation-starter.integration.test.ts` — testcontainer Postgres + seeded rows. Cover branches per AC10. Assert exactly-one audit row per successful path with `metadata.phase = "post-auth"`.
  - [ ] T8.4 `packages/api/__tests__/sharing/doctor-procedure-session-gate.test.ts` — unit-test the T4.1 session gate: `doctorProcedure` throws `UNAUTHORIZED` when header is set but session is null; throws `UNAUTHORIZED` when session is set but header is null; succeeds when both are set.
  - [ ] T8.5 `services/llm/__tests__/adapters/anthropic-conversation-starter.test.ts` — mock the Anthropic client. Assert: prompt construction passes the visible biomarkers + observations snapshot; valid JSON response → typed payload; invalid JSON / Zod failure → rethrows as `Anthropic.APIError`. Stub adapter regression test: still returns canned payload (no regression of Story 5.2 dev-flow).
  - [ ] T8.6 Component tests for `<ConversationStarterPrompt>` and `<BiomarkerCard variant="report">` — snapshot + accessibilityLabel checks.
  - [ ] T8.7 E2E spec (Playwright) at `apps/web/__tests__/e2e/doctor-magic-link.spec.ts` — happy path: pre-auth → email submit → simulate Supabase verify (use a test inbox or mock the OTP code) → callback → /m/[token]/view renders the cache payload. **Skip in CI if no Supabase test project is wired** (mirror existing `e2e/conversation-starter.spec.ts` skip-pattern from the architecture spec line 1037).

- [ ] **T9 — Docs**
  - [ ] T9.1 CLAUDE.md "Doctor magic-link discipline (Story 6.2)" paragraph per AC11.
  - [ ] T9.2 `.env.example` already lists `ANTHROPIC_API_KEY` and `WEB_APP_URL` — verify, no additions.
  - [ ] T9.3 `_bmad-output/implementation-artifacts/deferred-work.md` — log: (i) Story 6.3 owns `pending_invites.resolved_user_id` flip + FK; (ii) failed-state biomarker fallback resolver (AC8); (iii) `ConversationStarterPrompt` `highlighted` state (UX spec 940).

## Dev Notes

### Architecture compliance

- **AR5 (RLS token principal):** Story 6.2 is the FIRST production consumer. The `doctorProcedure` middleware sets `SET LOCAL app.current_share_token_id = $1` via `set_config(...)` (NOT `SET LOCAL = ${value}`; CLAUDE.md ops note — Drizzle parameters can't be inlined into SET). The middleware lives at `packages/api/src/trpc.ts:106-134` and was already shipped by Story 5.1 — Story 6.2 adds the session gate (T4) and consumes the middleware for real.
- **AR10 (audit log):** `writeAuditLog` only; `share_token.read` event already in `ACCESS_LOG_EVENT_KINDS`. Add `SHARE_TOKEN_READ_PHASE_POST_AUTH` constant so the Access Log renderer picks the right pt-BR label (Story 6.1 already added the phase-branching code path).
- **AR16 (conversation_starter_cache pre-warming):** the cache is pre-warmed at share-token-create time (Story 5.2); Story 6.2 READS it. NFR-P4 <3s post-auth load depends on the pre-warm being hot — verify the test scenario where pre-warm is still `queued` at doctor-tap-time renders the AC8 polling state.
- **NFR-P4 (<3s report load):** RSC + cached payload = single DB roundtrip on `share_tokens` (RLS-bound) + parallel service-role SELECT on `conversation_starter_cache` + parallel Supabase admin call for patient name. The audit-write happens AFTER the response is shaped (mirror Story 6.1 AC7).
- **NFR-S3 (LGPD per-biomarker scope):** end-to-end exercised via `share_token_biomarkers` RLS + the pre-warmed cache payload (which already encodes only visible categories — Story 5.2 consumer SELECTs `visible = true`).
- **NFR-S6 (DPA gate):** AC9 swaps the stub for real Anthropic behind the `ANTHROPIC_API_KEY` boot-gate. The DPA itself is an ops sign-off — not enforced in code; documented in CLAUDE.md.
- **FR26 / FR27 / FR28:** Story 6.2's deliverable surface — magic-link auth, biomarker trend cards with patient-baseline (never population ranges), and the 3 AI-generated discussion prompts.

### Library / framework requirements

- Next.js 15 App Router — server components for `auth/page.tsx` outer shell, `view/page.tsx`, `auth/callback/route.ts`. Client components for `DoctorMagicLinkForm.tsx` and `ConversationStarterPolling.tsx`. `params` is a Promise in Next 15 — `const { token } = await params;`.
- Supabase Auth (`@supabase/ssr` + `@supabase/supabase-js` via `packages/auth`): `signInWithOtp` (client), `exchangeCodeForSession` (server in callback route).
- Anthropic SDK (`@anthropic-ai/sdk`) — `messages.create` (NON-streaming) for the Conversation Starter. Reuse the existing `Anthropic` client from `services/llm/src/adapters/anthropic.ts` `createAnthropicAdapter`.
- Zod v4 (project upgraded post-Story 5.6) — `z.uuid()`, `z.infer`.
- TanStack Form + TanStack Query — mirror `apps/web/src/app/auth/register/register-form.tsx` patterns.
- Tamagui + RN-Web for `<ConversationStarterPrompt>` and `<BiomarkerCard>` (web-only renders for this story; the doctor surface has no Expo equivalent).

### File structure requirements

**Created:**

- `apps/web/src/app/m/[token]/auth/DoctorMagicLinkForm.tsx`
- `apps/web/src/app/m/[token]/auth/callback/route.ts`
- `apps/web/src/app/m/[token]/view/page.tsx`
- `apps/web/src/app/m/[token]/view/ConversationStarterPolling.tsx`
- `apps/web/src/app/m/[token]/view/ReportLayout.tsx`
- `packages/ui/src/components/ConversationStarterPrompt/ConversationStarterPrompt.tsx`
- `packages/ui/src/components/ConversationStarterPrompt/index.ts`
- `packages/ui/src/components/ConversationStarterPrompt/ConversationStarterPrompt.test.tsx`
- (conditional) `packages/ui/src/components/BiomarkerCard/BiomarkerCard.tsx` + index + test — only if the component does not already exist; mirror the `ShareBiomarkerToggle` shape if creating.
- `services/llm/src/prompts/conversation-starter.ts`
- `services/llm/__tests__/adapters/anthropic-conversation-starter.test.ts`
- `packages/api/__tests__/sharing/get-conversation-starter.integration.test.ts`
- `packages/api/__tests__/sharing/doctor-procedure-session-gate.test.ts`
- `packages/db/__tests__/rls/conversation_starter_cache.rls.test.ts`
- `packages/db/__tests__/rls/share_token_biomarkers.rls.test.ts`
- `apps/web/__tests__/e2e/doctor-magic-link.spec.ts` (skipped in CI absent Supabase test env)

**Modified:**

- `apps/web/src/app/m/[token]/auth/page.tsx` — replace stub (Story 6.1 T4.6) with real magic-link request page.
- `packages/validators/src/sharing.ts` — 10 pt-BR constants + 2 schemas + `SHARE_TOKEN_READ_PHASE_POST_AUTH` constant.
- `packages/api/src/router/sharing.ts` — `getConversationStarter` procedure.
- `packages/api/src/trpc.ts` — `doctorProcedure` session-gate (T4).
- `packages/api/src/sharing.ts` — if `parseShareTokenSegment` is not already exported by Story 6.1, extract from `apps/web/src/app/m/[token]/page.tsx` and export.
- `services/llm/src/adapters/anthropic.ts` — real `generateConversationStarter` implementation (replaces the stub-throw).
- `services/llm/src/consumers/generate-conversation-starter.ts` — extend data-fetch with the per-category top-3 observations snapshot (T7.3).
- `apps/web/src/trpc/react.tsx` — header threading for the doctor-side `x-share-token` (T5.5).
- `packages/ui/src/index.ts` — barrel re-export of new components.
- `CLAUDE.md` — Doctor magic-link discipline paragraph.

**No schema changes. No new env vars. No new audit kinds.**

### Testing requirements

- Integration tests use the testcontainer Postgres setup precedent (`packages/api/__tests__/sharing/*.integration.test.ts`).
- RLS tests use `packages/db/__tests__/rls/helpers.ts` for `setShareToken(id)` + `setPatient(id)` + `setServiceRole()` helpers — see `packages/db/__tests__/rls/share_tokens_preauth.rls.test.ts` (Story 6.1) for the canonical doctor-bound pattern.
- The 6-identity matrix is mandatory per CLAUDE.md "Code review discipline" — each identity has its own top-level `it(...)` block.
- The E2E spec is best-effort; document the skip condition in the file's first describe block.

### Previous story intelligence

- **Story 6.1 (PR #56 stacked) — pre-auth landing.** Story 6.2 extends the surface but does NOT replace Story 6.1's `publicProcedure` resolver. The pre-auth resolver stays as the dead-link discriminator. The doctor flow goes pre-auth → 6.2 magic-link → 6.2 view.
- **Story 6.1 R1 fix-up (commit `b1c6cfd`):**
  - H1 documented that the malformed-segment audit is forensic-only (sentinel resource_id is invisible to every patient under RLS). Story 6.2's `share_token.read post-auth` audit, in contrast, uses the REAL `shareTokenId` as resource_id — visible to the owning patient via the existing Access Log surface.
  - H2 added a real testcontainer integration test exercising the resolver branch table. Story 6.2 mirrors that file structure exactly.
  - M3 split audit `actorId` / `resourceId` per branch. Story 6.2 simplifies: `actorId = auth.uid()` (doctor's verified identity), `resourceId = shareTokenId`. No sentinels.
  - N1 pinned the never-throw contract on `resolvePatientFirstName`. Story 6.2 reuses this — same fallback semantics, different fallback string (`"Paciente"` not `"Alguém"`).
- **Story 5.1 (`doctorProcedure` middleware):** the GUC-setting middleware already exists; Story 6.2 (a) is its first consumer and (b) adds the session gate (T4) that the original ticket left explicitly open.
- **Story 5.2 (`conversation_starter_cache` pre-warm):** the cache row is INSERTed at token-create time via outbox pattern; consumer runs in `services/llm`. Status starts `queued`. The doctor's first-tap-after-create hits a hot cache 95% of the time; the AC8 polling state covers the 5%.
- **Story 5.2 (`share_tokens.expires_at` nullable):** RLS predicate uses `(expires_at IS NULL OR expires_at > now())`. Story 6.2's `getConversationStarter` SELECT relies on this — a no-expiry token reads as `active`.
- **Story 5.3 (`ACCESS_LOG_EVENT_KINDS`):** `share_token.read` already in the allowlist; Story 6.1 already extended the label-fn to branch on `phase`. Story 6.2 just emits with `phase = "post-auth"`.
- **Epic 5 retro lessons (round-1 gotcha checklist):**
  - Idempotency of in-flight unique constraints — N/A here (no INSERTs); audit row is the only mutation.
  - Nullable-column predicates — `expires_at IS NULL` already handled in RLS.
  - Resolver-time vs worker-time clock divergence — Story 6.2 reads `share_tokens.created_at` (worker time) and renders it as `sharedAt`. Pin in the resolver, NOT recompute client-side.
  - 6-identity RLS matrix — explicit per AC10.
  - Narrow catches by default — every try/catch documents the swallowed error shape.
  - Query-param coupling — `tokenHmac` query param is consumed at every hop (auth/page.tsx → form → emailRedirectTo → callback route → resolver). Verify the chain end-to-end at round-1.

### Git intelligence

- `worktree-story-6-2` branched from `origin/main` at 2f44243. PR #56 + Story 6.1 are NOT in main yet — the worktree starts clean. **Verify** with `git log --oneline main..HEAD` after the first commit that the diff is clean against main.
- Recent main commits (most relevant): `1916931` (sprint-status flip after PR #56 merge), `58ae568` (PR #56 land — Epic 5 + Story 6.1). Story 6.1's code is on main — Story 6.2 builds on it directly, not on the worktree-story-5-1 branch.
- Pattern to mirror for the RSC + service-role admin client: `apps/web/src/app/compartilhar/[shareTokenId]/resumo/page.tsx` (Story 5.4 — RSC + tRPC server caller).
- Pattern to mirror for the magic-link form: `apps/web/src/app/auth/register/register-form.tsx`. Differences: `signInWithOtp` instead of `signUp`; success path is "sent" confirmation, NOT redirect (the user goes to email next).

### Latest tech information

- **Next.js 15 App Router:** `params` and `searchParams` are Promises; `await params;`. The existing Story 6.1 `m/[token]/page.tsx` already uses this pattern — mirror exactly.
- **Supabase JS v2 `signInWithOtp`:** the official option for magic-link. `options.emailRedirectTo` MUST be an absolute URL on an allowlisted redirect domain — verify the Supabase project's Auth → URL Configuration includes `${WEB_APP_URL}/m/*`. If not, the magic-link email lands on `/auth/error` instead of our route handler. Sub-task: confirm the allowlist with the project owner before merging (ops note in dev notes).
- **Supabase JS v2 `exchangeCodeForSession`:** identical to the patient-side `apps/web/src/app/auth/callback/route.ts` — same return shape; same error semantics. Mirror that file.
- **`@anthropic-ai/sdk` `messages.create`:** non-streaming variant. Response is a single message with `content: Array<{type:"text"|"tool_use", text?:string}>`. The JSON-output framing requires either (a) extracting the text block and `JSON.parse`-ing, or (b) using the `tool_use` structured-output pattern. **Decision: (a)** — simpler, matches the project's existing usage in `generateBiomarkerSuggestion`. The system message instructs JSON-only output; Zod validates; failure → narrow-catch in the consumer.
- **`@trpc/client` per-request headers:** `httpBatchStreamLink({ headers: () => ({ ... }) })` supports a callback. For per-request override, wrap the callback in a closure reading from a React context (or a singleton ref). See T5.5.

### Project context reference

- Worktree: `/Users/francisaraujo/repos/healthtracker/.claude/worktrees/story-6-2`
- Branch: `worktree-story-6-2` (off `origin/main` 2f44243)
- Test infra: testcontainer Postgres (`pnpm --filter @healthtracker/api test:integration`), RLS suite (`pnpm --filter @healthtracker/db test:rls` — requires `supabase start`), Vitest for unit/component tests, Playwright for E2E (currently skip-pattern).

## Open questions / decisions for dev phase

1. **`x-share-token` header threading via React context vs prop drill (T5.5).** The doctor-side polling component needs to inject the header on every tRPC call. Options: (a) per-request `headers` callback in `httpBatchStreamLink` reading from a React context provider mounted at the layout level; (b) a dedicated `useDoctorTRPCClient(shareTokenId)` hook that creates a per-shareTokenId client; (c) prop-drill the shareTokenId into every doctor-side hook. **Recommendation: (a)** — discoverable + reusable for Story 6.3+. Document in dev notes.

2. **`generateConversationStarter` prompt content.** The system message framing is described in AC9.1 / T7.2 but the exact prompt is a product decision. Dev should ship a first draft that meets the framing constraints (no medical advice, JSON-only, ANVISA-compliant) and surface the actual prompt text in the round-1 review for the product owner to sign off on. **Specifically: which biomarker categories merit AI prompts vs. cards-only?** Ship round-1 with "all visible categories" and let R1 narrow.

3. **`BiomarkerCard` component status (T6.2).** The UX spec (line 860) references the component as if it exists. The patient-side fingerprint surface (Story 3.x) likely shipped some version. Dev should `grep -r "BiomarkerCard" packages/ui` first — if found, the `report` variant is an extension; if not, build a thin one covering only `report` to keep scope tight. Flag for R1 if the existing component's variant structure is incompatible.

4. **The `ConversationStarterPolling` 30s timeout (AC8).** A long-cold cache row (worker stalled or DPA-blocked production) would show `failed` after 30s. For dev/CI with the stub adapter, the cache becomes `ready` in <2s after token-create — so the polling state rarely surfaces. Dev should manually exercise the polling state by injecting a delay into the stub for one test. (Alternative: a feature flag to force `queued` for screenshot-driven QA — defer to round-1.)

5. **DPA timing.** The DPA blocker is real. If `ANTHROPIC_API_KEY` is unset in the deploy environment when Story 6.2 ships, the production conversation-starter falls back to the canned stub payload — which would render a Conversation Starter that says "Como evoluiu sua hemoglobina nos últimos 6 meses?" REGARDLESS of which biomarkers the patient shared. **This is a product-visible regression** disguised as a graceful degradation. Recommendation: gate the prod deploy of the `m/[token]/view` route on `ANTHROPIC_API_KEY` being present (e.g., a build-time check in `services/llm/src/index.ts` already warns; add a parallel hard-check at the consumer level that refuses to UPDATE `cache.status = 'ready'` when adapter is stub-typed AND `NODE_ENV === 'production'`). Document the trade-off; defer the hard gate to a deferred-work entry if scope is too tight.

6. **Open-redirect on the callback route (AC3.6).** The `shareTokenId.tokenHmac` pair is composed into a destination URL string. The uuid + 128-char alnum-regex validation is the spec-time guard, but worth a second pair of eyes in R1 — the patient-side `safeRedirectPath` rejects protocol-relative URLs; Story 6.2's composition is from validated parts so the equivalent guard is at the validation step, not the URL construction step.

7. **`pending_invites.resolved_user_id` flip — explicitly DEFERRED to Story 6.3.** Story 6.2's doctor authenticates (auth.users row exists) but does NOT claim the invite. The professional-account activation banner (Story 6.3 AC1) is what flips `resolved_user_id` AND lands the FK declaration. Story 6.2 reviewers must NOT add this flip — that would prematurely couple identity to a doctor who hasn't opted into the professional surface yet (the invite ownership becomes irrevocable as soon as it's tied to a user_id).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

### Completion Notes List

### File List

### References

- [Epic 6 / Story 6.2 — _bmad-output/planning-artifacts/epics.md lines 1437–1462]
- [UX `PreAuthLandingCard` + `ConversationStarterPrompt` + `BiomarkerCard` — _bmad-output/planning-artifacts/ux-design-specification.md lines 860–944, 967–983]
- [FR26–FR28 — prd.md lines 511–513]
- [NFR-P4 (<3s post-auth) + NFR-S3 (LGPD per-biomarker) + NFR-S6 (DPA) — prd.md lines 554, 562, 565]
- [Architecture: Anthropic + DPA blocker — architecture.md lines 451–456]
- [Architecture: Conversation Starter pre-warming — architecture.md lines 415–421]
- [Story 6.1 spec — _bmad-output/implementation-artifacts/6-1-doctor-views-pre-auth-landing-page-showing-patient-name-and-share-context.md]
- [Story 6.1 R1 fix-up — commit b1c6cfd]
- [doctorProcedure — packages/api/src/trpc.ts lines 106–134]
- [share_tokens RLS — packages/db/policies/custom_rls_share_tokens.sql]
- [conversation_starter_cache RLS — packages/db/policies/custom_rls_conversation_starter_cache.sql]
- [share_token_biomarkers RLS — packages/db/policies/custom_rls_share_token_biomarkers.sql]
- [Conversation Starter pre-warm consumer — services/llm/src/consumers/generate-conversation-starter.ts]
- [Anthropic adapter — services/llm/src/adapters/anthropic.ts]
- [Story 5.2 share-token URL shape — packages/api/src/sharing.ts `buildShareUrl`]
- [Story 5.3 ACCESS_LOG_EVENT_KINDS + phase-branching label — packages/validators/src/sharing.ts]
- [CLAUDE.md "Sharing schema notes" + "Pre-auth landing discipline (Story 6.1)" + "Code review discipline" 6-identity bullet — repo-root CLAUDE.md]
- [Epic 5 retro — _bmad-output/implementation-artifacts/epic-5-retro-2026-05-28.md]
