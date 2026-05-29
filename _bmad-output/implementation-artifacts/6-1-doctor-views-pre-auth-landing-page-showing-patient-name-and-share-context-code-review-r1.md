# Code Review R1 — Story 6.1 (Doctor pre-auth landing page)

**Commit:** `0c973c6`
**Reviewer:** Claude Opus 4.7 (R1, adversarial)
**Date:** 2026-05-28
**Stacked on:** PR #56 — no split recommended (per project convention).

---

## Verdict

**Request changes.** No blockers. The shipped surface is largely correct, but the integration-test file is essentially placeholder (`it.todo()` x7), one audit-visibility branch silently disappears from the patient's Access Log, and a couple of smaller hygiene gaps undermine the disciplines documented in the spec.

Severity bucket counts:

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| High     | 2     |
| Medium   | 3     |
| Low      | 2     |
| Nit      | 2     |

---

## Top 3 issues (by severity)

### H1 — Malformed-segment audit rows are invisible in the patient's Access Log

The `audit_log_select_own` RLS predicate (`packages/db/policies/custom_rls_audit_log.sql:33-45`) shows a patient a `share_token`-scoped audit row only when `EXISTS (SELECT 1 FROM share_tokens WHERE share_tokens.id = audit_log.resource_id AND share_tokens.patient_id = current_setting('app.current_patient_id'))`. The malformed-segment branch in `apps/web/src/app/m/[token]/page.tsx:73-77` writes `actorId = resourceId = SHARE_TOKEN_UNKNOWN_SENTINEL` (all-zeros uuid). That uuid is not in `share_tokens`, so the EXISTS subquery returns FALSE for every patient — **no patient ever sees these probes.** The spec (open question #2) reads "the patient cannot see WHICH invalid link was probed (just that one was)" — implying the row IS surfaced. As implemented, the row is written but invisible to every principal except service-role. Either: (a) accept this and update the spec/CLAUDE.md to say "malformed-segment probes are logged but not surfaced to any patient" (operational forensic only), or (b) extend the RLS predicate to also match the sentinel against some patient binding. Note this only affects malformed-segment + unknown-id probes; bad-HMAC against a real `shareTokenId` IS visible to the owning patient because `resource_id` joins.

### H2 — Integration test is `it.todo()` placeholders, not actual coverage

`packages/api/__tests__/sharing/get-pre-auth-context.integration.test.ts` ships seven `it.todo()` entries and two assertions that only verify the Zod schema and a string constant. None of the four state branches (`active`/`expired`/`revoked`/`invalid`) or the revoke-then-expire precedence is actually exercised against the testcontainer harness. The spec (T6.1, AC10) requires an integration test that asserts per-branch status discriminator AND that "exactly one `share_token.read` audit row is written with the expected `metadata.phase = "pre-auth"`". The dev-notes claim "Excluded from `test:unit` via the `*.integration.test.ts` filter" is true, but the file does not run a real harness — `configure-biomarkers.integration.test.ts` was cited as precedent yet that file (per the dev's own debug log) is the "schema-shape + todo" posture being mirrored. **The patient surveillance surface (the entire spec's `why`) currently has zero end-to-end test coverage** — a future regression that drops the `revoke`/`expire` audit emission would not fail any test. Write at least the four state-branch tests against the testcontainer setup (`packages/db/__tests__/integration/setup.ts`).

### M1 — RSC route's `db` import bypasses the resolver's audit code path

`apps/web/src/app/m/[token]/page.tsx:9` imports `db` from `@healthtracker/db/client` and passes it directly to `writePreAuthAudit(db, ...)` (line 73) for the malformed-segment branch. This is the documented intent (a tRPC procedure would reject the sentinel via Zod). But it leaks `db` into the apps-layer surface — a pattern that has previously caused drift between RLS-on (`protectedProcedure` tx) and RLS-off (raw `db`) call sites. Suggest: add a small `auditMalformedTokenProbe(args)` helper in `packages/api/src/router/sharing.ts` that internally pulls `db` and exposes ONLY that narrow contract. Same audit-row shape; cleaner surface; future stories don't grep `db` out of `apps/web/`.

---

## Full findings

### High

- **H1** (above) — malformed-segment audit rows not visible to any patient under RLS.
- **H2** (above) — integration test is `it.todo()` placeholders.

### Medium

- **M1** (above) — RSC route imports `db` directly to call `writePreAuthAudit`; consider an apps-layer helper.
- **M2** — `share_tokens_preauth.rls.test.ts` claims a 6-identity matrix in the docstring, but only ships **6** `it(...)` blocks — verified manually: `correctPatient`, `wrongPatient`, `serviceRole`, `doctorWithActiveToken`, `doctorWithExpiredToken`, `doctorWithRevokedToken`. ✅ The matrix IS complete (no false-claim like Story 5.1 R2). However, the spec required "**Plus 3 non-identity test cases** (file's other `describe` block): bad-HMAC → `invalid`; unknown shareTokenId → `invalid`; malformed `[token]` segment → component test → `invalid`." Only the 6-identity describe block ships. The bad-HMAC / unknown-id / malformed-segment cases are absent.
- **M3** — The `not-found` and `bad-HMAC` audit branches in `packages/api/src/router/sharing.ts:1154,1172` write `actorId = input.shareTokenId` (client-supplied uuid). The spec line "the URL-supplied id might be garbage; the sentinel makes 'probe attempts' filterable" was the rationale for switching the malformed-segment path to the sentinel. By the same logic the not-found path is ALSO an unverified client-supplied uuid (Zod-valid, but unowned), and bad-HMAC is a real id but the doctor doesn't possess it. Suggest auditing whether these should also use the sentinel as `actorId` (keeping `resourceId` as the real id for the bad-HMAC case so the owning patient still sees it). At minimum, document the asymmetry in the docblock.

### Low

- **L1** — `apps/web/src/app/m/[token]/page.tsx:101` builds `createTRPCContext({ headers: reqHeaders, session: null })` and uses `appRouter.createCaller(ctx)` for the RSC-side call. The repo's standard RSC-side caller pattern (per Dev Notes "library/framework requirements") is `apps/web/src/trpc/server.ts`. Using `createCaller` directly works, but skips any wrapping helpers (e.g. logging, error-boundary mapping) the project's RSC pattern provides. Verify alignment with the established RSC pattern (e.g. `apps/web/src/app/compartilhar/[shareTokenId]/resumo/page.tsx`).
- **L2** — The CLAUDE.md "Pre-auth landing discipline" paragraph (line 233-241 of the diff) is accurate and consistent. One nit: bullet 4 says "Mitigation is deferred to a future infra story" but no story key is referenced (Story 5.6's similar deferral cites the deferred-work tracker). Add an explicit deferred-work pointer so the deferral isn't forgotten.

### Nits

- **N1** — `packages/api/src/router/sharing.ts:1206-1220`: the resolver wraps `resolvePatientFirstName` in another `try/catch` despite the helper's docstring guaranteeing it does not throw. This is defensive in depth and consistent with CLAUDE.md narrow-catch discipline — fine to keep — but is dead-code-guard-adjacent (Epic 1 R2 pattern). Either trust the contract or pin it with a unit test that asserts `resolvePatientFirstName` never throws on adversarial inputs.
- **N2** — `packages/ui/src/components/PreAuthLandingCard/PreAuthLandingCard.tsx:81-90`: the active-state CTA wraps a `Button` (with `accessibilityRole="button"`) inside an `<a>` (with same `aria-label`). Screen readers will see "button, link, link" depending on tooling. Either drop the inner button role or render a single anchor styled as a button. Minor a11y polish.

---

## Verifications (per user prompt's checklist)

| #   | Item                                                                                                     | Result                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Resolver is `publicProcedure`, NOT `doctorProcedure`, with docstring                                     | ✅ — strong docstring at `packages/api/src/router/sharing.ts:1097-1124` explains the regression risk and points at the RLS test file.                                                   |
| 2   | No enumeration oracle (unknown/bad-HMAC/malformed all same `invalid` UI)                                 | ✅ — confirmed at resolver (lines 1153-1183) and RSC route (lines 65-94); same PreAuthLandingCard with `status="invalid"`.                                                              |
| 3   | Constant-time HMAC compare via `crypto.timingSafeEqual`, length-guarded                                  | ✅ — `packages/api/src/sharing.ts:297-302` guards length explicitly before `timingSafeEqual`. Unit test covers identical / differing-length / one-bit-different / first-byte-different. |
| 4   | Audit fires on active/expired/revoked/invalid + malformed-segment with `phase="pre-auth"`                | ✅ at all five branches. ⚠ malformed-segment audit not visible under RLS — see H1.                                                                                                      |
| 5   | CLAUDE.md "Pre-auth landing discipline" paragraph accurate, consistent, code-enforced                    | ✅ accurate, ✅ consistent. See L2 for missing deferred-work pointer.                                                                                                                   |
| 6   | Barrel re-export of `writePreAuthAudit` from `packages/api/src/index.ts` does not leak unrelated symbols | ✅ — only `writePreAuthAudit` is added (line 31). No other leakage.                                                                                                                     |
| 7   | `getSupabaseAdminClient` alias is the same cached client, not a second pool                              | ✅ — `packages/api/src/storage.ts:29-31` returns `getStorageClient()`; same `cachedClient` closure.                                                                                     |

---

## Notes

- **Stacked-PR posture honored** — no recommendation to split.
- **Round-1 hunting checklist (CLAUDE.md):**
  - Query-param producer-without-consumer: none introduced.
  - Broad `catch (err)` in new code: all four catches articulate which shapes they swallow (TypeError/ReferenceError/SyntaxError rethrown). ✅
  - TOCTOU: resolver's SELECT-then-HMAC-then-status read is read-only; no write; no race window worth closing.
  - Partial-index ON CONFLICT clause mismatch: no new partial indexes.
  - Dead-code guard: N1 noted (defensive try/catch around contracted-not-to-throw helper).
- **6-identity matrix:** all 6 `it(...)` blocks present in the RLS test file. No "claimed but not shipped" gap (the Story 5.1 R2 pattern).
