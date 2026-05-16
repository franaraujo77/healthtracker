---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-05-14'
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/ux-design-specification.md"
  - "_bmad-output/planning-artifacts/product-brief-healthtracker-distillate.md"
workflowType: 'architecture'
project_name: 'Health Tracker'
user_name: 'Francis'
date: '2026-05-14'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

51 FRs across 8 domains: Health Data Ingestion (FR1–10), Longitudinal Record & Fingerprint (FR11–16), AI Narrative — The Letter (FR17–20), Sharing & Access Control (FR21–25), Doctor Experience (FR26–31), Privacy & Compliance (FR32–37), Operator & Administration (FR38–41), Account & Authentication (FR42–51).

Architecturally, these cluster into four subsystems:
1. **Ingestion pipeline** — upload, OCR, LLM extraction, confidence gate, LOINC normalization, manual review queue, patient confirmation
2. **Record & intelligence layer** — longitudinal storage, personal baseline computation (z-score), Fingerprint visualization, The Letter generation
3. **Access control & sharing layer** — per-biomarker/per-doctor ACL, time-limited signed tokens, revocation, append-only access log, entitlement enforcement
4. **Presentation layer** — Expo patient app, Next.js doctor web, shared Tamagui component library

**Non-Functional Requirements:**

NFRs that directly constrain architecture (not implementation details):

| NFR | Constraint | Architectural implication |
|-----|-----------|--------------------------|
| P1 | Extraction <30s at p95, 100 concurrent jobs | Async worker pool; horizontal scaling (SC1) |
| P2 | Letter first token <3s | Persistent server (not serverless); Railway or equivalent |
| P3 | Fingerprint <2s | Indexed query on (patient_id, loinc_code, collected_at) |
| P4 | Conversation Starter loads <3s post-auth | Pre-warm/cache critical path; cold LLM call on doctor click is a conversion failure |
| S2 | RLS at PostgreSQL layer | Every query path behind RLS policy; no bypass for operators |
| S4 | Audit log append-only, immutable | Separate append-only table; no UPDATE/DELETE permissions |
| S6 | DPA required before LLM receives patient data | LLM calls gated; provider selection is a launch blocker |
| S8 | Data in Brazil or EU regions | Infrastructure provider selection constrained; LGPD Art. 33 governs data egress |
| SC1 | Extraction pipeline horizontally scalable | Queue-based worker architecture (not in-process) |
| R2 | Retry with exponential backoff; 3 failures → manual review | Upload state machine with dead-letter contract required |
| R4 | RPO 1 hour | Point-in-time recovery on patient DB; shapes hosting choice |
| R5 | RTO 4 hours | DR strategy required; informs managed vs. self-hosted PostgreSQL decision |
| I3 | LLM failure does not block uploads | Letter generation decoupled from ingestion pipeline |

**Scale & Complexity:**

- **Primary domain:** Full-stack (mobile + web + backend API + AI pipeline)
- **Complexity level:** High
- **Estimated architectural subsystems:** 7 (API gateway, ingestion pipeline, LLM service, access control + entitlement layer, Fingerprint computation service, notification service, operator dashboard)

### Technical Constraints & Dependencies

**Mandated by PRD / product brief:**
- PostgreSQL with Row-Level Security — not negotiable; shapes every data model
- Expo (React Native) + Next.js + TypeScript — cross-platform monorepo
- pnpm + Turborepo — monorepo toolchain
- Tamagui — cross-platform design system; shared `@healthtracker/ui` package
- Node/TypeScript backend
- Persistent server for LLM streaming (serverless ruled out by PRD R-13)
- Railway cited as candidate hosting (PRD R-13)
- `collected_at` stored as DATE (not TIMESTAMPTZ) for lab draws — requires UTC-offset normalization step at ingestion boundary before DATE truncation; must be tested against DST boundary fixtures (São Paulo UTC-3/UTC-2 edge cases)
- Observation schema: `(patient_id, loinc_code, value_numeric, unit_ucum, collected_at, source_type, source_ref)` with index on `(patient_id, loinc_code, collected_at)`
- LOINC normalization failure path: schema decision required — is `loinc_code` nullable? Extraction confidence ≥ 0.85 does not guarantee LOINC resolution. Unresolvable LOINC must have a defined routing outcome (block / store with null / route to manual review)

**LLM Data Egress Boundary (architectural constraint, not just compliance):**

Two points where patient health data leaves the system boundary: (1) OCR/extraction pipeline, (2) Letter/Conversation Starter generation. Before provider selection, the architecture must define:
- Which fields are transmitted (raw OCR text vs. extracted fields only vs. anonymized/pseudonymized subset)
- Whether a Brazilian-hosted model is required or preferred (LGPD Art. 33)
- How the extraction prompt is structured to minimize PHI exposure

These decisions cascade into ingestion pipeline design and confidence gate design.

**Test-environment LLM carve-out:**
CI pipelines cannot send real patient health data to production LLM providers. Architecture must define: (a) a mock LLM contract or streaming stub for CI, (b) a synthetic data generation spec for extraction pipeline testing. Without this, extraction CI is blocked on DPA procurement from day one.

**Unresolved decisions — prioritized by blocking impact:**

| Priority | Decision | Blocks |
|----------|----------|--------|
| P0 | `professional_id` FK: FK to `users` or UUID in `pending_invites`? | Sharing token schema, all sharing stories |
| P0 | RLS token principal model: `current_setting` context var or dedicated token role? | All sharing DB tests |
| P1 | LOINC normalization failure path + nullable `loinc_code`? | Observation schema migration |
| P1 | Free vs. premium tier boundary for The Letter | Letter test fixture architecture, entitlement enforcement layer design |
| P1 | Entitlement enforcement layer: authoritative (DB/RLS) or advisory (app layer)? | Metering, monetization experiments |
| P2 | LGPD Art. 18 deletion vs. append-only audit log — ADR required | Deletion flow implementation |
| P2 | Lab format scope at MVP (Fleury-only vs. multi-lab) | Extraction engineering scope, pipeline extensibility contract |
| P2 | LLM data egress boundary (fields transmitted, region requirements) | Provider selection, prompt architecture |
| P3 | DR strategy (managed vs. self-hosted PostgreSQL, regional replication) | Hosting selection |
| P3 | LOINC versioning strategy in the data model | Schema evolution |

**External dependencies (launch blockers):**
- Signed DPA with LLM provider (LGPD Art. 11) before any patient data processed
- DPO appointed before public launch
- LGPD consent flows reviewed by counsel before data collection begins
- ANVISA framing reviewed before any AI output ships

### Cross-Cutting Concerns Identified

1. **Security & RLS** — PostgreSQL RLS policies apply to every table touched by patient data; operator views are anonymised at the query level. The sharing token path requires a dedicated token principal model (not user principal) — either a `current_setting`-based context variable or a dedicated PostgreSQL role. This must be designed before any sharing story is implemented; it is a DB migration dependency, not a feature flag.

2. **LGPD/ANVISA compliance** — explicit consent gating at ingestion; ANVISA framing enforced at the LLM prompt and output layer; DPA required for LLM. **Consent versioning** is required: when the LLM prompt or extraction methodology changes, the architecture must determine whether existing consent covers the new inference. The consent ledger is both a compliance requirement and a regulatory audit asset.

3. **Audit trail** — all access events (read, write, share, revoke) logged to an append-only table; write-only for application code. **LGPD Art. 18 deletion vs. append-only constraint is an unresolved tension** requiring an ADR: the audit log must retain the fact of deletion without retaining personal data (pseudonymization of patient_id or a deletion manifest table are candidate resolutions).

4. **LLM provider isolation** — The Letter generation is decoupled from the ingestion pipeline; LLM unavailability queues Letters, does not block uploads. **The streaming fallback contract must be specified**: does unavailability produce a cached narrative, an error state, or a skeleton response? The React Suspense error boundary has no spec without this. The fallback is an emotional design decision as much as a technical one — a buffered all-at-once response strips the intimacy of the streamed experience.

5. **Upload state machine** — `pending → processing → complete → failed` transitions govern confidence gate routing and retry logic. **Dead-letter contract is required**: max retry attempts, re-queue trigger, human escalation threshold. Without this, the manual review queue consumer spec is undefined. **Idempotency key** on the upload endpoint is required to prevent duplicate extractions from mobile offline-retry behaviour.

6. **Access token lifecycle** — signed, scoped, time-limited tokens for doctor sharing; revocation must propagate immediately (not eventually consistent). Token principal model in RLS is the P0 unresolved decision blocking all sharing work. The token encodes the patient's per-biomarker sharing ceremony — if the RLS layer doesn't resolve the correct data scope on first render, the 90-second doctor conversion window closes on a blank screen.

7. **Extraction confidence gate** — per-field scoring (not per-document); <0.85 routes to manual review queue; 0 (total failure) has a separate UX path. Threshold sensitivity analysis required: the 0.85 value must be validated against NFR-P1 (100 concurrent jobs) across the 0.80–0.90 band. A golden dataset fixture (200–500 representative PDFs with known ground-truth LOINC values) is required as a CI accuracy regression gate.

8. **Streaming infrastructure** — React Suspense + Server Components for The Letter on Next.js; `aria-live="polite"` on streaming region; persistent server required. A streaming stub/simulator replaying pre-recorded token streams at configurable rates is required for CI. Time-to-first-token must be instrumented as a first-class metric in every test environment.

9. **LLM data egress boundary** — two patient data egress points (extraction, Letter generation) governed by LGPD Art. 33. Field-level decisions on what is transmitted (raw OCR vs. extracted fields vs. pseudonymized subset) cascade into pipeline design, prompt architecture, and provider selection. This is an architectural constraint, not a compliance checkbox. The egress boundary must be surfaceable in the Access Log in language the patient can understand.

10. **Entitlement enforcement** — free vs. premium tier boundaries, Letter metering, and future monetization experiments all depend on an authoritative entitlement layer. Application-layer-only enforcement creates two failure modes: feature leakage (revenue loss) and incorrect blocking (trust erosion before conversion). Architecture must decide whether entitlement is enforced at the data layer (RLS / entitlements table) or advisory (app layer check).

11. **Doctor Acquisition Loop latency** — the 90-second conversion window for the Conversation Starter is a business-critical architectural constraint, not a UX preference. The rendering path must be pre-warmed or cached. The trigger for pre-generating the doctor's report should be the moment the patient creates the sharing token — before the doctor taps the link. A cold LLM call at tap time is a conversion failure before the product has been seen.

12. **LOINC schema versioning** — LOINC releases updates; biomarker definitions change. Historical records encoded against one LOINC version must remain queryable across schema migrations. A versioning strategy must be embedded in the data model from day one.

### Testability Architecture Requirements

The following must be designed into the architecture, not retrofitted:

- **RLS adversarial test harness**: tenant-isolated test schemas per-test-run; every API endpoint tested against a matrix of identity types (correct patient, wrong patient, doctor with/without access, expired token, revoked token)
- **Extraction golden dataset**: 200–500 representative PDFs with ground-truth LOINC values as a CI accuracy regression gate
- **Audit log tamper-evidence contract**: assert row count, hash continuity, and absence of UPDATE/DELETE after every relevant operation
- **Streaming CI stub**: pre-recorded token stream simulator for NFR-P2 testing without live LLM calls
- **Upload state machine transition spec**: explicit state diagram as test specification; every arc is a test case
- **Consumer-driven contract tests (Pact)**: between the extraction pipeline and each LLM provider adapter; between mobile/web and backend API (especially sharing token endpoints)

### Recommended Decision Sequence (Days 1–10)

Sequential chain (strictly ordered — each unblocks the next):
1. RLS token principal model ADR → unblocks all sharing work
2. `professional_id` FK schema (`pending_invites` with nullable `resolved_user_id`)
3. Entitlement enforcement layer: authoritative vs. advisory
4. RLS policy contract tests (Pact at DB boundary)

Parallelizable Track A — Ingestion (no RLS dependency):
- `collected_at` UTC normalization guard at ingestion boundary
- Idempotency key on upload endpoint
- Upload state machine dead-letter contract

Parallelizable Track B — LLM/Streaming (no RLS, no schema dependency):
- LLM CI mock carve-out (gate for rest of Track B)
- LOINC normalization failure path + nullable decision
- Streaming fallback contract spec
- Pact contracts for LLM provider adapters

Start in parallel, legal dependency — do not block engineering behind it:
- LGPD Art. 18 deletion vs. append-only ADR (requires legal/DPA input; timebox 5 business days)

## Starter Template Evaluation

### Context

Concept 1 validation (The Letter) is confirmed passed. The full stack is in
scope from day one.

### Primary Technology Domain

Full-stack cross-platform monorepo — mobile (Expo), web (Next.js), backend API
(Node/TypeScript), AI extraction pipeline, PostgreSQL with RLS.

### Stack Mandated by PRD/UX Spec

The following decisions are pre-committed and not open for re-evaluation:

- **Monorepo toolchain:** pnpm + Turborepo
- **Mobile:** Expo (React Native) — iOS 16+ / Android 13+
- **Web:** Next.js (App Router, Server Components, streaming)
- **Language:** TypeScript throughout
- **Database:** PostgreSQL with Row-Level Security (non-negotiable, NFR-S2)
- **Design system:** Tamagui (cross-platform; `@healthtracker/ui` shared package)
- **LLM server:** Persistent server; Railway cited as candidate (PRD R-13)

### Starter Options Evaluated

| Option | Stars | Next.js | Expo | pnpm | RLS | Status |
|--------|-------|---------|------|------|-----|--------|
| create-t3-turbo | 5,600+ | 15 | SDK 54 | ✅ | Via Supabase | Active |
| turbo-expo-nextjs-clerk-convex | Community | 16 | SDK 55 | ✅ | No | Active |
| create-turbo-with-expo (Marknjo) | Community | 13+ | — | ✅ | No | Stale (Jan 2024) |

### Selected Foundation: create-t3-turbo (with modifications)

**Rationale:** Most actively maintained Expo + Next.js + Turborepo + pnpm
starter. Ships Next.js 15, Expo SDK 54, React 19, tRPC v11, Drizzle ORM,
Supabase, Better Auth. Primary delta from the starter: Tailwind/shadcn-ui
replaced with Tamagui; Better Auth re-evaluated against Supabase Auth (see
open decision below).

**Supabase alignment:** Supabase is PostgreSQL with RLS as its core value
proposition — not an add-on. AWS São Paulo region satisfies NFR-S8 (Brazil
data residency). Built-in point-in-time recovery satisfies NFR-R4 (RPO 1
hour). Magic link auth directly supports doctor Conversation Starter
registration (FR-26).

**Initialization Command:**

```bash
npx create-turbo@latest -e https://github.com/t3-oss/create-t3-turbo \
  --package-manager pnpm
```

### Architectural Decisions Provided by Starter

**Language & Runtime:**
TypeScript strict mode throughout; shared `@healthtracker/tsconfig` package.
React 19 on both Expo and Next.js.

**Styling Solution:**
Starter ships Tailwind CSS v4 + shadcn-ui. **First post-init step: remove
Tailwind/shadcn-ui, install and configure Tamagui.** Token definitions from
the UX spec colour and typography system seeded in
`packages/ui/tamagui.config.ts`. Rationale: Tamagui compiles to optimised
native and web output from a single component definition — no style
duplication between Expo and Next.js.

**Build Tooling:**
Turborepo task graph for parallel builds; pnpm workspaces. Expo Metro bundler
for native; Next.js Turbopack for web. `metro.config.js` must set
`config.resolver.unstable_enablePackageExports = true` for Tamagui's package
exports map to resolve correctly; without it the CJS bundle is used (2x
larger, breaks tree-shaking for web tokens).

**API Layer:**
tRPC v11 — end-to-end type safety between Next.js server and Expo client.
Shared types in `packages/api`. **Audit middleware required:** tRPC has no
built-in HTTP-verb semantics for LGPD access log compliance; a tRPC middleware
layer must record actor, resource, and operation for every resolver that
touches patient health data.

**LLM Streaming Transport Boundary:**
tRPC v11 streaming subscriptions require a persistent connection. Vercel Edge
Runtime caps long-lived HTTP streams at ~25s. The LLM server on Railway must
expose its own SSE/WebSocket endpoint consumed directly by the client — not
proxied through tRPC. tRPC handles upload trigger and status polling; streaming
transport is a separate concern. This boundary must be documented in
`packages/api/src/router/index.ts` before any LLM wiring begins.

**Database & ORM:**
Drizzle ORM on Supabase PostgreSQL. RLS policies are written as raw SQL in
Drizzle migration files via `db.execute(sql\`...\`)` — Drizzle does not model
RLS natively. A `drizzle.config.ts` guard and CI `drizzle-kit check` gate are
required to prevent schema regeneration from silently dropping RLS policies.

**RLS token principal model (open decision, P0):**
`current_setting('app.current_patient_id')` approach requires a `SET LOCAL`
call at the start of every transaction in the tRPC context initializer.
**Critical constraint:** Supabase's default pooler is PgBouncer in transaction
mode — `SET LOCAL` does not survive pool hops in this mode. If the
`current_setting` approach is chosen, Supabase's session-mode pooler or
direct connections must be used for authenticated requests. The dedicated
token role approach avoids this but requires more complex policy definitions.
This decision must be made and documented in an ADR before any RLS migration
is written.

**Authentication:**
create-t3-turbo ships Better Auth. Open decision: Supabase Auth is already in
the stack, provides magic links, and `auth.uid()` integrates natively with
RLS policies. Better Auth provides more flexibility for custom sharing token
claims. **Resolution required before sprint 1:** evaluate whether sharing
token requirements can be met with Supabase Auth custom claims. If yes,
remove Better Auth and reduce stack surface area. If no, document why Better
Auth is required.

**Code Organization:**

```
apps/
  expo/           — React Native patient app
  next/           — Next.js web (patient + doctor Conversation Starter)
packages/
  ui/             — @healthtracker/ui (Tamagui components)
  api/            — tRPC router definitions + audit middleware
  types/          — Shared TypeScript types, LOINC definitions, LLM adapter interface
  db/             — Drizzle schema, migrations, RLS policies (raw SQL)
  auth/           — Auth configuration (Better Auth or Supabase Auth — TBD)
  config/         — Shared ESLint, TypeScript, Prettier configs
services/
  extraction/     — AI extraction pipeline worker (queue consumer)
  llm/            — LLM service (Letter generation, Conversation Starter, SSE endpoint)
```

**Testing Framework:**
Not included in starter — to be configured in sprint 0: Vitest
(unit/integration), Playwright (web E2E), Detox or Maestro (Expo E2E), Pact
(consumer-driven contract tests for LLM adapters and API consumers), RLS
adversarial test harness (per testability requirements from Step 2).
CI matrix must include both Next.js build and Expo export build — not just
`tsc --noEmit`.

### Open Decisions Required Before Sprint 1

**AUTH-01:** Better Auth vs. Supabase Auth — evaluate sharing token custom
claims requirements. Supabase Auth preferred if requirements can be met;
eliminates one dependency and provides native `auth.uid()` RLS integration.

**LGPD-RAILWAY:** Railway is US infrastructure. LLM request payloads contain
patient health document content. Legal review required: does document content
need to be stripped to anonymized/extracted fields only before leaving the
Supabase São Paulo region? Answer shapes how the extraction pipeline structures
its LLM prompts and whether a field-extraction pre-processing step is required
before the Railway boundary.

### Sprint 0 Non-Negotiables (Schema & Infrastructure)

The following must be in place before sprint 1 data enters the schema — each
becomes exponentially more expensive to retrofit:

1. `drizzle.config.ts` custom migration protection + CI `drizzle-kit check` gate
2. RLS token principal model ADR (`current_setting` + session pooler vs. dedicated role)
3. tRPC/LLM streaming transport boundary documented in router
4. `metro.config.js` + `next.config.ts` Tamagui integration smoke-tested on both platforms
5. `uploads` table schema: `idempotency_key UNIQUE`, `processing_started_at`, state enum
6. `packages/types/src/llm.ts` LLM adapter interface defined (gates Pact contract tests)
7. LGPD-Railway legal review initiated (timebox: before any patient data sent to LLM)
8. CI matrix: Next.js build + Expo export + Pact provider verification

**Note:** Project initialization and sprint 0 setup constitute the first two
implementation stories. No feature stories begin until sprint 0 non-negotiables
are green.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- RLS token principal model: `current_setting` + session-mode pooler
- `professional_id` FK: `pending_invites` with nullable `resolved_user_id`
- Auth library: Supabase Auth (Better Auth removed)
- Sharing token structure: opaque tokens in DB (`share_tokens` table)
- Extraction queue: pg-boss (Postgres-backed, on Supabase)

**Important Decisions (Shape Architecture):**
- Entitlement enforcement: app layer (tRPC middleware reads `subscription_tier`)
- LLM provider: Anthropic Claude Sonnet
- OCR service: AWS Textract (São Paulo region)
- State management: tRPC + TanStack Query + Zustand (offline/local state)
- Fingerprint chart: Victory Native
- CI/CD: GitHub Actions + Turborepo remote cache
- Monitoring: Sentry (PII-scrubbed) + Axiom (server logs)

**Deferred Decisions (Post-MVP):**
- LOINC versioning strategy (schema evolution — not blocking MVP)
- DR failover to secondary region (RPO/RTO met by Supabase PITR for MVP)
- tRPC → REST migration (revisit only if complexity justifies)
- Victory Native → Skia upgrade (revisit if Fingerprint animation performance requires it)

### Data Architecture

**RLS Token Principal Model**
- Decision: `current_setting` approach — `SET LOCAL app.current_patient_id`
  at the start of every authenticated transaction
- Rationale: Simpler RLS policy SQL, readable and reviewable. Supabase
  session-mode pooler (not transaction-mode PgBouncer) required for
  authenticated requests. Direct connections used for extraction worker
  processes.
- Affects: every tRPC context initializer, all RLS policy definitions,
  Supabase pooler configuration

**`professional_id` FK Resolution**
- Decision: `pending_invites` table with nullable `resolved_user_id` (UUID)
- Rationale: Doctor Acquisition Loop requires sharing tokens to be created
  before a doctor has a Health Tracker account. Token references the invite
  record; `resolved_user_id` populated on first magic link authentication.
- Affects: `share_tokens` schema, doctor authentication flow (FR-26, FR-29),
  pending_invites migration

**Entitlement Enforcement**
- Decision: App layer — tRPC middleware reads `users.subscription_tier`
  and enforces feature gates before resolvers execute
- Rationale: Simpler to implement and iterate on for MVP. Acceptable risk
  given team size and launch timeline.
- Cascading implication: `users` table requires `subscription_tier` column
  (`free` | `premium`). All entitlement logic in a single tRPC middleware at
  `packages/api/src/middleware/entitlements.ts`. Premium feature tests must
  seed users with the correct tier.
- Future migration path: promote to DB-layer enforcement if feature leakage
  occurs post-launch, without breaking API contracts.
- Affects: FR-17 (Letter), FR-21 (sharing), FR-23 (Conversation Starter),
  FR-24 (Access Log), all premium features

**Extraction Queue**
- Decision: pg-boss (Postgres-backed job queue, runs on Supabase)
- Rationale: No additional infrastructure. Queue durability backed by
  Supabase Postgres WAL. Dead-letter support built in. Horizontal scaling
  via multiple worker processes. Simpler operational model for a 4-person team.
- Queue jobs: `extract_document`, `normalize_loinc`, `generate_letter`,
  `generate_conversation_starter`
- Dead-letter contract: max 3 attempts with exponential backoff; on 3rd
  failure, dead-letter queue entry created and patient notified (NFR-R2).
  Stuck-job recovery: worker queries `processing_started_at < NOW() -
  INTERVAL '10 minutes'` and transitions to `failed`.
- Affects: `services/extraction`, upload state machine schema,
  `processing_started_at` on `uploads` table

**Caching Strategy (Conversation Starter pre-warming)**
- Decision: Pre-generate Conversation Starter at share-token-creation time;
  cache in `conversation_starter_cache` table
  `(patient_id, share_token_id, generated_at, payload JSONB, expires_at)`
- Rationale: Doctor Acquisition Loop latency constraint (concern #11).
  <3s post-auth load (NFR-P4). Cold LLM generation at doctor tap time is
  a conversion failure. Triggered by `create_share_token` tRPC mutation.
- Cache invalidation: new draw uploaded → invalidate and regenerate for all
  active share tokens for that patient.
- Affects: FR-23, FR-27, FR-28, pg-boss job `generate_conversation_starter`

### Authentication & Security

**Auth Library**
- Decision: Supabase Auth (Better Auth removed in post-init cleanup)
- Rationale: `auth.uid()` integrates natively with Supabase RLS. Magic
  links supported out of the box (FR-26). Auth events logged to Postgres.
  Eliminates one stack dependency.
- Biometric auth (FR-43): `expo-local-authentication` as local session guard.
  Biometric unlocks the app; Supabase Auth manages the server-side session.
- Affects: FR-42, FR-43, FR-26, all authenticated flows

**Sharing Token Structure**
- Decision: Opaque tokens in DB — `share_tokens` table:
  `(id UUID PK, token_hash TEXT UNIQUE, patient_id UUID FK, invite_id UUID FK,
  biomarker_scope JSONB, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ)`
- Token value: random UUID signed with HMAC-SHA256 (server secret). Hash
  stored in DB only.
- Rationale: Immediate revocation is authoritative — set `revoked_at`, done.
  RLS policy: `revoked_at IS NULL AND expires_at > NOW()`. Immutable audit
  log records every token check. JWTs require a blocklist for immediate
  revocation, negating the stateless benefit.
- Affects: FR-22, FR-23, FR-24, FR-25, NFR-S3

### API & Communication Patterns

**LLM Provider**
- Decision: Anthropic Claude Sonnet (Letter generation, Conversation Starter);
  Claude Haiku for lower-latency extraction classification tasks
- Rationale: Strong narrative generation, structured extraction, LGPD-
  compatible DPA, no training on customer data.
- Launch blocker: DPA must be signed before `services/llm` processes any
  patient data in production (NFR-S6). LGPD-Railway legal review must confirm
  extracted-field-only payload satisfies Art. 33.
- Affects: `services/llm`, `services/extraction`, NFR-P2, NFR-P1

**OCR Service**
- Decision: AWS Textract (AWS São Paulo region, `sa-east-1`)
- Rationale: OCR processing stays within Brazil — cleanest LGPD Art. 33
  compliance path. Strong structured document support for Brazilian lab
  report formats. DPA available.
- Affects: `services/extraction`, FR-1, FR-2, FR-3, NFR-I1, NFR-I2, NFR-S8

**Error Handling Standards**
- Decision: tRPC error codes mapped to a Health Tracker error taxonomy.
  Client-facing errors in plain Brazilian Portuguese (pt-BR), never technical
  codes. Internal errors logged to Axiom with correlation IDs. Central error
  handler at `packages/api/src/errors.ts`.
- Health-specific: extraction errors and low-confidence flags are never
  surfaced as "errors" to the patient — they use the amber signal pattern
  from the UX spec (ExtractionPulse review-needed state).

### Frontend Architecture

**State Management**
- Decision: tRPC + TanStack Query (server state); Zustand (local/offline
  state — upload queue, cached Fingerprint)
- Upload queue store: `useUploadQueueStore` in
  `apps/expo/src/stores/upload-queue.ts`. Persisted to AsyncStorage via
  `zustand/middleware`. Retries on connectivity restore via NetInfo listener.
- Affects: FR-8 (offline upload queue), FR-16 (cached Fingerprint)

**Fingerprint Chart Library**
- Decision: Victory Native (MVP); upgrade path to `@shopify/react-native-skia`
  post-MVP if animation performance requires it
- Custom component: `FingerprintChart` in `packages/ui` wraps Victory Native
  with baseline band, deviation markers, and personal baseline shading per
  the UX spec. All cold-start and baseline-established states handled.
- Affects: FR-13, FingerprintChart component all variants

### Infrastructure & Deployment

**CI/CD Pipeline**
- Decision: GitHub Actions — Turborepo remote cache, Supabase CLI for DB
  migrations, EAS Build for Expo, Vercel/Railway deploy hooks for Next.js
  and LLM service
- Pipeline stages: lint → typecheck → unit tests → integration tests
  (Supabase local) → Pact contract verification → build → deploy (staging
  on merge to main; production on release tag)
- RLS adversarial test matrix runs on every PR against Supabase local
  (`supabase start`)
- Affects: all packages and services, testability architecture requirements

**Monitoring & Error Tracking**
- Decision: Sentry (Expo + Next.js SDKs) for error tracking; Axiom for
  structured server-side logs
- PII scrubbing (launch blocker, NFR-S5): Sentry `beforeSend` hook strips
  all biomarker values, patient_id, LOINC codes, and personal identifiers.
  Config at `packages/config/src/sentry.ts`. Must be verified before
  production launch — no raw health data in Sentry.
- Axiom log policy: correlation IDs only; no biomarker values in log
  messages; patient_id logged as hashed value only.
- Affects: NFR-S5, all services, launch readiness checklist

### Decision Impact Analysis

**Implementation Sequence (dependency order):**
1. Supabase project init + session-mode pooler config + RLS token model ADR
2. Drizzle schema: `users` (with `subscription_tier`), `pending_invites`,
   `share_tokens`, `uploads` (with `idempotency_key`, `processing_started_at`)
3. Supabase Auth configuration (magic link + email providers)
4. pg-boss queue setup on Supabase + extraction worker skeleton
5. AWS Textract integration in `services/extraction`
6. Anthropic Claude integration in `services/llm` (behind LLM adapter interface)
7. tRPC router + audit middleware + entitlement middleware
8. Tamagui configuration + base component library (`packages/ui`)
9. Expo patient app shell + upload flow
10. Next.js doctor Conversation Starter shell

**Cross-Component Dependencies:**
- Supabase Auth `auth.uid()` → RLS policies on all patient data tables
- `pending_invites.resolved_user_id` → share token RLS → doctor view
- pg-boss queue → extraction worker → `uploads` state machine → patient
  notification
- `conversation_starter_cache` → pre-warmed at share token creation →
  doctor 90-second conversion window
- Sentry PII scrubbing config → must be in place before any patient data
  enters production

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 14 areas where AI agents could make
different choices without explicit rules — covering naming, structure, format,
communication, and process patterns.

---

### Naming Patterns

**Database Naming Conventions:**

| Element | Convention | Example |
|---------|-----------|---------|
| Table names | `snake_case`, plural | `health_observations`, `share_tokens`, `pending_invites` |
| Column names | `snake_case` | `patient_id`, `loinc_code`, `collected_at`, `created_at` |
| Foreign keys | `{referenced_table_singular}_id` | `patient_id`, `invite_id`, `upload_id` |
| Indexes | `idx_{table}_{column(s)}` | `idx_health_observations_patient_loinc_date` |
| Enum types | `snake_case` | `upload_status`, `subscription_tier` |
| Enum values | `snake_case` | `pending`, `processing`, `complete`, `failed` |
| pg-boss job names | `snake_case` dot-namespaced | `extraction.process_document`, `letter.generate`, `conversation_starter.generate` |

**TypeScript / Code Naming Conventions:**

| Element | Convention | Example |
|---------|-----------|---------|
| Variables / parameters | `camelCase` | `patientId`, `loincCode`, `collectedAt` |
| Functions | `camelCase` | `getObservations`, `createShareToken` |
| React components | `PascalCase` | `FingerprintChart`, `LetterViewer`, `UploadCard` |
| TypeScript interfaces | `PascalCase`, no `I` prefix | `HealthObservation`, `ShareToken`, `UploadJob` |
| TypeScript enums | `PascalCase` values | `UploadStatus.Pending`, `SubscriptionTier.Free` |
| tRPC routers | `camelCase` | `observationsRouter`, `sharingRouter` |
| tRPC procedures | `camelCase` | `getByPatient`, `createShareToken`, `revokeToken` |
| Zustand stores | `use{Name}Store` | `useUploadQueueStore`, `useFingerprintCacheStore` |
| Tamagui tokens | `$colorName`, `$fontSize` etc. | `$primaryBlue`, `$textMd`, `$space4` |

**Audit Event Naming:**

Audit events use `noun.verb` dot notation, always past tense:
```
observation.read          share_token.created       share_token.revoked
document.uploaded         letter.generated          conversation_starter.generated
access.granted            access.denied
```

---

### Structure Patterns

**Package Responsibility Boundaries:**

| Package / Service | Owns | Must NOT contain |
|------------------|------|------------------|
| `packages/db` | Drizzle schema, migrations, RLS policy SQL, DB client | Business logic, HTTP handlers |
| `packages/api` | tRPC routers, middleware (audit, auth, entitlement) | DB schema definitions, UI components |
| `packages/types` | Shared TS types, LOINC definitions, LLM adapter interface | Runtime logic, DB queries |
| `packages/ui` | Tamagui components, tokens, theme config | App-specific state, API calls |
| `packages/config` | ESLint, TypeScript, Prettier, Sentry configs | App code |
| `apps/expo` | Mobile screens, navigation, Expo-specific integrations | Shared business logic that belongs in `packages/` |
| `apps/next` | Web pages (App Router), server components, Next.js config | Mobile-specific code |
| `services/extraction` | OCR→LLM extraction pipeline, pg-boss consumers | HTTP API serving, direct DB writes outside of extraction domain |
| `services/llm` | Letter/Conversation Starter generation, SSE endpoint | Extraction logic, direct DB writes outside of llm domain |

**Test Co-location:**

- Unit tests: co-located with source as `{filename}.test.ts`
- Integration tests: `__tests__/integration/` at package root
- RLS adversarial tests: `packages/db/__tests__/rls/` (one file per table)
- E2E tests: `apps/expo/__tests__/e2e/` and `apps/next/__tests__/e2e/`
- Pact contract tests: `packages/api/__tests__/pact/` (consumer) and `services/llm/__tests__/pact/` (provider)
- Golden dataset fixtures: `services/extraction/__tests__/fixtures/golden/`

**Drizzle Schema Organization:**

```
packages/db/src/
  schema/
    users.ts          — users, auth-related
    observations.ts   — health_observations, loinc_ref
    uploads.ts        — uploads, upload_status enum
    sharing.ts        — share_tokens, pending_invites, conversation_starter_cache
    audit.ts          — audit_log (append-only)
    queue.ts          — pg-boss job type helpers (not schema, just TS types)
  migrations/
    YYYYMMDD_HHMMSS_{description}.sql
  policies/           — RLS policy SQL files (referenced by migrations, prefixed custom_)
    custom_rls_observations.sql
    custom_rls_share_tokens.sql
    custom_rls_audit_log.sql
  seed/
    loinc_ref.ts      — LOINC reference data seed
```

Rule: every file in `policies/` is prefixed `custom_` so `drizzle-kit` check
distinguishes hand-authored policy SQL from generated migration SQL and does
not drop it on schema regeneration.

---

### Format Patterns

**tRPC Response Shape:**

All tRPC procedures return typed data directly — no wrapper envelope. Errors
use tRPC's native `TRPCError` with a Health Tracker error code in the `code`
field:

```typescript
// ✅ Correct
return { observations, total, nextCursor }

// ❌ Wrong — no wrapper objects
return { success: true, data: { observations } }
```

**Health Tracker Error Taxonomy:**

| tRPC code | Health Tracker meaning | Client message (pt-BR) |
|-----------|----------------------|----------------------|
| `UNAUTHORIZED` | Unauthenticated | "Faça login para continuar." |
| `FORBIDDEN` | Token revoked / expired / wrong scope | "Acesso negado ou expirado." |
| `NOT_FOUND` | Resource does not exist | "Não encontrado." |
| `PRECONDITION_FAILED` | Entitlement gate (free tier limit) | "Recurso disponível no plano premium." |
| `UNPROCESSABLE_CONTENT` | Validation failure | Field-specific message from Zod |
| `INTERNAL_SERVER_ERROR` | Unexpected server error | "Algo deu errado. Tente novamente." |

Extraction failures and low-confidence flags are **never** surfaced as errors
— they use the amber signal ExtractionPulse state in the UI.

**Date / Time Formats:**

| Context | Format | Rule |
|---------|--------|------|
| API JSON (non-date fields) | ISO 8601 string | `"2026-05-14T14:30:00Z"` |
| `collected_at` in API | ISO 8601 date string | `"2026-05-14"` — DATE only, no time |
| `collected_at` at ingestion | UTC-offset normalization | Extract from document in São Paulo local time (UTC-3/UTC-2), normalize to DATE before DB write. Must be tested against DST fixtures. |
| `created_at` / `updated_at` | ISO 8601 with UTC Z | Always UTC; never local time |
| UI display | `dd/MM/yyyy` | Brazilian date format, via `Intl.DateTimeFormat` |

**Canonical Observation Schema (DB + API):**

```typescript
interface HealthObservation {
  id: string                  // UUID
  patientId: string           // UUID
  loincCode: string | null    // null = unresolved; routes to manual review
  loincDisplay: string | null // human-readable LOINC name
  valueNumeric: number | null
  valueText: string | null    // for non-numeric results
  unitUcum: string | null     // UCUM unit code
  collectedAt: string         // DATE string "YYYY-MM-DD"
  sourceType: 'uploaded_document' | 'manual_entry'
  sourceRef: string | null    // upload_id or manual entry ref
  extractionConfidence: number | null  // 0.0–1.0; null for manual entries
  createdAt: string           // ISO 8601 UTC
}
```

---

### Communication Patterns

**pg-boss Job Payload Envelope:**

All pg-boss jobs use this envelope — never pass raw IDs or bare data:

```typescript
interface JobPayload<T> {
  jobId: string        // pg-boss job id (for idempotency checks)
  patientId: string    // always included for RLS context in worker
  correlationId: string // links to upload / share token / trigger event
  payload: T
  createdAt: string    // ISO 8601 UTC
}

// Example: extract_document job
interface ExtractDocumentPayload {
  uploadId: string
  storagePath: string
  idempotencyKey: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
}
```

**Push Notification Payload:**

```typescript
interface PushNotification {
  to: string           // Expo push token
  title: string        // pt-BR, max 50 chars
  body: string         // pt-BR, max 100 chars
  data: {
    type: 'upload_complete' | 'upload_failed' | 'letter_ready' | 'share_accepted'
    resourceId: string // uploadId / letterId / shareTokenId
  }
}
```

**LLM System Prompt Enforcement (ANVISA RDC 657/2022):**

Every LLM call that generates patient-facing content MUST include this
instruction in the system prompt — enforced at `services/llm/src/prompts/`:

```
All clinical observations are informational only. Where relevant, frame findings
as: "pode valer a pena discutir com um [tipo de especialista]" (it may be worth
discussing with a [specialist type]). Never state, imply, or suggest a diagnosis.
Never recommend specific medications, doses, or treatments.
```

This framing must survive post-processing — output sanitization must not strip
these qualifiers.

**SSE Streaming Pattern (Letter / Conversation Starter):**

```typescript
// services/llm/src/routes/letter-stream.ts
// Direct SSE endpoint — NOT proxied through tRPC
// Client connects here: GET /api/stream/letter/:letterId

// Event format:
// data: {"type":"token","content":"..."}\n\n
// data: {"type":"done","letterId":"..."}\n\n
// data: {"type":"error","code":"LETTER_UNAVAILABLE"}\n\n

// Fallback contract: if LLM unavailable, emit buffered cached response
// if exists, else emit {"type":"error","code":"LETTER_UNAVAILABLE"}
// Client renders skeleton + retry CTA — not an app-level error boundary
```

**RLS `SET LOCAL` Pattern:**

Every tRPC context initializer that serves authenticated requests must:

```typescript
// packages/api/src/trpc.ts — createTRPCContext
await db.execute(sql`SET LOCAL app.current_patient_id = ${session.user.id}`)
await db.execute(sql`SET LOCAL app.current_user_role = ${session.user.role}`)
// Must use session-mode pooler (not transaction-mode PgBouncer) — see ADR
```

Never call `SET` (session-scoped) in a pooled connection; always `SET LOCAL`
(transaction-scoped). Doctor sharing token requests set
`app.current_share_token_id` instead of `app.current_patient_id`.

---

### Process Patterns

**Upload State Machine — Canonical Transitions:**

```
pending ──► processing ──► complete
   │              │
   │        (confidence < 0.85 OR loinc_unresolvable)
   │              │
   │         needs_review ──► confirmed ──► complete
   │
   └──► failed (max retries exceeded → dead-letter)
```

Rules:
- Only the extraction worker may write `processing`, `needs_review`, `complete`
- Only a patient action may write `confirmed`
- Only pg-boss dead-letter handler may write `failed`
- No other code path may transition upload status
- Every transition must write an `audit_log` entry

**Entitlement Gate Pattern (`premiumProcedure`):**

```typescript
// packages/api/src/middleware/entitlements.ts
export const premiumProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.subscriptionTier !== 'premium') {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PREMIUM_REQUIRED' })
  }
  return next()
})

// Usage — not protectedProcedure, always premiumProcedure for premium features:
export const letterRouter = createTRPCRouter({
  generate: premiumProcedure.input(...).mutation(...)
})
```

**Audit Log Write Pattern:**

All audit log writes go through a single function — never inline `db.insert`:

```typescript
// packages/api/src/audit.ts
await writeAuditLog(ctx.db, {
  actorId: ctx.session.user.id,
  actorType: 'patient' | 'doctor' | 'system',
  event: 'observation.read',
  resourceId: observationId,
  resourceType: 'health_observation',
  metadata: { loincCode, shareTokenId: ctx.shareTokenId ?? null }
})
```

The `audit_log` table has no UPDATE or DELETE grants for the application role.
Any attempt to update or delete audit rows must fail at the DB layer (enforced
by RLS + role grants).

---

### Display Patterns (Tamagui + Health Data)

**Tamagui Token Usage Rules:**

- Colors: always use semantic tokens (`$primaryBlue`, `$warningAmber`,
  `$successGreen`, `$textPrimary`) — never hardcode hex values in component
  props or styles
- Typography: always use `$fontSize*` and `$fontWeight*` tokens — never
  numeric values
- Spacing: always use `$space*` tokens — never raw pixel values
- All components must accept and forward Tamagui `ComponentProps` — no style
  prop drilling

**Biomarker Display Rules:**

- Deviation from personal baseline: use amber (`$warningAmber`) for outside
  normal range — **NEVER red**. Red implies emergency; amber signals
  "worth reviewing"
- Personal baseline band: render as a shaded region on FingerprintChart, not
  a single line
- Extraction confidence display: show confidence badge only on
  `needs_review` state; never show raw confidence numbers to patients
- LOINC display name: always show `loinc_display` (human name) — never the
  raw LOINC code in patient-facing UI

**Accessibility Requirements:**

- All interactive elements: minimum 44×44pt touch target
- Streaming text regions: `aria-live="polite"` on Letter / Conversation
  Starter streaming containers
- Color-only state indication is prohibited: every color-coded state must also
  have a text label or icon
- FingerprintChart: must have accessible description via `accessibilityLabel`
  summarizing the biomarker trend

---

### Enforcement Guidelines

**All AI Agents MUST:**

1. Use `snake_case` for all database identifiers; `camelCase` for all
   TypeScript identifiers
2. Route all audit log writes through `writeAuditLog()` in
   `packages/api/src/audit.ts` — never inline
3. Gate all premium features through `premiumProcedure` — never
   `protectedProcedure` with an inline tier check
4. Use `SET LOCAL` (never `SET`) for RLS context variables in tRPC context
5. Include the ANVISA system prompt instruction in every patient-facing LLM
   call
6. Never surface extraction confidence numbers or LOINC codes in patient-
   facing UI
7. Never use hardcoded hex colors or pixel values in Tamagui components —
   always semantic tokens
8. Name pg-boss jobs in `domain.action` dot notation with `snake_case`
9. Prefix all RLS policy SQL files with `custom_` in `packages/db/policies/`
10. Never show red color for biomarker deviations — always amber

**Pattern Enforcement:**

- ESLint custom rule: prohibit `db.execute(sql\`SET ...)` outside of
  `packages/api/src/trpc.ts`
- ESLint custom rule: prohibit inline `db.insert` into `audit_log` table
  outside of `packages/api/src/audit.ts`
- CI gate: `drizzle-kit check` must pass on every PR; failure blocks merge
- PR checklist item: "Does this PR introduce a new patient-facing LLM output?
  → ANVISA framing verified?"
- PR checklist item: "Does this PR add a premium feature? →
  `premiumProcedure` used?"

**Good Examples:**

```typescript
// ✅ Correct: SET LOCAL for RLS context
await db.execute(sql`SET LOCAL app.current_patient_id = ${userId}`)

// ✅ Correct: premiumProcedure for gated features
export const generateLetter = premiumProcedure.mutation(async ({ ctx }) => { ... })

// ✅ Correct: audit log via helper
await writeAuditLog(ctx.db, { event: 'observation.read', ... })

// ✅ Correct: Tamagui semantic tokens
<Text color="$warningAmber" fontSize="$textMd">Requer revisão</Text>
```

**Anti-Patterns:**

```typescript
// ❌ SET (session-scoped) in pooled connection — leaks across pool hops
await db.execute(sql`SET app.current_patient_id = ${userId}`)

// ❌ Inline entitlement check — bypasses premiumProcedure audit trail
protectedProcedure.mutation(({ ctx }) => {
  if (ctx.user.tier !== 'premium') throw new Error('premium required')
})

// ❌ Direct audit_log insert — bypasses writeAuditLog helper
await ctx.db.insert(auditLog).values({ ... })

// ❌ Hardcoded color — breaks theme, inaccessible
<Text style={{ color: '#FF0000' }}>Atenção</Text>

// ❌ Red for biomarker deviation — violates ANVISA framing intent
<DeviationBadge color="red" />
```

## Project Structure & Boundaries

### Complete Project Directory Structure

```
healthtracker/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    — lint → typecheck → unit → integration → pact → build
│   │   ├── deploy-staging.yml        — merge to main → staging deploy
│   │   └── deploy-production.yml     — release tag → production deploy
│   └── pull_request_template.md      — checklist: ANVISA framing, premiumProcedure, PII scrubbing
├── .env.example
├── package.json                      — pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json                        — Turborepo task graph
├── tsconfig.json                     — root tsconfig (references all packages)
│
├── apps/
│   ├── expo/                         — React Native patient app
│   │   ├── app.json                  — Expo config
│   │   ├── eas.json                  — EAS Build config
│   │   ├── metro.config.js           — unstable_enablePackageExports=true for Tamagui
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── app/                  — Expo Router file-based routes
│   │   │   │   ├── _layout.tsx       — Root layout (auth guard, Tamagui provider)
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login.tsx
│   │   │   │   │   └── biometric.tsx
│   │   │   │   ├── (patient)/
│   │   │   │   │   ├── _layout.tsx   — Bottom tab navigator
│   │   │   │   │   ├── fingerprint.tsx   — FR11–16: Fingerprint chart screen
│   │   │   │   │   ├── letter.tsx        — FR17–20: The Letter screen
│   │   │   │   │   ├── upload.tsx        — FR1–10: Upload + ExtractionPulse
│   │   │   │   │   ├── sharing/
│   │   │   │   │   │   ├── index.tsx     — FR21–25: Sharing management
│   │   │   │   │   │   └── [tokenId].tsx — Share token detail / revoke
│   │   │   │   │   ├── access-log.tsx    — FR24: Access log viewer
│   │   │   │   │   └── settings/
│   │   │   │   │       ├── index.tsx
│   │   │   │   │       ├── privacy.tsx   — FR32–37: LGPD consent management
│   │   │   │   │       └── account.tsx   — FR42–51: Account settings
│   │   │   │   └── +not-found.tsx
│   │   │   ├── stores/
│   │   │   │   ├── upload-queue.ts   — Zustand: offline upload queue (AsyncStorage persisted)
│   │   │   │   └── fingerprint-cache.ts  — Zustand: cached Fingerprint data
│   │   │   ├── hooks/
│   │   │   │   ├── use-biometric.ts
│   │   │   │   ├── use-net-info.ts
│   │   │   │   └── use-letter-stream.ts  — SSE streaming hook (Railway endpoint)
│   │   │   └── lib/
│   │   │       ├── trpc.ts           — tRPC client for Expo
│   │   │       └── supabase.ts       — Supabase client (Expo)
│   │   └── __tests__/
│   │       └── e2e/                  — Maestro or Detox E2E flows
│   │           ├── upload-flow.yaml
│   │           └── sharing-flow.yaml
│   │
│   └── next/                         — Next.js 15 (App Router) — doctor + patient web
│       ├── next.config.ts            — Tamagui plugin, strict CSP headers
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx        — Root layout (Tamagui provider, auth)
│       │   │   ├── page.tsx          — Marketing / landing
│       │   │   ├── (patient)/        — Patient web portal (secondary to mobile)
│       │   │   │   └── ...
│       │   │   ├── (doctor)/         — Doctor experience
│       │   │   │   ├── layout.tsx    — Doctor auth guard
│       │   │   │   ├── activate/
│       │   │   │   │   └── page.tsx  — FR26: Magic link activation
│       │   │   │   └── conversation/
│       │   │   │       └── [shareToken]/
│       │   │   │           └── page.tsx   — FR27–31: Conversation Starter (Server Component + streaming)
│       │   │   ├── share/
│       │   │   │   └── [token]/
│       │   │   │       └── page.tsx  — FR22: Shared record public view
│       │   │   └── api/
│       │   │       ├── trpc/
│       │   │       │   └── [trpc]/
│       │   │       │       └── route.ts  — tRPC HTTP handler
│       │   │       └── webhooks/
│       │   │           └── supabase/
│       │   │               └── route.ts  — Supabase Auth webhooks
│       │   ├── components/           — Next.js–specific server components
│       │   │   └── conversation-starter/
│       │   │       ├── ConversationStreamer.tsx   — Suspense + aria-live streaming
│       │   │       └── ConversationSkeleton.tsx
│       │   └── lib/
│       │       ├── trpc.ts           — tRPC server client
│       │       └── supabase.ts       — Supabase server client (cookies)
│       └── __tests__/
│           └── e2e/                  — Playwright E2E
│               ├── conversation-starter.spec.ts
│               └── doctor-activation.spec.ts
│
├── packages/
│   ├── db/                           — @healthtracker/db
│   │   ├── package.json
│   │   ├── drizzle.config.ts         — custom migration protection guard
│   │   ├── src/
│   │   │   ├── index.ts              — DB client export (session-mode pooler config)
│   │   │   ├── schema/
│   │   │   │   ├── users.ts          — users (id, subscription_tier, created_at)
│   │   │   │   ├── observations.ts   — health_observations, loinc_ref
│   │   │   │   ├── uploads.ts        — uploads (idempotency_key, processing_started_at, status)
│   │   │   │   ├── sharing.ts        — share_tokens, pending_invites, conversation_starter_cache
│   │   │   │   └── audit.ts          — audit_log (append-only, no UPDATE/DELETE grants)
│   │   │   └── client.ts             — createDrizzleClient (accepts DB URL + pool config)
│   │   ├── migrations/               — timestamped SQL migration files
│   │   │   └── YYYYMMDD_HHMMSS_init.sql
│   │   ├── policies/                 — RLS policy SQL (custom_ prefix)
│   │   │   ├── custom_rls_observations.sql
│   │   │   ├── custom_rls_share_tokens.sql
│   │   │   ├── custom_rls_uploads.sql
│   │   │   └── custom_rls_audit_log.sql
│   │   ├── seed/
│   │   │   └── loinc_ref.ts          — LOINC reference data seed (dev/test)
│   │   └── __tests__/
│   │       ├── integration/          — Drizzle integration tests (Supabase local)
│   │       └── rls/                  — RLS adversarial test harness
│   │           ├── observations.rls.test.ts
│   │           ├── share-tokens.rls.test.ts
│   │           └── audit-log.rls.test.ts
│   │
│   ├── api/                          — @healthtracker/api (tRPC routers)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts              — exports appRouter, createTRPCContext
│   │   │   ├── trpc.ts               — createTRPCContext (SET LOCAL, session setup)
│   │   │   ├── errors.ts             — Health Tracker error taxonomy
│   │   │   ├── audit.ts              — writeAuditLog() — only path to audit_log
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           — protectedProcedure (Supabase Auth session)
│   │   │   │   ├── entitlements.ts   — premiumProcedure (subscription_tier gate)
│   │   │   │   └── audit-middleware.ts  — tRPC middleware: logs all patient-data resolvers
│   │   │   └── routers/
│   │   │       ├── index.ts          — appRouter (merges all sub-routers)
│   │   │       ├── observations.ts   — FR11–16: get, list, baseline
│   │   │       ├── uploads.ts        — FR1–10: create, status, confirm
│   │   │       ├── letter.ts         — FR17–20: generate trigger, status (premiumProcedure)
│   │   │       ├── sharing.ts        — FR21–25: createShareToken, revoke, listActive
│   │   │       ├── doctor.ts         — FR26–31: activate, getConversationStarter
│   │   │       ├── consent.ts        — FR32–37: LGPD consent ledger
│   │   │       └── account.ts        — FR42–51: profile, deletion request
│   │   └── __tests__/
│   │       ├── integration/          — tRPC handler integration tests
│   │       └── pact/                 — Consumer-driven contract tests
│   │           ├── sharing.pact.test.ts
│   │           └── observations.pact.test.ts
│   │
│   ├── types/                        — @healthtracker/types (shared TypeScript types)
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── observations.ts       — HealthObservation, LOINC types, UploadStatus
│   │       ├── sharing.ts            — ShareToken, PendingInvite
│   │       ├── llm.ts                — LLMAdapter interface (gates Pact mock provider)
│   │       ├── jobs.ts               — pg-boss JobPayload<T> envelope types
│   │       └── notifications.ts      — PushNotification payload types
│   │
│   ├── ui/                           — @healthtracker/ui (Tamagui components)
│   │   ├── package.json
│   │   ├── tamagui.config.ts         — Token definitions (UX spec colours, typography)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── theme/
│   │       │   ├── tokens.ts         — $primaryBlue, $warningAmber, $textMd, $space* etc.
│   │       │   └── themes.ts         — light / dark theme definitions
│   │       ├── components/
│   │       │   ├── FingerprintChart/ — FR13: Victory Native chart wrapper
│   │       │   │   ├── FingerprintChart.tsx
│   │       │   │   ├── FingerprintChart.test.tsx
│   │       │   │   └── index.ts
│   │       │   ├── ExtractionPulse/  — FR7–9: upload status indicator (amber signal)
│   │       │   │   ├── ExtractionPulse.tsx
│   │       │   │   └── index.ts
│   │       │   ├── LetterViewer/     — FR17: streaming letter display
│   │       │   │   ├── LetterViewer.tsx
│   │       │   │   └── index.ts
│   │       │   ├── ShareCeremony/    — FR21–22: biomarker scope picker
│   │       │   │   ├── ShareCeremony.tsx
│   │       │   │   └── index.ts
│   │       │   └── primitives/       — Button, Text, Card, Input (Tamagui-wrapped)
│   │       └── providers/
│   │           └── TamaguiProvider.tsx  — wraps both Expo and Next.js roots
│   │
│   ├── auth/                         — @healthtracker/auth (Supabase Auth config)
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── server.ts             — Supabase server-side auth helpers
│   │       ├── client.ts             — Supabase browser/Expo client helpers
│   │       └── middleware.ts         — Next.js middleware: session refresh
│   │
│   └── config/                       — @healthtracker/config (shared tooling configs)
│       ├── package.json
│       └── src/
│           ├── eslint/
│           │   ├── base.js
│           │   ├── next.js
│           │   └── expo.js
│           ├── typescript/
│           │   ├── base.json
│           │   ├── nextjs.json
│           │   └── react-native.json
│           ├── prettier.js
│           └── sentry.ts             — PII scrubbing config (beforeSend hook)
│
└── services/
    ├── extraction/                   — AI extraction pipeline (pg-boss consumer)
    │   ├── package.json
    │   ├── Dockerfile
    │   ├── src/
    │   │   ├── index.ts              — Worker entry point (pg-boss connection)
    │   │   ├── consumers/
    │   │   │   ├── extract-document.ts   — extraction.process_document handler
    │   │   │   └── normalize-loinc.ts    — extraction.normalize_loinc handler
    │   │   ├── ocr/
    │   │   │   └── textract.ts       — AWS Textract client (sa-east-1)
    │   │   ├── extraction/
    │   │   │   ├── claude-extractor.ts   — Anthropic Haiku extraction client
    │   │   │   ├── confidence-gate.ts    — per-field confidence scoring, 0.85 threshold
    │   │   │   └── loinc-normalizer.ts   — LOINC code resolution
    │   │   ├── state-machine/
    │   │   │   └── upload-transitions.ts — canonical state transitions (only path to status writes)
    │   │   └── notifications/
    │   │       └── push.ts           — Expo push notification sender
    │   └── __tests__/
    │       ├── unit/
    │       ├── integration/
    │       ├── pact/                 — Pact provider verification (LLM adapter contract)
    │       └── fixtures/
    │           └── golden/           — 200–500 PDFs with ground-truth LOINC values (CI accuracy gate)
    │
    └── llm/                          — LLM service (Letter + Conversation Starter + SSE)
        ├── package.json
        ├── Dockerfile
        ├── railway.json              — Railway deployment config (persistent server)
        ├── src/
        │   ├── index.ts              — Express/Fastify server entry
        │   ├── routes/
        │   │   ├── letter-stream.ts  — GET /api/stream/letter/:letterId (SSE)
        │   │   └── conversation-stream.ts — GET /api/stream/conversation/:tokenId (SSE)
        │   ├── consumers/            — pg-boss consumers for async generation
        │   │   ├── generate-letter.ts
        │   │   └── generate-conversation-starter.ts
        │   ├── prompts/
        │   │   ├── anvisa-system.ts  — ANVISA RDC 657/2022 system prompt (enforced)
        │   │   ├── letter-prompt.ts
        │   │   └── conversation-starter-prompt.ts
        │   ├── adapters/
        │   │   └── anthropic.ts      — Implements LLMAdapter interface from @healthtracker/types
        │   └── cache/
        │       └── conversation-starter-cache.ts  — Read/write conversation_starter_cache table
        └── __tests__/
            ├── unit/
            ├── integration/
            └── pact/                 — Pact provider stubs for CI (no real LLM calls)
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | Protocol | Location | Auth |
|----------|----------|----------|------|
| Patient mobile → backend | tRPC over HTTPS | `apps/next/src/app/api/trpc/` | Supabase JWT |
| Doctor web → backend | tRPC over HTTPS | `apps/next/src/app/api/trpc/` | Supabase magic link JWT |
| Patient mobile → Letter stream | SSE over HTTPS | `services/llm` (Railway) | Supabase JWT |
| Doctor web → Conversation Starter stream | SSE over HTTPS | `services/llm` (Railway) | Share token |
| Backend → Textract | AWS SDK | `services/extraction` | AWS IAM role |
| Backend → Anthropic | HTTPS | `services/llm` + `services/extraction` | API key (DPA required) |
| Supabase webhook → Next.js | HTTPS POST | `apps/next/src/app/api/webhooks/supabase/` | Webhook secret |

**Service Communication Flow:**

```
Patient app ──tRPC──► Next.js API ──pg-boss──► services/extraction
                            │                         │
                            │                    (confidence gate)
                            │                         │
                            │                    services/llm (pg-boss consumer)
                            │
                     ──SSE──► services/llm (Railway, direct — not through Next.js)
```

**Data Boundaries:**

- Patient health data never leaves Supabase São Paulo (`sa-east-1`) except:
  - Raw document bytes → Textract (`sa-east-1` — stays in Brazil)
  - Extracted fields (not raw documents) → Anthropic via Railway (pending LGPD-Railway legal review)
- Audit log: Supabase only; never exported to Axiom or Sentry
- Sentry: receives stack traces + correlation IDs; PII-scrubbed before transmission

### Requirements to Structure Mapping

**FR Domain → Primary Location:**

| FR Domain | FRs | Primary location |
|-----------|-----|-----------------|
| Health Data Ingestion | FR1–10 | `services/extraction`, `packages/api/routers/uploads.ts`, `apps/expo/src/app/(patient)/upload.tsx` |
| Longitudinal Record & Fingerprint | FR11–16 | `packages/api/routers/observations.ts`, `packages/ui/FingerprintChart`, `apps/expo/src/app/(patient)/fingerprint.tsx` |
| AI Narrative — The Letter | FR17–20 | `services/llm`, `packages/api/routers/letter.ts`, `packages/ui/LetterViewer` |
| Sharing & Access Control | FR21–25 | `packages/api/routers/sharing.ts`, `packages/ui/ShareCeremony`, `packages/db/schema/sharing.ts` |
| Doctor Experience | FR26–31 | `packages/api/routers/doctor.ts`, `apps/next/src/app/(doctor)`, `services/llm/consumers/generate-conversation-starter.ts` |
| Privacy & Compliance | FR32–37 | `packages/api/routers/consent.ts`, `packages/db/policies/`, `packages/api/src/audit.ts` |
| Operator & Administration | FR38–41 | `apps/next/src/app/(operator)` (post-MVP scope) |
| Account & Authentication | FR42–51 | `packages/auth`, `packages/api/routers/account.ts`, `apps/expo/src/app/(auth)` |

**Cross-Cutting Concerns → Location:**

| Concern | Location |
|---------|----------|
| RLS policies | `packages/db/policies/custom_rls_*.sql` |
| Audit logging | `packages/api/src/audit.ts` (single entry point) |
| Entitlement enforcement | `packages/api/src/middleware/entitlements.ts` |
| ANVISA prompt enforcement | `services/llm/src/prompts/anvisa-system.ts` |
| PII scrubbing | `packages/config/src/sentry.ts` |
| Error taxonomy | `packages/api/src/errors.ts` |
| Tamagui tokens | `packages/ui/tamagui.config.ts` + `packages/ui/src/theme/tokens.ts` |
| LGPD consent ledger | `packages/api/routers/consent.ts` + `packages/db/schema/users.ts` |

### Integration Points

**Internal Communication:**

- `apps/expo` ↔ `packages/api`: tRPC client (`apps/expo/src/lib/trpc.ts`)
- `apps/next` ↔ `packages/api`: tRPC server client (`apps/next/src/lib/trpc.ts`)
- `apps/next` ↔ `services/llm`: direct SSE (client-side fetch, not Next.js server)
- `packages/api` → `packages/db`: Drizzle client from `@healthtracker/db`
- `services/extraction` → `services/llm`: via pg-boss job queue (not direct HTTP)
- All packages import shared types from `@healthtracker/types`

**External Integrations:**

| Service | Package | Region | DPA required |
|---------|---------|--------|-------------|
| Supabase (PostgreSQL + Auth + Storage) | `packages/db`, `packages/auth` | São Paulo | No (data stays in region) |
| AWS Textract | `services/extraction/ocr/textract.ts` | sa-east-1 | Yes |
| Anthropic Claude | `services/llm/adapters/anthropic.ts` | US (LGPD review pending) | Yes (launch blocker) |
| Expo Push Notifications | `services/extraction/notifications/push.ts` | Expo infra | Review |
| Railway (hosting) | `services/llm/railway.json` | US (LGPD review pending) | Review |
| Sentry | `packages/config/src/sentry.ts` | EU/US | PII-scrubbed |
| Axiom | `services/llm`, `services/extraction` | EU | Correlation IDs only |

**Data Flow — Upload to Letter:**

```
1. Patient uploads PDF/image → apps/expo → tRPC uploads.create
2. uploads.create stores to Supabase Storage + creates uploads row (pending)
3. pg-boss enqueues extraction.process_document job
4. services/extraction worker:
   a. Calls Textract (sa-east-1) → raw OCR text
   b. Calls Claude Haiku → extracted fields + confidence scores
   c. Confidence gate: all fields ≥ 0.85 → complete; any < 0.85 → needs_review
   d. LOINC normalizer → loinc_code (nullable if unresolvable)
   e. Writes to health_observations; transitions upload status
   f. Enqueues letter.generate job (if premium)
5. services/llm letter consumer:
   a. Reads all observations for patient
   b. Calls Claude Sonnet (ANVISA system prompt enforced)
   c. Writes letter to letter_cache table
   d. Sends push notification
6. Patient opens app → tRPC letter.status → streams via SSE from services/llm
```

### Development Workflow Integration

**Turborepo Task Graph:**

```json
{
  "tasks": {
    "build": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test:unit": { "dependsOn": ["^build"] },
    "test:integration": { "dependsOn": ["^build"], "env": ["SUPABASE_URL", "SUPABASE_KEY"] },
    "test:pact": { "dependsOn": ["^build"] },
    "db:migrate": { "dependsOn": ["db#build"] }
  }
}
```

**Local Development:**

```bash
supabase start                    # local Supabase (DB + Auth + Storage)
pnpm dev                          # Turborepo: starts Next.js + Expo Metro + services in parallel
pnpm db:migrate                   # Drizzle migrations against local Supabase
pnpm test:rls                     # RLS adversarial test matrix against local Supabase
```

**Deployment Structure:**

| Target | Trigger | Platform |
|--------|---------|----------|
| Staging (Next.js) | Push to `main` | Vercel |
| Staging (services) | Push to `main` | Railway |
| Production (Next.js) | Release tag | Vercel |
| Production (services) | Release tag | Railway |
| Mobile builds | Release tag | EAS Build → App Store / Play Store |
| DB migrations | CI pipeline (pre-deploy) | Supabase CLI + GitHub Actions |

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are mutually compatible. Expo SDK 54 + Next.js 15 + tRPC v11
+ Drizzle + Supabase Auth are exactly what create-t3-turbo ships. The
session-mode pooler requirement is directly consistent with the `SET LOCAL`
RLS pattern. pg-boss on Supabase is consistent with the no-extra-infrastructure
constraint for a small team. Railway persistent server is the correct pairing
for SSE streaming (NFR-P2) and is incompatible with serverless. Victory Native
is compatible with Expo SDK 54. Tamagui compiles correctly on both Metro and
Next.js Turbopack when `unstable_enablePackageExports` is set.

**Pattern Consistency:**
Implementation patterns directly support architectural decisions throughout.
`snake_case` DB naming ↔ Drizzle convention. `premiumProcedure` enforces the
app-layer entitlement decision at every call site. `writeAuditLog()` enforces
the append-only audit constraint across all writers. `SET LOCAL` is the correct
mechanism for the `current_setting` RLS principal model on session-mode pooler.
ANVISA prompt is centralized at `services/llm/src/prompts/anvisa-system.ts` and
cannot be bypassed by individual consumers.

**Structure Alignment:**
The project structure maps cleanly to all architectural decisions. `packages/db`
owns schema + RLS policies and nothing else. `services/extraction` and
`services/llm` are separate Dockerized workers that communicate only through
pg-boss — no direct HTTP coupling. The SSE streaming boundary (client →
Railway, not through Next.js) is visible in the structure: no SSE routes exist
in `apps/next`.

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:**

| FR Domain | Status | Notes |
|-----------|--------|-------|
| FR1–10 Health Data Ingestion | ✅ Covered | `services/extraction` + uploads router + upload state machine |
| FR11–16 Longitudinal Record & Fingerprint | ✅ Covered | observations router + FingerprintChart component + indexed query |
| FR17–20 AI Narrative — The Letter | ✅ Covered | `services/llm` + letter router (premiumProcedure) + LetterViewer |
| FR21–25 Sharing & Access Control | ✅ Covered | sharing router + ShareCeremony + opaque share_tokens schema |
| FR26–31 Doctor Experience | ✅ Covered | doctor router + Next.js doctor routes + Conversation Starter pre-warming |
| FR32–37 Privacy & Compliance | ✅ Covered | consent router + RLS policies + append-only audit_log |
| FR38–41 Operator & Administration | ⚠️ Deferred | Explicitly post-MVP; `(operator)` route group reserved in Next.js |
| FR42–51 Account & Authentication | ✅ Covered | `packages/auth` + account router + biometric (expo-local-authentication) |

**Non-Functional Requirements Coverage:**

| NFR | Status | Architectural mechanism |
|-----|--------|------------------------|
| P1: Extraction <30s, 100 concurrent | ✅ | pg-boss queue + horizontal worker scaling |
| P2: Letter first token <3s | ✅ | Railway persistent server + direct SSE (not through Next.js) |
| P3: Fingerprint <2s | ✅ | Index on `(patient_id, loinc_code, collected_at)` |
| P4: Conversation Starter <3s post-auth | ✅ | Pre-warm cache at share-token-creation time |
| S2: RLS at PostgreSQL layer | ✅ | `custom_rls_*.sql` + `SET LOCAL` + CI gate |
| S4: Audit log append-only | ✅ | No UPDATE/DELETE grants; `writeAuditLog()` only path |
| S5: No PII in error tracking | ✅ | `sentry.ts` beforeSend hook strips biomarker values + patient_id |
| S6: DPA required before LLM | ✅ | Documented as launch blocker; gates `services/llm` production deploy |
| S8: Data in Brazil or EU | ✅ | Supabase São Paulo + Textract sa-east-1; Railway under LGPD review |
| SC1: Horizontal pipeline scaling | ✅ | pg-boss consumer worker processes scale independently |
| R2: Retry + dead-letter | ✅ | pg-boss max 3 attempts + exponential backoff + dead-letter queue |
| R4: RPO 1 hour | ✅ | Supabase PITR (point-in-time recovery) |
| R5: RTO 4 hours | ✅ | Managed Supabase; DR strategy documented for post-MVP |
| I3: LLM failure doesn't block uploads | ✅ | Letter generation is a separate pg-boss queue; ingestion decoupled |

### Implementation Readiness Validation ✅

**Decision Completeness:** All critical decisions are documented with specific
versions, rationale, and cascading implications. All Sprint 0 non-negotiables
are listed. The decision sequence (days 1–10) provides a safe implementation
order. Two open legal decisions (LGPD-Railway, Art. 18 ADR) are documented
with owners, timeboxes, and non-blocking status for engineering.

**Structure Completeness:** Every package, service, and app has a defined
responsibility boundary. All files that multiple agents would need to know
about are listed by path. Integration points between services are specified
with protocols and auth mechanisms.

**Pattern Completeness:** 14 conflict categories covered. Naming, structure,
format, communication, and process patterns are all specified with concrete
examples and explicit anti-patterns.

### Gap Analysis Results

**Gap 1 — `letters` table missing from Drizzle schema (Closed)**

The data flow referenced a `letter_cache` table but no schema file existed.
Resolution: add `packages/db/src/schema/letters.ts` to the schema organization:

```
letters.ts  — letters (id UUID PK, patient_id UUID FK, generated_at TIMESTAMPTZ,
              content TEXT, model_version TEXT, expires_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ)
```

RLS policy required: `custom_rls_letters.sql` — patient reads own letters only.
Letter router (`packages/api/routers/letter.ts`) writes and reads this table.
`services/llm` writes via the same Drizzle client.

**Gap 2 — Consent schema columns (Documented, schema defined here)**

The `packages/api/routers/consent.ts` existed but consent storage columns
were unspecified. Resolution — add `packages/db/src/schema/consent.ts`:

```typescript
// consent_grants table
// (id UUID PK, patient_id UUID FK, consent_type consent_type_enum,
//  version TEXT, granted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
//  metadata JSONB, created_at TIMESTAMPTZ)
//
// consent_type_enum values:
//   'health_data_processing'    — base data collection (LGPD Art. 7)
//   'ai_extraction'             — AI/OCR processing of documents
//   'doctor_sharing'            — sharing records with doctors
//   'llm_letter_generation'     — LLM Letter feature
//
// Versioning: when extraction methodology changes, a new consent_grants
// row with incremented version is required. Existing consent at older
// version does not cover new inference methods.
```

RLS: append-only for application role (mirrors audit_log pattern). Patient
reads own grants only. No UPDATE; revocation inserts a new row with
`revoked_at` set.

**No critical blocking gaps remain.**

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed (12 cross-cutting concerns)
- [x] Scale and complexity assessed (7 architectural subsystems)
- [x] Technical constraints identified (mandated stack + LGPD/ANVISA)
- [x] Cross-cutting concerns mapped with testability requirements
- [x] Unresolved decisions prioritized (P0–P3) with blocking impact

**✅ Architectural Decisions**
- [x] Critical decisions documented with rationale and cascading implications
- [x] Technology stack fully specified with versions
- [x] Integration patterns defined (tRPC, pg-boss, SSE boundaries)
- [x] Performance considerations addressed (all NFRs P1–P4 covered)
- [x] Security decisions documented (RLS model, token structure, audit log)

**✅ Implementation Patterns**
- [x] Naming conventions established (DB, TypeScript, events, jobs)
- [x] Structure patterns defined (package boundaries, test co-location)
- [x] Communication patterns specified (pg-boss envelope, SSE format, RLS)
- [x] Process patterns documented (state machine, entitlement gate, audit write)
- [x] Display patterns documented (Tamagui tokens, biomarker colors, accessibility)
- [x] 10 mandatory enforcement rules + anti-patterns list

**✅ Project Structure**
- [x] Complete directory structure defined (all files and directories)
- [x] Component boundaries established (package responsibility table)
- [x] Integration points mapped (boundaries table + data flow)
- [x] Requirements to structure mapping complete (all 8 FR domains)
- [x] Deployment structure defined (Vercel + Railway + EAS Build)

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: High**

The architecture has no unresolved decisions that block Sprint 1 feature work.
All P0 decisions are made. Sprint 0 non-negotiables are listed. The two
open legal items (LGPD-Railway, Art. 18 ADR) have owners, timeboxes, and are
explicitly non-blocking for engineering.

**Key Strengths:**
- RLS-first design prevents entire classes of patient data leakage bugs
- pg-boss on Supabase eliminates an entire infrastructure dependency for MVP
- Doctor Acquisition Loop latency is architecturally solved (pre-warming),
  not left to implementation luck
- ANVISA compliance is enforced structurally (centralized prompt file), not
  by convention
- Consent versioning is built into the schema from day one — not retrofitted
- Two schema gaps found and closed during validation before any implementation
  began

**Areas for Future Enhancement (Post-MVP):**
- LOINC versioning strategy in the data model
- DR failover to secondary region (RPO/RTO currently met by Supabase PITR)
- Operator dashboard (FR38–41) — reserved route group, no implementation needed at MVP
- Victory Native → Skia upgrade if Fingerprint animation performance requires it
- DB-layer entitlement enforcement if feature leakage occurs post-launch

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented in this file
- Use implementation patterns consistently — consult the Enforcement Guidelines
  before writing any new module
- Respect package responsibility boundaries (table in Step 5)
- The Sprint 0 non-negotiables must all be green before any feature story begins
- Refer to the Decision Sequence (Days 1–10) for safe implementation order

**First Implementation Step:**

```bash
npx create-turbo@latest -e https://github.com/t3-oss/create-t3-turbo \
  --package-manager pnpm
```

Then execute Sprint 0 non-negotiables in order (see Starter Template section).
