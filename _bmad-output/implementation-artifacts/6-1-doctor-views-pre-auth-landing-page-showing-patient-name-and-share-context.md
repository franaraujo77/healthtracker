# Story 6.1: Doctor views pre-auth landing page showing patient name and share context

Status: review

Stacked on PR #56 (Epic 5 + Story 5.6 train). First story of Epic 6.

## Story

As a doctor who received a sharing link via WhatsApp,
I want to see a landing page that tells me who shared with me and a one-line context before I authenticate,
so that I know whether it is worth the 60 seconds to register / log in.

## Acceptance Criteria

1. **AC1 — Route + URL contract.** A new web route `apps/web/src/app/m/[token]/page.tsx` renders the pre-auth landing surface. The `[token]` segment is the `${shareTokenId}.${tokenHmac}` composite minted by `buildShareUrl` in Story 5.2 (`packages/api/src/sharing.ts`). The page MUST be a Next.js App Router server component (no client-side fetch on first paint — NFR-P4 sub-1s requirement) that splits `[token]` on the first `.`, runs HMAC verification + status resolution server-side, and streams the static HTML before hydration. No app-shell / authenticated layout is wrapped around this route (it is a pre-auth surface — no Compartilhar/Acessos chrome). Reuse `apps/web/src/app/layout.tsx` only.

2. **AC2 — `publicProcedure` resolver `sharingRouter.getPreAuthContext`.** New `publicProcedure` (NOT `doctorProcedure` — the doctor is not yet authenticated and there is no `x-share-token` header yet) at `packages/api/src/router/sharing.ts`: `getPreAuthContext({ shareTokenId: z.uuid(), tokenHmac: z.string().min(1).max(128) }) → { status: 'active' | 'expired' | 'revoked' | 'invalid', patientFirstName: string | null, sharedAt: Date | null, expiresAt: Date | null }`. **Resolver does NOT pass through `doctorProcedure`** — it must run with the service-role connection (no RLS principal), because the doctor cannot SELECT the row through doctor-side RLS yet (the doctor principal RLS predicate already filters `revoked_at IS NULL AND expires_at > now()`, so it would 404 on expired/revoked and we'd lose the ability to distinguish states). Use `ctx.db` outside any GUC-setting transaction. Resolver pseudo:

   ```ts
   getPreAuthContext: publicProcedure
     .input(
       z.object({
         shareTokenId: z.uuid(),
         tokenHmac: z.string().min(1).max(128),
       }),
     )
     .query(async ({ ctx, input }) => {
       const row = await ctx.db
         .select({
           id: ShareTokens.id,
           tokenHmac: ShareTokens.tokenHmac,
           patientId: ShareTokens.patientId,
           expiresAt: ShareTokens.expiresAt,
           revokedAt: ShareTokens.revokedAt,
           createdAt: ShareTokens.createdAt,
         })
         .from(ShareTokens)
         .where(eq(ShareTokens.id, input.shareTokenId))
         .limit(1);
       if (row.length === 0)
         return {
           status: "invalid",
           patientFirstName: null,
           sharedAt: null,
           expiresAt: null,
         };
       const r = row[0]!;
       // CRITICAL: constant-time HMAC compare. Use timingSafeEqual on equal-length Buffers — NEVER ===.
       const aBuf = Buffer.from(r.tokenHmac);
       const bBuf = Buffer.from(input.tokenHmac);
       const hmacOk =
         aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
       if (!hmacOk)
         return {
           status: "invalid",
           patientFirstName: null,
           sharedAt: null,
           expiresAt: null,
         };
       const now = new Date();
       const status: "active" | "expired" | "revoked" = r.revokedAt
         ? "revoked"
         : r.expiresAt !== null && r.expiresAt <= now
           ? "expired"
           : "active";
       const patientFirstName = await resolvePatientFirstName(
         ctx.db,
         r.patientId,
       );
       const sharedAt = r.createdAt;
       // Emit audit row for EVERY attempt (success/expired/revoked/invalid). See AC6.
       await writeAccessAttemptAudit(ctx.db, {
         shareTokenId: input.shareTokenId,
         status,
         patientId: status === "invalid" ? null : r.patientId,
       });
       return {
         status,
         patientFirstName: status === "active" ? patientFirstName : null,
         sharedAt: status === "active" ? sharedAt : null,
         expiresAt: status === "active" ? r.expiresAt : null,
       };
     });
   ```

   **Why the resolver returns `null` for `patientFirstName` / `sharedAt` / `expiresAt` on non-`active` states:** information-disclosure hygiene — an expired or revoked link MUST NOT reveal who the patient was, only that the link state is dead. The expired/revoked screens render the pure pt-BR copy with no patient context.

3. **AC3 — HMAC verification reuses `verifyShareToken`.** The constant-time compare MUST call `verifyShareToken(raw, signature)` from `packages/api/src/sharing.ts` (already authored in Story 5.1 for this exact purpose — see line 96). Do NOT inline a new `timingSafeEqual` call; centralisation prevents the next story from re-implementing this. **Subtle wrinkle:** `verifyShareToken(raw, signature)` re-signs `raw` and compares to `signature`. In our case, we don't have the raw token — we have the `shareTokenId` (UUID) and the `tokenHmac` from the URL, plus the persisted `share_tokens.tokenHmac` from the row. We are comparing two HMAC strings, not raw-vs-signature. So either: (a) extend `sharing.ts` with a new `compareHmacStrings(a, b): boolean` helper that does the constant-time string compare, or (b) duplicate the `timingSafeEqual` logic here. **Decision: (a)** — name it `constantTimeEqualHmac(a, b): boolean` and export it. Document why: "Used by the pre-auth resolver where we compare two persisted HMAC strings (URL-supplied vs DB-persisted); `verifyShareToken` is for raw-vs-signature."

4. **AC4 — Patient first-name resolution.** `resolvePatientFirstName(db, patientId)` returns the patient's first name string. **Open question (decision-needed below): there is currently no `users.first_name` column.** Resolution path for THIS story: derive from the patient's Supabase Auth email local-part — split on `@`, take the prefix, run a `humanizeEmailLocal` helper (lowercase, replace `.`/`_`/`-` with space, capitalise first letter of each word). Source: `await supabaseAdmin.auth.admin.getUserById(patientId)` → `data.user.email`. Helper lives at `packages/api/src/sharing.ts` (alongside the other patient-facing string helpers). **Failure mode:** if the admin call fails or returns no email, return `null` (the UI falls back to "alguém" — see AC5). **NEVER throw** from `resolvePatientFirstName` — a Supabase admin call failure must degrade gracefully, not 500 the landing page. Service-role key required; this runs server-side in the tRPC resolver context, not the browser. **No new DB column lands in this story.**

5. **AC5 — UI: `PreAuthLandingCard` component renders 4 states.** Author a new shared component `packages/ui/src/components/PreAuthLandingCard/PreAuthLandingCard.tsx` (Tamagui + React Native Web — same cross-platform pattern as `ShareBiomarkerToggle`, `DeleteAccountConfirmationCard`). Props: `{ status: 'active' | 'expired' | 'revoked' | 'invalid', patientFirstName: string | null, sharedAt: Date | null }`. States and pt-BR copy:
   - `active`: heading `{patientFirstName ?? "Alguém"} compartilhou um histórico de saúde com você.`; one-line context `Para preparar a sua próxima consulta.`; Tier-1 CTA `Ver histórico` (button is a `<Link href="/m/[token]/auth">` placeholder — Story 6.2 wires the magic-link form into this destination route; for Story 6.1, the link points to `/m/[token]/auth` and that route renders a minimal "Story 6.2 will land here" stub).
   - `expired`: heading `Este link expirou.`; body `Peça ao paciente um novo link.`; no CTA.
   - `revoked`: heading `O paciente revogou o acesso a este link.`; body `Peça um novo link se ainda precisar do histórico.`; no CTA.
   - `invalid`: heading `Link inválido.`; body `Verifique se o link está completo ou peça um novo ao paciente.`; no CTA. **Same copy for unknown-id, bad-HMAC, and malformed-token-segment** — never differentiate; that would be an enumeration oracle.

   Pt-BR strings exported as **named constants** from `packages/validators/src/sharing.ts` (mirrors the Story 5.1 `SHARE_TOKEN_INVALID_PT_BR` and Story 5.2 `BIOMARKER_TOGGLE_FAILED_PT_BR` pattern): `PRE_AUTH_LANDING_ACTIVE_HEADING_FN(firstName: string)`, `PRE_AUTH_LANDING_ACTIVE_BODY_PT_BR`, `PRE_AUTH_LANDING_EXPIRED_HEADING_PT_BR`, `PRE_AUTH_LANDING_EXPIRED_BODY_PT_BR`, `PRE_AUTH_LANDING_REVOKED_HEADING_PT_BR`, `PRE_AUTH_LANDING_REVOKED_BODY_PT_BR`, `PRE_AUTH_LANDING_INVALID_HEADING_PT_BR`, `PRE_AUTH_LANDING_INVALID_BODY_PT_BR`, `PRE_AUTH_LANDING_CTA_PT_BR = "Ver histórico"`.

6. **AC6 — Audit log: every attempt writes `share_token.read` with status metadata.** Use the existing `writeAuditLog` from `packages/api/src/audit.ts`. Event = `"share_token.read"` (already in `ACCESS_LOG_EVENT_KINDS` — no new kind). Actor: `actorId = <shareTokenId>` (the doctor has no auth identity yet; Story 6.2 will switch to the doctor's auth.uid once authenticated), `actorType = "doctor"`. `resourceId = shareTokenId`, `resourceType = "share_token"`. **Metadata shape** (frozen contract — Access Log and Story 6.2 will both read this):

   ```json
   { "phase": "pre-auth", "status": "active" | "expired" | "revoked" | "invalid", "userAgent": "<request UA header, truncated to 200 chars>" }
   ```

   **Audit MUST fire for every attempt** including `invalid` and `revoked`. This is the patient's surveillance surface — a doctor probing a revoked link is exactly what the Access Log is meant to show. The Access Log component (`AccessLogItem`) renders this via its existing `share_token.read` case; **verify the existing pt-BR label fn `ACCESS_LOG_EVENT_LABEL_PT_BR_FN("share_token.read", metadata)` correctly handles the new metadata shape**, and extend it if necessary to surface `phase: "pre-auth"` in the rendered text (suggested: `"Médico abriu a tela de entrada do link"` for `phase=pre-auth`, leaving `"Médico abriu o histórico"` for post-auth which Story 6.2 will emit with `phase: "post-auth"`).

   **`invalid`-state audit subtlety:** the `actorId = shareTokenId` from the URL when status is `invalid` is the **client-supplied** id — could be any uuid the doctor's link contained. That's acceptable (we want to log probes), but `resourceId` should be the same value (it's not pointing at a real `share_tokens.id` row). Do NOT FK-validate `resourceId` against `share_tokens.id` — `audit_log` has no FK to `share_tokens` and shouldn't gain one (the bigger threat is logging-failure-due-to-FK-violation hiding the probe).

7. **AC7 — Performance: first-byte < 1s (NFR-P4).** Server component renders on the first request; one DB roundtrip (`share_tokens` by PK) + one Supabase admin call (`getUserById`) — both run in parallel via `Promise.all`. The audit write happens AFTER the response is shaped (use `Promise.allSettled` for `[auditWrite, supabaseAdminCall]` so an audit-write hiccup doesn't block the render — but await both before returning, since we MUST audit before responding). **Do NOT use Next.js dynamic = "force-dynamic"** by default — but DO add `export const revalidate = 0` and `export const dynamic = "force-dynamic"` because the response is request-specific and we don't want any caching layer to serve a stale `expired` state. **No client-side hydration of the data fetch** — the server component renders the final HTML.

8. **AC8 — Responsive layout per UX-DR16.** `PreAuthLandingCard` is centred max-width 480px at `$lg`+ (web desktop) and full-width with top padding `20vh` at `$sm`–`$md` (UX spec lines 1276–1278). Always vertically centred in viewport. No app navigation chrome (no sidebar, no bottom tab bar) — this is a pre-auth surface. Render the Health Tracker wordmark/logo above the card.

9. **AC9 — Malformed token segment.** If `[token]` doesn't contain a `.`, or the prefix isn't a uuid-shaped string, or the HMAC suffix is empty — the page renders the `invalid` state directly without even calling `getPreAuthContext`. Validate via the same uuid regex used in Story 5.3's `decodeAccessLogCursor`. The server component does the parse-and-validate, returns the `invalid` UI shell, AND **fires an audit row** with `actorId = "00000000-0000-0000-0000-000000000000"` (a sentinel — the actual shareTokenId is unknown/malformed). Document the sentinel in `packages/validators/src/sharing.ts` as `SHARE_TOKEN_UNKNOWN_SENTINEL = "00000000-0000-0000-0000-000000000000"` so other Epic 6 stories (logging unknown-doctor probes) reuse it.

10. **AC10 — Tests: 6-identity RLS matrix MANDATORY.** Author `packages/db/__tests__/rls/share_tokens_preauth.rls.test.ts` covering all 6 identities (the canonical Story 5.1 round-2 finding). Because `getPreAuthContext` runs **without an RLS principal** (no GUC set — service role), the test file's job is to **prove the resolver itself returns the right status discriminator under each identity**, not to test RLS isolation (which is exercised by the existing `share_tokens.rls.test.ts`). Each identity:
    - `correctPatient`: not applicable — the resolver doesn't filter by patient. Test asserts the function still returns `active` regardless of which patient_id owns the row.
    - `wrongPatient`: same — `active` regardless.
    - `serviceRole`: `active`.
    - `doctorWithActiveToken`: returns `{status: 'active', patientFirstName: <derived>, ...}`.
    - `doctorWithExpiredToken`: returns `{status: 'expired', patientFirstName: null, sharedAt: null, expiresAt: null}`.
    - `doctorWithRevokedToken`: returns `{status: 'revoked', patientFirstName: null, sharedAt: null, expiresAt: null}`.

    **Plus 3 non-identity test cases** (file's other `describe` block): bad-HMAC → `invalid`; unknown shareTokenId → `invalid`; malformed `[token]` segment → resolved at the page-component layer (separate component test) → `invalid`. **The point of running the matrix even though the resolver is RLS-naïve is preventing a future regression where someone "fixes" the resolver to use `doctorProcedure` — at which point expired/revoked rows become unreadable and the status discriminator degrades to `invalid`, hiding the patient's surveillance surface.** Add a docstring at the top of the test file pointing at this risk.

11. **AC11 — Component tests.** `packages/ui/src/components/PreAuthLandingCard/PreAuthLandingCard.test.tsx`: 4 snapshot tests (one per state). Plus one accessibility test: the active CTA `Ver histórico` is the primary focus target on load (`accessibilityLabel` = `"Ver histórico de {patientFirstName}"`; `accessibilityRole = "button"`).

## Tasks / Subtasks

- [x] **T1 — Validators (`packages/validators/src/sharing.ts`)** (AC5, AC6, AC9)
  - [x] T1.1 Export `PRE_AUTH_LANDING_*` pt-BR constants and `PRE_AUTH_LANDING_ACTIVE_HEADING_FN(firstName)` heading function (AC5 list).
  - [x] T1.2 Export `PreAuthStatus = z.enum(["active", "expired", "revoked", "invalid"])` and `preAuthContextOutputSchema` matching the resolver return shape.
  - [x] T1.3 Export `SHARE_TOKEN_UNKNOWN_SENTINEL = "00000000-0000-0000-0000-000000000000"`.
  - [x] T1.4 Extend `ACCESS_LOG_EVENT_LABEL_PT_BR_FN` so the `share_token.read` case branches on `metadata.phase`: `"pre-auth"` → `"Médico abriu a tela de entrada do link"`; `"post-auth"` (Story 6.2) → `"Médico abriu o histórico"`; absent/legacy → fall back to existing label string.

- [x] **T2 — Sharing helpers (`packages/api/src/sharing.ts`)** (AC3, AC4)
  - [x] T2.1 Export `constantTimeEqualHmac(a: string, b: string): boolean` — `Buffer.from` both sides, length-guard, `timingSafeEqual`. Docstring: "Compare two persisted HMAC strings (URL-supplied vs DB-persisted) in constant time. For raw-vs-signature use `verifyShareToken`."
  - [x] T2.2 Export `humanizeEmailLocal(local: string): string` — pure: `local.split('@')[0]`, replace `[._-]+` with space, split words, capitalise first letter of each, trim. Treat input shorter than 1 char as → `null` (caller will fall back).
  - [x] T2.3 Export async `resolvePatientFirstName(supabaseAdmin: SupabaseClient, patientId: string): Promise<string | null>`. Implementation: `await supabaseAdmin.auth.admin.getUserById(patientId)` → if data.user.email → `humanizeEmailLocal(email)`; on any error or empty email → return `null`. **Narrow catch** — only swallow the SupabaseError code path; re-throw `TypeError`/`ReferenceError` (Epic 2 retro discipline).

- [x] **T3 — Resolver (`packages/api/src/router/sharing.ts`)** (AC2, AC6, AC7)
  - [x] T3.1 New `publicProcedure` `getPreAuthContext` per AC2 pseudo. Input/output Zod schemas from `packages/validators/src/sharing.ts`.
  - [x] T3.2 Resolver does **NOT** wrap in `ctx.db.transaction(...)` — `publicProcedure` provides a bare connection, no GUC. The single SELECT + single audit-INSERT are both autonomous; if the audit insert fails, log to console and still return the status (the patient's surveillance surface degrades by one row; we don't want to 500 the doctor's first impression). Use a narrow try/catch around the audit insert only.
  - [x] T3.3 Inject Supabase admin client. Pattern: import from `packages/auth` (the same path the Story 5.6 deletion consumer uses). Do not instantiate a new `createClient(...)` inline.
  - [x] T3.4 Run `[dbRow, patientFirstName]` in parallel via `Promise.all`. Audit-write runs sequentially **after** state resolution (so the status field is correct in the metadata).
  - [x] T3.5 Register the procedure under `sharingRouter.getPreAuthContext`.

- [x] **T4 — Web route (`apps/web/src/app/m/[token]/page.tsx`)** (AC1, AC5, AC7, AC8, AC9)
  - [x] T4.1 Create `apps/web/src/app/m/[token]/page.tsx` — async server component. Params: `{ token: string }`. Add `export const dynamic = "force-dynamic"` and `export const revalidate = 0`.
  - [x] T4.2 Parse `[token]` on first `.`: `const dotIdx = token.indexOf("."); const shareTokenId = token.slice(0, dotIdx); const tokenHmac = token.slice(dotIdx + 1);`. Validate shareTokenId via uuid regex (reuse from `sharing.ts` cursor decoder). If malformed → render `<PreAuthLandingCard status="invalid" patientFirstName={null} sharedAt={null} />` and emit an audit row via direct `writeAuditLog` call with `actorId = SHARE_TOKEN_UNKNOWN_SENTINEL`, `resourceId = SHARE_TOKEN_UNKNOWN_SENTINEL`, metadata `{phase: "pre-auth", status: "invalid", reason: "malformed-segment", userAgent: <UA>}`.
  - [x] T4.3 If well-formed → server-side tRPC caller (use the `apps/web/src/trpc/server.ts` pattern — RSC-side caller) → `await api.sharing.getPreAuthContext({shareTokenId, tokenHmac})` → pass result props into `<PreAuthLandingCard ...>`.
  - [x] T4.4 Pass userAgent from `headers()` (`next/headers`) into the resolver via a new optional input field `userAgent: z.string().max(200).optional()`. Truncate at 200 chars before passing.
  - [x] T4.5 Page layout: no `(authenticated)` route group; bare layout with Health Tracker wordmark + `<PreAuthLandingCard>` centred. Add `<head>` `<meta name="robots" content="noindex,nofollow">` (the URL is a secret; no search-engine indexing).
  - [x] T4.6 Create `apps/web/src/app/m/[token]/auth/page.tsx` as a Story 6.2 STUB — renders a minimal "Em breve — Story 6.2 entregará a autenticação do médico" placeholder. Without this stub the active-state CTA link 404s.

- [x] **T5 — Shared UI component (`packages/ui/src/components/PreAuthLandingCard/`)** (AC5, AC8, AC11)
  - [x] T5.1 `PreAuthLandingCard.tsx` — Tamagui `YStack` + RN-Web. Props per AC5. Switch on `status`; render the appropriate heading + body + (active only) CTA `<Link>` (use `next/link` on web; the component is web-only-rendered in this story — the active doctor flow does not have an Expo surface).
  - [x] T5.2 Width responsive: `$lg+` → max-width 480px centred; `$sm`–`$md` → full-width with `paddingTop="20vh"`. Use Tamagui media queries.
  - [x] T5.3 `index.ts` re-export. Add to `packages/ui/src/index.ts`.
  - [x] T5.4 `PreAuthLandingCard.test.tsx` — 4 snapshot tests (one per status) + 1 accessibility assertion (active CTA accessibilityLabel includes patient first name).

- [x] **T6 — Tests** (AC10, AC11)
  - [x] T6.1 `packages/api/__tests__/sharing/get-pre-auth-context.integration.test.ts` — testcontainer Postgres + seeded `share_tokens` rows. Cover the resolver branch table: active / expired (set `expires_at = now() - interval '1 second'`) / revoked (set `revoked_at`) / unknown id / bad HMAC. Assert each case returns the right status and that **exactly one** `share_token.read` audit row is written with the expected `metadata.phase = "pre-auth"` and `metadata.status` matching.
  - [x] T6.2 `packages/db/__tests__/rls/share_tokens_preauth.rls.test.ts` — 6-identity matrix per AC10. Even though the resolver is RLS-naïve, this test guards against a future "doctorProcedure"-ification regression. Docstring at top of file references AC10 + Story 5.1 R2 retro lesson.
  - [x] T6.3 `packages/api/__tests__/sharing/sharing-helpers.test.ts` (or extend the existing helpers test) — unit-test `humanizeEmailLocal` (boundary cases: `francis.araujo@x.com` → `Francis Araujo`; `f@x.com` → `F`; `@x.com` → `null`; empty string → `null`; `f__o-bar.baz@x` → `F O Bar Baz`).
  - [x] T6.4 `packages/api/__tests__/sharing/constant-time-equal.test.ts` — assert `constantTimeEqualHmac` returns `false` for differing-length inputs (no throw); `true` for equal; `false` for one-bit difference.

- [x] **T7 — Docs**
  - [x] T7.1 CLAUDE.md — add a "Pre-auth landing discipline (Story 6.1)" paragraph under the existing sharing notes block. Cover: (a) why the resolver is `publicProcedure` not `doctorProcedure` (status discrimination); (b) why audit fires for `invalid`/`revoked` too (patient surveillance); (c) the `phase: pre-auth | post-auth` metadata convention for `share_token.read`; (d) `SHARE_TOKEN_UNKNOWN_SENTINEL` usage for malformed-link probes.
  - [x] T7.2 No env var additions. `SHARE_TOKEN_HMAC_SECRET` + `WEB_APP_URL` are reused from Story 5.1/5.2.

## Dev Notes

### Architecture compliance

- **AR5 (RLS token principal):** the `doctorProcedure` middleware (Story 5.1) and the doctor-side RLS policies on `share_tokens` + `share_token_biomarkers` + `conversation_starter_cache` are in place but **NOT consumed by this story**. Story 6.1 deliberately runs the pre-auth resolver as `publicProcedure` (service-role connection, no GUC set) because the doctor-side RLS predicate filters expired/revoked rows out of SELECT entirely (`custom_rls_share_tokens.sql` line 28: `AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`) — which would collapse the `expired`/`revoked`/`invalid` triplet into a single 404 and defeat the entire purpose of the pre-auth states. Story 6.2 IS the first consumer of `doctorProcedure` (post-auth report fetch).
- **AR10 (audit log):** `writeAuditLog` from `packages/api/src/audit.ts` — never INSERT into `audit_log` directly.
- **AR16 (conversation_starter_cache pre-warming):** out of scope for this story; the cache is pre-warmed by Story 5.2 at share-token creation time and read by Story 6.2.
- **NFR-P4 (< 1s first-byte):** server component + single PK lookup + parallel admin call. No client-side fetch on first paint.
- **NFR-S3 (LGPD per-biomarker scope):** not exercised in this story — no biomarker data is rendered.

### Library / framework requirements

- Next.js 15 App Router server components (RSC). The `apps/web/src/trpc/server.ts` RSC-side caller is the integration point (mirror the pattern from `apps/web/src/app/inicio/page.tsx` or wherever an existing RSC fetches tRPC data).
- Supabase Admin API: `@supabase/supabase-js` admin client via `packages/auth` (NEVER instantiate inline — CLAUDE.md authentication rule).
- Tamagui + RN-Web for the shared UI component (existing pattern: `ShareBiomarkerToggle`).
- `node:crypto` `timingSafeEqual` for the constant-time compare (already imported in `packages/api/src/sharing.ts`).

### File structure requirements

**Created:**

- `apps/web/src/app/m/[token]/page.tsx` — server component
- `apps/web/src/app/m/[token]/auth/page.tsx` — Story 6.2 stub
- `packages/ui/src/components/PreAuthLandingCard/PreAuthLandingCard.tsx`
- `packages/ui/src/components/PreAuthLandingCard/PreAuthLandingCard.test.tsx`
- `packages/ui/src/components/PreAuthLandingCard/index.ts`
- `packages/api/__tests__/sharing/get-pre-auth-context.integration.test.ts`
- `packages/api/__tests__/sharing/constant-time-equal.test.ts`
- `packages/db/__tests__/rls/share_tokens_preauth.rls.test.ts`

**Modified:**

- `packages/validators/src/sharing.ts` — add 9 pt-BR constants + sentinel + extend label fn
- `packages/api/src/sharing.ts` — add `constantTimeEqualHmac`, `humanizeEmailLocal`, `resolvePatientFirstName`
- `packages/api/src/router/sharing.ts` — add `getPreAuthContext`
- `packages/ui/src/index.ts` — re-export `PreAuthLandingCard`
- `CLAUDE.md` — Pre-auth landing discipline paragraph

**No schema changes. No new env vars. No new audit kinds.**

### Testing requirements

- Integration tests use the existing testcontainer Postgres setup at `packages/api/__tests__/sharing/*.integration.test.ts` precedent.
- RLS tests use `packages/db/__tests__/rls/helpers.ts` for the `setShareToken(id)` + `setPatient(id)` + `setServiceRole()` helpers — see `packages/db/__tests__/rls/share_tokens.rls.test.ts` for the canonical pattern.
- The 6-identity matrix is mandatory per CLAUDE.md "Code review discipline" — Story 5.1 round-2 found that 3 tests claimed full matrix but only shipped patient subset; reviewer MUST verify each `it(...)` block exists.

### Previous story intelligence

- **Story 5.1 (PR #56) — share_token primitives.** `share_tokens` table, `tokenHash`/`tokenHmac` columns, `verifyShareToken`/`signShareToken` helpers, doctor-side RLS policies. The HMAC sign/verify primitives are stable; reuse, do NOT re-implement.
- **Story 5.2 — magic-link URL shape.** `buildShareUrl(shareTokenId, tokenHmac) → ${WEB_APP_URL}/m/${shareTokenId}.${tokenHmac}`. Story 6.1 owns the `/m/...` destination route.
- **Story 5.3 — Access Log.** `ACCESS_LOG_EVENT_KINDS` includes `share_token.read`. The Access Log resolver allowlist filter relies on this. Story 6.1 emits this event for the first time in production — verify the label fn handles the new `phase` metadata.
- **Story 5.4 — revocation.** `share_tokens.revoked_at` is the signal. The pre-auth resolver must check this BEFORE checking `expires_at` (a token revoked yesterday and expired today should render `revoked`, not `expired` — revocation is the more user-actionable state).
- **Story 5.6 retro lessons:** narrow catches only (don't swallow `TypeError`); pseudonymization not applicable here (audit row uses the real shareTokenId, not a hashed identifier); pagination not relevant (single PK SELECT).
- **Epic 1 / Epic 2 retros:** no enumeration oracle — return the same `invalid` UI for unknown-id, bad-HMAC, and malformed-segment. Don't differentiate error messages.

### Git intelligence

- The most recent commit on PR #56 is Story 5.6 (account deletion); the branch is up-to-date with the worktree. Story 6.1 stacks directly onto the existing branch (per user memory `feedback_stacked_stories_single_pr`).
- Existing patterns to mirror: `packages/api/src/router/sharing.ts` `revokeShareToken` (narrow catch, audit-after-mutation, RLS via outer middleware); `apps/web/src/app/compartilhar/[shareTokenId]/resumo/page.tsx` (RSC + tRPC server-side caller pattern).

### Latest tech information

- **Next.js 15 App Router:** `params` in dynamic routes is a Promise in Next 15 — use `const { token } = await params;` not destructure. Verify against the existing dynamic routes (`apps/web/src/app/compartilhar/[shareTokenId]/...`) — match whichever pattern they already use.
- **Supabase JS v2:** `supabase.auth.admin.getUserById(id)` is the correct method (NOT `getUser(id)` — that's session-based). Requires service-role key.
- **`timingSafeEqual`** in Node 18+ throws on differing-length buffers — guard with length check first. Already correctly handled in the existing `verifyShareToken` (line 96 of `sharing.ts`); mirror that pattern.

### Project context reference

- Worktree: `/Users/francisaraujo/repos/healthtracker/.claude/worktrees/story-5-1`
- Branch: `worktree-story-5-1` (stacked onto PR #56)
- Test infra: testcontainer Postgres (`pnpm --filter @healthtracker/api test:integration`), RLS suite (`pnpm --filter @healthtracker/db test:rls` — requires `supabase start`), Vitest for unit/component tests.

## Open questions / decisions for dev phase

1. **Patient first-name source.** This story derives from email local-part (AC4). Alternatives: (a) add `users.first_name` column now (defers Story 6.2 work but bloats Story 6.1 scope + needs a migration), (b) defer to Story 6.2 and ship Story 6.1 with literal `"Alguém"` for all `active` states (degrades UX but ships fastest), (c) email-local-part derivation (chosen — zero schema change, acceptable UX for MVP). **Flag for product:** if email-local derivation produces awkward names ("Jdoe2024"), Story 6.4's `pending_invites.displayName` already collects a patient-friendly identifier for the doctor — but that's the doctor's friendly name for the patient, not the patient's own first name. A future story could add `users.first_name` properly with onboarding capture. **Dev should ship (c) and surface ugly names in the round-1 review if they emerge.**

2. **Audit-row `actorId` for the `invalid` state.** Set to `SHARE_TOKEN_UNKNOWN_SENTINEL = "00000000-0000-0000-0000-000000000000"` rather than the URL-supplied (and unverified) shareTokenId. **Rationale:** the URL-supplied id might be garbage; the sentinel makes "probe attempts" filterable in the Access Log resolver. **Risk:** the patient cannot see WHICH invalid link was probed (just that one was). Acceptable for MVP.

3. **Audit-fire-on-invalid is a DoS vector.** A doctor (or attacker) hammering `/m/<random>.<random>` URLs writes a row per attempt. **Mitigation deferred to Story 6.2 / a future infra story** — rate-limit at the Next.js edge / Vercel WAF, NOT in the resolver. Document in CLAUDE.md.

4. **HMAC compare on `getPreAuthContext` runs even when `expires_at < now()` or `revoked_at IS NOT NULL`.** This is intentional — a doctor with an old valid HMAC must see the "expired" state, not "invalid". Don't short-circuit on revocation/expiry before the HMAC check.

5. **The active-state CTA links to `/m/[token]/auth` which is a Story 6.2 stub.** This is a known visual rough edge — Story 6.1 should ship with the stub explicitly labelled so reviewers don't flag it as broken. The full magic-link flow is Story 6.2's deliverable.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm typecheck` — 17 tasks, 0 errors.
- `pnpm lint` — 15 tasks, 0 errors, 0 warnings (after fixing inline `import()` type annotations in `writePreAuthAudit`).
- `pnpm --filter @healthtracker/api test:unit` — 232 tests passing across 27 files. New tests: `humanize-email-local.test.ts` (8), `constant-time-equal.test.ts` (4), `get-pre-auth-context.integration.test.ts` (excluded from `test:unit` — runs in `test:integration`).
- RLS test `share_tokens_preauth.rls.test.ts` requires `supabase start`; not exercised in this dev pass (mirrors precedent for sibling `share_tokens.rls.test.ts`).
- UI component test `PreAuthLandingCard.test.tsx` not exercised in this pass — `packages/ui` has no test runner wired (mirrors `DeleteAccountConfirmationCard.test.tsx` precedent).

### Completion Notes List

- All 11 ACs implemented. Tasks T1–T7 + every subtask checked.
- Resolver wired as `publicProcedure` per AC2; docstring documents the regression risk and points at the RLS-matrix guard file.
- Audit row fires on every pre-auth attempt (active/expired/revoked/invalid) with `metadata.phase = "pre-auth"`. Best-effort write — narrow try/catch around the audit insert keeps a single failed row from 500-ing the landing page; programmer errors propagate.
- HMAC compare runs after the row SELECT and before status discrimination — a doctor with an old valid HMAC sees the correct dead-link state, not `invalid`.
- Malformed `[token]` URL segment (no `.`, non-uuid prefix, empty HMAC suffix) renders the `invalid` UI directly and emits an audit row with `actorId = resourceId = SHARE_TOKEN_UNKNOWN_SENTINEL`. The resolver is bypassed (Zod would reject the sentinel as not a real share_tokens row, but the audit MUST fire — that's why `writePreAuthAudit` is exported and called directly from the RSC).
- `resolvePatientFirstName` derives from email local-part via `humanizeEmailLocal`; narrow catch, never throws on SDK / network failures (returns `null`), so the UI's "Alguém" fallback covers the degraded path. Programmer errors propagate.
- 6-identity RLS matrix authored in `share_tokens_preauth.rls.test.ts`. The file's job is to prove the regression risk (doctorProcedure-ification would collapse expired/revoked/invalid → 404) — each identity has its own `it(...)` block per CLAUDE.md round-2 discipline.
- CLAUDE.md "Pre-auth landing discipline (Story 6.1)" paragraph added under the existing sharing notes block.
- No schema changes, no new env vars, no new audit kinds (per spec).

### File List

**Created:**

- `apps/web/src/app/m/[token]/page.tsx`
- `apps/web/src/app/m/[token]/auth/page.tsx`
- `packages/ui/src/components/PreAuthLandingCard/PreAuthLandingCard.tsx`
- `packages/ui/src/components/PreAuthLandingCard/PreAuthLandingCard.test.tsx`
- `packages/ui/src/components/PreAuthLandingCard/index.ts`
- `packages/api/__tests__/sharing/constant-time-equal.test.ts`
- `packages/api/__tests__/sharing/humanize-email-local.test.ts`
- `packages/api/__tests__/sharing/get-pre-auth-context.integration.test.ts`
- `packages/db/__tests__/rls/share_tokens_preauth.rls.test.ts`

**Modified:**

- `packages/validators/src/sharing.ts` — pre-auth I/O schemas, pt-BR copy constants, sentinel, `shareTokenReadPhase` extension to `ACCESS_LOG_EVENT_LABEL_PT_BR_FN`.
- `packages/api/src/sharing.ts` — `constantTimeEqualHmac`, `humanizeEmailLocal`, `resolvePatientFirstName`.
- `packages/api/src/router/sharing.ts` — `getPreAuthContext` publicProcedure + `writePreAuthAudit` exported helper.
- `packages/api/src/storage.ts` — `getSupabaseAdminClient` re-exported alias.
- `packages/api/src/index.ts` — barrel re-export of `writePreAuthAudit`.
- `packages/ui/src/index.ts` — barrel re-export of `PreAuthLandingCard`.
- `CLAUDE.md` — Pre-auth landing discipline paragraph.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status in-progress → review.

### References

- [Epic 6 / Story 6.1 — _bmad-output/planning-artifacts/epics.md lines 1409–1435]
- [UX `PreAuthLandingCard` spec — _bmad-output/planning-artifacts/ux-design-specification.md lines 967–983]
- [UX responsive spec — ux-design-specification.md lines 1276–1278]
- [NFR-P4 — prd.md line 554]
- [Story 5.1 share_token primitives — packages/api/src/sharing.ts; packages/db/src/schema/sharing.ts]
- [Story 5.2 magic-link URL shape — packages/api/src/sharing.ts `buildShareUrl`]
- [Story 5.3 ACCESS_LOG_EVENT_KINDS — packages/validators/src/sharing.ts line 308]
- [doctorProcedure / doctor RLS principal — packages/api/src/trpc.ts lines 106–134; packages/db/policies/custom_rls_share_tokens.sql]
- [CLAUDE.md "6-identity RLS matrix mandatory" — repo-root CLAUDE.md]
