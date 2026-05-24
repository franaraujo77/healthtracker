---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories"]
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
  - "_bmad-output/planning-artifacts/ux-design-specification.md"
---

# Health Tracker - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Health Tracker, decomposing the requirements from the PRD, UX Design Specification, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Health Data Ingestion**
- FR1: Patient can upload a blood test result as a PDF file from device storage
- FR2: Patient can upload a blood test result as an image (JPEG/PNG/HEIC) from camera roll or direct camera capture
- FR3: System can extract biomarker values, units, reference ranges, lab name, and collection date from uploaded PDFs and images
- FR4: System can normalize extracted biomarkers to LOINC codes and UCUM-standard units
- FR5: System can assign a per-field extraction confidence score and route low-confidence fields (<0.85) to manual review without auto-publishing
- FR6: Patient can review extracted values with confidence flags and confirm or correct individual fields before they are added to their record
- FR7: Patient can view the status of an upload (processing / pending review / published / failed)
- FR8: Patient can queue an upload for processing when offline; the upload executes automatically when connectivity restores
- FR9: Patient can manually enter bioimpedance (BIA) measurements including collection date and device name
- FR10: System can handle Brazilian lab decimal separator conventions (comma vs period) and multiple reference range formats

**Longitudinal Record & Fingerprint**
- FR11: Patient can view their complete longitudinal biomarker record across all uploaded draws, sorted by collection date
- FR12: System can compute a personal baseline for each biomarker from the patient's own historical draws (2+ draws required)
- FR13: Patient can view the Longitudinal Fingerprint — a visualization of each biomarker's trend plotted against their personal baseline band
- FR14: System can flag biomarker values that deviate significantly from the patient's personal baseline, distinct from population reference range flags
- FR15: Patient can view a partial Fingerprint with population context at draw 1, with labelling indicating the baseline builds with additional draws
- FR16: Patient can view cached Fingerprint data without an active network connection, with a "last updated" timestamp

**AI Narrative (The Letter)**
- FR17: Patient can receive a streamed narrative summary (The Letter) after a new draw is confirmed, framed as a message from their past self
- FR18: System can generate The Letter incorporating longitudinal patterns across all data types (blood markers + BIA) in the patient's record
- FR19: All AI-generated text is framed as suggestion rather than diagnosis, using "it may be worth discussing with a [specialist type]" framing
- FR20: Patient can re-read a previously generated Letter from the record history

**Sharing & Access Control**
- FR21: Patient can configure which biomarker categories are shared with each named doctor or health professional
- FR22: Patient can revoke a doctor's access to their record at any time
- FR23: Patient can generate a time-limited shareable link to their Conversation Starter report for a specific doctor; duration selection is presented with a 7-day default, with options for 30 days, 24 hours, or no expiry (no-expiry requires an additional confirmation step)
- FR24: Patient can view the Access Log — a complete list of who viewed which biomarker categories and when
- FR25: Access log entries are immutable; they cannot be deleted by the patient or operator

**Doctor Experience**
- FR26: Doctor can open a shared patient link without installing an app; authentication required before any patient health data is displayed; pre-auth landing page shows only patient name and share context
- FR27: Doctor can view the Conversation Starter report — biomarker trend cards with current value, previous value, trend direction, and patient's personal baseline band
- FR28: Doctor can view up to 3 AI-generated discussion prompts derived from the patient's data
- FR29: Doctor can activate a professional account from the shared link view
- FR30: Doctor can invite a patient by contact (email or phone) to create a Health Tracker account
- FR31: Doctor can configure biomarker staleness thresholds for their professional view

**Privacy & Compliance**
- FR32: Patient must provide explicit, per-data-type consent before any health data is collected or processed
- FR33: System records consent events with timestamp, consent text version, and data type scope
- FR34: Patient can export their complete health record as a JSON file at any time
- FR35: Patient can export their complete health record as a formatted PDF at any time
- FR36: Patient can permanently delete their account and all associated data; deletion is confirmed and irreversible
- FR37: Patient can view a summary of all consent agreements currently active on their account

**Operator & Administration**
- FR38: Operator can view a manual review queue of extraction results flagged below the confidence threshold, with anonymised patient identifiers
- FR39: Operator can confirm or reject individual extraction field values in the manual review queue
- FR40: Confirmed extraction results are published to the patient's record and the patient is notified
- FR41: System maintains an immutable audit log of all data access events (read, write, share, revoke) with actor, resource, and timestamp

**Account & Authentication**
- FR42: Patient can create an account with email and password
- FR43: Patient can authenticate using biometric authentication (Face ID / fingerprint) as an alternative to password entry
- FR44: Patient can receive push notifications for key events (extraction complete, Letter ready, manual review required, access log event)
- FR45: Patient can manage notification preferences per event type
- FR46: Patient can upload prior lab results during onboarding, before account setup is fully complete
- FR47: Patient can add life events to their biomarker Fingerprint timeline with a privacy_flag (default patient-only, never shared without explicit consent)
- FR48 (Growth): Pre-results emotional check-in screen — five emotional states; stored with upload, never shared without consent
- FR49 (Growth): Post-results closing emotional check-in; pre/post shift stored as personal longitudinal signal
- FR50 (Growth): Patient can tap any biomarker to receive a suggested, calm, non-alarmist question for a specialist ("Explain this to my doctor")
- FR51 (Vision): Patient can record a voice memo (up to 30 seconds) at time of upload; stored with record, never shared without explicit consent

### NonFunctional Requirements

**Performance**
- NFR-P1: Extraction completes within 30s at p95 for documents up to 10 pages/5 MB, under 100 concurrent jobs
- NFR-P2: The Letter streams first token within 3s; full narrative (~300 words) in <15s
- NFR-P3: Longitudinal Fingerprint renders within 2s of draw confirmation
- NFR-P4: Conversation Starter report loads within 3s post-auth on mobile; pre-auth landing page in <1s
- NFR-P5: Standard read API responses complete within 500ms at p95 under expected load
- NFR-P6: Mobile app launch-to-interactive under 3s on mid-range Android (Moto G class)

**Security**
- NFR-S1: All patient health data encrypted at rest (AES-256) and in transit (TLS 1.3)
- NFR-S2: Row-Level Security enforced at PostgreSQL layer; no application-layer query can access another patient's data
- NFR-S3: Doctor-shared links use signed, scoped tokens with configurable expiry; revocable by patient
- NFR-S4: Audit log is append-only and immutable; no actor can modify or delete entries
- NFR-S5: No third-party analytics/crash/telemetry SDK receives raw biomarker values or patient identifiers
- NFR-S6: Signed DPA (LGPD Art. 11 compliant) required with LLM provider before any patient data is processed
- NFR-S7: Manual review queue exposes only anonymised patient_id to operators — no name, email, or contact data
- NFR-S8: All patient health data stored/processed within Brazil or EU data regions only

**Scalability**
- NFR-SC1: Extraction pipeline supports horizontal scaling — additional workers addable without architectural changes
- NFR-SC2: System sustains baseline performance up to 10x launch-day concurrent users without architectural intervention
- NFR-SC3: LLM streaming infrastructure handles concurrent Letter generation without visible queuing delays; graceful degradation with patient notification beyond peak thresholds
- NFR-SC4: Fingerprint computation queries complete within 500ms at p95 against 10M biomarker records, validated by load test before launch

**Accessibility**
- NFR-A1: Web app (Next.js) meets WCAG 2.1 Level AA for all core patient flows
- NFR-A2: Mobile app supports system-level text size preferences (Dynamic Type/iOS, font scale/Android)
- NFR-A3: All non-decorative images/icons include accessible labels; screen readers can navigate core flows
- NFR-A4: Colour is never the sole means of conveying information; deviation indicators include text labels alongside colour
- NFR-A5: Minimum contrast ratio 4.5:1 for body text, 3:1 for large text and UI components

**Integration**
- NFR-I1: Extraction pipeline handles PDF and image formats from at least Fleury, DASA, and Hermes Pardini at MVP launch, with documented per-lab adapters
- NFR-I2: Extraction correctly parses Brazilian decimal separator (comma) and multiple reference range formats
- NFR-I3: If LLM provider unavailable, upload processing and Fingerprint continue; Letter queued with patient notification
- NFR-I4: Data portability export (JSON + PDF) is self-contained; LOINC codes include human-readable biomarker names

**Reliability**
- NFR-R1: Core endpoints (ingestion, Fingerprint, Access Log) maintain 99.5% uptime monthly
- NFR-R2: Failed extraction jobs retry with exponential backoff; after 3 failed attempts, patient notified and upload enters manual review
- NFR-R3: No patient health data silently lost — every upload either succeeds, enters manual review, or triggers a patient-visible failure notification
- NFR-R4: RPO: maximum 1 hour of data loss; daily backups with point-in-time recovery on patient data DB
- NFR-R5: RTO: core ingestion and Fingerprint endpoints restored within 4 hours of confirmed infrastructure failure

### Additional Requirements

Architecture-derived requirements that directly shape epic and story content:

- AR1: Initialize project from `create-t3-turbo` starter (Expo SDK 54 + Next.js 15 + tRPC v11 + Drizzle + Supabase) — this is Epic 0, Story 1
- AR2: Replace Tailwind/shadcn-ui with Tamagui; set `metro.config.js` `unstable_enablePackageExports=true`; configure `tamagui.config.ts` with UX spec tokens
- AR3: Supabase Auth (remove Better Auth from starter); configure magic link + email providers; `auth.uid()` integrates natively with RLS
- AR4: Supabase session-mode pooler required for authenticated requests (not transaction-mode PgBouncer) — `SET LOCAL` does not survive pool hops in transaction mode
- AR5: RLS token principal model — `SET LOCAL app.current_patient_id` in every tRPC context initializer for authenticated requests; doctor sharing token requests use `app.current_share_token_id`
- AR6: `drizzle.config.ts` custom migration protection + CI `drizzle-kit check` gate must be in place before any schema is written
- AR7: pg-boss (Postgres-backed job queue on Supabase) for async extraction, Letter generation, and Conversation Starter generation
- AR8: AWS Textract (sa-east-1 region) for OCR — keeps document bytes within Brazil (LGPD Art. 33)
- AR9: Anthropic Claude Sonnet (Letter/Conversation Starter) + Claude Haiku (extraction classification); DPA required before any patient data sent — launch blocker
- AR10: tRPC audit middleware — records actor, resource, operation for every resolver touching patient health data; all writes via `writeAuditLog()` helper only
- AR11: `premiumProcedure` middleware for all premium-gated features (Letter, sharing, Access Log); never inline tier check in `protectedProcedure`
- AR12: ANVISA system prompt centralized in `services/llm/src/prompts/anvisa-system.ts` — enforced on every patient-facing LLM call
- AR13: Sentry PII scrubbing — `beforeSend` strips biomarker values, patient_id, LOINC codes before transmission; must be verified before production launch
- AR14: Upload state machine — canonical transitions only through `upload-transitions.ts`; only the extraction worker may write `processing/needs_review/complete`; only pg-boss dead-letter handler may write `failed`
- AR15: `pending_invites` table with nullable `resolved_user_id` — supports sharing token creation before doctor has an account
- AR16: `conversation_starter_cache` — pre-generated at share-token-creation time (not at doctor tap time) to meet NFR-P4 <3s post-auth
- AR17: SSE streaming endpoint in `services/llm` — NOT proxied through tRPC or Next.js (Vercel Edge Runtime caps long-lived streams at ~25s)
- AR18: RLS adversarial test harness — per-identity-type matrix (correct patient, wrong patient, doctor with/without access, expired token, revoked token) on every PR
- AR19: Sprint 0 non-negotiables must all be green before any feature story begins (see Architecture Sprint 0 list)
- AR20: LGPD Art. 18 deletion vs. append-only audit log ADR required — pseudonymize patient_id in audit log on deletion, do not drop rows
- AR21: `idempotency_key UNIQUE` on `uploads` table — prevents duplicate extractions from mobile offline-retry behaviour

### UX Design Requirements

- UX-DR1: Implement Tamagui design token system — warm off-white background (#F9F7F4), deep teal primary (#0D6E6E), amber deviation (#D97706), DM Sans UI font, Lora for The Letter; all tokens in `packages/ui/src/theme/tokens.ts`; no hardcoded hex values in components
- UX-DR2: Implement FingerprintChart component — line chart with personal baseline band (shaded teal), 5 states (cold-start-1 single pulsing dot, cold-start-2 dashed band, baseline-established full chart, doctor-view read-only, loading shimmer); pinch-to-zoom and pan; accessible data table fallback; `accessibilityLabel` describing overall trend
- UX-DR3: Implement BiomarkerCard component — 6 states (cold-start, within-band, watching amber chip, notable amber prominent, loading skeleton, hidden-from-doctor); 3 variants (compact, standard, featured); full composite `accessibilityLabel` including value, unit, deviation description
- UX-DR4: Implement ExtractionPulse component — slow 3s-cycle teal ambient pulse (not a spinner); progressive micro-copy at 0–10s / 10–20s / 20–30s / 30s+; manual-entry escape hatch at 30s+; reduced-motion static spinner + progress fraction fallback
- UX-DR5: Implement LetterReader component — full-screen Lora serif reading experience; `aria-live="polite"` on streaming region; tab bar persists (not hidden); reduced-motion instant-reveal fallback; patient-full and doctor-excerpt variants
- UX-DR6: Implement AccessLogItem component — 4 states (active, expired, revoked-pending, revoked); compact and expanded variants; revocation with 5s undo toast; `accessibilityLabel` as complete sentence
- UX-DR7: Implement ShareBiomarkerToggle component — per-biomarker sharing control with explicit agency-confirmation animation on hide ("Ferritina oculta do Dr. Ribeiro"); setup and edit variants; `role="switch"` accessibility
- UX-DR8: Implement PreAuthLandingCard component — shows patient first name + draw date + one-sentence context only (zero health data); 4 states (default, loading, magic-link-sent, expired-link); desktop centred card + mobile full-width variants
- UX-DR9: Implement ConversationStarterPrompt component — 3 numbered prompts visible above the fold on desktop; biomarker reference chip scrolls to BiomarkerCard; highlighted state on doctor tap; doctor-facing web only
- UX-DR10: Implement EmptyStateRecord component — warm illustration (aria-hidden) + forward-looking pt-BR headline + single primary CTA; 3 states (cold-start, partial, filtered-empty); full-page and inline variants
- UX-DR11: Implement bottom tab navigation — 4 tabs: Início (House), Histórico (Calendar), Compartilhar (Arrow-up), Acessos (Eye); tab bar NEVER hidden during LetterReader, sharing ceremony, or extraction; deep-link breadcrumb pill for WhatsApp-native entry
- UX-DR12: Implement upload flow — 3 fully distinct confidence paths (≥0.85 auto-confirm, 0.01–0.84 manual review queue with notification, 0 specific failure reason + 3 recovery options); never generic "something went wrong" error
- UX-DR13: Implement sharing ceremony — duration selection first (7-day default, 30-day, 24h, no-expiry with extra confirmation); per-biomarker toggles with agency-confirmation on hide; plain-language summary screen; Send button is Tier 2 (not primary action); never Tier 1
- UX-DR14: Implement time-limited sharing duration picker in sharing ceremony UI — 4 duration options, 7-day pre-selected, no-expiry requires extra confirmation tap
- UX-DR15: Implement WCAG 2.1 AA accessibility — axe-core in CI; VoiceOver (iOS) and TalkBack (Android) on 5 critical flows; keyboard-only navigation for all doctor web surfaces; data table fallback for FingerprintChart; skip link on all web pages
- UX-DR16: Implement responsive design — Tamagui breakpoints ($xs–$xl); mobile-first patient web; desktop-first doctor Conversation Starter (centred, max-width 720px); Conversation Starter must not break on mobile
- UX-DR17: Implement reduced-motion support — `useReducedMotion()` on all animated components; ExtractionPulse, LetterReader streaming, FingerprintChart draw animation all have static fallbacks
- UX-DR18: Implement dark mode token definitions in theme file — warm dark palette (#1C1917 background); must be defined even if not shipped in MVP
- UX-DR19: Implement amber deviation signal system — biomarker deviation signals use amber chip + icon + label (never colour alone, never red); `$color.error` (#DC2626) reserved for system errors only; separate semantic tokens for biomarker deviation vs system error
- UX-DR20: Implement pt-BR UI copy — all user-facing strings in Brazilian Portuguese; 8th-grade reading level target; ANVISA-compliant framing in all AI output copy; push notification copy never uses urgency, alarm, or evaluative language

### FR Coverage Map

- FR1: Epic 2 — PDF upload from device storage
- FR2: Epic 2 — Image upload from camera roll / direct capture
- FR3: Epic 2 — Extract biomarker values, units, reference ranges, lab name, date
- FR4: Epic 2 — LOINC / UCUM normalization
- FR5: Epic 2 — Per-field confidence score; route <0.85 to manual review
- FR6: Epic 2 — Patient reviews and confirms extracted values
- FR7: Epic 2 — Upload status display
- FR8: Epic 2 — Offline upload queue
- FR9: Epic 2 — Manual BIA entry
- FR10: Epic 2 — Brazilian decimal separator and reference range format handling
- FR11: Epic 3 — Longitudinal biomarker record view
- FR12: Epic 3 — Personal baseline computation (2+ draws)
- FR13: Epic 3 — Longitudinal Fingerprint visualization
- FR14: Epic 3 — Personal baseline deviation flagging
- FR15: Epic 3 — Draw-1 partial Fingerprint with population context
- FR16: Epic 3 — Cached Fingerprint available offline
- FR17: Epic 4 — Streamed Letter narrative after draw confirmed
- FR18: Epic 4 — Letter incorporates blood markers + BIA longitudinal patterns
- FR19: Epic 4 — ANVISA-compliant AI framing ("direction not diagnosis")
- FR20: Epic 4 — Patient re-reads previous Letters
- FR21: Epic 5 — Per-biomarker, per-doctor sharing configuration
- FR22: Epic 5 — Patient revokes doctor access
- FR23: Epic 5 — Generate time-limited shareable link (7-day default)
- FR24: Epic 5 — Access Log view
- FR25: Epic 5 — Immutable access log entries
- FR26: Epic 6 — Doctor opens link without app install; auth before data shown
- FR27: Epic 6 — Conversation Starter: trend cards with personal baseline band
- FR28: Epic 6 — Up to 3 AI-generated discussion prompts for doctor
- FR29: Epic 6 — Doctor activates professional account from shared link
- FR30: Epic 6 — Doctor invites patient by email or phone
- FR31: Epic 6 — Doctor configures biomarker staleness thresholds
- FR32: Epic 1 — Explicit per-data-type consent before health data collected
- FR33: Epic 1 — Consent events recorded with timestamp, version, scope
- FR34: Epic 5 — JSON export of complete health record
- FR35: Epic 5 — PDF export of complete health record
- FR36: Epic 5 — Permanent account and data deletion
- FR37: Epic 1 — Patient views active consent summary
- FR38: Epic 8 — Operator views anonymised manual review queue
- FR39: Epic 8 — Operator confirms or rejects extraction field values
- FR40: Epic 8 — Confirmed results published with patient notification
- FR41: Epic 8 — Immutable audit log of all data access events
- FR42: Epic 1 — Patient creates account with email and password
- FR43: Epic 1 — Biometric authentication (Face ID / fingerprint)
- FR44: Epic 2 — Push notifications for key events
- FR45: Epic 2 — Patient manages notification preferences per event type
- FR46: Epic 1 — Onboarding-time import of prior lab results
- FR47: Epic 7 — Life events on Fingerprint timeline with privacy_flag
- FR48 (Growth): Epic 7 — Pre-results emotional check-in (5 states)
- FR49 (Growth): Epic 7 — Post-results emotional check-in; pre/post shift stored
- FR50 (Growth): Epic 4 — "Explain this to my doctor" biomarker tap feature
- FR51 (Vision): Epic 7 — Voice memo at upload (30s); patient-only by default

## Epic List

### Epic 0: Project Foundation & Development Environment
Initialize the monorepo, configure all infrastructure, and establish sprint 0 non-negotiables so the system is ready for feature development with RLS, audit logging, and LGPD compliance foundations in place.
**Requirements covered:** AR1–AR21, UX-DR1, UX-DR18, UX-DR19

### Epic 1: Patient Can Create an Account and Their Health Record Begins
A patient can register, give explicit LGPD-compliant consent per data type, enable biometric unlock, and optionally import prior lab results — so their longitudinal record starts on day one, not draw one.
**FRs covered:** FR32, FR33, FR37, FR42, FR43, FR46
**UX-DRs covered:** UX-DR10, UX-DR11, UX-DR20

### Epic 2: Patient Can Upload and Review Blood Test Results
A patient can upload a PDF or camera-roll photo of any Brazilian lab report, watch extraction in progress, confirm or correct low-confidence values, and queue uploads while offline — so blood test data enters the record accurately and with their explicit sign-off.
**FRs covered:** FR1–FR10, FR44, FR45
**UX-DRs covered:** UX-DR4, UX-DR12

### Epic 3: Patient Can See Their Health Fingerprint Over Time
A patient can view their complete longitudinal biomarker record plotted against their own personal baseline — not a population average — so they see their health as a trajectory rather than a single number.
**FRs covered:** FR11–FR16
**UX-DRs covered:** UX-DR2, UX-DR3

### Epic 4: Patient Receives a Personal Health Narrative
A patient receives a streamed, warm, ANVISA-compliant narrative after each draw that reflects their longitudinal patterns — and can tap any biomarker to get a calm, suggested question to raise with their specialist.
**FRs covered:** FR17–FR20, FR50 (Growth)
**UX-DRs covered:** UX-DR5

### Epic 5: Patient Controls Who Sees Their Health Data
A patient can configure exactly which biomarkers each doctor sees, generate time-limited sharing links (7-day default), view an immutable Access Log, revoke access at any time, export their complete record, and permanently delete their account.
**FRs covered:** FR21–FR25, FR34–FR36
**UX-DRs covered:** UX-DR6, UX-DR7, UX-DR13, UX-DR14

### Epic 6: Doctor Can View a Patient's Conversation Starter
A doctor can tap a WhatsApp link, authenticate in one step, and see a pre-generated Conversation Starter report — 3 discussion prompts and biomarker trend cards — within 90 seconds, without installing anything.
**FRs covered:** FR26–FR31
**UX-DRs covered:** UX-DR8, UX-DR9, UX-DR16

### Epic 7: Patient Adds Personal Context to Their Record
A patient can add life events to their Fingerprint timeline, capture their emotional state before and after results, and record a voice memo at upload — so the record reflects lived experience alongside biomarker data.
**FRs covered:** FR47, FR48 (Growth), FR49 (Growth), FR51 (Vision)

### Epic 8: Operator Can Manage Extraction Quality
An operator can view a queue of low-confidence extraction results (anonymised), confirm or reject individual field values, and see results published to the patient's record — so the confidence gate operates at scale.
**FRs covered:** FR38–FR41

---

## Stories

### Epic 0: Project Foundation & Development Environment

Initialize the monorepo, configure all infrastructure, and establish Sprint 0 non-negotiables so the system is ready for feature development with RLS, audit logging, and LGPD compliance foundations in place before any patient data flows.

---

#### Story 0.1: Initialize monorepo from create-t3-turbo starter template

**As a** developer,
**I want** a working monorepo initialized from `create-t3-turbo` with Expo SDK 54, Next.js 15, tRPC v11, Drizzle ORM, and Supabase configured,
**So that** all subsequent feature stories start from a known, reproducible baseline with shared packages in place.

**Acceptance Criteria:**

**Given** a clean working directory,
**When** `pnpm install` is run,
**Then** `apps/expo`, `apps/web`, `packages/api`, `packages/db`, `packages/ui` all resolve without errors,
**And** `pnpm turbo build` completes successfully with no TypeScript errors.

**Given** the monorepo is initialized,
**When** `apps/expo` is started with `pnpm dev`,
**Then** the Expo dev server starts and the default app renders on a simulator without native build errors.

**Given** the monorepo is initialized,
**When** `apps/web` is started with `pnpm dev`,
**Then** the Next.js dev server starts and the default page renders at `localhost:3000`.

**Given** Better Auth ships with the create-t3-turbo starter,
**When** the foundation story is accepted,
**Then** Better Auth is removed and replaced with Supabase Auth; no Better Auth import remains in any package.

**Requirements:** AR1, AR3

---

#### Story 0.2: Configure Tamagui design system with Health Tracker tokens

**As a** developer,
**I want** Tamagui installed and configured across the monorepo with the Health Tracker design token system,
**So that** every component written in later stories uses the correct semantic tokens without hardcoded hex values.

**Acceptance Criteria:**

**Given** Tamagui is installed in `packages/ui`,
**When** `tamagui.config.ts` is inspected,
**Then** it exports tokens including `$color.backgroundPrimary: '#F9F7F4'`, `$color.primaryTeal: '#0D6E6E'`, `$color.biomarkerDeviation: '#D97706'`, `$color.error: '#DC2626'`, `$color.backgroundDark: '#1C1917'`, and font families `DM Sans` (UI) and `Lora` (Letter).

**Given** `metro.config.js` in `apps/expo`,
**When** it is inspected,
**Then** `unstable_enablePackageExports: true` is set to support Tamagui's package exports.

**Given** a component uses `$color.biomarkerDeviation`,
**When** a developer hard-codes a hex value `#D97706` anywhere in `packages/ui/src`,
**Then** the CI lint step fails with a no-hardcoded-color rule violation.

**Given** the dark mode token set,
**When** the theme file is inspected,
**Then** dark mode token definitions are present in `packages/ui/src/theme/tokens.ts` even if the dark mode theme is not surfaced in the MVP UI.

**Requirements:** AR2, UX-DR1, UX-DR18, UX-DR19

---

#### Story 0.3: Configure Supabase Auth with magic link and email providers

**As a** developer,
**I want** Supabase Auth configured with magic link and email/password providers,
**So that** both patient and doctor authentication flows can be built against a stable auth layer.

**Acceptance Criteria:**

**Given** the Supabase project is provisioned,
**When** a test user attempts magic link sign-in,
**Then** a magic link email is sent and clicking it returns a valid session token.

**Given** the Supabase project is provisioned,
**When** a test user attempts email/password sign-in with valid credentials,
**Then** a valid session token is returned.

**Given** a tRPC context is initialized with a valid Supabase session,
**When** `auth.uid()` is called in an RLS policy,
**Then** it returns the authenticated user's UUID without any additional application-layer configuration.

**Given** the session-mode pooler is required for `SET LOCAL`,
**When** the Supabase client in `packages/api` is configured,
**Then** it uses the session-mode pooler connection string, not the transaction-mode PgBouncer URL, as documented in `packages/db/README.md`.

**Requirements:** AR3, AR4, AR5

---

#### Story 0.4: Configure RLS token principal model and migration protection

**As a** developer,
**I want** the RLS token principal model and Drizzle migration protection in place,
**So that** no schema can be written and no patient data can be queried before the security foundation is verified.

**Acceptance Criteria:**

**Given** a tRPC authenticated request is processed,
**When** the context initializer runs,
**Then** `SET LOCAL app.current_patient_id = '<uuid>'` is executed in the same DB connection before any resolver logic runs.

**Given** a doctor sharing-token request is processed,
**When** the context initializer runs,
**Then** `SET LOCAL app.current_share_token_id = '<token_id>'` is set instead of `app.current_patient_id`.

**Given** `drizzle.config.ts` is configured with migration protection,
**When** `drizzle-kit generate` produces a new migration,
**Then** the CI `drizzle-kit check` gate runs and fails the PR if the migration drops a column or table without an explicit override comment.

**Given** the RLS adversarial test harness is in place,
**When** a test runs as `wrong_patient` identity against any patient-data table,
**Then** the query returns zero rows and does not error, confirming RLS isolation.

**Requirements:** AR4, AR5, AR6, AR18, NFR-S2

---

#### Story 0.5: Configure pg-boss extraction job queue

**As a** developer,
**I want** pg-boss installed and configured on the Supabase PostgreSQL instance,
**So that** the async extraction pipeline, Letter generation, and Conversation Starter jobs can be queued without a separate message broker.

**Acceptance Criteria:**

**Given** pg-boss is installed in `services/worker`,
**When** the worker process starts,
**Then** the `pgboss` schema tables are created in the Supabase database and the boss instance reports `started` state in logs.

**Given** a test job is enqueued with `boss.send('extraction', payload)`,
**When** the worker processes it,
**Then** the job transitions `created → active → completed` and the result is visible in `pgboss.job`.

**Given** a job fails 3 consecutive times,
**When** pg-boss moves it to the dead-letter state,
**Then** the dead-letter handler invokes `upload-transitions.ts` to set upload status to `failed` and no other code path may write `failed`.

**Given** the extraction worker is scaled horizontally,
**When** two worker instances are running simultaneously,
**Then** each job is processed exactly once (no duplicate processing).

**Requirements:** AR7, AR14, NFR-SC1, NFR-R2

---

#### Story 0.6: Set up GitHub Actions CI/CD pipeline

**As a** developer,
**I want** a GitHub Actions pipeline that runs type checking, lint, unit tests, RLS adversarial tests, and `drizzle-kit check` on every PR,
**So that** architectural invariants are enforced automatically before any code merges.

**Acceptance Criteria:**

**Given** a PR is opened against `main`,
**When** the CI pipeline runs,
**Then** it executes in order: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `drizzle-kit check`, and the RLS adversarial test matrix; all must pass for the PR to be mergeable.

**Given** the RLS adversarial test matrix is defined,
**When** CI runs against any migration that modifies a patient-data table,
**Then** it runs queries as each identity type: (correct patient, wrong patient, doctor with access, doctor without access, expired token, revoked token) and asserts the correct access for each.

**Given** a migration drops a column without an override comment,
**When** `drizzle-kit check` runs,
**Then** CI fails with a clear error message identifying the destructive operation.

**Given** the pipeline includes an axe-core accessibility check,
**When** it runs against the Next.js build,
**Then** WCAG 2.1 AA violations on core patient flows cause a CI failure.

**Requirements:** AR6, AR18, AR19, NFR-A1, NFR-S2

---

#### Story 0.7: Configure Sentry error tracking with PII scrubbing

**As a** developer,
**I want** Sentry configured across Expo and Next.js with a `beforeSend` hook that strips all PII before transmission,
**So that** crash reporting works without sending biomarker values, patient identifiers, or LOINC codes to Sentry's servers.

**Acceptance Criteria:**

**Given** Sentry is initialized in `apps/expo` and `apps/web`,
**When** an unhandled exception is thrown with a payload containing `patient_id`, `loinc_code`, or a biomarker value,
**Then** the `beforeSend` hook removes those fields before the event is transmitted, verifiable in a Sentry test event.

**Given** the `beforeSend` hook is configured,
**When** it is inspected,
**Then** the scrub list covers: `patient_id`, `loinc_code`, `value_numeric`, `unit_ucum`, email, phone, and full name fields.

**Given** the scrubbing is deployed,
**When** a production error event arrives in Sentry,
**Then** no raw biomarker values or personal identifiers appear in the event payload, breadcrumbs, or extra context.

**Given** Sentry is used for crash reporting,
**When** a third-party analytics SDK is evaluated,
**Then** no SDK that receives raw health data or patient identifiers is added to either app.

**Requirements:** AR13, NFR-S5

---

#### Story 0.8: Capture Epic 0 schema in baseline Supabase migration

**As a** platform engineer,
**I want** Epic 0's infrastructure schema (pg-boss tables under the `pgboss` schema, any Drizzle-managed setup tables) captured as Supabase migration SQL,
**So that** a fresh Supabase project can be provisioned from version control without relying on `pnpm db:push`.

**Note:** Epic 0 schema was applied via `pnpm db:push` and `pg-boss` self-bootstrap. The migration SQL for Epic 0 is consolidated into the baseline produced by **Story 3.5** (`0001_baseline_epics_0_to_3.sql`); no separate migration file is required. This story is tracked for traceability.

**Acceptance Criteria:**

**Given** Story 3.5 is `done`,
**When** I inspect `supabase/migrations/0001_baseline_epics_0_to_3.sql`,
**Then** the `pgboss` schema (tables, sequences, indexes) and any other Epic 0 setup objects are present and idempotently applicable to a fresh project.

**Given** a fresh Supabase project is created,
**When** the baseline migration is applied via `supabase db push`,
**Then** `pg-boss` starts cleanly with no auto-bootstrap divergence from the migration definition.

**Requirements:** AR6, AR7

---

### Epic 1: Patient Can Create an Account and Their Health Record Begins

A patient can register, give explicit LGPD-compliant consent per data type, enable biometric unlock, and optionally import prior lab results — so their longitudinal record starts on day one, not draw one.

---

#### Story 1.1: Patient creates account with email and password

**As a** new patient,
**I want** to create a Health Tracker account with my email and password,
**So that** I can begin building my personal longitudinal health record.

**Acceptance Criteria:**

**Given** I am on the registration screen,
**When** I enter a valid email and a password meeting the minimum requirements (8+ chars, at least one number) and tap "Criar conta",
**Then** a Supabase Auth account is created and I am issued a valid session,
**And** a corresponding row is inserted into the `patients` table with my `user_id` from `auth.uid()`.

**Given** I submit a registration with an email already registered,
**When** Supabase Auth returns a duplicate email error,
**Then** the screen displays "Já existe uma conta com esse e-mail. Tente entrar." without exposing raw error codes.

**Given** my account is created,
**When** the onboarding flow begins,
**Then** I am presented with the LGPD consent screens (Story 1.2) before any health data collection is offered.

**Given** registration succeeds,
**When** I check the audit log,
**Then** a `patient.created` event is recorded with my `patient_id`, timestamp, and actor set to `self`.

**Requirements:** FR42, FR33, AR5, AR10, NFR-S1, UX-DR20

---

#### Story 1.2: Patient provides LGPD-compliant consent per data type at onboarding

**As a** new patient,
**I want** to review and explicitly consent to each type of health data being collected,
**So that** I maintain control over my data and the system satisfies LGPD Art. 11 requirements for sensitive data.

**Acceptance Criteria:**

**Given** I have just created an account,
**When** the consent flow begins,
**Then** I am shown individual consent screens for: (1) blood test results, (2) bioimpedance measurements — each with the consent text version identifier, a plain-language explanation of what will be stored and why, and a distinct "Concordo" action.

**Given** I am on a consent screen,
**When** I tap "Concordo",
**Then** a consent event is written to `consent_records` with: `patient_id`, `data_type`, `consent_text_version`, `agreed_at` timestamp, and my `patient_id` sourced from `SET LOCAL app.current_patient_id`.

**Given** I skip or decline a consent category,
**When** I proceed through onboarding,
**Then** data collection for that category is blocked at the tRPC layer and the UI does not show upload options for it.

**Given** the blood test results and bioimpedance consents are accepted,
**When** the AI narrative consent screen appears,
**Then** it identifies Anthropic as the AI processing provider, explains that blood marker and BIA data will be sent to generate personalized narratives (The Letter), and requires a distinct "Concordo" tap before The Letter feature is enabled; declining this consent allows data storage but disables The Letter and Conversation Starter discussion prompts.

**Given** all mandatory consents are accepted,
**When** onboarding completes,
**Then** I land on the empty-state Início screen showing the `EmptyStateRecord` component with a pt-BR headline and a single "Enviar resultado" CTA.

**Requirements:** FR32, FR33, FR37, NFR-S1, NFR-S6, UX-DR10, UX-DR20

---

#### Story 1.3: Patient enables biometric authentication

**As a** patient,
**I want** to enable Face ID or fingerprint as an alternative to password entry,
**So that** I can unlock the app quickly while keeping health data protected.

**Acceptance Criteria:**

**Given** I am in the onboarding flow or Settings,
**When** I choose to enable biometric auth and the device supports it,
**Then** the system prompts for biometric enrollment and, on success, stores the preference in secure device storage (not in the Supabase DB).

**Given** biometric auth is enabled and I close and reopen the app,
**When** the lock screen appears,
**Then** tapping "Usar biometria" triggers the native biometric prompt; a successful biometric result restores my session without re-entering my password.

**Given** biometric auth fails three consecutive times,
**When** the third failure occurs,
**Then** the app falls back to password entry and the biometric option is not shown again until re-enabled.

**Given** the device has no biometric hardware or the patient skips setup,
**When** they reach the biometric offer screen,
**Then** a "Pular por agora" option is visible and tapping it proceeds without error.

**Requirements:** FR43, NFR-S1, UX-DR20

---

#### Story 1.4: Patient views and manages active consent agreements

**As a** patient,
**I want** to see a summary of all consent agreements active on my account and understand what I have agreed to,
**So that** I can exercise my LGPD Art. 18 right to review my consents at any time.

**Acceptance Criteria:**

**Given** I navigate to Configurações > Privacidade > Meus Consentimentos,
**When** the screen loads,
**Then** I see one row per data type (blood test results, bioimpedance) showing: data type label, consent text version, and date I agreed.

**Given** I tap a consent row,
**When** the detail view opens,
**Then** I see the full consent text version I agreed to, rendered in pt-BR at 8th-grade reading level.

**Given** I want to withdraw a consent,
**When** I tap "Retirar consentimento" and confirm,
**Then** a `consent_withdrawn` event is written to `consent_records` with timestamp, the withdrawn data type is blocked from future collection, and existing records for that type are not deleted (deletion requires Story 5.6).

**Given** the consent list is fetched,
**When** the tRPC resolver runs,
**Then** `writeAuditLog()` records a `consent_records.read` event with `patient_id` and timestamp.

**Requirements:** FR37, FR33, AR10, UX-DR20

---

#### Story 1.5: Patient imports prior lab results during onboarding

**As a** new patient,
**I want** to upload my existing lab results during the onboarding flow, before my profile is fully configured,
**So that** my longitudinal record and Fingerprint start with historical data from day one.

**Acceptance Criteria:**

**Given** I am in the onboarding flow and have completed consent screens,
**When** the "Enviar resultados anteriores" screen appears,
**Then** I can select one or more PDFs or images from my device without being forced to complete profile setup first.

**Given** I initiate an upload during onboarding,
**When** the upload is queued,
**Then** it is processed by the same extraction pipeline as post-onboarding uploads (Story 2.1 / 2.2), with the same confidence gate and `idempotency_key`.

**Given** I skip importing prior results during onboarding,
**When** I land on the main app,
**Then** the `EmptyStateRecord` component shows the `cold-start` state with a "Enviar primeiro resultado" CTA.

**Given** I am in the onboarding import screen,
**When** I tap "Fazer isso depois",
**Then** onboarding completes and the import prompt is available from the Início tab empty state.

**Requirements:** FR46, FR1, FR2, AR21, UX-DR10, UX-DR20

---

#### Story 1.6: Capture Epic 1 schema in baseline Supabase migration

**As a** platform engineer,
**I want** Epic 1's account-and-consent schema (`patients`, `consent_agreements`, `audit_log`, and their RLS policies) captured as Supabase migration SQL,
**So that** the production database can be reproduced from version control rather than from `pnpm db:push` against a running project.

**Note:** Epic 1 schema was applied via `pnpm db:push`. The migration SQL is consolidated into the baseline produced by **Story 3.5** (`0001_baseline_epics_0_to_3.sql`); no separate migration file is required. This story is tracked for traceability.

**Acceptance Criteria:**

**Given** Story 3.5 is `done`,
**When** I inspect `supabase/migrations/0001_baseline_epics_0_to_3.sql`,
**Then** the `patients`, `consent_agreements`, and `audit_log` tables, plus all indexes, triggers, and RLS policies introduced by Epic 1 stories (1.1–1.5), are present in the baseline SQL.

**Given** the baseline is applied to a fresh project,
**When** `pnpm db:push` runs against that project,
**Then** Drizzle reports zero pending changes for Epic 1 tables.

**Requirements:** AR6, AR10, NFR-S1

---

### Epic 2: Patient Can Upload and Review Blood Test Results

A patient can upload a PDF or camera-roll photo of any Brazilian lab report, watch extraction in progress, confirm or correct low-confidence values, and queue uploads while offline — so blood test data enters the record accurately and with their explicit sign-off.

---

#### Story 2.1: Patient uploads a PDF blood test result

**As a** patient,
**I want** to upload a PDF of my blood test results from my device storage,
**So that** my biomarker data is extracted and added to my longitudinal record.

**Acceptance Criteria:**

**Given** I tap "Enviar resultado" and choose "Arquivo PDF",
**When** I select a PDF up to 5 MB / 10 pages,
**Then** the upload is accepted, an `uploads` row is created with status `queued` and a unique `idempotency_key`, and the `ExtractionPulse` component appears.

**Given** the same PDF is submitted twice (e.g., from offline retry),
**When** the second insert hits the `idempotency_key UNIQUE` constraint,
**Then** the duplicate is silently rejected and no second extraction job is enqueued.

**Given** the extraction completes with all fields at confidence ≥ 0.85,
**When** the pipeline publishes results,
**Then** upload status transitions to `complete` via `upload-transitions.ts` only, biomarker rows are inserted into `observations`, and the patient receives a push notification "Seus resultados [Lab Name] estão prontos".

**Given** a PDF exceeds 5 MB or 10 pages,
**When** the patient selects it,
**Then** the upload is rejected before transmission with a specific pt-BR error message explaining the limit, not a generic error.

**Requirements:** FR1, FR3, FR4, FR5, FR7, FR10, AR8, AR14, AR21, NFR-P1, NFR-I1, NFR-I2, UX-DR4, UX-DR12, UX-DR20

---

#### Story 2.2: Patient uploads a photo of a blood test result from camera roll or camera

**As a** patient,
**I want** to upload a photo of my printed lab result from my camera roll or by taking a photo directly,
**So that** I can add results I received via WhatsApp or photographed at the lab, without needing a PDF.

**Acceptance Criteria:**

**Given** I tap "Enviar resultado" and choose "Foto ou câmera",
**When** I select a JPEG, PNG, or HEIC image from my camera roll,
**Then** the image is accepted, an `uploads` row is created, and the `ExtractionPulse` component appears.

**Given** I choose "Câmera" instead of camera roll,
**When** I capture a photo of the lab report,
**Then** the captured image follows the same pipeline as a camera-roll image with no additional steps required.

**Given** the image is a photograph of a printed report with a Brazilian lab comma decimal separator,
**When** AWS Textract in `sa-east-1` processes the image,
**Then** the extracted value is correctly parsed (e.g., "2,4" parsed as `2.4` for numeric storage) and the LOINC normalization step produces a valid `loinc_code`.

**Given** image OCR produces no readable text (blurry, rotated, or non-lab image),
**When** confidence scores are all below 0.01,
**Then** the upload enters the `failed` state via `upload-transitions.ts`, the patient sees a specific failure reason (not "algo deu errado"), and is offered 3 recovery options: retake photo, upload PDF, or enter manually.

**Requirements:** FR2, FR3, FR4, FR5, FR10, AR8, AR14, NFR-I2, NFR-R3, UX-DR12, UX-DR20

---

#### Story 2.3: System extracts and normalizes biomarker values from uploaded documents

**As a** developer,
**I want** the extraction pipeline to produce LOINC-normalized observations with per-field confidence scores,
**So that** the data entering the `observations` table is consistently structured regardless of source lab or format.

**Acceptance Criteria:**

**Given** a Fleury, DASA, or Hermes Pardini PDF is processed,
**When** the extraction pipeline runs,
**Then** all top-20 Brazilian biomarkers (CBC, lipid panel, metabolic, thyroid, iron, CRP) that appear in the document are extracted with: `value_numeric`, `unit_ucum`, `reference_range_low`, `reference_range_high`, `loinc_code`, `lab_name`, `collected_at`, and a per-field `confidence_score`.

**Given** a field has confidence ≥ 0.85,
**When** the pipeline finishes,
**Then** that field is inserted into `observations` with status eligible for publication and does not require manual review.

**Given** a field has confidence in the range 0.01–0.84,
**When** the pipeline finishes,
**Then** that field is not published to the patient's record; instead, it is inserted into the manual review queue (Story 8.1) and the upload enters `needs_review` state.

**Given** LOINC resolution fails for an extracted field (code not in lookup table),
**When** the normalization step runs,
**Then** the field is stored with `loinc_code = NULL` and routed to manual review; the upload is not blocked for other fields that resolved successfully.

**Requirements:** FR3, FR4, FR5, AR8, AR9, AR12, NFR-I1, NFR-I2, NFR-P1, NFR-S6, NFR-S8

---

#### Story 2.4: Patient reviews and confirms low-confidence extracted values

**As a** patient,
**I want** to review any extracted values that the system is unsure about and confirm or correct them,
**So that** no uncertain data enters my health record without my explicit sign-off.

**Acceptance Criteria:**

**Given** my upload has one or more fields with confidence 0.01–0.84,
**When** I open the upload detail screen,
**Then** I see each low-confidence field displayed with its extracted value, a yellow flag icon, the label "Confirme este valor", and an editable input pre-filled with the extracted value.

**Given** I review a low-confidence field and the extracted value is correct,
**When** I tap "Confirmar",
**Then** the field is published to `observations` and the audit log records a `observation.patient_confirmed` event.

**Given** I review a low-confidence field and the extracted value is wrong,
**When** I edit the value and tap "Salvar",
**Then** the corrected value is published to `observations` with `source_type = 'patient_corrected'` and the original extracted value is retained in the extraction record for audit purposes.

**Given** all low-confidence fields are confirmed or corrected,
**When** the last confirmation is submitted,
**Then** the upload transitions to `complete` via `upload-transitions.ts` and a push notification is sent confirming the record is updated.

**Requirements:** FR6, FR7, AR10, AR14, UX-DR12, UX-DR20

---

#### Story 2.5: Patient views upload status and receives push notifications

**As a** patient,
**I want** to see the real-time status of my uploads and receive push notifications when they complete,
**So that** I know when my results are ready without needing to keep the app open.

**Acceptance Criteria:**

**Given** I have submitted an upload,
**When** I open the Histórico tab,
**Then** I see the upload card with its current status label in pt-BR: "Processando" (processing), "Aguardando confirmação" (needs_review), "Publicado" (complete), or "Falhou" (failed).

**Given** my device has push notifications enabled,
**When** an extraction completes successfully,
**Then** I receive a notification with copy "Seus resultados [Lab Name] estão prontos para ver" — no urgency language.

**Given** an extraction enters `needs_review`,
**When** the pg-boss job triggers the notification,
**Then** I receive "Um resultado precisa da sua confirmação" — no alarm language.

**Given** an upload fails after 3 retries,
**When** the dead-letter handler fires,
**Then** I receive "Não conseguimos processar este arquivo. Toque para ver as opções." and the upload card shows the specific failure reason with 3 recovery options.

**Requirements:** FR7, FR44, AR14, NFR-R2, NFR-R3, UX-DR4, UX-DR20

---

#### Story 2.6: Patient queues an upload while offline

**As a** patient,
**I want** to select a document for upload while offline and have it automatically submitted when I reconnect,
**So that** poor connectivity never causes me to lose a lab result I'm trying to add.

**Acceptance Criteria:**

**Given** my device has no network connection,
**When** I select a PDF or image for upload,
**Then** the file is stored in the local upload queue and the upload card shows "Aguardando conexão" — not a failure state.

**Given** my device reconnects to the internet,
**When** connectivity is restored,
**Then** the queued upload is automatically submitted without any action from me and transitions to the `queued` state in the server.

**Given** the same file was queued offline and the app was killed and reopened before connectivity returned,
**When** connectivity is restored,
**Then** the upload still executes using the persisted queue (not lost from memory).

**Given** the upload is submitted with its `idempotency_key`,
**When** the server receives it,
**Then** the `idempotency_key UNIQUE` constraint prevents duplicate extraction if the offline queue submitted it twice.

**Requirements:** FR8, AR21, NFR-R3, UX-DR20

---

#### Story 2.7: Patient manually enters bioimpedance (BIA) measurements

**As a** patient,
**I want** to manually enter my bioimpedance measurements from my gym's InBody or Tanita machine,
**So that** my body composition data is part of my longitudinal Fingerprint alongside blood markers.

**Acceptance Criteria:**

**Given** I navigate to "Adicionar medição" and select "Bioimpedância",
**When** I enter visceral fat area, skeletal muscle mass, body fat percentage, the collection date, and device name,
**Then** the values are saved to `observations` with `source_type = 'manual_bia'` and the collection date is stored as a DATE after UTC-offset normalization.

**Given** I submit a BIA entry,
**When** it is saved,
**Then** the tRPC resolver calls `writeAuditLog()` recording `observation.write` with my `patient_id`, timestamp, and `source_type = 'manual_bia'`.

**Given** BIA data already exists for the same date and device,
**When** I submit a duplicate entry,
**Then** the form warns "Já existe uma medição com este dispositivo para esta data. Deseja substituir?" before overwriting.

**Given** a required field (collection date) is missing,
**When** I attempt to submit,
**Then** the field is highlighted with a pt-BR inline error and the form is not submitted.

**Requirements:** FR9, AR10, UX-DR20

---

#### Story 2.8: Patient manages push notification preferences

**As a** patient,
**I want** to control which push notification types I receive,
**So that** I only get notifications that are relevant to me.

**Acceptance Criteria:**

**Given** I complete my first successful upload,
**When** the extraction completes,
**Then** I am prompted to enable push notifications at that moment — not at onboarding.

**Given** I navigate to Configurações > Notificações,
**When** the screen loads,
**Then** I see toggles for each event type: Resultados prontos, Cartas prontas, Acesso ao histórico, Confirmação necessária — each independently toggleable.

**Given** I disable "Acesso ao histórico" notifications,
**When** a doctor views my record,
**Then** no push notification is sent but the access log entry is still created.

**Given** I have denied push notification permission at the OS level,
**When** I visit the notifications settings screen,
**Then** a banner explains "As notificações estão desativadas no sistema. Toque para ativar nas configurações do dispositivo." with a deep link to OS settings.

**Requirements:** FR44, FR45, UX-DR20

---

#### Story 2.9: Capture Epic 2 schema in baseline Supabase migration

**As a** platform engineer,
**I want** Epic 2's upload-and-extraction schema (`uploads`, `observations`, `loinc_ref`, `extraction_review_queue`, `push_tokens`, `notification_preferences`, and their RLS policies, partial unique indexes, and triggers) captured as Supabase migration SQL,
**So that** production schema state is reproducible from version control and the partial-unique-index hazards called out in the Epic 2 retro (Story 2.7 R2-P213) are documented as DDL.

**Note:** Epic 2 schema was applied via `pnpm db:push`. The migration SQL is consolidated into the baseline produced by **Story 3.5** (`0001_baseline_epics_0_to_3.sql`); no separate migration file is required. This story is tracked for traceability.

**Acceptance Criteria:**

**Given** Story 3.5 is `done`,
**When** I inspect `supabase/migrations/0001_baseline_epics_0_to_3.sql`,
**Then** all Epic 2 tables, indexes (including partial unique indexes), triggers, and RLS policies introduced by stories 2.1–2.8 are present.

**Given** the baseline contains partial unique indexes,
**When** the SQL is reviewed,
**Then** index DDL is written as `CREATE UNIQUE INDEX CONCURRENTLY` (per CLAUDE.md ops note) so future `WHERE`-clause modifications follow the safe pattern from the start.

**Given** the baseline is applied to a fresh project,
**When** `pnpm db:push` runs against that project,
**Then** Drizzle reports zero pending changes for Epic 2 tables.

**Requirements:** AR6, AR8, AR10, AR14, NFR-S2

---

### Epic 3: Patient Can See Their Health Fingerprint Over Time

A patient can view their complete longitudinal biomarker record plotted against their own personal baseline — not a population average — so they see their health as a trajectory rather than a single number.

---

#### Story 3.1: Patient views their complete longitudinal biomarker record

**As a** patient,
**I want** to view all my biomarker results across all uploaded draws, sorted by collection date,
**So that** I can see my complete health history in one place.

**Acceptance Criteria:**

**Given** I have at least one published draw,
**When** I navigate to the Histórico tab,
**Then** I see all draws listed in reverse chronological order, each showing lab name, collection date, and a summary of biomarker count.

**Given** I tap on a draw,
**When** the detail view opens,
**Then** I see all biomarkers extracted from that draw displayed using the `BiomarkerCard` component in `standard` variant, each showing value, unit, and population reference range.

**Given** a biomarker deviates from the population reference range,
**When** it is displayed,
**Then** the `BiomarkerCard` shows the amber deviation chip with a text label — never red, never colour alone.

**Given** the record fetch is called,
**When** the tRPC resolver executes,
**Then** `writeAuditLog()` records a `observations.read` event with `patient_id` and timestamp, and the RLS policy ensures only the authenticated patient's rows are returned.

**Requirements:** FR11, AR5, AR10, NFR-S2, NFR-A4, UX-DR3, UX-DR19, UX-DR20

---

#### Story 3.2: Patient views the Fingerprint at Draw 1 with baseline-building context

**As a** patient with only one published draw,
**I want** to see a partial Fingerprint that uses population context while clearly indicating my personal baseline is being built,
**So that** I understand the current view is a starting point, not yet my personal trajectory.

**Acceptance Criteria:**

**Given** I have exactly one published draw,
**When** I open the Fingerprint (Início tab),
**Then** the `FingerprintChart` renders in `cold-start-1` state: a single pulsing dot per biomarker against the population reference band, with the label "Sua linha de base pessoal cresce com cada novo exame".

**Given** the Fingerprint is in `cold-start-1` state,
**When** I view the chart,
**Then** an `EmptyStateRecord` component in `partial` state is shown beneath the chart explaining "Com 2 ou mais exames, você verá seu padrão pessoal" with a "Enviar resultado anterior" CTA.

**Given** a BiomarkerCard in cold-start state has a deviation signal,
**When** it is displayed,
**Then** the deviation is against the population reference range (not personal baseline) and the card label reads "fora da faixa de referência" in pt-BR.

**Given** the reduced-motion preference is set,
**When** `cold-start-1` renders,
**Then** the pulsing dot animation is replaced with a static dot; `useReducedMotion()` governs this.

**Requirements:** FR13, FR15, UX-DR2, UX-DR3, UX-DR10, UX-DR17, UX-DR20

---

#### Story 3.3: Patient views the Fingerprint at Draw 2+ with personal baseline band

**As a** patient with two or more published draws,
**I want** to see the Longitudinal Fingerprint with my personal baseline band computed from my own history,
**So that** I understand each new result in the context of what is normal for me, not for a population average.

**Acceptance Criteria:**

**Given** I have two or more published draws,
**When** the Fingerprint loads,
**Then** the `FingerprintChart` renders in `baseline-established` state: a line chart with a shaded teal personal baseline band, data points plotted chronologically, and pinch-to-zoom/pan gesture support.

**Given** a biomarker value deviates more than one standard deviation from my personal baseline,
**When** it is plotted on the chart and shown in its `BiomarkerCard`,
**Then** the card renders in `watching` or `notable` state with an amber chip and a text deviation description — never red, never colour alone.

**Given** the personal baseline computation runs,
**When** queried against 10M biomarker records,
**Then** the p95 response time is under 500ms as validated by a load test fixture.

**Given** I have an `accessibilityLabel` need,
**When** VoiceOver reads the `FingerprintChart`,
**Then** it reads a complete sentence describing the overall trend (e.g., "Ferritina: 3 medições. Tendência descendente. Valor atual 2,1 desvios abaixo da sua linha de base pessoal.").

**Requirements:** FR12, FR13, FR14, AR5, NFR-A3, NFR-A4, NFR-SC4, UX-DR2, UX-DR3, UX-DR19, UX-DR20

---

#### Story 3.4: Patient views cached Fingerprint data while offline

**As a** patient,
**I want** to view my Fingerprint even when I have no internet connection,
**So that** I can reference my health data during a doctor appointment without worrying about connectivity.

**Acceptance Criteria:**

**Given** I have previously loaded the Fingerprint while online,
**When** I open the app with no network connection,
**Then** the Fingerprint renders from local cache showing the last computed state, with a "Última atualização: [data e hora]" label visible.

**Given** the device is offline and the Fingerprint is showing cached data,
**When** I attempt to navigate to a screen that requires live data (e.g., upload),
**Then** those actions are gracefully disabled with a pt-BR message explaining connectivity is required.

**Given** the cache is stale (last updated more than 24 hours ago),
**When** the cached Fingerprint renders,
**Then** the timestamp label is displayed in amber to indicate the data may not reflect the latest draw.

**Given** I come back online after viewing cached data,
**When** connectivity is restored,
**Then** the Fingerprint refreshes automatically and the amber stale indicator is removed.

**Requirements:** FR16, UX-DR2, UX-DR20

---

#### Story 3.5: Generate baseline Supabase migration covering Epics 0–3 schema

**As a** platform engineer,
**I want** a single baseline Supabase migration file that captures every table, column, index, constraint, trigger, and RLS policy introduced by Epics 0, 1, 2, and 3 — schema that today exists only because of repeated `pnpm db:push` invocations against the linked project,
**So that** the production database becomes reproducible from version control, the `supabase-deploy` GitHub Action stops being a no-op, and future epics (4–8) can add incremental migrations on top of a known baseline.

**Acceptance Criteria:**

**Given** Epics 0–2 are `done` and Epic 3 is `in-progress` with schema applied via `pnpm db:push`,
**When** I run `supabase db diff --use-migra --linked -f 0001_baseline_epics_0_to_3` against the linked project,
**Then** a single SQL file is committed at `supabase/migrations/0001_baseline_epics_0_to_3.sql` containing — at minimum — the `pgboss` schema (Epic 0); the `patients`, `consent_agreements`, and `audit_log` tables (Epic 1); the `uploads`, `observations`, `loinc_ref`, `extraction_review_queue`, `push_tokens`, and `notification_preferences` tables (Epic 2); and any Fingerprint-related tables, materialized views, or indexes introduced by Epic 3 stories (3.1–3.4) — each with its RLS policies, triggers, and partial unique indexes.

**Given** the baseline migration is applied to a fresh Supabase project via `supabase db push`,
**When** `pnpm db:push` is run immediately afterward against the same project,
**Then** Drizzle reports zero pending changes — confirming end-to-end schema parity between Drizzle source-of-truth and the baseline migration.

**Given** the baseline is merged to `main`,
**When** the `supabase-deploy` workflow fires automatically (or via `workflow_dispatch`),
**Then** `supabase db push` applies the baseline to the linked production project idempotently, with no destructive operations against existing tables and with `supabase migration list --linked` showing `0001_baseline_epics_0_to_3` as applied.

**Given** the baseline contains partial unique indexes (per Story 2.7 R2-P213 retro) or any index touching a `WHERE` clause,
**When** the SQL is reviewed,
**Then** every `CREATE UNIQUE INDEX` and `DROP INDEX` is written with `CONCURRENTLY`, and the PR description documents the rollout plan and any required maintenance window per the CLAUDE.md ops note.

**Given** the baseline lands,
**When** subsequent epics (4–8) introduce schema,
**Then** their respective migration stories (4.4, 5.7, 6.6, 7.5, 8.3) author incremental migration files (`0002_*.sql`, `0003_*.sql`, …) rather than re-baselining — and `pnpm db:push` is no longer used against the production project.

**Given** the migration file is generated,
**When** the round-2 reviewer audits it,
**Then** every table in `packages/db/src/schema/*.ts` (excluding `auth-schema.ts`, which Supabase manages) maps to a `CREATE TABLE` statement in the baseline, and any column/index/policy present in Drizzle but missing from the baseline is flagged as a blocker.

**Requirements:** AR6, AR10, AR13, AR14, NFR-S2

---

### Epic 4: Patient Receives a Personal Health Narrative

A patient receives a streamed, warm, ANVISA-compliant narrative after each draw that reflects their longitudinal patterns — and can tap any biomarker to get a calm, suggested question to raise with their specialist.

---

#### Story 4.1: Patient receives a streamed Letter narrative after a draw is confirmed

**As a** patient,
**I want** to receive a streamed personal narrative after each new draw is confirmed,
**So that** I understand my longitudinal patterns in a human, accessible way — not as a list of lab numbers.

**Acceptance Criteria:**

**Given** a draw is confirmed (upload status = `complete`),
**When** the Letter generation job runs,
**Then** a Claude Sonnet call is made using the ANVISA system prompt from `services/llm/src/prompts/anvisa-system.ts`, and the SSE streaming endpoint in `services/llm` begins streaming to the patient.

**Given** the Letter stream begins,
**When** the patient opens the notification or taps the Letter entry point,
**Then** the `LetterReader` component renders in full-screen with Lora serif font, streaming tokens appear with `aria-live="polite"` on the streaming region, and the first token arrives within 3 seconds.

**Given** the Letter is generating,
**When** the patient navigates to another tab,
**Then** the bottom tab bar remains visible and navigation is not blocked.

**Given** the full narrative completes (~300 words),
**When** it is reviewed,
**Then** every suggestion is framed as "pode valer discutir com [tipo de especialista]" — no "você tem", "isso indica", or "você deve" phrasing, enforced by the ANVISA system prompt.

**Requirements:** FR17, FR18, FR19, AR9, AR11, AR12, AR17, NFR-P2, NFR-S6, UX-DR5, UX-DR11, UX-DR20

---

#### Story 4.2: Patient re-reads a previously generated Letter

**As a** patient,
**I want** to re-read any Letter that was previously generated for a past draw,
**So that** I can refer back to narrative context at any time, not just when it first arrives.

**Acceptance Criteria:**

**Given** I navigate to the Histórico tab and tap on a completed draw,
**When** the draw detail view loads,
**Then** if a Letter exists for that draw, a "Ler carta" button is shown.

**Given** I tap "Ler carta",
**When** the `LetterReader` opens,
**Then** it displays the stored Letter text in Lora serif, full-screen, without re-generating from the LLM.

**Given** the Letter is opened for re-reading,
**When** the tRPC resolver executes,
**Then** `writeAuditLog()` records a `letter.read` event with `patient_id`, `draw_id`, and timestamp.

**Given** the LLM service was unavailable when the Letter was originally triggered,
**When** I tap "Ler carta" for that draw,
**Then** I see a message "Sua carta está sendo preparada. Você receberá uma notificação quando estiver pronta." — no generic error.

**Requirements:** FR20, AR10, AR11, UX-DR5, UX-DR20

---

#### Story 4.3: Patient taps a biomarker to receive an "Explain this to my doctor" suggestion (Growth)

**As a** patient,
**I want** to tap any biomarker card and receive a calm, suggested question I can raise with my specialist,
**So that** I can walk into appointments prepared without needing to translate lab jargon myself.

**Acceptance Criteria:**

**Given** I tap any `BiomarkerCard` in the Fingerprint or Histórico view,
**When** the biomarker detail sheet opens,
**Then** a "Pergunte ao seu médico" section is visible with a single, non-alarmist suggested question in pt-BR generated by the ANVISA-compliant LLM prompt.

**Given** the suggestion is generated,
**When** I read it,
**Then** it is phrased as a question the patient would ask (e.g., "Posso pedir ao meu endocrinologista para discutirmos o que essa tendência de ferritina significa para mim?") — not as a diagnosis.

**Given** the `premiumProcedure` middleware is applied,
**When** a non-premium patient taps the feature,
**Then** they see an upgrade prompt in pt-BR explaining this is a premium feature — the suggestion text is not shown.

**Given** the LLM call completes,
**When** the suggestion is displayed,
**Then** `writeAuditLog()` records `biomarker_suggestion.generated` with `patient_id`, `loinc_code`, and timestamp.

**Requirements:** FR50 (Growth), AR9, AR10, AR11, AR12, NFR-S6, UX-DR20

---

#### Story 4.4: Author incremental Supabase migration for Epic 4 schema

**As a** platform engineer,
**I want** a versioned Supabase migration file that captures every net-new table, column, index, trigger, and RLS policy introduced by Epic 4 (Letter narratives — e.g. `letters`, related staging or cache tables, streaming-state tracking),
**So that** Letter persistence reaches production through the `supabase-deploy` workflow and is not applied via ad-hoc `pnpm db:push`.

**Acceptance Criteria:**

**Given** Story 3.5 baseline is `done` and Epic 4 stories (4.1–4.3) have landed Drizzle schema for Letters,
**When** I run `supabase db diff --use-migra --linked -f epic_4_letters` against the linked project,
**Then** a single SQL file is committed under `supabase/migrations/` (next numeric prefix after the baseline) containing only Epic 4 net-new objects.

**Given** the migration is merged to `main`,
**When** `supabase-deploy` runs,
**Then** `supabase db push` applies the migration cleanly and `pnpm db:push` against the linked project reports zero pending changes.

**Given** any index or constraint affects partial uniqueness or hot tables,
**When** the SQL is reviewed,
**Then** index DDL uses `CONCURRENTLY` per the CLAUDE.md ops note.

**Requirements:** AR6, AR10, AR11, NFR-S2

---

### Epic 5: Patient Controls Who Sees Their Health Data

A patient can configure exactly which biomarkers each doctor sees, generate time-limited sharing links (7-day default), view an immutable Access Log, revoke access at any time, export their complete record, and permanently delete their account.

---

#### Story 5.1: Patient configures per-biomarker sharing with a named doctor

**As a** patient,
**I want** to select exactly which biomarker categories a specific doctor can see before generating a sharing link,
**So that** I share only what is clinically relevant to that professional.

**Acceptance Criteria:**

**Given** I initiate sharing with a new doctor (Compartilhar tab),
**When** the sharing ceremony begins,
**Then** I first see the duration picker (Story 5.2) before the per-biomarker toggle screen.

**Given** I am on the per-biomarker toggle screen,
**When** I hide a biomarker category for a specific doctor,
**Then** the `ShareBiomarkerToggle` shows the agency-confirmation animation with the label "Ferritina oculta do Dr. [Nome]" and the toggle state is persisted to the `share_token_biomarkers` table.

**Given** I enable a previously hidden biomarker,
**When** I toggle it back on,
**Then** the change is persisted immediately and takes effect on the next doctor page load (no sharing link regeneration required).

**Given** the sharing configuration is saved,
**When** the tRPC resolver writes the configuration,
**Then** `writeAuditLog()` records a `sharing.configured` event with `patient_id`, `doctor_identifier`, `biomarker_categories`, and timestamp.

**Requirements:** FR21, AR10, AR11, NFR-S3, UX-DR7, UX-DR13, UX-DR20

---

#### Story 5.2: Patient generates a time-limited sharing link with duration selection

**As a** patient,
**I want** to generate a shareable link with a chosen expiry duration,
**So that** access to my record is always time-bounded by default and I maintain control over how long it lasts.

**Acceptance Criteria:**

**Given** I begin the sharing ceremony,
**When** the duration picker screen appears,
**Then** 4 options are shown: "24 horas", "7 dias" (pre-selected), "30 dias", and "Sem prazo" — in that visual order.

**Given** I select "Sem prazo",
**When** I attempt to proceed,
**Then** an extra confirmation step appears: "Confirmar acesso sem prazo — o médico poderá ver seus dados até você revogar manualmente." and I must tap "Confirmar" before proceeding.

**Given** I complete the ceremony and tap the final share button,
**When** the share token is created,
**Then** a signed, scoped token is inserted into `share_tokens` with `expires_at` set to `now() + interval`, `patient_id`, `doctor_identifier`, and `biomarker_categories` scope; the `conversation_starter_cache` is pre-generated at this point.

**Given** the sharing link is generated,
**When** I view the summary screen,
**Then** the "Enviar" button is rendered as a Tier 2 action (not the primary action) per UX-DR13.

**Requirements:** FR23, AR15, AR16, NFR-S3, UX-DR13, UX-DR14, UX-DR20

---

#### Story 5.3: Patient views the Access Log

**As a** patient,
**I want** to see a complete log of who accessed which parts of my record and when,
**So that** I have full transparency over who has viewed my health data.

**Acceptance Criteria:**

**Given** I navigate to the Acessos tab,
**When** the Access Log loads,
**Then** I see all access events listed in reverse chronological order, each rendered as an `AccessLogItem` with: actor name or anonymised identifier, biomarker categories accessed, timestamp, and token status (active/expired/revoked).

**Given** a doctor viewed my record 2 hours ago,
**When** I view the corresponding `AccessLogItem`,
**Then** it shows the doctor's name/email, the biomarker categories they viewed, the exact timestamp, and the `active` state badge.

**Given** `premiumProcedure` is applied to the Access Log resolver,
**When** a non-premium patient tries to load the Access Log,
**Then** they see a premium upgrade prompt in pt-BR — no log entries are shown.

**Given** the Access Log is queried,
**When** the RLS policy evaluates,
**Then** only entries where `patient_id` matches `app.current_patient_id` are returned; immutability means no `DELETE` or `UPDATE` permissions exist on `access_log` for any role.

**Requirements:** FR24, FR25, AR5, AR10, AR11, NFR-S2, NFR-S4, UX-DR6, UX-DR20

---

#### Story 5.4: Patient revokes a doctor's access to their record

**As a** patient,
**I want** to revoke a specific doctor's access at any time,
**So that** I can immediately end access I no longer want to grant, regardless of the original expiry.

**Acceptance Criteria:**

**Given** I view an `AccessLogItem` in `active` state,
**When** I tap "Revogar acesso" and confirm,
**Then** the `share_tokens` row for that token is updated to `revoked_at = now()` and subsequent doctor requests with that token are rejected with a 403.

**Given** I revoke access,
**When** the revocation is processed,
**Then** a 5-second undo toast appears: "Acesso revogado. Desfazer?" — tapping undo restores the token within the window.

**Given** a revocation completes (undo window passed),
**When** the `AccessLogItem` re-renders,
**Then** it shows `revoked-pending` then `revoked` state and the timestamp of revocation.

**Given** a revoked token is presented by a doctor,
**When** the tRPC resolver validates the token,
**Then** it returns a 403 and `writeAuditLog()` records `share_token.rejected` with the reason `revoked`.

**Requirements:** FR22, AR10, NFR-S3, UX-DR6, UX-DR20

---

#### Story 5.5: Patient exports their complete health record as JSON or PDF

**As a** patient,
**I want** to export my entire health record as a JSON file or formatted PDF,
**So that** I can exercise my LGPD Art. 18 data portability right and keep a personal copy of my data.

**Acceptance Criteria:**

**Given** I navigate to Configurações > Dados > Exportar registro,
**When** I choose "JSON" or "PDF" and tap "Exportar",
**Then** the export is generated server-side and a download link is delivered to the app within 60 seconds.

**Given** the JSON export is generated,
**When** I open the file,
**Then** every `observations` row includes: `loinc_code`, a human-readable `biomarker_name` in pt-BR, `value_numeric`, `unit_ucum`, `collected_at`, `lab_name`, and `source_type` — the file is self-contained and interpretable without Health Tracker infrastructure.

**Given** the PDF export is generated,
**When** I open it,
**Then** it includes all draws, BIA entries, life events, and a cover page identifying it as a Health Tracker personal health record export.

**Given** an export is requested,
**When** the tRPC resolver runs,
**Then** `writeAuditLog()` records `record.exported` with `patient_id`, `export_format`, and timestamp.

**Requirements:** FR34, FR35, AR10, NFR-I4, UX-DR20

---

#### Story 5.6: Patient permanently deletes their account and all data

**As a** patient,
**I want** to permanently delete my account and all associated health data,
**So that** I can exercise my LGPD Art. 18 right to erasure.

**Acceptance Criteria:**

**Given** I navigate to Configurações > Conta > Excluir conta,
**When** the deletion flow begins,
**Then** I am shown a summary of what will be deleted, required to type "EXCLUIR" to confirm, and warned the action is irreversible.

**Given** I complete the confirmation,
**When** the deletion runs,
**Then** all rows in `patients`, `observations`, `uploads`, `consent_records`, `share_tokens`, `life_events` are permanently deleted for my `patient_id`.

**Given** the audit log is append-only (NFR-S4),
**When** my account is deleted,
**Then** audit log rows for my `patient_id` are pseudonymized (replace `patient_id` with a deterministic hash) rather than dropped, per AR20 ADR.

**Given** deletion completes,
**When** I attempt to log in with my former credentials,
**Then** Supabase Auth returns "Conta não encontrada" and no patient data is accessible.

**Requirements:** FR36, AR10, AR20, NFR-S4, UX-DR20

---

#### Story 5.7: Author incremental Supabase migration for Epic 5 schema

**As a** platform engineer,
**I want** a versioned Supabase migration file that captures every net-new table, column, index, trigger, and RLS policy introduced by Epic 5 (sharing — `sharing_grants`, time-limited share links, access log entries, export/deletion bookkeeping),
**So that** sharing and data-subject-rights schema reaches production through the `supabase-deploy` workflow with auditable history.

**Acceptance Criteria:**

**Given** the Story 3.5 baseline is `done` and Epic 5 stories (5.1–5.6) have landed Drizzle schema for sharing/access-log/export/deletion flows,
**When** I run `supabase db diff --use-migra --linked -f epic_5_sharing` against the linked project,
**Then** a single SQL file is committed under `supabase/migrations/` containing only Epic 5 net-new objects, including the RLS policies that gate doctor read access and pseudonymization triggers for deletion (per Story 5.6 AR20 ADR).

**Given** the migration is merged to `main`,
**When** `supabase-deploy` runs,
**Then** `supabase db push` applies the migration cleanly and `pnpm db:push` against the linked project reports zero pending changes.

**Given** any partial unique index or `WHERE`-clause modification is required,
**When** the SQL is reviewed,
**Then** index DDL uses `CONCURRENTLY` per the CLAUDE.md ops note and the rollout plan is documented in the PR.

**Requirements:** AR6, AR10, AR15, AR16, AR20, NFR-S3

---

### Epic 6: Doctor Can View a Patient's Conversation Starter

A doctor can tap a WhatsApp link, authenticate in one step, and see a pre-generated Conversation Starter report — 3 discussion prompts and biomarker trend cards — within 90 seconds, without installing anything.

---

#### Story 6.1: Doctor views pre-auth landing page showing patient name and share context

**As a** doctor who received a sharing link,
**I want** to see a landing page that tells me who shared with me and why before I authenticate,
**So that** I know the context before committing to logging in.

**Acceptance Criteria:**

**Given** I open a valid sharing link in any modern browser,
**When** the pre-auth landing page loads,
**Then** it loads in under 1 second and shows only: the patient's first name, the share context (e.g., "Compartilhou resultados de exame"), and a "Ver histórico" authentication CTA — no biomarker values, no lab results.

**Given** the link has expired,
**When** I open it,
**Then** the `PreAuthLandingCard` renders in `expired-link` state with a pt-BR message "Este link expirou. Peça ao paciente um novo link." — no patient health data is shown.

**Given** the link has been revoked by the patient,
**When** I open it,
**Then** the page shows "O paciente revogou o acesso a este link." — no health data is shown.

**Given** the landing page renders,
**When** I am on mobile,
**Then** the card is full-width; on desktop it is centred with max-width 720px.

**Requirements:** FR26, AR16, NFR-P4, UX-DR8, UX-DR16, UX-DR20

---

#### Story 6.2: Doctor authenticates via magic link and views the Conversation Starter report

**As a** doctor who has opened a sharing link,
**I want** to authenticate with a magic link email and immediately see the patient's Conversation Starter report,
**So that** I can review the patient's longitudinal data before our appointment in under 90 seconds from opening the link.

**Acceptance Criteria:**

**Given** I tap "Ver histórico" on the pre-auth landing page,
**When** I enter my email address,
**Then** a magic link is sent to that email and the page transitions to `magic-link-sent` state with a confirmation message in pt-BR.

**Given** I click the magic link in my email,
**When** I am redirected back to the app and authentication completes,
**Then** the Conversation Starter report loads within 3 seconds from the pre-generated `conversation_starter_cache`, showing: 3 discussion prompts and biomarker trend cards for the shared categories only.

**Given** the report loads,
**When** I view the biomarker cards,
**Then** each `BiomarkerCard` renders in `doctor-view` (read-only) state with: current value, previous value, trend direction arrow, and the patient's personal baseline band — not population ranges.

**Given** `SET LOCAL app.current_share_token_id` is set in the tRPC context,
**When** the RLS policy evaluates,
**Then** only the biomarker categories scoped to this token are returned; categories the patient excluded are not accessible.

**Requirements:** FR26, FR27, FR28, AR5, AR16, NFR-P4, NFR-S3, UX-DR8, UX-DR9, UX-DR16, UX-DR20

---

#### Story 6.3: Doctor activates a professional account from the Conversation Starter view

**As a** doctor viewing a Conversation Starter report,
**I want** to activate a professional Health Tracker account from within the report,
**So that** I can receive future patient shares and build my own patient panel without leaving the current flow.

**Acceptance Criteria:**

**Given** I am viewing the Conversation Starter report for the first time,
**When** the report loads,
**Then** a non-intrusive banner "Ative sua conta profissional" is visible at the bottom of the report, styled as a secondary action.

**Given** I tap the activation banner,
**When** the professional account setup flow begins,
**Then** my email (already authenticated) is pre-filled, I confirm my professional category (endocrinologista, cardiologista, etc.), and the account is activated in one step.

**Given** my professional account is activated,
**When** the activation completes,
**Then** a `professional_account.activated` event is written to the audit log and a `professionals` row is created linked to my `user_id`.

**Given** I am a returning doctor with an existing professional account,
**When** I open a new patient sharing link and authenticate,
**Then** the activation banner is not shown.

**Requirements:** FR29, AR10, NFR-S1, UX-DR9, UX-DR20

---

#### Story 6.4: Doctor invites a patient to create a Health Tracker account

**As a** doctor with a professional account,
**I want** to invite a patient by email or phone to create a Health Tracker account,
**So that** I can initiate the Doctor Acquisition Loop by recommending the product directly to patients I see.

**Acceptance Criteria:**

**Given** I am in my professional dashboard,
**When** I tap "Convidar paciente" and enter an email or phone number,
**Then** an invitation record is created in `pending_invites` with my `professional_id`, the contact, and a `resolved_user_id = NULL`.

**Given** the invite is sent,
**When** the patient opens the invitation link and creates an account,
**Then** `pending_invites.resolved_user_id` is updated with the new patient's `user_id` and a `patient_invite.resolved` audit event is written.

**Given** a patient was invited by a doctor,
**When** they create an account and complete onboarding,
**Then** the doctor's name is shown as the referrer on the patient's Início empty state: "Convidado por Dr. [Nome]".

**Given** an invite is sent to an already-registered email,
**When** the system detects the duplicate,
**Then** no duplicate invite is created and the doctor is notified "Este paciente já tem uma conta."

**Requirements:** FR30, AR15, AR10, UX-DR20

---

#### Story 6.5: Doctor configures biomarker staleness thresholds for their professional view

**As a** doctor,
**I want** to define how old a biomarker result can be before it is flagged as stale in my view,
**So that** I can quickly identify which values need to be refreshed before I make clinical decisions.

**Acceptance Criteria:**

**Given** I am in my professional dashboard under Configurações > Limiares de atualização,
**When** I view the threshold settings,
**Then** I see a list of biomarker categories (lipídios, tireoide, ferro, metabolismo, etc.) each with a configurable threshold in days.

**Given** I set the ferritin staleness threshold to 90 days,
**When** a patient's ferritin value was collected more than 90 days ago,
**Then** the corresponding `BiomarkerCard` in my Conversation Starter view shows a "Resultado antigo" chip.

**Given** I have not configured a threshold for a biomarker,
**When** the staleness check runs,
**Then** the system default of 180 days is applied.

**Given** staleness thresholds are saved,
**When** the tRPC resolver writes the configuration,
**Then** `writeAuditLog()` records `staleness_threshold.updated` with `professional_id` and the updated categories.

**Requirements:** FR31, AR10, UX-DR20

---

#### Story 6.6: Author incremental Supabase migration for Epic 6 schema

**As a** platform engineer,
**I want** a versioned Supabase migration file that captures every net-new table, column, index, trigger, and RLS policy introduced by Epic 6 (doctor accounts and Conversation Starter — professional account records, staleness threshold configs, doctor→patient invitation links),
**So that** doctor-side schema reaches production through the `supabase-deploy` workflow.

**Acceptance Criteria:**

**Given** the Story 3.5 baseline is `done` and Epic 6 stories (6.1–6.5) have landed Drizzle schema for doctor accounts, invitations, and staleness configuration,
**When** I run `supabase db diff --use-migra --linked -f epic_6_doctor_accounts` against the linked project,
**Then** a single SQL file is committed under `supabase/migrations/` containing only Epic 6 net-new objects, including RLS policies that prevent doctors from reading patient data outside the scope of an active sharing grant.

**Given** the migration is merged to `main`,
**When** `supabase-deploy` runs,
**Then** `supabase db push` applies the migration cleanly and `pnpm db:push` against the linked project reports zero pending changes.

**Given** any partial unique index or constraint touches the patient-data path,
**When** the SQL is reviewed,
**Then** index DDL uses `CONCURRENTLY` per the CLAUDE.md ops note.

**Requirements:** AR6, AR10, AR15, AR16

---

### Epic 7: Patient Adds Personal Context to Their Record

A patient can add life events to their Fingerprint timeline, capture their emotional state before and after results, and record a voice memo at upload — so the record reflects lived experience alongside biomarker data.

---

#### Story 7.1: Patient adds a life event to their Fingerprint timeline

**As a** patient,
**I want** to add life events to my Fingerprint timeline to mark personal context that may explain changes in my trends,
**So that** I can understand the story behind the data — not just the numbers.

**Acceptance Criteria:**

**Given** I am viewing the Fingerprint chart,
**When** I tap "Adicionar evento de vida",
**Then** a sheet opens where I can enter: event description (free text, 140 char max), event date (date picker with retroactive entry), and optionally a category tag.

**Given** I save a life event,
**When** it is stored,
**Then** a row is inserted into `life_events` with `patient_id`, `event_date`, `description`, `category`, and `privacy_flag = 'patient_only'` by default; the event never appears in any shared doctor view.

**Given** a life event is saved,
**When** the Fingerprint renders for the relevant time period,
**Then** the event appears as a marker on the timeline at the correct date; its label is visible in pt-BR.

**Given** the life event resolver writes the record,
**When** it completes,
**Then** `writeAuditLog()` records `life_event.created` with `patient_id` and `event_date`.

**Requirements:** FR47, AR10, UX-DR20

---

#### Story 7.2: Patient captures emotional check-in before results appear (Growth)

**As a** patient with a new upload pending review,
**I want** to record how I am feeling before I see my results,
**So that** I can track how my emotional state relates to my health data over time.

**Acceptance Criteria:**

**Given** I open a draw that has just been published and I have not yet viewed it,
**When** the check-in screen appears before results are shown,
**Then** I see 5 emotional state options in pt-BR: "Esperançoso", "Preocupado", "Curioso", "Exausto", "Não sei" — presented without loading or urgency.

**Given** I select an emotional state,
**When** I tap to proceed to results,
**Then** the app shows a brief single-sentence acknowledgment (e.g., "Obrigado por compartilhar como você está.") before transitioning to the results screen.

**Given** my pre-results check-in is saved,
**When** it is stored,
**Then** the selected state is written to `emotional_checkins` with `patient_id`, `upload_id`, `state`, `type = 'pre'`, `privacy_flag = 'patient_only'`, and timestamp; it is never included in any shared doctor view.

**Given** I choose to skip the check-in,
**When** I tap "Pular",
**Then** I proceed directly to results and no check-in record is created for that draw.

**Requirements:** FR48 (Growth), UX-DR20

---

#### Story 7.3: Patient captures emotional check-in after reviewing results (Growth)

**As a** patient who has just reviewed their new draw,
**I want** to record how I feel after seeing my results,
**So that** I can track the emotional shift between expectation and reality as a personal longitudinal signal.

**Acceptance Criteria:**

**Given** I have finished reviewing a draw and a pre-results check-in was recorded,
**When** I reach the end of the results review flow,
**Then** the post-results check-in screen appears with the same 5 emotional states in pt-BR.

**Given** I select a post-results emotional state,
**When** it is saved,
**Then** the state is written to `emotional_checkins` with `type = 'post'`, linked to the same `upload_id` as the pre-results record, and `privacy_flag = 'patient_only'`.

**Given** both pre- and post-results check-ins exist for an upload,
**When** I view my personal context history,
**Then** I can see the pre/post state pair for each draw that has both, as a personal longitudinal signal accessible only to me.

**Given** no pre-results check-in was recorded for a draw,
**When** the results review ends,
**Then** no post-results check-in screen is shown for that draw.

**Requirements:** FR49 (Growth), UX-DR20

---

#### Story 7.4: Patient records a voice memo at the time of upload (Vision)

**As a** patient uploading a new lab result,
**I want** to record a short voice memo capturing my context at the time of upload,
**So that** I have a qualitative record of what was happening in my life when I took this test.

**Acceptance Criteria:**

**Given** I am on the upload confirmation screen,
**When** I tap "Adicionar memo de voz" (optional),
**Then** the mobile microphone permission is requested if not already granted, and a 30-second recording interface appears.

**Given** I record a voice memo and tap "Salvar",
**When** the upload is submitted,
**Then** the audio file is attached to the `uploads` row with `privacy_flag = 'patient_only'`; it is never shared with any doctor or professional without my explicit consent.

**Given** the voice memo exceeds 30 seconds,
**When** the recording reaches 30 seconds,
**Then** recording stops automatically and a message in pt-BR explains the limit.

**Given** I tap "Pular" on the voice memo screen,
**When** the upload proceeds,
**Then** no audio is recorded and the upload continues normally without any voice memo attached.

**Requirements:** FR51 (Vision), UX-DR20

---

#### Story 7.5: Author incremental Supabase migration for Epic 7 schema

**As a** platform engineer,
**I want** a versioned Supabase migration file that captures every net-new table, column, index, trigger, and RLS policy introduced by Epic 7 (personal context — life events on the Fingerprint timeline, emotional check-ins pre/post results, voice memo attachments),
**So that** personal-context schema reaches production through the `supabase-deploy` workflow.

**Acceptance Criteria:**

**Given** the Story 3.5 baseline is `done` and Epic 7 stories (7.1–7.4) have landed Drizzle schema for life events, emotional check-ins, and voice memos,
**When** I run `supabase db diff --use-migra --linked -f epic_7_personal_context` against the linked project,
**Then** a single SQL file is committed under `supabase/migrations/` containing only Epic 7 net-new objects, including RLS policies that scope all rows to `auth.uid()` and any storage-bucket references required for voice memo attachments.

**Given** the migration is merged to `main`,
**When** `supabase-deploy` runs,
**Then** `supabase db push` applies the migration cleanly and `pnpm db:push` against the linked project reports zero pending changes.

**Given** any index or constraint affects partial uniqueness or hot tables,
**When** the SQL is reviewed,
**Then** index DDL uses `CONCURRENTLY` per the CLAUDE.md ops note.

**Requirements:** AR6, AR10

---

### Epic 8: Operator Can Manage Extraction Quality

An operator can view a queue of low-confidence extraction results (anonymised), confirm or reject individual field values, and see results published to the patient's record — so the confidence gate operates at scale.

---

#### Story 8.1: Operator views the anonymised manual review queue

**As an** operator,
**I want** to view a queue of extraction results that fell below the confidence threshold, showing only anonymised identifiers,
**So that** I can review and resolve uncertain values without accessing any patient personal information.

**Acceptance Criteria:**

**Given** I am authenticated as an operator role,
**When** I open the review queue dashboard,
**Then** I see a list of queue items each showing: `patient_id` (UUID only, no name or contact data), lab name, collection date, and the number of flagged fields — no personal identifiers.

**Given** I tap a queue item,
**When** the detail view opens,
**Then** I see each flagged field with: field label, extracted value, raw OCR output, and confidence score — all without patient name, email, or any personal contact data.

**Given** the operator dashboard fetches queue data,
**When** the RLS policy evaluates,
**Then** only the anonymised fields are returned; a query to retrieve `patients.email` or `patients.full_name` for a `patient_id` visible in the queue returns zero results for the operator role.

**Given** the queue is empty,
**When** I open the dashboard,
**Then** a "Fila vazia — todos os resultados foram revisados" state is shown, not a blank screen.

**Requirements:** FR38, AR5, NFR-S7, UX-DR20

---

#### Story 8.2: Operator confirms or rejects individual extraction field values

**As an** operator,
**I want** to confirm or reject each low-confidence field in the manual review queue,
**So that** accurate values are published to the patient's record and inaccurate values are rejected with a reason.

**Acceptance Criteria:**

**Given** I am reviewing a queue item with flagged fields,
**When** I tap "Confirmar" on a field where the extracted value is correct,
**Then** the field is published to `observations`, the patient's upload transitions to `complete` (if all fields are resolved) via `upload-transitions.ts`, and the patient receives the notification "Seus resultados estão prontos".

**Given** I tap "Rejeitar" on a field where the extracted value is wrong,
**When** I enter a reason from the predefined list (e.g., "Separador decimal incorreto", "Valor ilegível", "Unidade incorreta") and confirm,
**Then** the field is marked as `rejected` with the reason, is not published to `observations`, and the patient receives a notification to manually enter the value.

**Given** an operator confirms a field,
**When** the action is persisted,
**Then** `writeAuditLog()` records `extraction_field.operator_confirmed` with `operator_id` (anonymised as role, not name), `patient_id`, `loinc_code`, and timestamp.

**Given** a patient's upload has a mix of confirmed and rejected fields,
**When** all fields are resolved,
**Then** the upload is published with the confirmed fields only; rejected fields are excluded from `observations` and the patient is notified which values need manual entry.

**Requirements:** FR39, FR40, FR41, AR10, AR14, NFR-S7, UX-DR20

---

#### Story 8.3: Author incremental Supabase migration for Epic 8 schema

**As a** platform engineer,
**I want** a versioned Supabase migration file that captures every net-new table, column, index, trigger, and RLS policy introduced by Epic 8 (operator role for extraction quality — operator role definition, rejection-reason enums or lookup tables, any review-queue columns added beyond the Epic 2 baseline),
**So that** operator-side schema and the strict anonymising RLS policies reach production through the `supabase-deploy` workflow.

**Acceptance Criteria:**

**Given** the Story 3.5 baseline is `done` and Epic 8 stories (8.1–8.2) have landed Drizzle schema for operator roles and extraction-review workflow extensions,
**When** I run `supabase db diff --use-migra --linked -f epic_8_operator_review` against the linked project,
**Then** a single SQL file is committed under `supabase/migrations/` containing only Epic 8 net-new objects, including RLS policies that prevent the operator role from reading `patients.email`, `patients.full_name`, or any personal identifier (per Story 8.1 acceptance criteria).

**Given** the migration is merged to `main`,
**When** `supabase-deploy` runs,
**Then** `supabase db push` applies the migration cleanly and `pnpm db:push` against the linked project reports zero pending changes.

**Given** any index or constraint affects partial uniqueness or hot tables,
**When** the SQL is reviewed,
**Then** index DDL uses `CONCURRENTLY` per the CLAUDE.md ops note and the rollout plan is documented in the PR.

**Requirements:** AR6, AR10, AR14, NFR-S7

---

## Maintenance Backlog

> Cross-cutting operational work that doesn't fit a product epic. These are tracked here so they're visible during sprint planning, but they intentionally don't have story numbers — they're scheduled as maintenance sprints between product epics, or triggered when a specific blocker forces them.

### M1: Expo SDK 56 upgrade (mobile only)

**Status:** `not-scheduled` — wait for a product trigger or for SDK 54 to approach EOL.

**Trigger conditions (any of):**

- Product needs an Expo SDK 56-only feature (e.g., a new push notification API, a new background task surface, or a privacy-manifest requirement for App Store submission).
- Expo SDK 54 reaches EOL or stops receiving security patches.
- A dependency we need lands a new major that requires SDK 56 as a peer (e.g., a future `react-native-reanimated` 5.x or `victory-native` 5.x).

**Why this is NOT a per-package story:**

The Expo SDK ships as a coupled bundle. SDK 54's `bundledNativeModules.json` (Expo's EAS-validated compatibility matrix) pins exact versions of every `expo-*`, the core RN native peers, AND React itself (`react@19.1.0`, plus matched `react-dom` and `@types/react`). Bumping any one out of band (e.g., `expo-constants` from `~18.0.10` to `56.0.x`, `react-native-worklets` from `0.5.1` to `0.8.x`, or `react` from `19.1.4` to `19.2.6` per closed PR #37) breaks the native ABI between modules at runtime — and CI cannot detect it because the mobile app isn't built or run in CI (no EAS Build step on PR checks). Dependabot / Renovate are configured to ignore Expo + React Native + React-core package families for this reason; see `.github/dependabot.yml` and `.github/renovate.json`.

**Scope when scheduled (rough — refine into stories at planning time):**

- M1.1: Run Expo's official SDK 54 → 56 upgrade guide; bump `expo`, all `expo-*`, `react-native` (likely 0.81 → 0.82+), `react-native-reanimated` (4.1 → 4.x or 5.x), `react` + `react-dom` + `@types/react` + `@types/react-dom` (to whatever SDK 56's `bundledNativeModules.json` pins), and all `react-native-*` peers in a single coordinated PR.
- M1.2: Decide the iOS floor. SDK 56's `expo-system-ui@56.0.0` raises minimum iOS to 16.4 (drops iPhone 8 / 8 Plus and earlier). This is a product decision — gather analytics on the user-base iOS distribution before committing.
- M1.3: EAS Build native rebuild (iOS + Android); install fresh dev-client on test devices.
- M1.4: Full mobile QA pass — every screen and every native API surface (camera, document picker, image picker, biometric auth, secure store, notifications, local notifications, deep links, audit-log emission paths).
- M1.5: Update `Info.plist` (iOS minimum target), `app.json` / `app.config.ts` (SDK version, runtime version policy), and the `bundledNativeModules.json` reference in this doc.
- M1.6: App Store + Google Play resubmission with new minimum OS metadata.

**Dependencies / sequencing notes:**

- This is a horizontal infrastructure change. Schedule it **between epics** (e.g., after Epic 3 close-out, before Epic 4 mobile work begins) so it doesn't block a feature epic's mobile QA window.
- It is **not** a CLAUDE.md "ops note" partial-index situation — it's a coupled SDK upgrade, which is the safer kind of breaking change (deterministic, well-documented by Expo) provided we treat it as one atomic unit.

**Requirements:** none (operational). Touches: AR1 (monorepo), AR4 (Supabase pooler — unaffected), AR11 (mobile flow), NFR-A4 (a11y — full re-test).

### M2: Tamagui 2.x upgrade (web + mobile UI seam)

**Status:** `not-scheduled` — wait for a product trigger or for tamagui 1.x to enter security-only / EOL mode.

**Trigger conditions (any of):**

- Product needs a Tamagui 2.x feature (e.g., a new component or a stable API tamagui 1.x doesn't ship).
- A peer dep we need (e.g., a future `react-native-reanimated` major, or a Next.js major that drops the current `@tamagui/next-plugin` ABI) requires Tamagui 2 as its peer.
- Tamagui 1.x reaches EOL / stops receiving security fixes.

**Why this is NOT a per-package story:**

Tamagui ships as a coupled compiler + runtime bundle across `@tamagui/core`, `@tamagui/web`, `@tamagui/animations-css`, `@tamagui/animations-react-native`, `@tamagui/babel-plugin`, `@tamagui/next-plugin`, the `tamagui` umbrella, and the shared theme tokens we expose from `packages/ui/src/theme/`. All siblings must be on the same major version — mixing 1.x and 2.x breaks at type-check and runtime across `packages/ui`, `apps/web`, and `apps/expo`. Dependabot's closed PR #34 demonstrated the fragmentation hazard (it bumped only `@tamagui/core` to 2.0 while siblings stayed at `^1.144.4`). Both bot configs now ignore `tamagui` + `@tamagui/*` for this reason.

**Scope when scheduled (rough — refine into stories at planning time):**

- M2.1: Pin every `@tamagui/*` + `tamagui` catalog entry in `pnpm-workspace.yaml` to the same 2.x major; bump `tamagui` umbrella in lock-step.
- M2.2: Apply the Tamagui 2.0 compiler migration — platform-arg-driven web/native resolution, inlined `TAMAGUI_TARGET` / `EXPO_OS` constants (rewrites parts of `next.config.js` and the Expo babel config).
- M2.3: API renames sweep — `sheet`/`adapt`/`select` callsites across `packages/ui/src/**` (Story 0.2 design system) and `apps/web` + `apps/expo` consumers. Map every existing import to the 2.x equivalent.
- M2.4: RNGH press-gesture overhaul — every Tamagui `<Button>` / pressable in the patient flows (Início CTAs, EmptyStateRecord, UploadSourceSheet, biometric unlock) needs a behaviour re-test for press-cancel + accessibility-action paths (NFR-A4).
- M2.5: Tamagui 2's vite-plugin peer-dep was removed — verify nothing in the test toolchain (vitest + `@tamagui/babel-plugin`) regresses.
- M2.6: Visual regression pass — Início, Histórico, Onboarding, Consent, Auth, Notification settings. Capture before/after screenshots for the patient-facing screens; flag any token resolution drift (e.g. `$biomarkerDeviation` rendering differently between 1.x and 2.x).
- M2.7: A11y re-test — every screen with token-driven colour pairing (Story 3.3, Story 3.4 amber stale state, BiomarkerCard deviation states).

**Dependencies / sequencing notes:**

- Like M1, this is a horizontal change. Schedule **between epics** (ideally bundled with M1 in a single "platform upgrade sprint" if both trigger conditions fire together — they share the mobile QA burden and the EAS rebuild).
- The compiler rewrite in M2.2 changes generated CSS / RN style output, so visual regression is the dominant risk surface. CI cannot catch this (no screenshot pipeline).

**Requirements:** none (operational). Touches: AR1 (monorepo), AR11 (mobile flow), AR12 (web flow), NFR-A4 (a11y — full re-test).

### M3: ESLint v10 family upgrade (tooling only)

**Status:** `not-scheduled` — low priority. ESLint v9 is still actively maintained; schedule when v9 enters security-only mode, OR when a dep we need requires v10 as a peer, OR when our own rule set wants a v10-only feature.

**Trigger conditions (any of):**

- ESLint v9 reaches EOL / security-only.
- A plugin we depend on (`@next/eslint-plugin-next`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-import`, `eslint-plugin-turbo`, or `@vercel/style-guide`) ships a major that requires `eslint@^10` as a peer.
- We want a v10-only feature (e.g., new rule, perf gains, native TypeScript config support without the `unstable_native_nodejs_ts_config` flag).

**Why this is NOT a per-package story:**

The ESLint v10 ecosystem has a tight peer-dep matrix at install time. `@eslint/js@10` declares `eslint: ^10.0.0`; the workspace's catalog pins `eslint: ^9.x` across 12 packages; bumping just one breaks `pnpm install` workspace-wide (closed PRs #39 and #40 both demonstrated this — install-time failure across every CI job). Most ecosystem plugins haven't published v10-compatible peer ranges broadly yet, and the project's `unstable_native_nodejs_ts_config` flag (used in every `eslint --flag unstable_native_nodejs_ts_config` script across the workspace) needs a v10 audit since the flag may have stabilised / renamed / been removed.

Dependabot/Renovate are configured to ignore `eslint` + `@eslint/js` for this reason. Note: `typescript-eslint` and other plugins whose peer range explicitly accepts both v9 + v10 are NOT ignored — they can land independently.

**Scope when scheduled (rough — refine into stories at planning time):**

- M3.1: Audit every `eslint-plugin-*` and `eslint-config-*` in the workspace catalog; bump each to the version whose peer range accepts v10. If any plugin has no v10-compatible release, stop and decide: replace the plugin, drop the rule, or wait.
- M3.2: Bump `eslint` core + `@eslint/js` to the same v10 minor in the catalog, in lockstep with M3.1.
- M3.3: Audit `tooling/eslint/base.ts`, `tooling/eslint/nextjs.ts`, `tooling/eslint/react.ts` for any rule config / preset that v10's `eslint:recommended` ruleset changed (v10 changed several recommended defaults).
- M3.4: Verify the `unstable_native_nodejs_ts_config` flag in every `eslint --flag unstable_native_nodejs_ts_config` script still works on v10 — or replace with v10's stable equivalent if the flag has been renamed/promoted.
- M3.5: Check Node version floor — v10 requires Node `^20.19 || ^22.13 || >=24`. Confirm CI runner Node version satisfies it (`pnpm` engines pin in repo root + `actions/setup-node` in `.github/workflows/ci.yml`).
- M3.6: Land as one PR; verify `pnpm lint` + `pnpm format` still pass across all 12 packages.

**Dependencies / sequencing notes:**

- Lower blast radius than M1 / M2 (tooling only, no product surface). Can land in any sprint that has spare capacity.
- Bundle with the prettier-ecosystem reflow (PRs #29 prettier-core + #42 prettier-plugin-tailwindcss are both on hold for `pnpm format:fix` reflow) **only if** they happen to land in the same sprint — they're independent otherwise.

**Requirements:** none (operational). Touches: tooling/eslint/*, tooling/prettier/* (only if bundled), .github/workflows/ci.yml (Node version), eslint.config.ts in every package.
