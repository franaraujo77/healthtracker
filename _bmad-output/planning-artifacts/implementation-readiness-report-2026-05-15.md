---
stepsCompleted: ["step-01-document-discovery", "step-02-prd-analysis", "step-03-epic-coverage-validation", "step-04-ux-alignment", "step-05-epic-quality-review", "step-06-final-assessment"]
documentsIncluded:
  prd: "_bmad-output/planning-artifacts/prd.md"
  architecture: "_bmad-output/planning-artifacts/architecture.md"
  ux: "_bmad-output/planning-artifacts/ux-design-specification.md"
  epics: null
---

# Implementation Readiness Assessment Report

**Date:** 2026-05-15
**Project:** healthtracker

---

## Document Inventory

| Type | File | Size | Last Modified |
|------|------|------|---------------|
| PRD | `prd.md` | 55 KB | May 13 |
| Architecture | `architecture.md` | 83 KB | May 14 |
| UX Design | `ux-design-specification.md` | 97 KB | May 14 |
| Epics & Stories | ❌ Not found | — | — |

---

## PRD Analysis

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
- FR23: Patient can generate a shareable link to their Conversation Starter report for a specific doctor
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

**Total FRs: 51** (FR1–FR51; FR48–FR51 are Growth/Vision phase)

---

### Non-Functional Requirements

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

**Total NFRs: 29** (P1–P6, S1–S8, SC1–SC4, A1–A5, I1–I4, R1–R5)

---

### Additional Requirements / Constraints

- **LGPD Art. 11**: Health data is sensitive data; explicit informed consent required per data type; DPO required before launch; breach notification within 2 business days; data portability and right to erasure mandated
- **ANVISA RDC 657/2022**: All AI outputs must use "direction not diagnosis" framing; no MDSW classification threshold exceeded; any new AI feature requires internal framing review before shipping
- **CFM Resolution 2.314/2022**: Conversation Starter must not be framed as a clinical consultation or medical advice
- **LLM DPA**: Must be in place before any patient data sent to LLM provider; provider must have no-training-on-data clause and EU/BR data residency
- **LOINC normalization scope**: Top 20 Brazilian lab biomarkers (CBC, lipid panel, metabolic, thyroid, iron, CRP) required at MVP
- **App store compliance**: Apple Health & Fitness category; Google Play sensitive data declaration; no HealthKit in MVP
- **IAP**: R$39/month premium subscription; web-subscription path considered to avoid store fees

### PRD Completeness Assessment

The PRD is thorough and production-ready. Requirements are numbered, traceable, and phase-tagged (MVP / Growth / Vision). Compliance constraints are specific and actionable. The main gap from a readiness perspective is **no Epics & Stories document exists** — the FRs and NFRs have no breakdown into implementable work units yet.

---

## Epic Coverage Validation

### Coverage Matrix

| FR Number | PRD Requirement (summary) | Epic Coverage | Status |
|-----------|--------------------------|---------------|--------|
| FR1 | PDF upload from device storage | **NOT FOUND** | ❌ MISSING |
| FR2 | Image upload from camera roll / capture | **NOT FOUND** | ❌ MISSING |
| FR3 | Extract biomarker values, units, reference ranges, lab name, date | **NOT FOUND** | ❌ MISSING |
| FR4 | Normalize biomarkers to LOINC/UCUM | **NOT FOUND** | ❌ MISSING |
| FR5 | Per-field confidence score; route <0.85 to manual review | **NOT FOUND** | ❌ MISSING |
| FR6 | Patient reviews extracted values with flags; confirm/correct fields | **NOT FOUND** | ❌ MISSING |
| FR7 | Upload status (processing / pending review / published / failed) | **NOT FOUND** | ❌ MISSING |
| FR8 | Offline upload queue; auto-executes on connectivity restore | **NOT FOUND** | ❌ MISSING |
| FR9 | Manual BIA entry with date and device name | **NOT FOUND** | ❌ MISSING |
| FR10 | Brazilian decimal separator and multiple reference range format handling | **NOT FOUND** | ❌ MISSING |
| FR11 | Longitudinal biomarker record view sorted by collection date | **NOT FOUND** | ❌ MISSING |
| FR12 | Personal baseline computation (2+ draws) | **NOT FOUND** | ❌ MISSING |
| FR13 | Longitudinal Fingerprint visualization (personal baseline band) | **NOT FOUND** | ❌ MISSING |
| FR14 | Flag significant deviations from personal baseline | **NOT FOUND** | ❌ MISSING |
| FR15 | Draw-1 partial Fingerprint with population context | **NOT FOUND** | ❌ MISSING |
| FR16 | Cached Fingerprint available offline with "last updated" timestamp | **NOT FOUND** | ❌ MISSING |
| FR17 | Streamed Letter narrative after draw confirmed | **NOT FOUND** | ❌ MISSING |
| FR18 | Letter incorporates blood markers + BIA longitudinal patterns | **NOT FOUND** | ❌ MISSING |
| FR19 | All AI text uses ANVISA-compliant "direction not diagnosis" framing | **NOT FOUND** | ❌ MISSING |
| FR20 | Patient can re-read previous Letters from record history | **NOT FOUND** | ❌ MISSING |
| FR21 | Per-biomarker, per-doctor sharing configuration | **NOT FOUND** | ❌ MISSING |
| FR22 | Patient can revoke doctor access at any time | **NOT FOUND** | ❌ MISSING |
| FR23 | Generate shareable Conversation Starter link for a specific doctor | **NOT FOUND** | ❌ MISSING |
| FR24 | Access Log — who viewed which biomarkers and when | **NOT FOUND** | ❌ MISSING |
| FR25 | Access log entries are immutable | **NOT FOUND** | ❌ MISSING |
| FR26 | Doctor opens link without app install; auth before data displayed; pre-auth shows name/context only | **NOT FOUND** | ❌ MISSING |
| FR27 | Conversation Starter: trend cards with current value, previous value, trend, personal baseline band | **NOT FOUND** | ❌ MISSING |
| FR28 | Up to 3 AI-generated discussion prompts for doctor | **NOT FOUND** | ❌ MISSING |
| FR29 | Doctor activates professional account from shared link view | **NOT FOUND** | ❌ MISSING |
| FR30 | Doctor invites patient by email or phone | **NOT FOUND** | ❌ MISSING |
| FR31 | Doctor configures biomarker staleness thresholds | **NOT FOUND** | ❌ MISSING |
| FR32 | Explicit per-data-type consent before health data collected | **NOT FOUND** | ❌ MISSING |
| FR33 | Consent events recorded with timestamp, version, and scope | **NOT FOUND** | ❌ MISSING |
| FR34 | JSON export of complete health record | **NOT FOUND** | ❌ MISSING |
| FR35 | PDF export of complete health record | **NOT FOUND** | ❌ MISSING |
| FR36 | Permanent account and data deletion, confirmed and irreversible | **NOT FOUND** | ❌ MISSING |
| FR37 | Patient views active consent summary | **NOT FOUND** | ❌ MISSING |
| FR38 | Operator views anonymised manual review queue | **NOT FOUND** | ❌ MISSING |
| FR39 | Operator confirms or rejects extraction field values | **NOT FOUND** | ❌ MISSING |
| FR40 | Confirmed results published to patient record with notification | **NOT FOUND** | ❌ MISSING |
| FR41 | Immutable audit log of all data access events | **NOT FOUND** | ❌ MISSING |
| FR42 | Patient creates account with email and password | **NOT FOUND** | ❌ MISSING |
| FR43 | Biometric auth (Face ID / fingerprint) | **NOT FOUND** | ❌ MISSING |
| FR44 | Push notifications for key events | **NOT FOUND** | ❌ MISSING |
| FR45 | Patient manages notification preferences per event type | **NOT FOUND** | ❌ MISSING |
| FR46 | Onboarding-time import of prior lab results | **NOT FOUND** | ❌ MISSING |
| FR47 | Life events on Fingerprint timeline with privacy_flag | **NOT FOUND** | ❌ MISSING |
| FR48 (Growth) | Pre-results emotional check-in (5 states) | **NOT FOUND** | ❌ MISSING |
| FR49 (Growth) | Post-results emotional check-in; pre/post shift stored | **NOT FOUND** | ❌ MISSING |
| FR50 (Growth) | "Explain this to my doctor" biomarker tap feature | **NOT FOUND** | ❌ MISSING |
| FR51 (Vision) | Voice memo at upload (30s); patient-only, never shared without consent | **NOT FOUND** | ❌ MISSING |

### Missing Requirements

> **Root cause:** No Epics & Stories document has been created. All 51 FRs are untraced.

#### Critical Missing FRs (MVP — must ship before launch)

FR1–FR10 — Health Data Ingestion (entire extraction pipeline)
- Impact: Core product capability; nothing else works without this
- Recommendation: "Data Ingestion" epic

FR11–FR16 — Longitudinal Fingerprint
- Impact: The defining aha moment; primary reason for the product's existence
- Recommendation: "Longitudinal Fingerprint" epic

FR17–FR20 — The Letter
- Impact: Concept 1 validation gate; engagement moat
- Recommendation: "AI Narrative (The Letter)" epic

FR21–FR25 — Sharing & Access Control
- Impact: Doctor Acquisition Loop enabler; also legally required privacy architecture
- Recommendation: "Access Control & Privacy" epic

FR26–FR31 — Doctor Experience
- Impact: Doctor Acquisition Loop completion; growth engine
- Recommendation: "Doctor Experience" epic

FR32–FR37 — Privacy & Compliance (LGPD)
- Impact: **BLOCKER** — legally required before any patient data is collected; cannot launch without
- Recommendation: "Compliance & LGPD" epic

FR38–FR41 — Operator Dashboard & Audit
- Impact: Required to operate confidence gate at scale; audit log is legally required
- Recommendation: "Operator Dashboard" epic (or merged into Compliance epic)

FR42–FR47 — Account, Auth & Onboarding
- Impact: Foundational; no product without auth; onboarding import critical for day-1 value
- Recommendation: "Auth & Onboarding" epic

#### Growth/Vision FRs (Phase 2–3, lower immediate priority)
- FR48–FR49: Emotional check-ins (Growth phase)
- FR50: "Explain this to my doctor" (Growth phase)
- FR51: Voice memos (Vision phase)

### Coverage Statistics

- Total PRD FRs: 51
- FRs covered in epics: 0
- Coverage percentage: **0%** — Epics & Stories document does not yet exist

---

## UX Alignment Assessment

### UX Document Status

✅ **Found** — `ux-design-specification.md` (97 KB, May 14) — comprehensive, all 14 workflow steps completed

### UX ↔ PRD Alignment

**Well-aligned areas:**
- All 4 user journeys (Upload→Fingerprint, Doctor Conversation Starter, Returning Visit, 11pm Frightening Result) directly map to PRD journeys 1–3 and the Journey Requirements Summary
- UX emotional goals (patient "Seen", doctor "Relieved") are consistent with PRD success criteria
- ANVISA framing ("direction not diagnosis") enforced in UX copy and pattern guidelines — consistent with FR19, FR28, and domain requirements
- Personal baseline / population range split in all biomarker display patterns — consistent with FR12–15
- LGPD consent ceremony (3 separate prompts at onboarding) consistent with FR32–33, FR37
- Life events overlay (FR47), voice memos (FR51), emotional check-ins (FR48–49) referenced in UX flows
- Access Log as primary tab (not settings) — consistent with FR24

**✅ RESOLVED — Time-Limited Sharing:**

| Document | What it says |
|----------|-------------|
| **PRD** | "Time-limited sharing links" listed as **Phase 2 (Post-MVP)** feature (4–9 months) |
| **UX Spec** | "Permanent access is the anomaly. Time-limited sharing links are the **default** sharing paradigm" — 7-day default selected in the MVP sharing ceremony UI |
| **Architecture** | `share_tokens` table includes `expires_at TIMESTAMPTZ` — schema supports it, but the architecture document doesn't resolve the MVP vs Phase 2 question |

**Resolution (2026-05-15):** PRD updated — time-limited sharing promoted to MVP capability #15; FR23 updated to specify 7-day default duration selection. UX spec and Architecture are now aligned with PRD. No further action required.

**⚠️ MINOR MISALIGNMENT — Social Login for Doctor Auth:**

| Document | What it says |
|----------|-------------|
| **UX Spec** | "Magic link or social login are the right patterns" for doctor registration |
| **Architecture** | Supabase Auth magic links only; social login not specified |

**Impact:** Low — magic link is sufficient for MVP. Social login as an option could be added without architectural changes. Recommend flagging for doctor conversion rate monitoring.

**⚠️ MINOR GAP — Operator Dashboard UX:**

| Document | What it says |
|----------|-------------|
| **PRD** | FR38–41 listed as MVP must-have capabilities |
| **UX Spec** | No operator dashboard flows or screens designed |
| **Architecture** | FR38–41 explicitly deferred to post-MVP with route group reserved |

**Impact:** Architecture and UX are aligned (both defer), but PRD says operator dashboard is MVP. This is a deliberate scope decision that should be explicitly documented and agreed — the confidence gate can operate via manual email-based review as the PRD itself suggests as a resource contingency.

### UX ↔ Architecture Alignment

**Well-aligned areas:**
- Tamagui design system: UX specifies Tamagui; architecture confirms it, with token configuration specified
- Railway persistent server for SSE streaming: UX requires first token <3s; architecture solves this architecturally
- FingerprintChart component: UX details 5 states (cold-start-1, cold-start-2, baseline-established, doctor-view, loading); architecture defines FingerprintChart in `packages/ui` with Victory Native
- LetterReader with `aria-live="polite"` streaming: consistent across both documents
- ExtractionPulse animation (3s slow pulse, ambient, not spinner): architecture confirms component in `packages/ui`
- Doctor pre-warming (Conversation Starter cache): UX states doctor must have report in <3s; architecture pre-generates at share-token-creation time
- WCAG 2.1 AA target: consistent across UX spec and NFR-A1

**⚠️ RISK — `$color.error` Token Conflict:**

| Document | What it says |
|----------|-------------|
| **UX Spec** | `color.error = #DC2626` — system errors only; amber (`#D97706`) for biomarker deviations |
| **Architecture** | "`$color.error` is overridden globally to amber-warm (`#D97706`)" |

**Impact:** If `$color.error` is globally overridden to amber, upload failure states and system errors (not biomarker deviations) will also display in amber instead of the appropriate error red. The UX spec intentionally preserves `#DC2626` for system errors. The architecture's global override is too broad. The token approach should be: amber for biomarker deviation tokens, red for system error tokens — separate semantic tokens, not a global override.

**⚠️ RISK — Victory Native Animation Fidelity:**

- UX specifies: trend line animates in on Draw 2+, ambient slow pulse for extraction, reduced-motion fallbacks
- Architecture: Victory Native selected for MVP with upgrade path to Skia if needed
- Victory Native has limited animation primitives compared to the UX animation spec. The ambient pulse and trend line animation may require custom wrappers or a faster-than-expected Skia migration.

### Warnings

1. **Time-limited sharing phase conflict** — Must resolve before sharing ceremony implementation. Recommend: clarify with PRD owner whether 7-day default is MVP or Phase 2, then update either PRD or UX spec.
2. **`$color.error` global override** — Should be corrected in architecture before token system is implemented. Use separate amber biomarker deviation tokens; preserve red for system errors.
3. **Victory Native animation** — Test ExtractionPulse pulse animation and FingerprintChart trend line animation against the UX motion spec early in Phase 1 (Days 1–45). De-risk before Skia migration becomes necessary.
4. **Operator dashboard scope gap** — Align PRD, architecture, and UX on whether FR38–41 are MVP or explicitly deferred. If deferred, update PRD to reflect Phase 2.
5. **Social login gap** — Low priority for MVP, but doctor conversion rate on magic-link-only should be monitored from day 1. Social login fallback may become necessary based on conversion data.

---

## Epic Quality Review

### Status

**Cannot execute** — no Epics & Stories document exists. This section documents the quality standards that the to-be-created epics must meet.

### Quality Standards for Epic Creation

When epics are created (via `bmad-create-epics-and-stories`), every epic must be validated against:

#### Epic Structure Requirements

**✅ Must have:**
- User-centric title describing what the user can do ("Patient can upload and review a blood test")
- User outcome goal (not a technical milestone)
- Standalone value: a user must benefit from this epic without requiring a future epic

**🔴 Forbidden epic titles (examples of what NOT to do):**
- "Setup Database" / "Create Schema" / "Configure RLS"
- "API Development" / "Infrastructure Setup"
- "Authentication System" (borderline — must frame as user value)

#### Recommended Epic Structure for This Project

Based on the PRD FR domains and Architecture decision sequence, the epics should map as follows:

| Epic # | Recommended Title | FRs Covered | PRD Phase | Arch Priority |
|--------|------------------|-------------|-----------|---------------|
| Epic 0 | Project Foundation & Sprint 0 Setup | — | Pre-MVP | Sprint 0 non-negotiables |
| Epic 1 | Patient Can Create an Account and Start Their Health Record | FR32, FR33, FR37, FR42, FR43, FR46 | MVP | Sequential chain steps 1–4 |
| Epic 2 | Patient Can Upload and Review Blood Test Results | FR1–10 | MVP | Track A (ingestion) |
| Epic 3 | Patient Can See Their Health Fingerprint Over Time | FR11–16 | MVP | After Epic 2 |
| Epic 4 | Patient Receives a Personal Health Narrative (The Letter) | FR17–20 | MVP | After Epic 3 (Track B) |
| Epic 5 | Patient Controls Who Sees Their Health Data | FR21–25, FR34, FR35, FR36 | MVP | After Epic 1 |
| Epic 6 | Doctor Can View a Patient's Conversation Starter | FR26–31 | MVP | After Epic 5 |
| Epic 7 | Patient and Operator Can Manage Extraction Quality | FR38–41 | MVP (or defer) | After Epic 2 |
| Epic 8 | Life Events and Personal Context | FR47 | MVP | After Epic 3 |

#### Critical Structural Rules

1. **Epic 0 — Project Foundation must be Epic 1, Story 1:** Architecture mandates `create-t3-turbo` initialization and Sprint 0 non-negotiables before any feature story. The first story must be: "Set up initial project from create-t3-turbo starter template with pnpm."

2. **Database tables created per story, not upfront:** Do NOT create all tables in a single setup story. Each story should create the table(s) it first needs. Architecture's `drizzle.config.ts` guard and CI `drizzle-kit check` gate manage migration safety.

3. **No forward dependencies:** Epic 3 (Fingerprint) can depend on Epic 2 (Upload) — that's a backward dependency and is fine. Epic 2 must NOT reference Epic 3 components.

4. **RLS before data:** Any story writing health data must have its RLS policy written in the same story. Never write data rows before the RLS policy is in place.

5. **LGPD consent gate:** The consent flows (Epic 1) must be complete before any story in Epics 2–8 can collect health data. Epic 1 is the unbreakable dependency for all data-collection epics.

#### Story Quality Standards

Each story must include:
- **Title:** "Patient/Doctor/Operator can [verb] [object]" — never "Create the X module"
- **User story:** "As a [patient/doctor/operator], I want to [action] so that [outcome]"
- **Acceptance Criteria:** Given/When/Then format, testable, covers error paths
- **FR Traceability:** Which FR(s) does this story cover?
- **Architecture note:** Which packages/services does this touch?

#### Architecture-Specific Requirements for Stories

From the Architecture document, every story that involves:

| Concern | Required in story |
|---------|------------------|
| Patient data writes | RLS `SET LOCAL` pattern in tRPC context; RLS policy file in `packages/db/policies/` |
| Premium features | `premiumProcedure` middleware — not `protectedProcedure` |
| Data access reads | `writeAuditLog()` call in the resolver |
| Patient-facing LLM output | ANVISA system prompt in `services/llm/src/prompts/anvisa-system.ts` |
| Biomarker color display | Amber (`$warningAmber`), never red |
| Upload state changes | Only through `upload-transitions.ts` state machine |

### Best Practices Compliance Checklist (for future review)

Once epics are created, verify each epic against:

- [ ] Epic delivers user value (not a technical milestone)
- [ ] Epic can function independently (no forward epic dependencies)
- [ ] Stories are appropriately sized (completable in 1–3 days)
- [ ] No forward story dependencies within the epic
- [ ] Database tables created only when first needed in that story
- [ ] Acceptance criteria in Given/When/Then format
- [ ] Every AC is independently testable
- [ ] FR traceability maintained per story
- [ ] Sprint 0 non-negotiables are Epic 0 Story 1 preconditions
- [ ] LGPD consent (Epic 1) gates all health data stories

---

## Summary and Recommendations

### Overall Readiness Status

## ⛔ NOT READY — Epics & Stories Missing

The PRD, Architecture, and UX Specification are individually strong and well-aligned with each other. However, the project **cannot proceed to implementation** without an Epics & Stories document. There is also one critical cross-document misalignment that must be resolved first.

---

### Issues by Severity

#### 🔴 Critical (Blockers — must resolve before implementation)

| # | Issue | Documents Affected | Action Required |
|---|-------|-------------------|-----------------|
| C1 | **No Epics & Stories document exists** | All | Run `bmad-create-epics-and-stories` to generate epics and stories from the PRD and Architecture |
| C2 | ~~**Time-limited sharing phase conflict**~~ | ✅ **RESOLVED 2026-05-15** | PRD updated: time-limited sharing (7-day default) promoted to MVP capability #15; FR23 updated to specify duration selection; Post-MVP table entry removed |
| C3 | **Epics & Stories will have 0% FR traceability until created** | — | After epics are created, re-run this readiness check to verify all 51 FRs are covered |

#### 🟠 Major (Should fix before implementation)

| # | Issue | Documents Affected | Action Required |
|---|-------|-------------------|-----------------|
| M1 | **`$color.error` token override is too broad** | Architecture vs UX Spec | Architecture should use a separate amber semantic token for biomarker deviations; preserve `#DC2626` red for system errors only. Update the Architecture document's display patterns section |
| M2 | **Operator Dashboard scope gap** | PRD (MVP FR38–41) vs Architecture (deferred) vs UX Spec (not designed) | Explicitly align all three documents: either update PRD to move FR38–41 to Phase 2, or add operator dashboard flows to UX spec and restore to Architecture MVP scope |
| M3 | **LGPD/ANVISA compliance review not yet initiated** | Architecture (listed as launch blocker) | DPO appointment, LLM DPA, LGPD consent review by counsel — these are non-negotiable launch blockers that require real-world lead time. Start now |

#### 🟡 Minor (Monitor / low-priority)

| # | Issue | Documents Affected | Action Required |
|---|-------|-------------------|-----------------|
| mn1 | **Victory Native animation fidelity risk** | Architecture vs UX Spec | Test ExtractionPulse and FingerprintChart animations early in Phase 1 (Days 1–45); validate against UX motion spec before Skia migration becomes urgent |
| mn2 | **Social login gap for doctor auth** | Architecture vs UX Spec | Monitor doctor magic-link conversion rate from day 1; social login may be needed post-launch |
| mn3 | **LGPD-Railway legal review pending** | Architecture | Legal timebox: confirm before any patient data sent to Anthropic/Railway |

---

### Recommended Next Steps

1. ~~**Resolve the time-limited sharing conflict (C2)**~~ ✅ **Done** — PRD updated 2026-05-15.

2. **Create Epics & Stories (C1)** — Run `bmad-create-epics-and-stories`. Use the recommended epic structure from this report as input. The architecture document's "Decision Sequence (Days 1–10)" and "Recommended Implementation Sequence" should drive story ordering within each epic.

3. **Fix the `$color.error` token in Architecture (M1)** — Update `packages/ui/src/theme/tokens.ts` guidance in the Architecture document: biomarker deviation signals use `$deviationAmber` token; `$colorError` remains `#DC2626` for system errors only.

4. **Align Operator Dashboard scope across all three documents (M2)** — Either add it to UX spec and restore to Architecture MVP scope, or formally move PRD FR38–41 to Phase 2 and document the resource contingency plan (email-based manual review queue).

5. **Initiate compliance lead time items now (M3)** — DPO appointment, Anthropic DPA procurement, LGPD counsel review. These have real-world lead times of weeks, not days. Parallel track to development.

6. **Re-run this readiness check after epics are created** — Once the Epics & Stories document exists, re-run `bmad-check-implementation-readiness` to verify FR coverage is complete and epic quality meets standards.

---

### Final Note

This assessment identified **6 issues** across **3 severity levels**. The 2 critical structural issues (no epics, and the time-limited sharing conflict) are the only genuine blockers to implementation. The PRD is production-quality. The Architecture is detailed and actionable. The UX Specification is comprehensive. The foundation is strong — the project needs its work breakdown structure before the first line of code is written.

**Assessment conducted:** 2026-05-15
**Assessor:** Winston (System Architect / Implementation Readiness)
**Report location:** `_bmad-output/planning-artifacts/implementation-readiness-report-2026-05-15.md`
