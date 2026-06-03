# Story 9.2: Production credentials, region pinning, and DPA gating

Status: done

<!-- SECOND story of Epic 9. STACKS on Story 9.1 (the real Textract adapter) — same worktree/PR branch `worktree-story-8-1-operator-review-queue` (one PR spans Epic 8 + Epic 9 per Francis's 2026-06-02 decision). -->
<!-- 9.1 left an explicit seam: `aws-adapter.ts` getClient() reads `AWS_REGION ?? 'sa-east-1'` with the default credential chain and NO boot gate, with a comment "Story 9.2 adds the fail-loud boot gate + hard sa-east-1 pin". THIS is that story. -->
<!-- SCOPE FENCE — 9.2 adds ONLY the boot-time config gate + region pin + env-var/DPA docs. It does NOT change the mapping (9.1), does NOT touch the consumer failure path (9.3), does NOT re-enqueue (9.4). -->

## Story

As a **platform engineer**,
I want **the AWS Textract path gated at worker BOOT on `sa-east-1` + resolvable DPA-signed credentials, failing loud if misconfigured**,
so that **patient documents are processed only in-region under a signed data-processing agreement (LGPD Art. 33), and a bad deploy crashes at boot instead of silently dead-lettering every upload**.

## Context: what exists today (read before writing)

- **9.1's seam** (`services/extraction/src/textract/aws-adapter.ts`): `getClient()` lazily builds `new TextractClient({ region: process.env.AWS_REGION ?? "sa-east-1" })` with the SDK default credential chain, and a comment marking that **9.2 owns** the fail-loud boot gate + hard region pin. There is currently NO validation — a misconfigured `EXTRACTION_ADAPTER=aws` deploy (wrong region, no creds) would only fail at _first job dispatch_ (throw → retry → dead-letter), which is exactly the silent-failure mode this story closes.
- **The boot-gate precedent** (`services/extraction/src/index.ts:62–68`): the worker already fails loud at boot for Supabase — `if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error(...)`. This is the NFR-S6 pattern to mirror. `index.ts` is the worker entrypoint (top-level side effects: pg-boss, supabase, adapter selection at `:53`). The AWS gate slots in next to the adapter selection, guarded by `EXTRACTION_ADAPTER === "aws"`.
- **`index.ts` is NOT unit-tested** (heavy side effects). So the gate LOGIC must live in a **pure, exported function** in a new module that `index.ts` calls — the function is what the unit tests exercise (mirrors why 9.1 split `aws-mapping.ts` out of the adapter).
- **Deploy target is Railway** (`services/extraction/railway.json`, NIXPACKS, `pnpm … start`). Railway injects credentials as **static env keys** (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), so a presence check on those (plus the role-provider env vars for completeness) is the right, detectable gate.
- **`docs/env-vars.md`** has an "Extraction Worker (`services/extraction/`)" table (currently just `WORKER_DATABASE_URL`). 9.2 adds the AWS rows + a DPA note. **9.1 deliberately deferred this doc to 9.2.**
- **`turbo.json` globalEnv** already lists `AWS_REGION` (added in 9.1). The new credential env vars the gate reads (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) must be added there too, or the `turbo/no-undeclared-env-vars` lint rule fails (the 9.1 lesson).

## Acceptance Criteria

> AC1–AC3 are lifted verbatim from `_bmad-output/planning-artifacts/epics.md` L1907–1921 (Story 9.2). AC4–AC7 are implementation-contract ACs locking the pure-gate shape, the credential-resolution altitude, and the scope fence.

1. **AC1 — Fail-loud boot gate on missing credentials.**
   **Given** `EXTRACTION_ADAPTER=aws`,
   **When** the worker boots without resolvable AWS credentials (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, or an equivalent container/web-identity task-role env),
   **Then** it throws a clear deploy-config `Error` at boot (mirroring the `SUPABASE_SERVICE_ROLE_KEY` NFR-S6 gate) — NOT at first job dispatch. The error message names the missing vars and the DPA requirement.

2. **AC2 — Region pinned to `sa-east-1`.**
   **Given** the adapter constructs the Textract client,
   **When** it is configured,
   **Then** the region is pinned to `sa-east-1` (NFR-S8 data residency): an `AWS_REGION` that is set to any value other than `sa-east-1` **fails the boot gate** with a clear error; unset defaults to `sa-east-1`. The `TextractClient` is constructed with the validated region (no longer the bare `process.env.AWS_REGION ?? 'sa-east-1'` from 9.1).

3. **AC3 — DPA + env-var documentation.**
   **Given** LGPD Art. 33,
   **When** AWS Textract is enabled in production,
   **Then** `docs/env-vars.md` documents the DPA prerequisite and every required AWS env var (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), and states the credentials must reference the **signed-DPA AWS account**.

4. **AC4 — Gate logic is a PURE, exported, unit-tested function.**
   **Given** `index.ts` is not unit-testable (boot side effects),
   **Then** the gate lives in a NEW `services/extraction/src/textract/aws-config.ts` exporting a pure `assertAwsTextractConfig(env: NodeJS.ProcessEnv = process.env): { region: string }` that: validates the region (AC2), validates credential presence (AC1), and returns the resolved `{ region: 'sa-east-1' }` — **no SDK client, no network, no `process.exit`; it THROWS on misconfig.** `index.ts` calls it inside the `EXTRACTION_ADAPTER === "aws"` branch at boot (before/at adapter selection). `aws-adapter.ts` `getClient()` calls the SAME resolver for its region (single source of truth; drop the 9.1 `?? 'sa-east-1'` inline default + the "9.2 will add" comment).

5. **AC5 — Credential-resolution altitude (presence, not validity).**
   **Given** NFR-S8 forbids live AWS calls in CI,
   **Then** the gate checks credential **presence** via env, accepting ANY of: (a) static keys `AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY`; (b) container role `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || AWS_CONTAINER_CREDENTIALS_FULL_URI`; (c) web-identity `AWS_WEB_IDENTITY_TOKEN_FILE` (with `AWS_ROLE_ARN`). It does **NOT** make an STS/Textract call to verify the creds are _valid_ (that's a runtime concern, not a boot gate; a live call in CI violates NFR-S8). Documented limitation: an EC2-IMDS-only identity (no credential env vars) is not auto-detected — not our Railway deploy target; documented in code + `docs/env-vars.md`.

6. **AC6 — `index.ts` boot wiring (mirror the Supabase gate).**
   **Given** the NFR-S6 precedent at `index.ts:62`,
   **Then** the `aws` branch calls `assertAwsTextractConfig()` at boot so a misconfig throws before the worker registers consumers. The `mock` branch is **untouched** (CI/dev never hit the gate). A thrown gate error is uncaught (crashes the process loud) — exactly like the Supabase gate.

7. **AC7 — Quality gates + scope fence + no behaviour change for mock.**
   **Then** `pnpm -w typecheck`, `pnpm -w lint` (with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` declared in `turbo.json` globalEnv), `pnpm -w format` green; `pnpm --filter @healthtracker/extraction-worker test:unit` passes (existing + new `aws-config.test.ts`). The mapping (9.1) is unchanged; the consumer failure path (9.3) and re-enqueue (9.4) are untouched; CI adapter selection still defaults to `mock`.

**Requirements traceability:** NFR-S8 (data residency — `sa-east-1` pin; no live AWS in CI), NFR-S6 (boot-gate secrets — fail first/loud), NFR-S7 (patient data only in-region under DPA), LGPD Art. 33 (DPA prerequisite documented + credentials reference the signed-DPA account).

---

## Tasks / Subtasks

- [x] **Task 1 — Pure config gate `aws-config.ts` (AC2, AC4, AC5)**
  - [x] 1.1 Create `services/extraction/src/textract/aws-config.ts` exporting `const AWS_TEXTRACT_REGION = "sa-east-1"` and `assertAwsTextractConfig(env: NodeJS.ProcessEnv = process.env): { region: string }`.
  - [x] 1.2 **Region (AC2):** `const region = env.AWS_REGION ?? AWS_TEXTRACT_REGION; if (region !== AWS_TEXTRACT_REGION) throw new Error(...)` — message names the offending value + that residency requires `sa-east-1` (NFR-S8).
  - [x] 1.3 **Credentials (AC1, AC5):** compute `hasStatic = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)`, `hasContainerRole = !!(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI)`, `hasWebIdentity = !!env.AWS_WEB_IDENTITY_TOKEN_FILE`. If none → `throw new Error(...)` naming `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` + the DPA-signed-account requirement (LGPD Art. 33). Return `{ region }`.
  - [x] 1.4 JSDoc: this is a pure boot gate (presence, not validity — no live AWS call, NFR-S8); document the EC2-IMDS-only non-detection limitation.

- [x] **Task 2 — Wire the gate into boot (AC6)**
  - [x] 2.1 In `services/extraction/src/index.ts`, inside the `EXTRACTION_ADAPTER === "aws"` path (the adapter-selection ternary at `:53`, or immediately before it), call `assertAwsTextractConfig()`. Simplest: add `if (EXTRACTION_ADAPTER === "aws") assertAwsTextractConfig();` right before the `textractAdapter` assignment. Import from `./textract/aws-config.js` (`.js` ESM extension).
  - [x] 2.2 Leave the `mock` branch + the existing Supabase/`WORKER_DATABASE_URL` gates untouched. Confirm the new gate throws BEFORE consumer registration (it's at module top-level, same as the Supabase gate).

- [x] **Task 3 — Tighten the adapter to the validated region (AC4)**
  - [x] 3.1 In `aws-adapter.ts` `getClient()`, replace `region: process.env.AWS_REGION ?? "sa-east-1"` with `region: assertAwsTextractConfig().region` (single source of truth). Remove the "Story 9.2 will add the fail-loud boot gate" comment; replace with a one-liner noting the gate now runs at boot (`index.ts`) and `getClient` re-resolves the pinned region defensively.
  - [x] 3.2 Confirm `extract()` is otherwise unchanged (no new try/catch — failure-path hardening is still 9.3).

- [x] **Task 4 — Declare env vars (AC7)**
  - [x] 4.1 Add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to `turbo.json` globalEnv (next to the `AWS_REGION` entry from 9.1) so `turbo/no-undeclared-env-vars` passes. (The container/web-identity vars are read only as presence flags; add them too if lint flags them — verify.)

- [x] **Task 5 — Docs: env-vars + DPA (AC3)**
  - [x] 5.1 In `docs/env-vars.md`, extend the "Extraction Worker (`services/extraction/`)" table with rows for `AWS_REGION` (Required when `EXTRACTION_ADAPTER=aws`; default `sa-east-1`; must be `sa-east-1`), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (Required when `EXTRACTION_ADAPTER=aws`; **DPA-signed AWS account**), Introduced `Story 9.2`. Add `EXTRACTION_ADAPTER` itself if absent.
  - [x] 5.2 Add a short note under "## Notes" — the LGPD Art. 33 DPA prerequisite: Textract may only run in production against an AWS account with a signed Data Processing Agreement, pinned to `sa-east-1` (NFR-S8). Mention the boot gate fails loud on misconfig.
  - [x] 5.3 Update the CLAUDE.md "Extraction backend (Epic 9)" stanza: the 9.2 boot gate + `sa-east-1` pin + DPA docs are now shipped (move 9.2 out of "deferred").

- [x] **Task 6 — Tests (AC1, AC2, AC5)**
  - [x] 6.1 Create `services/extraction/__tests__/aws-config.test.ts` exercising `assertAwsTextractConfig(fakeEnv)`:
    - region `sa-east-1` + static keys → returns `{ region: 'sa-east-1' }`.
    - region unset + static keys → returns `{ region: 'sa-east-1' }` (default pin).
    - region `us-east-1` (or any non-`sa-east-1`) → throws, message mentions region/residency.
    - no credentials (no static keys, no role env) → throws, message mentions `AWS_ACCESS_KEY_ID`/DPA.
    - container-role env present (no static keys) → ok.
    - web-identity env present (no static keys) → ok.
    - Pass plain object literals as `env` (not `process.env`) so the test is hermetic — do NOT mutate `process.env`.
  - [x] 6.2 Confirm no existing worker test regresses (the `index.ts` change is a boot-only guard; the unit suite doesn't import `index.ts`).

- [x] **Task 7 — Quality gates (mandatory)**
  - [x] 7.1 `pnpm -w typecheck` green.
  - [x] 7.2 `pnpm -w lint` green (new env vars declared in turbo.json; narrow throws only).
  - [x] 7.3 `pnpm -w format` clean (prettier the new `.ts` + the `docs/env-vars.md` table — note the doc uses aligned markdown table pipes; keep alignment or let prettier handle it).
  - [x] 7.4 `pnpm --filter @healthtracker/extraction-worker test:unit` green (existing + `aws-config.test.ts`).

---

## Dev Notes

### The scope fence (do not cross)

9.2 = boot-time AWS config gate (region + credential presence) + the `docs/env-vars.md`/DPA documentation + the single-source region in the adapter. **Deferred:** the mapping (9.1, done), the consumer `extract()` failure-path catch/dead-letter (9.3), the stub-era re-enqueue (9.4). Do NOT add a try/catch around `extract()` or touch `consumers/document.ts`.

### Why a pure gate function (AC4)

`index.ts` is the worker entrypoint with un-unit-testable boot side effects (pg-boss, Supabase client, consumer registration). Putting the gate logic in a pure `assertAwsTextractConfig(env)` makes the region/credential rules fully unit-testable with fake env objects, while `index.ts` just calls it. This mirrors 9.1's `aws-mapping.ts` split and the repo's "logic in a pure module, side-effects in the entrypoint" pattern.

### Credential-resolution altitude (AC5) — read carefully

The gate checks **presence**, not **validity**. It cannot make a live STS/Textract call to verify the credentials actually work — NFR-S8 forbids live AWS in CI, and a boot-time network call would make the worker's startup depend on AWS reachability. So the gate accepts any recognised credential-source env (static keys / container role / web identity). This catches the real misconfig (no creds configured at all, wrong region) loud at boot, while leaving "creds are present but invalid/expired" to surface at first dispatch (where 9.3 will dead-letter it cleanly). Document this boundary so a reviewer doesn't expect an STS probe. EC2-IMDS-only identities have no env footprint and aren't detected — not our Railway target (Railway = static keys).

### Existing code to read before writing (READ ALL)

- `services/extraction/src/index.ts:18–68` — adapter selection (`:53`) + the Supabase boot-gate precedent (`:62`) to mirror. The AWS gate slots in next to selection.
- `services/extraction/src/textract/aws-adapter.ts` (Story 9.1) — `getClient()` reads `AWS_REGION ?? 'sa-east-1'`; Task 3 routes it through the resolver. The "9.2 will add" comment is the seam to close.
- `docs/env-vars.md` (Extraction Worker table at L34–38; Notes at L48+) — Task 5 extends both.
- `turbo.json` globalEnv (`AWS_REGION` at L79) — Task 4 adds the credential vars.
- `CLAUDE.md` "Extraction backend (Epic 9)" stanza — Task 5.3 marks 9.2 shipped.

### Existing behaviour that must be preserved (regression watch)

- **`mock` adapter path unchanged** — CI/dev never call `assertAwsTextractConfig` (it's behind `EXTRACTION_ADAPTER === "aws"`). The default boot stays warning-only (no AWS gate). No test that boots with mock should newly throw.
- **9.1 mapping + adapter `extract()` unchanged** — only `getClient()`'s region source changes; the SDK call + mapping delegation are identical.
- **The Supabase / `WORKER_DATABASE_URL` gates** at `index.ts:62`/`:102` are untouched and still fire first.
- **No live AWS call anywhere** (NFR-S8) — the gate is pure env inspection; tests pass fake env objects, never `process.env` mutation.

### Project Structure Notes

- **NEW:** `services/extraction/src/textract/aws-config.ts`, `services/extraction/__tests__/aws-config.test.ts`.
- **MODIFIED:** `services/extraction/src/index.ts` (+boot gate call), `services/extraction/src/textract/aws-adapter.ts` (region via resolver; drop 9.1 default+comment), `turbo.json` (+2 AWS env vars), `docs/env-vars.md` (AWS rows + DPA note), `CLAUDE.md` (Epic 9 stanza — 9.2 shipped).
- **NO** mapping change, **NO** `consumers/document.ts`, **NO** DB/migration, **NO** `apps/*`.

### Open questions for Francis (surface at hand-off, do NOT block)

1. **Credential validity vs presence.** The gate verifies creds are _configured_, not that they _work_ (no live STS call — NFR-S8). If you want a one-time live Textract reachability probe at boot (outside CI), that's a follow-up — it couples worker startup to AWS uptime and can't run in CI, so I kept it to presence. Flag if you want the probe (guarded behind a non-test env check).
2. **Region default vs hard-require.** I default unset `AWS_REGION` to `sa-east-1` (pinned) and reject any other value. If you'd rather REQUIRE `AWS_REGION=sa-east-1` explicitly (throw on unset too), it's a one-line change — say which you prefer.
3. **DPA account identifier.** `docs/env-vars.md` will say "DPA-signed AWS account" generically. If there's a specific account id / IAM role ARN convention to reference, point me at it and I'll cite it.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` L1899–1921] Story 9.2 spec (NFR-S8/NFR-S6/NFR-S7, LGPD Art. 33).
- [Source: `services/extraction/src/index.ts:62`] The `SUPABASE_SERVICE_ROLE_KEY` NFR-S6 boot-gate precedent to mirror.
- [Source: `services/extraction/src/textract/aws-adapter.ts`] 9.1's `getClient()` region seam this story closes.
- [Source: `CLAUDE.md` NFR-S6 boot-gating + "Extraction backend (Epic 9)"] The fail-first-after-deploy secret convention.
- [Source: `_bmad-output/implementation-artifacts/9-1-implement-the-real-aws-textract-adapter.md`] The predecessor story; its "deferred to 9.2" list is this story's scope.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story + bmad-dev-story workflows)

### Debug Log References

- `pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 (after adding `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` to `turbo.json` globalEnv for `turbo/no-undeclared-env-vars`) · changed files prettier-clean · `pnpm --filter @healthtracker/extraction-worker test:unit` **90 pass** (8 new in `aws-config.test.ts`).

### Completion Notes List

- Implemented 2026-06-02 on `worktree-story-8-1-operator-review-queue`, stacked on Story 9.1 (Epic 8 + Epic 9 share one PR).
- **NEW `aws-config.ts`** — pure `assertAwsTextractConfig(env = process.env)`: pins region to `sa-east-1` (unset defaults; any other value throws — NFR-S8), and requires resolvable credentials (static keys OR container OR web-identity task role; presence not validity — no live AWS, NFR-S8). Throws clear deploy-config errors naming the offending var + the DPA-signed-account requirement (LGPD Art. 33). `AWS_TEXTRACT_REGION` exported.
- **Boot wiring (`index.ts`)** — `if (EXTRACTION_ADAPTER === "aws") assertAwsTextractConfig();` right before adapter selection, mirroring the Supabase NFR-S6 gate at `:62`. Mock branch untouched; the gate throws (crashes loud) before consumer registration.
- **Adapter (`aws-adapter.ts`)** — `getClient()` now builds the client with `assertAwsTextractConfig().region` (single source of truth); removed 9.1's `?? 'sa-east-1'` inline default + the "9.2 will add" comment. `extract()` unchanged (no try/catch — failure-path hardening is still 9.3).
- **Docs** — `docs/env-vars.md`: AWS rows (`EXTRACTION_ADAPTER`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) + an "AWS Textract DPA + region gating" note (region pin, DPA-signed account, presence-not-validity altitude, EC2-IMDS non-detection). CLAUDE.md "Extraction backend (Epic 9)" stanza: 9.2 moved from deferred → shipped.
- **Tests** — `aws-config.test.ts` (8): sa-east-1+keys, unset-region default, wrong-region throw, no-creds throw, DPA message, container role, web identity, half-key-pair throw. Hermetic (fake env objects; never mutates `process.env`).
- Scope fence honoured: no mapping change (9.1), no `consumers/document.ts` (9.3), no re-enqueue (9.4), no DB/migration, no `apps/*`.
- Altitude decision (documented): the gate verifies credential _presence_, not _validity_ — a live STS/Textract probe would violate NFR-S8 and couple boot to AWS uptime. Invalid/expired creds surface at first dispatch (9.3 dead-letters). Flagged as open question for Francis.

### File List

**NEW**

- `services/extraction/src/textract/aws-config.ts`
- `services/extraction/__tests__/aws-config.test.ts`

**MODIFIED**

- `services/extraction/src/index.ts` (boot gate call + import)
- `services/extraction/src/textract/aws-adapter.ts` (region via resolver; dropped 9.1 default + comment)
- `turbo.json` (+`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- `docs/env-vars.md` (AWS env rows + DPA note)
- `CLAUDE.md` (Epic 9 stanza — 9.2 shipped)

**NO** mapping change, **NO** `consumers/document.ts`, **NO** DB/migration, **NO** `apps/*`.

## Senior Developer Review (AI)

**Reviewed:** 2026-06-02 · **Outcome:** Changes Requested → Addressed · **Method:** 3-layer adversarial (Blind Hunter — diff only; Edge Case Hunter — diff + repo read; Acceptance Auditor — diff vs spec). The Acceptance Auditor passed all 7 ACs and confirmed the scope fence intact; the Hunters surfaced 2 MED credential-gate correctness bugs + a doc gap, all patched.

### Action Items

- [x] **MED — web-identity false-pass: `AWS_WEB_IDENTITY_TOKEN_FILE` accepted without `AWS_ROLE_ARN`.** The SDK's `fromTokenFile` (`AssumeRoleWithWebIdentity`) needs BOTH; accepting the token file alone would pass the boot gate but fail to resolve creds at first dispatch — re-introducing the silent dead-letter the gate exists to prevent. **Fix:** `hasWebIdentity = !!(AWS_WEB_IDENTITY_TOKEN_FILE && AWS_ROLE_ARN)`, mirroring the static-key `&&`. New regression test. (`aws-config.ts`)
- [x] **MED — `AWS_REGION=""` threw instead of defaulting.** `?? ` only coalesces null/undefined; a declared-but-empty env var (the common Railway/Docker shape) yielded `""` → spurious boot crash, contradicting the documented "unset defaults to sa-east-1" contract. **Fix:** `(env.AWS_REGION ?? "").trim() || AWS_TEXTRACT_REGION` — blank/whitespace now defaults (also fixes a trailing-space copy-paste); a concrete wrong region still throws. New tests (empty + whitespace). (`aws-config.ts`)
- [x] **LOW/doc — misleading "no credentials" crash for `AWS_PROFILE`/SSO/shared-config/IMDS.** These are valid SDK credential sources the gate deliberately rejects (not the Railway target), but the error + docs only mentioned IMDS. **Fix:** error message + module JSDoc + `docs/env-vars.md` now state `AWS_PROFILE`/SSO/IMDS are intentionally unsupported and what to use instead. (`aws-config.ts`, `docs/env-vars.md`)

### Dismissed (with rationale)

- **LOW — `AWS_CONTAINER_CREDENTIALS_FULL_URI` accepted without its auth token** — tightening risks a false-negative crash (FULL_URI is valid token-less in some link-local setups); not the Railway target. Left as-is.
- **LOW — region case-sensitivity (`SA-EAST-1`)** — AWS region codes are canonically lowercase; case-folding could mask a real typo. The `.trim()` already handles the realistic whitespace case.
- **LOW — `getClient()` re-invokes the gate at first dispatch** — pure + same env; the credential re-check is harmless dead weight, kept as single-source-of-truth for the region. No live bug (env isn't mutated post-boot).
- **NOTE — no unit test of the `index.ts` wiring itself** — `index.ts` is deliberately not unit-tested (boot side effects); the pure-function tests are the contract, per spec AC4.

### Post-patch gates

`pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 · changed files prettier-clean · `pnpm --filter @healthtracker/extraction-worker test:unit` **92 pass** (10 in `aws-config.test.ts`, up from 8 — added web-identity-without-role + blank/whitespace region). No live AWS call (NFR-S8).
