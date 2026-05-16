---
stepsCompleted: ["step-01-document-discovery", "step-02-prd-analysis", "step-03-epic-coverage-validation", "step-04-ux-alignment", "step-05-epic-quality-review", "step-06-final-assessment"]
documentsUsed:
  prd: "_bmad-output/planning-artifacts/prd.md"
  architecture: "_bmad-output/planning-artifacts/architecture.md"
  epics: "_bmad-output/planning-artifacts/epics.md"
  ux: "_bmad-output/planning-artifacts/ux-design-specification.md"
---

# Implementation Readiness Assessment Report

**Date:** 2026-05-15
**Project:** healthtracker

---

## PRD Analysis

### Functional Requirements

**Health Data Ingestion (10 FRs)**
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

**Longitudinal Record & Fingerprint (6 FRs)**
- FR11: Patient can view their complete longitudinal biomarker record across all uploaded draws, sorted by collection date
- FR12: System can compute a personal baseline for each biomarker from the patient's own historical draws (2+ draws required)
- FR13: Patient can view the Longitudinal Fingerprint — a visualization of each biomarker's trend plotted against their personal baseline band
- FR14: System can flag biomarker values that deviate significantly from the patient's personal baseline, distinct from population reference range flags
- FR15: Patient can view a partial Fingerprint with population context at draw 1, with labelling indicating the baseline builds with additional draws
- FR16: Patient can view cached Fingerprint data without an active network connection, with a "last updated" timestamp

**AI Narrative / The Letter (4 FRs)**
- FR17: Patient can receive a streamed narrative summary (The Letter) after a new draw is confirmed, framed as a message from their past self
- FR18: System can generate The Letter incorporating longitudinal patterns across all data types (blood markers + BIA) in the patient's record
- FR19: All AI-generated text is framed as suggestion rather than diagnosis, using "it may be worth discussing with a [specialist type]" framing
- FR20: Patient can re-read a previously generated Letter from the record history

**Sharing & Access Control (5 FRs)**
- FR21: Patient can configure which biomarker categories are shared with each named doctor or health professional
- FR22: Patient can revoke a doctor's access to their record at any time
- FR23: Patient can generate a time-limited shareable link to their Conversation Starter report for a specific doctor; duration selection is presented with a 7-day default, with options for 30 days, 24 hours, or no expiry (no-expiry requires an additional confirmation step)
- FR24: Patient can view the Access Log — a complete list of who viewed which biomarker categories and when
- FR25: Access log entries are immutable; they cannot be deleted by the patient or operator

**Doctor Experience (6 FRs)**
- FR26: Doctor can open a shared patient link without installing an app; authentication required before any patient health data is displayed; pre-auth landing page shows only patient name and share context
- FR27: Doctor can view the Conversation Starter report — biomarker trend cards with current value, previous value, trend direction, and patient's personal baseline band
- FR28: Doctor can view up to 3 AI-generated discussion prompts derived from the patient's data
- FR29: Doctor can activate a professional account from the shared link view
- FR30: Doctor can invite a patient by contact (email or phone) to create a Health Tracker account
- FR31: Doctor can configure biomarker staleness thresholds for their professional view

**Privacy & Compliance (6 FRs)**
- FR32: Patient must provide explicit, per-data-type consent before any health data is collected or processed
- FR33: System records consent events with timestamp, consent text version, and data type scope
- FR34: Patient can export their complete health record as a JSON file at any time
- FR35: Patient can export their complete health record as a formatted PDF at any time
- FR36: Patient can permanently delete their account and all associated data; deletion is confirmed and irreversible
- FR37: Patient can view a summary of all consent agreements currently active on their account

**Operator & Administration (4 FRs)**
- FR38: Operator can view a manual review queue of extraction results flagged below the confidence threshold, with anonymised patient identifiers
- FR39: Operator can confirm or reject individual extraction field values in the manual review queue
- FR40: Confirmed extraction results are published to the patient's record and the patient is notified
- FR41: System maintains an immutable audit log of all data access events (read, write, share, revoke) with actor, resource, and timestamp

**Account & Authentication (10 FRs)**
- FR42: Patient can create an account with email and password
- FR43: Patient can authenticate using biometric authentication (Face ID / fingerprint) as an alternative to password entry
- FR44: Patient can receive push notifications for key events (extraction complete, Letter ready, manual review required, access log event)
- FR45: Patient can manage notification preferences per event type
- FR46: Patient can upload prior lab results during onboarding, before account setup is fully complete
- FR47: Patient can add life events to their biomarker Fingerprint timeline with a `privacy_flag` (default patient-only, never shared without explicit consent)
- FR48 (Growth): Pre-results emotional check-in screen — five emotional states; stored with upload, never shared without consent
- FR49 (Growth): Post-results closing emotional check-in; pre/post shift stored as personal longitudinal signal
- FR50 (Growth): Patient can tap any biomarker to receive a suggested, calm, non-alarmist question for a specialist ("Explain this to my doctor")
- FR51 (Vision): Patient can record a voice memo (up to 30 seconds) at time of upload; stored with record, never shared without explicit consent

**Total FRs: 51**

---

### Non-Functional Requirements

**Performance (6)**
- NFR-P1: Extraction within 30s at p95, up to 10 pages/5 MB, under 100 concurrent jobs
- NFR-P2: Letter streams first token in <3s; full ~300 words in <15s
- NFR-P3: Longitudinal Fingerprint renders within 2s of draw confirmation
- NFR-P4: Conversation Starter loads within 3s post-auth on mobile; pre-auth landing page <1s
- NFR-P5: Standard read API responses within 500ms at p95
- NFR-P6: Mobile app launch-to-interactive under 3s on mid-range Android

**Security (8)**
- NFR-S1: All patient health data encrypted at rest (AES-256) and in transit (TLS 1.3)
- NFR-S2: Row-Level Security enforced at PostgreSQL layer; no application-layer query can access another patient's data
- NFR-S3: Doctor-shared links use signed, scoped tokens with configurable expiry; revocable by patient
- NFR-S4: Audit log is append-only and immutable; no actor can modify or delete entries
- NFR-S5: No third-party analytics/crash/telemetry SDK receives raw biomarker values or patient identifiers
- NFR-S6: Signed DPA (LGPD Art. 11 compliant) required with LLM provider before any patient data is processed
- NFR-S7: Manual review queue exposes only anonymised patient_id to operators — no name, email, or contact data
- NFR-S8: All patient health data stored/processed within Brazil or EU data regions only

**Scalability (4)**
- NFR-SC1: Extraction pipeline supports horizontal scaling without architectural changes
- NFR-SC2: System sustains baseline performance up to 10x launch-day concurrent users without architectural intervention
- NFR-SC3: LLM streaming infrastructure handles concurrent Letter generation without visible queuing; graceful degradation with patient notification beyond peak thresholds
- NFR-SC4: Fingerprint computation queries complete within 500ms at p95 against 10M biomarker records, validated by load test before launch

**Accessibility (5)**
- NFR-A1: Web app meets WCAG 2.1 Level AA for all core patient flows
- NFR-A2: Mobile app supports system-level text size preferences (Dynamic Type / font scale) without layout breakage
- NFR-A3: All non-decorative images/icons include accessible labels; screen readers can navigate core flows
- NFR-A4: Colour is never the sole means of conveying information; deviation indicators include text labels
- NFR-A5: Minimum contrast ratio 4.5:1 for body text, 3:1 for large text and UI components

**Integration (4)**
- NFR-I1: Extraction pipeline handles PDF and image formats from at least Fleury, DASA, and Hermes Pardini at MVP launch, with documented per-lab adapters
- NFR-I2: Extraction correctly parses Brazilian decimal separator (comma) and multiple reference range formats
- NFR-I3: If LLM provider unavailable, upload processing and Fingerprint continue; Letter queued with patient notification
- NFR-I4: Data portability export (JSON + PDF) is self-contained; LOINC codes include human-readable biomarker names

**Reliability (5)**
- NFR-R1: Core endpoints (ingestion, Fingerprint, Access Log) maintain 99.5% uptime monthly
- NFR-R2: Failed extraction jobs retry with exponential backoff; after 3 failed attempts, patient notified and upload enters manual review
- NFR-R3: No patient health data silently lost — every upload either succeeds, enters manual review, or triggers a patient-visible failure notification
- NFR-R4: RPO: maximum 1 hour of data loss; daily backups with point-in-time recovery on patient data DB
- NFR-R5: RTO: core ingestion and Fingerprint endpoints restored within 4 hours of confirmed infrastructure failure

**Total NFRs: 32**

---

### Additional Requirements

**Regulatory / Compliance Constraints (not FRs/NFRs)**
- LGPD Art. 11: Health data is sensitive data requiring explicit consent per data type; DPO appointment required before public launch
- LGPD Art. 18: Data portability (JSON/PDF export) and right to erasure both in MVP
- ANVISA RDC 657/2022: AI outputs must stay below MDSW classification — "direction not diagnosis" enforced at prompt and output layer; regulatory lawyer sign-off if classification is in doubt
- CFM Resolution 2.314/2022: Conversation Starter must not be framed as clinical consultation or medical advice
- LLM Provider DPA: Required before any patient data is sent to LLM provider — explicit launch gate

**Business Constraints**
- Concept 1 Validation Gate: ≥2 of 3 behavioral ACs in ≥3 of 5 test participants within 6 days — must pass before full Letter build
- 90-day MVP team: 1 backend + 1 mobile/frontend + 1 AI/ML + 1 PM + part-time regulatory counsel
- Store compliance: Apple App Store "Health & Fitness" category; health data entitlement declarations required

### PRD Completeness Assessment

The PRD is **well-structured and comprehensive** for a regulated healthcare product:
- 51 FRs spanning all feature domains, with Growth/Vision tagging for post-MVP features
- 32 NFRs with testable thresholds across performance, security, scalability, accessibility, integration, and reliability
- Strong regulatory framing (LGPD, ANVISA, CFM) embedded in requirements, not siloed
- Risk register with 13 risks (R-01 through R-13) covering compliance, technical, market, and execution risks
- FR23 was updated during prior session to reflect time-limited sharing as MVP (7-day default, 30d/24h/no-expiry options) — aligned with UX spec and architecture

---

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement (summary) | Epic / Story | Status |
|---|---|---|---|
| FR1 | PDF upload from device storage | Epic 2 / Story 2.1, 1.5 | ✅ Covered |
| FR2 | Image upload (camera roll / camera) | Epic 2 / Story 2.2, 1.5 | ✅ Covered |
| FR3 | Extract biomarker values, units, ranges, lab, date | Epic 2 / Story 2.3 | ✅ Covered |
| FR4 | LOINC / UCUM normalization | Epic 2 / Story 2.3 | ✅ Covered |
| FR5 | Per-field confidence score; route <0.85 to manual review | Epic 2 / Story 2.3 | ✅ Covered |
| FR6 | Patient reviews and confirms low-confidence extracted values | Epic 2 / Story 2.4 | ✅ Covered |
| FR7 | Upload status display | Epic 2 / Story 2.5, 2.4 | ✅ Covered |
| FR8 | Offline upload queue | Epic 2 / Story 2.6 | ✅ Covered |
| FR9 | Manual BIA entry (date + device name) | Epic 2 / Story 2.7 | ✅ Covered |
| FR10 | Brazilian decimal separator + reference range format handling | Epic 2 / Story 2.2, 2.3 | ✅ Covered |
| FR11 | Longitudinal biomarker record view (sorted by date) | Epic 3 / Story 3.1 | ✅ Covered |
| FR12 | Personal baseline computation (2+ draws required) | Epic 3 / Story 3.3 | ✅ Covered |
| FR13 | Longitudinal Fingerprint visualization | Epic 3 / Story 3.2, 3.3 | ✅ Covered |
| FR14 | Personal baseline deviation flagging | Epic 3 / Story 3.3 | ✅ Covered |
| FR15 | Draw-1 partial Fingerprint with population context | Epic 3 / Story 3.2 | ✅ Covered |
| FR16 | Cached Fingerprint available offline with last-updated timestamp | Epic 3 / Story 3.4 | ✅ Covered |
| FR17 | Streamed Letter narrative after draw confirmed | Epic 4 / Story 4.1 | ✅ Covered |
| FR18 | Letter incorporates blood markers + BIA longitudinal patterns | Epic 4 / Story 4.1 | ✅ Covered |
| FR19 | ANVISA-compliant AI framing ("direction not diagnosis") | Epic 4 / Story 4.1 | ✅ Covered |
| FR20 | Patient re-reads previously generated Letter | Epic 4 / Story 4.2 | ✅ Covered |
| FR21 | Per-biomarker, per-doctor sharing configuration | Epic 5 / Story 5.1 | ✅ Covered |
| FR22 | Patient revokes doctor access | Epic 5 / Story 5.4 | ✅ Covered |
| FR23 | Generate time-limited sharing link (7-day default, 30d/24h/no-expiry) | Epic 5 / Story 5.2 | ✅ Covered |
| FR24 | Access Log view | Epic 5 / Story 5.3 | ✅ Covered |
| FR25 | Immutable access log entries | Epic 5 / Story 5.3 | ✅ Covered |
| FR26 | Doctor opens link without app; auth before data shown; pre-auth landing page | Epic 6 / Story 6.1, 6.2 | ✅ Covered |
| FR27 | Conversation Starter: trend cards with personal baseline band | Epic 6 / Story 6.2 | ✅ Covered |
| FR28 | Up to 3 AI-generated discussion prompts for doctor | Epic 6 / Story 6.2 | ✅ Covered |
| FR29 | Doctor activates professional account from shared link | Epic 6 / Story 6.3 | ✅ Covered |
| FR30 | Doctor invites patient by email or phone | Epic 6 / Story 6.4 | ✅ Covered |
| FR31 | Doctor configures biomarker staleness thresholds | Epic 6 / Story 6.5 | ✅ Covered |
| FR32 | Explicit per-data-type consent before health data collected | Epic 1 / Story 1.2 | ✅ Covered |
| FR33 | Consent events recorded with timestamp, version, scope | Epic 1 / Story 1.1, 1.2, 1.4 | ✅ Covered |
| FR34 | JSON export of complete health record | Epic 5 / Story 5.5 | ✅ Covered |
| FR35 | PDF export of complete health record | Epic 5 / Story 5.5 | ✅ Covered |
| FR36 | Permanent account and data deletion | Epic 5 / Story 5.6 | ✅ Covered |
| FR37 | Patient views active consent summary | Epic 1 / Story 1.4 | ✅ Covered |
| FR38 | Operator views anonymised manual review queue | Epic 8 / Story 8.1 | ✅ Covered |
| FR39 | Operator confirms or rejects extraction field values | Epic 8 / Story 8.2 | ✅ Covered |
| FR40 | Confirmed results published with patient notification | Epic 8 / Story 8.2 | ✅ Covered |
| FR41 | Immutable audit log of all data access events | Epic 8 / Story 8.2 (+ Epic 0 / Story 0.4 for infrastructure) | ✅ Covered |
| FR42 | Patient creates account with email and password | Epic 1 / Story 1.1 | ✅ Covered |
| FR43 | Biometric authentication (Face ID / fingerprint) | Epic 1 / Story 1.3 | ✅ Covered |
| FR44 | Push notifications for key events | Epic 2 / Story 2.5, 2.8 | ✅ Covered |
| FR45 | Patient manages notification preferences per event type | Epic 2 / Story 2.8 | ✅ Covered |
| FR46 | Onboarding-time import of prior lab results | Epic 1 / Story 1.5 | ✅ Covered |
| FR47 | Life events on Fingerprint timeline with privacy_flag | Epic 7 / Story 7.1 | ✅ Covered |
| FR48 (Growth) | Pre-results emotional check-in (5 states, patient-only) | Epic 7 / Story 7.2 | ✅ Covered |
| FR49 (Growth) | Post-results emotional check-in; pre/post shift stored | Epic 7 / Story 7.3 | ✅ Covered |
| FR50 (Growth) | "Explain this to my doctor" biomarker tap feature | Epic 4 / Story 4.3 | ✅ Covered |
| FR51 (Vision) | Voice memo at upload (30s); patient-only by default | Epic 7 / Story 7.4 | ✅ Covered |

### Missing Requirements

None. All 51 FRs have traceable coverage in epics and stories.

### Coverage Statistics

- Total PRD FRs: 51
- FRs covered in epics: 51
- **Coverage: 100%**

---

## UX Alignment Assessment

### UX Document Status

**Found:** `ux-design-specification.md` (95K, complete — all 14 workflow steps completed 2026-05-13)

The UX spec is comprehensive: emotional journey mapping, 6 component definitions (BiomarkerCard, FingerprintChart, LetterReader, ExtractionPulse, AccessLogItem, ShareBiomarkerToggle, PreAuthLandingCard, EmptyStateRecord, ConversationStarterPrompt), responsive strategy, accessibility targets, UX patterns, design token system, and 4 detailed user journey flowcharts.

### UX ↔ PRD Alignment

**Strongly aligned:**
- All 4 PRD user journeys (Maria WhatsApp-native, Maria Organiser, Dr. Rodrigo, Operator) are reflected in UX journey flows
- Time-limited sharing as default paradigm — UX spec explicitly inverts the market default ("permanent access is the anomaly"); directly matches FR23 and MVP Capability #15
- ANVISA "direction not diagnosis" framing — enforced in UX through copy guidelines, component content guidelines, and emotional design principles
- Doctor 90-second conversion window — pre-auth landing page design, magic link auth, `conversation_starter_cache` pre-generation all aligned
- Privacy as primary UI — Access Log on bottom tab bar, ShareBiomarkerToggle as ceremony not settings, UX-DR6/7/13/14 fully specified

**Gap identified — LGPD AI Narrative Consent (Major):**

The UX spec (Disclosure & Privacy Patterns section) describes **three distinct onboarding consent prompts**:
1. "Processar seus exames para calcular tendências pessoais" (core function)
2. **"Gerar A Carta do Seu Eu Passado com IA"** (AI narrative — The Letter)
3. "Nos ajudar a melhorar o produto com dados anonimizados" (analytics, optional)

**Story 1.2** only covers consent for: (1) blood test results, (2) bioimpedance measurements — data type consent.

**Missing:** An explicit patient-facing consent screen for **AI processing / The Letter generation** is absent from Story 1.2's acceptance criteria. Under LGPD Art. 11, sending health data to an LLM provider for narrative generation constitutes additional processing that requires separate explicit consent from the patient — distinct from consent to store the data type. This is architecturally addressed by the LLM DPA requirement (AR9, NFR-S6) but the **patient-visible consent screen** is missing from the stories.

**Recommendation:** Add an acceptance criterion to Story 1.2 covering a third consent screen: explicit patient consent for AI narrative generation (The Letter), identifying Anthropic as the processor and the purpose. This is a LGPD Art. 11 compliance gap.

### UX ↔ Architecture Alignment

**Strongly aligned:**
- Tamagui design system: specified in architecture (AR2) and fully detailed in UX spec — token names and values match
- SSE streaming endpoint not proxied through tRPC: AR17 matches UX requirement for first token <3s
- `conversation_starter_cache` pre-generated at share-token creation: AR16 matches UX 90-second window
- Session-mode pooler: AR4 matches requirement for `SET LOCAL` context variable needed by RLS
- Bottom tab bar never hidden: AR11 `premiumProcedure` and UX-DR11 both specify tab bar persistence

**Gap identified — $color.error Token Contradiction (Major, pre-existing):**

Two contradictory statements exist **within the UX spec itself** (confirmed unchanged from prior readiness report):

- **Colour table** (UX spec p.499): `color.error = #DC2626` — "System — True Errors Only (never biomarker values)" — red is used for extraction failure, system errors
- **Feedback patterns** (UX spec p.1079): "`$color.error` is overridden globally to amber-warm (#D97706), never red. This is a system-level token decision."

Story 0.2 (Tamagui config) exports `$color.error: '#DC2626'` (following the colour table). However if the feedback pattern section's intent is honored — amber globally — this would eliminate red entirely and the "System — True Errors Only" distinction in the colour table becomes moot.

**Impact:** Story 0.2's acceptance criteria specify `$color.error: '#DC2626'`. If the developer follows the colour table (which Story 0.2 reflects), system errors will use red — which is the more defensible UX position (amber for biomarker deviation, red for system errors). The feedback section's absolute "never red" statement is at odds with this.

**Recommendation:** Francis needs to make a decision: (A) Keep red (#DC2626) for system errors only, amber for biomarker deviation — Story 0.2 is correct as written; or (B) Eliminate red entirely and map all error states to amber. Update UX spec to resolve the contradiction before implementation begins.

**Gap identified — Doctor Social Login (Minor):**

UX spec repeatedly references "magic link or social login" as doctor auth options (multiple sections). Architecture and stories implement only magic link + email/password. No social login provider (Google, Microsoft) is specified or architected.

**Impact:** The doctor's 90-second conversion window benefits from social login since it avoids email round-trips. However, social login requires OAuth provider setup, scope declaration, and App Store/Play Store disclosure — none of which are trivial for a healthcare app. Magic link achieves the same one-field, one-button auth pattern.

**Recommendation:** Clarify whether social login is MVP or post-MVP. If post-MVP, remove "social login" references from UX spec to avoid developer confusion. Stories are correct as-written (magic link only) — no story change needed unless social login is confirmed MVP.

### Warnings

1. **Amber contrast (documented, not a gap):** Amber (#D97706) on off-white (#F9F7F4) = 3.1:1 ratio — passes WCAG AA for large text (≥3:1) but fails for normal text (requires 4.5:1). The UX spec documents the resolution (always large text + icon + dark text on amber background). Stories do not enforce this as an acceptance criterion. Risk: a developer could apply amber as body text and introduce an accessibility violation. Mitigate by adding an axe-core CI check (Story 0.6 covers this).

2. **Analytics consent (ambiguous):** The UX spec describes an optional analytics consent at onboarding. The PRD (NFR-S5) prohibits third-party analytics SDKs from receiving health data. If Health Tracker collects any first-party anonymized analytics, an optional LGPD consent is needed. If no analytics are collected, the UX spec prompt is unnecessary. Clarification needed: are any anonymized analytics being collected in MVP? If yes, Story 1.2 needs a fourth consent screen (optional).

3. **Direction selection deferred:** The UX spec defers final home screen direction selection to Figma phase ("direction decision deferred to Figma design phase"). Stories are written for the navigation structure and component interactions, not a specific home screen layout direction. This is appropriate — implementation can proceed from component stories without the final direction locked — but the Figma deliverable is a dependency before the first Sprint 1 UI stories can be accepted.

---

## Epic Quality Review

### Epic Structure Validation

#### Epic 0: Project Foundation & Development Environment

**User value:** ⚠️ Technical foundation epic — no direct user value. This is **intentional and acceptable** for a greenfield project per BMAD methodology. The architecture explicitly defines Sprint 0 non-negotiables (AR1–AR21) that must be established before any feature story begins. The green flag for Epic 0 is the architecture's explicit Sprint 0 requirement, not a design flaw.

**Starter template:** ✅ Story 0.1 is "Initialize monorepo from create-t3-turbo starter template" — correct placement as the very first story.

**Greenfield indicators:** ✅ Epic 0 includes initial project setup (0.1), design system (0.2), auth (0.3), RLS (0.4), job queue (0.5), CI/CD (0.6), and Sentry (0.7). All appropriate Sprint 0 work.

**Independence:** ✅ Epic 0 is prerequisite for all others; no forward dependencies.

---

#### Epic 1: Patient Can Create an Account and Their Health Record Begins

**User value:** ✅ Directly user-facing — registration, consent, biometric auth, onboarding import.

**Independence:** ✅ Complete standalone epic; a patient can register, consent, and import prior results.

**Story dependency chain:**
- Story 1.1 (account creation) → standalone ✅
- Story 1.2 (consent) → requires 1.1 (account exists) ✅
- Story 1.3 (biometric) → requires 1.1 ✅
- Story 1.4 (manage consents) → requires 1.2 ✅
- Story 1.5 (onboarding import) → requires 1.2 + **references Epic 2 pipeline** ⚠️

**Soft forward dependency — Story 1.5 → Epic 2 (Minor):**
Story 1.5 AC states: "it is processed by the same extraction pipeline as post-onboarding uploads (Story 2.1 / 2.2)." This cross-epic reference means Story 1.5's upload UI can be built and tested in Epic 1, but the actual extraction processing depends on Epic 2's pipeline. Story 1.5 is correctly scoped to the *onboarding entry point* only — the extraction pipeline is Epic 2's responsibility. This is an acceptable incremental delivery pattern, not a blocking forward dependency. Developer should be aware that uploaded files will queue but not process until Epic 2 stories are complete.

---

#### Epic 2: Patient Can Upload and Review Blood Test Results

**User value:** ✅ Core patient capability — upload, extract, confirm, view status, offline queue.

**Independence:** ✅ Complete with Epic 1 (account required) + Epic 0 (infrastructure).

**Developer story flagged:**
- Story 2.3 ("System extracts and normalizes biomarker values") — "As a developer" user story type. This is a system-level story with no direct patient interaction; the "As a developer" framing is acceptable for pipeline implementation stories. No change required.

**Story 2.4 informal reference to Epic 8 (Minor):**
Story 2.4 AC states: "it is inserted into the manual review queue (Story 8.1)" — informational reference only. Story 2.4 (patient-facing low-confidence review) is complete without Epic 8 being implemented; the queue exists as a data structure concept even before the operator dashboard is built.

**Database entity timing:** ✅ `uploads`, `observations` tables created within Epic 2 stories (not front-loaded).

---

#### Epic 3: Patient Can See Their Health Fingerprint Over Time

**User value:** ✅ The core aha moment — longitudinal Fingerprint with personal baseline.

**Independence:** ✅ Complete with Epics 0–2 outputs (needs observation data).

**Story quality — Story 3.3:**
NFR-SC4 acceptance criterion ("p95 response time under 500ms against 10M biomarker records, validated by a load test fixture") is testable and specific. ✅ No vague criteria.

**Story 3.2 cold-start state:** All 3 cold-start scenarios (Draw 1, Draw 2, Draw 2+) properly distributed across Stories 3.2 and 3.3. ✅

---

#### Epic 4: Patient Receives a Personal Health Narrative

**User value:** ✅ The Letter — streamed narrative, ANVISA-compliant, premium-gated.

**Independence:** ✅ Complete with Epics 0–3 outputs.

**Story 4.3 Growth label:** Correctly labeled as Growth feature; premiumProcedure middleware applied; ANVISA framing enforced. ✅

---

#### Epic 5: Patient Controls Who Sees Their Health Data

**User value:** ✅ Sharing ceremony, Access Log, revocation, export, deletion — patient privacy as primary surface.

**Independence:** ✅ Complete with Epics 0–4 outputs.

**Story 5.1 forward reference to Story 5.2 (Minor):**
Story 5.1 first AC: "I first see the duration picker (Story 5.2) before the per-biomarker toggle screen." This is a soft forward reference — the sharing ceremony spans both stories. Story 5.1 tests the per-biomarker toggle screen; Story 5.2 tests the duration picker. A developer implementing Story 5.1 should stub the duration step with a placeholder. Both stories in the same epic and same sprint — acceptable. No rework needed but the note is worth developer awareness.

---

#### Epic 6: Doctor Can View a Patient's Conversation Starter

**User value:** ✅ Complete doctor experience — landing page, auth, report, account activation, patient invitation, staleness thresholds.

**Independence:** ✅ Requires Epic 5 (sharing tokens created before doctor can view). Correct epic ordering.

**Pre-generated cache dependency:** Story 6.2 depends on `conversation_starter_cache` pre-generated in Story 5.2 (AR16). This is a correct cross-epic dependency (Epic 5 creates, Epic 6 reads) — not a forward dependency. ✅

**Story 6.4 (doctor invites patient) referencing `pending_invites`:** Architecture (AR15) specifies this table. Correct. ✅

---

#### Epic 7: Patient Adds Personal Context to Their Record

**User value:** ✅ Life events, emotional check-ins, voice memo.

**Independence:** ✅ Complete with Epics 0–3 outputs.

**Growth/Vision labeling:** Stories 7.2 (FR48 Growth), 7.3 (FR49 Growth), 7.4 (FR51 Vision) correctly labeled in requirements line. ✅

**Privacy flags:** All personal-context stories enforce `privacy_flag = 'patient_only'` and confirm never-shared-with-doctor invariant. ✅

---

#### Epic 8: Operator Can Manage Extraction Quality

**User value:** ✅ Operator can manage quality gate — legitimate user value for the operator persona.

**Independence:** ✅ Standalone with Epic 0 infrastructure and Epic 2 extraction pipeline.

**Story 8.2 upload-transitions.ts:** Confirms only `upload-transitions.ts` may transition upload to `complete` — critical architectural invariant correctly encoded in ACs. ✅

---

### Best Practices Compliance Checklist

| Epic | Delivers User Value | Independently Valuable | Stories Appropriately Sized | No Forward Dependencies | Tables Created When Needed | Clear ACs | FR Traceability |
|---|---|---|---|---|---|---|---|
| Epic 0 | ⚠️ Technical (acceptable for Sprint 0) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Epic 1 | ✅ | ✅ | ✅ | ⚠️ 1.5→E2 (minor) | ✅ | ✅ | ✅ |
| Epic 2 | ✅ | ✅ | ✅ | ⚠️ 2.4→E8 (minor) | ✅ | ✅ | ✅ |
| Epic 3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Epic 4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Epic 5 | ✅ | ✅ | ✅ | ⚠️ 5.1→5.2 (minor) | ✅ | ✅ | ✅ |
| Epic 6 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Epic 7 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Epic 8 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Quality Findings

#### 🔴 Critical Violations
None.

#### 🟠 Major Issues
None.

#### 🟡 Minor Concerns

**MC-1: Story 1.5 cross-epic pipeline reference**
- *Finding:* Story 1.5 references "processed by the same extraction pipeline as post-onboarding uploads (Story 2.1 / 2.2)" — informational cross-epic dependency
- *Impact:* Low — Story 1.5 UI is implementable in Epic 1; extraction processing happens automatically when Epic 2 is complete
- *Recommendation:* Developer note: uploaded files during onboarding will queue but not extract until Epic 2 stories are complete. No story change needed; sprint planning should note this handoff.

**MC-2: Story 5.1 forward reference to Story 5.2**
- *Finding:* Story 5.1 AC says "I first see the duration picker (Story 5.2) before the per-biomarker toggle screen"
- *Impact:* Low — both stories are in the same epic and sprint; developer should stub duration step when building 5.1
- *Recommendation:* Note for sprint planning; no story rewrite needed.

**MC-3: Story 2.3 "As a developer" format**
- *Finding:* Story 2.3 uses developer persona rather than patient persona
- *Impact:* Cosmetic — appropriate for pipeline implementation with no direct patient interaction
- *Recommendation:* Acceptable as-written; no change needed.

---

## Summary and Recommendations

### Overall Readiness Status

## ✅ READY — with 1 required pre-implementation action and 2 decisions needed before Sprint 1

The planning artifacts are substantially complete and well-aligned. The critical blockers from the prior assessment (no Epics & Stories document; time-limited sharing PRD/UX conflict) are resolved. FR coverage is 100%. Epic structure is sound. Architecture compliance is embedded in story acceptance criteria. The one required action before implementation begins is documented below.

---

### Issues Found: 4 total across 3 categories

| ID | Severity | Category | Finding |
|---|---|---|---|
| I-1 | 🟠 Major | LGPD Compliance | Story 1.2 missing explicit patient consent screen for AI narrative (The Letter) processing — LGPD Art. 11 gap |
| I-2 | 🟠 Major | UX ↔ Architecture | `$color.error` contradiction within UX spec (colour table: #DC2626 for system errors; feedback section: globally overridden to amber) — story 0.2 and developer guidance unclear |
| I-3 | 🟡 Minor | UX ↔ Architecture | Doctor social login mentioned in UX spec but not in architecture or stories — "magic link or social login" vs. magic link only |
| I-4 | 🟡 Minor | Epic Quality | 3 soft forward references in stories (1.5→E2, 2.4→E8, 5.1→5.2) — informational only, not blocking |

---

### Critical Issues Requiring Immediate Action

**I-1: LGPD AI Narrative Consent — Action Required Before Sprint 1**

Story 1.2 covers consent for blood test results and bioimpedance measurements. The UX spec describes a third onboarding consent screen for AI narrative processing ("Gerar A Carta do Seu Eu Passado com IA"). Under LGPD Art. 11, sending health data to Anthropic (an LLM provider) for The Letter constitutes additional processing that requires separate explicit patient consent — distinct from consenting to store the data type.

**Required action:** Add the following to Story 1.2 acceptance criteria:

> **Given** the blood test results and bioimpedance consents are accepted,
> **When** the AI narrative consent screen appears,
> **Then** it identifies Anthropic as the AI processing provider, explains that blood marker and BIA data will be sent to generate personalized narratives (The Letter), and requires a distinct "Concordo" tap before The Letter feature is enabled; declining this consent allows data storage but disables The Letter and Conversation Starter discussion prompts.

This keeps Story 1.2's scope (onboarding consent flows) without creating a new story, and satisfies LGPD Art. 11 for AI processing.

---

### Decisions Required From Francis

**Decision 1: $color.error token (I-2)**

The UX spec contains two contradictory definitions:
- **Colour table:** `color.error = #DC2626` (red) — used for system errors only, explicitly NOT for biomarker values
- **Feedback patterns section:** "`$color.error` is overridden globally to amber, never red"

Story 0.2 currently implements `$color.error: '#DC2626'` following the colour table.

**Choose one:**
- **(A) Keep red for system errors** — colour table is correct. Amber (`color.deviationAmber`) handles all biomarker deviation signals. Red is reserved for extraction failures, network errors. This is the more defensible UX position (different semantic meaning for biomarker deviation vs. system error).
- **(B) Eliminate red entirely** — feedback section is the intent. All error-adjacent states use amber. Update Story 0.2 to remove `$color.error: '#DC2626'` and add a note that amber is the sole deviation colour across the system.

**Recommendation:** Option A. The colour table's distinction between biomarker deviation (amber) and system error (red) is clinically appropriate and avoids over-engineering the amber signal to carry two different meanings.

---

**Decision 2: Doctor social login (I-3)**

UX spec mentions "magic link or social login" in multiple sections. Architecture and stories implement magic link only.

**Choose one:**
- **(A) Magic link only for MVP** — remove "social login" references from UX spec to avoid developer confusion. Stories are correct as-written.
- **(B) Social login is MVP** — add a story to Epic 6 for Google/Microsoft OAuth setup; update architecture (AR3) to include OAuth providers; update Story 0.3 to configure OAuth in Supabase Auth.

**Recommendation:** Option A. Magic link achieves the 90-second doctor conversion target. Social login adds OAuth provider setup, App Store disclosure updates, and LGPD consent changes — not worth the Sprint 0 scope increase. Post-MVP is the right placement.

---

### Recommended Next Steps

1. **Immediately:** Add AI narrative consent AC to Story 1.2 (I-1 fix — 10 minutes of work)
2. **Before Sprint 1 planning:** Make the $color.error decision (I-2) and update either Story 0.2 AC or the UX spec feedback section accordingly
3. **Before Sprint 1 planning:** Confirm doctor social login is post-MVP (I-3) and update UX spec to remove "social login" language
4. **Sprint 0 Day 1:** Follow the architecture's recommended decision sequence — RLS token principal model ADR → `professional_id` FK schema → entitlement enforcement layer — these must be resolved before feature stories begin
5. **Pre-launch gate (not blocking Sprint 0):** DPO appointment, Anthropic DPA, legal ANVISA framing review — these are launch blockers but not planning blockers

### Final Note

This assessment identified **4 issues** across **3 categories**. The planning corpus is in excellent shape for a high-complexity regulated healthcare product — 100% FR coverage, strong architectural invariants woven into story ACs, clear epic independence, LGPD and ANVISA compliance embedded throughout. The LGPD AI narrative consent gap (I-1) is the single item that must be resolved before implementation begins; the remaining three are either decisions or informational notes for the development team.

**Assessor:** Implementation Readiness Workflow (BMAD v6.5.0)
**Date:** 2026-05-15
**Documents assessed:** prd.md, architecture.md, epics.md (42 stories), ux-design-specification.md
