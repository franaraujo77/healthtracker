# Story 6.2 — Code Review R1

**Commit under review:** `9d4ee9b` ("feat(story-6.2): doctor magic-link auth + conversation starter view")
**PR:** #57
**Reviewer:** Round 1 adversarial review
**Date:** 2026-05-29
**Spec:** `6-2-doctor-authenticates-via-magic-link-and-views-the-conversation-starter-report.md`

---

## Verdict

**REQUEST CHANGES** — security & correctness foundations are solid; the deferred-test gap (T8.3 + T8.5) and one concrete sharing-related code defect must close before R2 sign-off.

**Findings:** 0 blocker · 3 high · 5 medium · 4 low · 3 nit

---

## Top 3 findings by severity

1. **HIGH — `cacheStatus = "queued"` returns `sharedAt` from the share-token row but never `auditId` consumer is unable to discriminate first-of-many polling ticks from refresh-driven retries.** Polling tick fires `share_token.read post-auth` **every tick** (≈ once / 2s); the patient's surveillance surface will see 15 audit rows for a 30s cold-cache window for one doctor view. Spec line 209 ("Audit fires on EVERY view of the report (not just first view) — the patient's surveillance surface wants the full timeline") arguably justifies this, but a 15-row burst per cold-cache view is a different signal than "the doctor viewed the report once". Recommendation: emit `share_token.read` only when `cacheStatus === "ready"`, OR add a `pollTick: true` metadata bit so the Access Log renderer can collapse them. (`packages/api/src/router/sharing.ts:1432`)

2. **HIGH — T8.3 (`get-conversation-starter.integration.test.ts`) AND T8.5 (`anthropic-conversation-starter.test.ts`) are unshipped despite being mandatory in the spec (T8.3/T8.5 lines 190 / 192).** Story 5.6 R1 precedent treated comparable test gaps as HIGH. T8.3 is the only end-to-end coverage of the doctor RLS branch, the audit row's post-auth phase, and the failure-reason → pt-BR mapping. T8.5 is the only thing protecting the live Anthropic `messages.create` arguments + JSON-parse / Zod-rethrow chain from a regression. Spec is explicit they are AC10 deliverables; no deferred-work entry was filed. See "Deferred tests triage" below.

3. **HIGH — Open-redirect / token-tag confusion on `/m/[token]/auth/callback`.** The callback validates `searchParams.shareTokenId` / `searchParams.tokenHmac` against regex, then composes `${origin}/m/${segment}` for the redirect — **but never validates that those query params match the `[token]` segment in the route URL**. A magic-link URL crafted to land on `/m/<tokenA>/auth/callback?shareTokenId=<tokenB-id>&tokenHmac=<tokenB-hmac>` would consume the auth code, mint the doctor's session, then redirect to `/m/<tokenB>/view` — i.e., the magic-link issued for token A authorizes the doctor on token B. Mitigated in practice by the `getPreAuthContext` re-validation step (token B must also be `active`), but the magic-link signing semantic is broken: holding any active link is enough to authenticate against any other active link. Add a sanity check: parse `[token]` from `request.url`, compare `shareTokenId` + `tokenHmac` against the segment, reject if mismatched. (`apps/web/src/app/m/[token]/auth/callback/route.ts:62-67`)

---

## Findings

### HIGH

- **H1 — Per-tick `share_token.read` audit emission.** See top-finding #1.
- **H2 — T8.3 + T8.5 deferred without a deferred-work entry.** See top-finding #2.
- **H3 — Callback route does not cross-check `[token]` segment vs query params.** See top-finding #3.

### MEDIUM

- **M1 — `apps/web/src/app/m/[token]/view/page.tsx` synthesizes a fake `Session`** (`access_token: ""`, `refresh_token: ""`, etc., cast through `as unknown as`). The `doctorProcedure` middleware reads only `session.user`, so this works **today**, but Story 6.3 is likely to consume `session.access_token` (e.g., to call `supabase.auth.admin.*` on behalf of the doctor) — and will silently get an empty string. Either (a) call `supabase.auth.getSession()` after `getUser()` revalidated and pass the real session through, or (b) leave a `TODO` comment + a unit-test guard that fails when the middleware grows new reads. (`view/page.tsx:91-100`)
- **M2 — `DoctorMagicLinkForm.tsx` calls `document.querySelector("form")` inside `onPress`.** First-form-on-the-page is a global query and will collide if any future surface composes two forms on `/m/[token]/auth`. Use a ref or trigger via the form's own submit button. (`DoctorMagicLinkForm.tsx:144-149`)
- **M3 — `shareTokenHolder` module-level singleton is a tab-wide race condition** when two doctor-view tabs are open. Tab A mounts `ShareTokenProvider(tokenA)`, tab B mounts `ShareTokenProvider(tokenB)` — but a single browser process shares the module; the second mount overwrites `current`, and tab A's next tRPC call sends tokenB. Probability: low (one-token-per-tab is the dominant flow), but the failure mode is a cross-token header on a `doctorProcedure` call, which the resolver's defense-in-depth `constantTimeEqualHmac` re-check catches as `NOT_FOUND` — so the impact is degraded UX, not data leak. Acceptable for 6.2; flag in deferred-work for Story 6.3+ when two-tab flows become realistic. (`apps/web/src/trpc/react.tsx:36-54`)
- **M4 — `services/llm/src/consumers/generate-conversation-starter.ts` duplicates `conversationStarterPayloadSchema` Zod.** Spec line 274 documents the dual-declaration convention, but the local mirror omits `previousValue` / `currentValue` nullability matching the canonical schema verbatim (e.g., the canonical declares `currentValue: z.number().nullable()`, the local mirror declares the same — but if either drifts, the Anthropic→worker→resolver pipeline silently degrades). Recommendation: copy-test (a unit test in `services/llm` that imports the canonical schema via a relative path and runs `expect(localSchema._def).toEqual(canonicalSchema._def)`).
- **M5 — Resolver maps EVERY `cache.status === "failed"` to the SHORT pt-BR string** (`CONVERSATION_STARTER_FAILED_PT_BR`), but the worker's DPA-gate branch writes `failure_reason = 'LLM_API_ERROR'` for the stub-in-production case. Operator forensics lose the distinction (`STUB_ADAPTER_IN_PRODUCTION` in the audit, but `LLM_API_ERROR` in `failure_reason`). Either add a `STUB_IN_PROD` failure_reason and map it the same on the client, or document why the operator-distinction lives only in the audit row.

### LOW

- **L1 — `DoctorMagicLinkForm.tsx` broad `catch` is documented as intentional** (collapses TypeError/DOMException to a single generic error per AC1). Per CLAUDE.md "Narrow catches by default": the narrow alternative is `catch (err) { if (err instanceof TypeError && err.message === 'fetch failed') ...; if (err instanceof DOMException) ...; throw err; }` and re-mapping. R1 accepts the broad catch with the AC1 enumeration-oracle rationale, but would prefer a narrowed list with a fall-through `throw` for programmer errors. (`DoctorMagicLinkForm.tsx:64-72`)
- **L2 — `callback/route.ts` `catch` swallows ALL errors** from `getPreAuthContext` and treats every shape as `invalid`. The inline comment justifies it ("any shape (network, Zod, RPC) collapses to the same redirect target"). Same narrow-catch concern as L1 — programmer errors silently degrade to a dead-link. Mitigation: keep the broad catch but `console.error` the swallowed shape so operators can spot RPC-level regressions. (`callback/route.ts:53-61`)
- **L3 — `view/page.tsx` redirects to `/m/${token}` on `getConversationStarter` failure** with a broad catch ("NOT_FOUND from the resolver…"). A TRPCError with `code !== "NOT_FOUND"` (e.g., `INTERNAL_SERVER_ERROR` from an audit-write that throws TypeError) would silently dead-link. Narrow on `err.code === "NOT_FOUND"`. (`view/page.tsx:118-126`)
- **L4 — `polling.refetchInterval` returns `false` on `ready` but does NOT also stop the elapsed-timer effect.** The cleanup runs on `dataUpdatedAt` change, which fires on `ready` — so the timer is correctly cleared. But the assertion is non-obvious; a brief comment would help future maintainers. (`ConversationStarterPolling.tsx:42-66`)

### NIT

- **N1 — `apps/web/src/app/m/[token]/view/page.tsx` line 156** passes `valueNumeric={card.currentValue ?? 0}` — a `null` current-value renders as `0`, which is a misleading observation. The card's `state="cold-start"` may handle this, but a `card.currentValue === null ? "—" : card.currentValue` boundary is safer.
- **N2 — `services/llm/src/prompts/conversation-starter.ts:33`** the system message says "1 a 6 prompts" but the user prompt says "gere 3 prompts breves" — inconsistent. The Zod schema enforces 1..6, so the model can return anything in range; the user prompt's "3" is a soft preference. Worth aligning to avoid model confusion.
- **N3 — Hard-coded inline `style={{}}` throughout `view/page.tsx`, `auth/page.tsx`, `ReportLayout.tsx`** rather than Tailwind classes. Project convention is Tailwind 4 (CLAUDE.md "Web app — Tailwind 4 (PostCSS plugin)"). Acceptable for an MVP surface; flag for a follow-up refactor.

---

## Deferred-tests triage

| Task                                                                                                | Severity   | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T8.3** integration test for `getConversationStarter`                                              | **HIGH**   | The only test that covers the resolver's branch table end-to-end (RLS-bound SELECT on `share_tokens` + service-role read of `conversation_starter_cache` + `share_token.read post-auth` audit row + failure-reason → pt-BR mapping). Story 6.1 already added a comparable integration test for `getPreAuthContext`; the symmetry argument is strong. Story 5.6 R1 precedent (account-deletion) escalated comparable `it.todo()`-only test gaps to HIGH. **Block R2 sign-off until this lands.** |
| **T8.5** Anthropic adapter unit test                                                                | **HIGH**   | First production-bound `messages.create` call in the codebase; protects (a) prompt-construction argument shape, (b) `JSON.parse` of `text` content, (c) Zod-rethrow as `Anthropic.APIError` for the consumer's narrow-catch. No other layer in the stack catches a `model` / `max_tokens` / `system` argument regression. **Block R2 sign-off until this lands.**                                                                                                                               |
| **T8.6** Component snapshots for `<ConversationStarterPrompt>` + `<BiomarkerCard variant="report">` | **MEDIUM** | Lower blast-radius — UI regressions surface visually and the components are small. Acceptable as a follow-up if logged in `deferred-work.md`.                                                                                                                                                                                                                                                                                                                                                   |
| **T8.7** E2E Playwright spec                                                                        | **LOW**    | Spec already declared it as "skip in CI if no Supabase test project is wired"; the skip-pattern is the precedent. Document the skip, file the harness, ship.                                                                                                                                                                                                                                                                                                                                    |

**T9.3 deferred-work log:** spec line 199 required dev to log three deferrals. Need to verify the entry was added to `_bmad-output/implementation-artifacts/deferred-work.md` — if not present, that itself is a finding (escalate to HIGH given T8.3/T8.5).

---

## Verifications PASSED

**Per-codebase mandatory checks (CLAUDE.md "Code review discipline"):**

- 6-identity RLS matrix on `conversation_starter_cache.rls.test.ts` — all 6 (`correctPatient`, `wrongPatient`, `serviceRole`, `doctorWithActiveToken`, `doctorWithExpiredToken`, `doctorWithRevokedToken`) ✓
- 6-identity matrix on `share_token_biomarkers.rls.test.ts` — all 6 + cross-token leak guard ✓
- No `@ts-ignore` / `@ts-expect-error` / `.skip` / `.todo` introduced in shipped code ✓
- Resolver narrow catches: `try { JSON parse }` re-throws TypeError/ReferenceError/SyntaxError ✓; `try { resolvePatientFirstName }` same ✓; `try { writeAuditLog }` same ✓.
- Query-param producer/consumer chain: `shareTokenId` + `tokenHmac` → form → emailRedirectTo → callback route → `getPreAuthContext` → `getConversationStarter` — all consumers wired ✓.

**Story-6.2-specific:**

1. `doctorProcedure` has BOTH gates (`x-share-token` header AND `ctx.session?.user`) — confirmed at `packages/api/src/trpc.ts:130-145` ✓. Defense-in-depth `constantTimeEqualHmac` re-check at resolver line 1331 ✓.
2. Audit shape: `share_token.read` event, `metadata.phase = "post-auth"`, `actorId = ctx.session.user.id` ✓ — but see H1 re: per-tick emission.
3. DPA hard-gate: discriminated `LLMAdapterKind = "real" | "stub"` (not runtime string sniff). Consumer reads `deps.llm.kind === "stub"` ✓.
4. Service-role bypass on `conversation_starter_cache` runs **after** the doctor-RLS `share_tokens` check + HMAC re-check ✓. Authorization proven before bypass.
5. `pending_invites.resolved_user_id` not touched — grep clean ✓.
6. `x-share-token` threaded via React `<ShareTokenProvider>` + `httpBatchStreamLink({ headers: () => ... })` callback. No localStorage / URL re-parse ✓ (but see M3 re: tab-wide singleton race).
7. Magic-link callback validates the share-token **before** issuing the session cookie via `caller.sharing.getPreAuthContext` ✓ — but see H3 re: `[token]`-vs-querystring mismatch.
8. NFR-S6 boot gate — no new env var; `ANTHROPIC_API_KEY` reuses Story 4.1 boot gate ✓.
9. Prompt content (`services/llm/src/prompts/conversation-starter.ts`) — explicit "Não dê conselhos médicos. Não diagnostique. Use enquadramento conforme ANVISA"; forces JSON-only output ✓. (See N2 for a minor inconsistency.)
10. Reuses existing patterns — `writeAuditLog`, `constantTimeEqualHmac`, `resolvePatientFirstName`, `getSupabaseAdminClient` — no reinvention ✓.

---

## Recommended next steps for the dev agent

1. Close H1 — guard the audit emission, or add a `pollTick` metadata bit + Access Log collapse.
2. Close H3 — add the `[token]` segment vs query-string cross-check in the callback route.
3. Land T8.3 and T8.5 — these unblock R2.
4. Close M1 / M2 / L3 (≤ 10 min each).
5. Verify `deferred-work.md` has the T9.3 entries; if not, add them.
