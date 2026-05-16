---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish]
releaseMode: phased
inputDocuments:
  - "_bmad-output/planning-artifacts/product-brief-healthtracker.md"
  - "_bmad-output/planning-artifacts/product-brief-healthtracker-distillate.md"
  - "_bmad-output/design-thinking-2026-04-28.md"
  - "_bmad-output/planning-artifacts/research/market-health-tracking-app-individuals-research-2026-05-12.md"
workflowType: 'prd'
classification:
  projectType: mobile+web
  domain: healthcare
  complexity: high
  projectContext: greenfield
---

# Product Requirements Document - Health Tracker

**Author:** Francis
**Date:** 2026-05-12

## Executive Summary

Health Tracker is a patient-owned longitudinal health record for Brazil's 50 million private health consumers. Patients upload blood test results from any Brazilian lab (Fleury, DASA, Hermes Pardini, Einstein, Lavoisier), log bioimpedance readings, and record skinfold measurements — building a unified clinical history that persists across every specialist they see. The product targets Maria: health-conscious, 25–50, urban Brazil, private health insurance, who has seen an endocrinologist, a sports medicine physician, and a nutritionist over three years and still walks into every new appointment starting from zero.

The core problem is structural, not behavioral. Brazil's private lab data sits entirely outside any unified system — the government's Meu SUS Digital covers only SUS patients. The government's own unification target is 2028. Every global platform (Samsung Health, Apple Health, Google Health, WHOOP, InsideTracker) locks clinical features to the US market. The white space is confirmed, unoccupied, and governed by a closing deadline.

### What Makes This Special

**The Longitudinal Fingerprint** computes deviation against the patient's own history, not population reference ranges. A ferritin of 45 ng/mL is "normal" by population standards and a personal crisis for someone whose baseline is 90. No competitor can replicate this without years of patient history they don't have — making the data moat asymmetric and time-locked.

**Granular, revocable, patient-initiated sharing** is architecturally absent from the market. No existing product enables a patient to share their lipid panel with a cardiologist but not their weight, or grant time-limited access for a one-off consultation. Every current approach is either provider-controlled (EMRs, Meu SUS Digital) or flat PDF export.

**The Doctor Acquisition Loop** is the growth engine: patient shares a record → doctor opens a Conversation Starter report (3 AI-generated discussion prompts, scannable in 90 seconds) → doctor activates account → doctor invites other patients → loop repeats. Doctor recommendation is the #1 acquisition lever for clinical health apps — no consumer health app has built this loop.

**Privacy as architecture, not policy.** The Access Log — who viewed which biomarker, and when — is a transparency mechanism no health app, lab portal, or EMR currently offers. 60% of Brazilians are concerned about biometric data (CETIC.br 2024). Privacy is not a settings page; it is the primary UI.

### Project Classification

| Field | Value |
|---|---|
| **Project Type** | Mobile + Web (cross-platform: Expo + Next.js) |
| **Domain** | Healthcare — patient records, clinical biomarker data |
| **Complexity** | High — regulated domain (LGPD Art. 11, ANVISA RDC 657/2022), AI extraction pipeline, LOINC normalization, row-level security, LLM streaming |
| **Project Context** | Greenfield |

## Success Criteria

### User Success

The core user success moment is **the Fingerprint at draw 2+** — when a patient sees that her ferritin was 90 in January, 72 in June, and 58 today, and understands this as a personal trajectory rather than a lab number sitting inside a green range. This moment is the product's reason for existing.

The second success moment is **the doctor opening the Conversation Starter and acknowledging the trajectory** — the first time Maria isn't the one explaining her own history to a clinician.

Measurable user outcomes:
- Patient feels like the most informed person in the room (qualitative, tracked in interview cohort)
- Patient returns to check their record without a new lab result as the trigger (habit formation)
- Patient completes a share with a doctor within 30 days of first upload

**Concept 1 Validation Gate** (before full build): The Letter assumption — patients engage deeply with health data framed as personal narrative. Gate opens if ≥2 of 3 behavioral acceptance criteria fire in ≥3 of 5 test participants within 6 days of prototype exposure.

### Business Success

**North star:** Doctor-initiated patient invitations ≥3/week by month 3, trending upward for 3 consecutive weeks.

| Metric | Target | Timeframe |
|---|---|---|
| Day-30 patient retention | ≥20% | Month 1–3 (vs. 3.9% category median) |
| Letter open rate | ≥70% within 48h | Month 1+ |
| Longitudinal Completeness Score | Median ≥60/100 | Day 90 |
| Organic return sessions | ≥40% of users, 2+/month | Month 3 |
| Doctor Profile Activation Rate | ≥60% within 7 days of first patient share | Month 1–3 |
| Doctor-initiated new patient activations | ≥30% of all new accounts | Month 6 |
| Trial-to-paid conversion | ≥12% | Month 1–3 |
| 6-month patient retention | ≥40% | Month 6 |
| Median health events logged per active user at day 30 | ≥3 draws or BIA entries | Month 1–3 (record depth leading indicator) |

### Technical Success

- AI extraction confidence gate: <0.85 triggers manual review queue; results never auto-published below threshold
- LOINC normalization coverage: top 20 Brazilian lab biomarkers (CBC, lipid panel, metabolic, thyroid, iron) at launch
- PDF + image upload both supported from day 1 (WhatsApp-native Maria does not save PDFs)
- The Letter: first token streamed in <3s; full narrative in <15s
- PDF/image extraction: results available to patient within 30s of upload
- Row-Level Security enforced at database level — no application-layer-only isolation
- LGPD compliance: explicit consent recorded per data type, DPO appointed, breach notification process defined, data portability (JSON + PDF export) in MVP
- ANVISA RDC 657/2022: all AI outputs framed as "it may be worth discussing with a [specialist type]" — below MDSW classification threshold
- Uptime: 99.5% for ingestion and Fingerprint endpoints

### Measurable Outcomes

Success at 90 days: ≥3 doctor-initiated invitations/week trending upward, ≥20% day-30 patient retention, Concept 1 validation gate passed, LGPD-compliant architecture live, top 20 biomarker extraction working across Fleury/DASA/Hermes Pardini lab formats.

Success at 12 months: Doctor trust graph established in endocrinology, sports medicine, and cardiology. ≥30% of new accounts doctor-initiated. Premium subscription active at R$39/month. 6-month patient retention ≥40%.

## Product Scope

The MVP delivers core health record management, LGPD-compliant data controls, and a confidence-gated AI extraction layer for Brazil's private health consumer. It is designed to produce the defining aha moment — a patient seeing her ferritin decline as a personal trajectory — and to make that record shareable with a doctor in one tap.

Growth adds intelligence and connectivity: skinfold entry, the exam quest loop, AI specialist suggestions, and the Ritual Check-In upload ceremony. Vision adds ecosystem leverage: lab API partnerships, corporate wellness channels, and device integrations.

See **Project Scoping & Phased Development** for the full feature-by-feature breakdown with rationale and phase dependencies.

## User Journeys

### Journey 1: Maria (WhatsApp-native) — First Upload to First Insight

**Opening scene.** Maria, 34, received her Fleury blood test results via WhatsApp — a photo she took of the printed report at the lab. It's sitting in her camera roll between a meme and a photo of her dog. She's vaguely aware her ferritin came back low-ish again, but she doesn't know what "again" means because she has no memory of the number from last time. She's not going to open a laptop. She opens the Health Tracker app.

**Rising action.** The upload screen accepts her camera roll image directly — no PDF required, no "please scan and convert" dead end. She selects the photo. A progress indicator runs while OCR and the AI extraction pipeline process it. Thirty seconds later, her CBC, lipid panel, and iron markers appear in a review screen with confidence flags. One result — her serum iron — shows a yellow flag (confidence 0.78) asking her to confirm the number. She taps to confirm: 52 µg/dL. She hits "save."

**Climax.** Maria has two prior draws already in her record. The Fingerprint loads. She sees her ferritin plotted across three points: 88 → 61 → 47. Her personal baseline band — computed from her own history — shows 88 as her norm. The current value sits 2.1 standard deviations below her baseline, flagged in amber. Under the chart: *"Your ferritin has declined steadily across three draws. It may be worth discussing this trend with your doctor or a haematologist."* This is not a population alarm. This is her alarm.

**Resolution.** She forwards the Conversation Starter link to her endocrinologist before her appointment next week. She doesn't bring a folder of PDFs. She brings a link. The doctor opens it and sees the same three-point ferritin decline with the discussion prompt pre-loaded. The appointment starts from trajectory, not from scratch.

*Capabilities revealed: image upload + OCR, AI extraction with confidence gate, manual review for low-confidence values, Fingerprint with personal baseline, ANVISA-compliant AI suggestion framing, Conversation Starter link generation.*

---

### Journey 2: Maria (The Organiser) — Power User Building a Complete Record

**Opening scene.** Cláudia, 42, has been meticulous. She has six Fleury PDFs saved in a Google Drive folder called "Saúde 2021–2025." She also has two bioimpedance reports from the InBody machine at her gym. She finds Health Tracker and decides to upload everything at once.

**Rising action.** She uploads all six PDFs in a batch. The system processes them sequentially, extracting and normalizing each draw. On draw 3 (2022), a TSH value appears outside her personal range and outside population range — but the system flags it quietly, not with an alarm. By draw 6, she has a complete longitudinal record: TSH, free T4, ferritin, cholesterol panel, glucose, HbA1c, all plotted against her own baselines. She manually enters her two InBody bioimpedance readings — visceral fat area, skeletal muscle mass, body fat percentage — logging the date and device. The Fingerprint now shows body composition alongside blood markers.

**Climax.** The Letter arrives: a 280-word narrative framed as a message from her past self. It notes that her HbA1c has been stable for four years while her visceral fat area increased — two signals that didn't appear in the same room until now. It closes with a warm prompt to discuss this pattern at her next appointment. Cláudia reads it twice.

**Resolution.** She shares her metabolic markers with her endocrinologist and her body composition data with her nutritionist — different biomarker sets, different doctors, each configured with per-biomarker toggles. Neither doctor sees data that isn't relevant to their specialty.

*Capabilities revealed: batch PDF upload, manual BIA entry, multi-draw Fingerprint, The Letter, per-biomarker selective sharing, per-doctor access configuration.*

---

### Journey 3: Dr. Rodrigo — The Doctor Receiving a Patient Share

**Opening scene.** Dr. Rodrigo is an endocrinologist. He sees 18 patients a day. His consultation notes live in an EMR he didn't choose. Between patients he gets a WhatsApp message from a number he doesn't recognise: "Oi Dr. Rodrigo, aqui está meu histórico antes da consulta de quinta." With a link.

**Rising action.** He opens the link on his phone between patients. It renders a minimal landing page showing the patient's name and a brief description of what has been shared — no patient data visible yet. He authenticates with a quick registration or login (no app install required). Once authenticated, the Conversation Starter report loads within 90 seconds of receiving the link. Three discussion prompts are pre-loaded from the patient's data: (1) Ferritin has declined 47% from personal baseline across three draws. (2) TSH elevated above personal baseline in two of four draws. (3) Free T4 stable. The biomarker cards show current value, previous value, trend direction, and the patient's own baseline range — not population ranges.

**Climax.** Dr. Rodrigo has enough context to start the appointment from clinical substance rather than history-taking. He opens the door knowing what changed. The patient walks in as the most informed person in the room — and finds that the doctor has already read her trajectory.

**Resolution.** After the appointment, Dr. Rodrigo activates his own Health Tracker professional account. He invites two of his regular patients to upload their records. The Doctor Acquisition Loop turns once.

*Capabilities revealed: shareable link (authenticated doctor access), Conversation Starter report, biomarker trend cards with personal baseline, professional account activation, doctor-initiated patient invitation.*

---

### Journey 4: Operator / Internal Ops — Handling a Manual Review Queue Item

**Opening scene.** An extraction result came back with a confidence score of 0.71 — below the 0.85 gate. The system placed it in the manual review queue rather than publishing it to the patient's record. A Health Tracker ops team member opens the review dashboard.

**Rising action.** The queue shows the patient's upload (anonymised view with patient_id only), the extracted values, the raw OCR output, and the confidence flags per field. The reviewer sees that "TSH: 2,4 mU/L" was parsed from a scan where the decimal separator is a comma (Brazilian format) — and the OCR read it as "2.4" — which is the correct value. The reviewer confirms the extraction. The result is published to the patient's record and the patient receives a notification.

**Resolution.** The ops reviewer logs the comma/period parsing pattern as a known Fleury format quirk. The extraction model is flagged for retraining with additional Brazilian lab format examples.

*Capabilities revealed: manual review queue, operator dashboard (anonymised), confirm/reject extraction flow, audit trail, model feedback loop.*

---

### Journey Requirements Summary

| Capability Area | Revealed By |
|---|---|
| Image + PDF upload, OCR pipeline | Journey 1 (WhatsApp-native) |
| AI extraction with confidence gate | Journeys 1, 4 |
| Manual review queue + operator dashboard | Journey 4 |
| Longitudinal Fingerprint (personal baseline z-score) | Journeys 1, 2 |
| ANVISA-compliant AI suggestion framing | Journey 1 |
| The Letter (streamed LLM narrative) | Journey 2 |
| Manual BIA entry | Journey 2 |
| Per-biomarker, per-doctor access control | Journey 2 |
| Shareable link (authenticated doctor view) | Journey 3 |
| Conversation Starter report | Journey 3 |
| Biomarker trend cards (personal baseline, not population) | Journey 3 |
| Professional account activation + patient invitation | Journey 3 |
| Access Log | Journeys 2, 3 |
| Data portability (JSON/PDF export) | Journey 2 |
| Life event overlay on Fingerprint timeline | Concept 1 prototype (design thinking) |
| Onboarding-time import of prior results | Design thinking key insight |

## Domain-Specific Requirements

### Compliance & Regulatory

**LGPD (Lei Geral de Proteção de Dados — Art. 11)**
Health data is sensitive data under LGPD. The legal basis for processing is explicit, informed consent — not legitimate interest or contract. Requirements:
- Explicit consent collected per data type at onboarding (blood markers, bioimpedance, skinfold separately)
- Consent records stored with timestamp, version of consent text accepted, and scope
- DPO (Data Protection Officer) appointed before public launch — not optional
- Breach notification: ANPD and affected patients notified within 2 business days of confirmed breach
- Data portability: patient can export their full record as JSON or PDF at any time (Art. 18) — in scope for MVP
- Right to erasure: patient can delete their account and all data permanently; deletion is verifiable
- Data minimization: no collection beyond what serves the explicit product function

**ANVISA RDC 657/2022 — Software as Medical Device (MDSW)**
The product's AI outputs must stay below the MDSW classification threshold. Non-negotiable framing rules:
- All AI-generated text uses "it may be worth discussing with a [specialist type]" — never "you have," "this indicates," or "you should"
- No diagnosis, no clinical decision support, no treatment recommendation
- "Direction, not diagnosis" is not a marketing frame — it is a legal boundary enforced at the prompt and output layer
- Any new AI feature must pass internal ANVISA framing review before shipping
- If ANVISA classification is ever in doubt, a regulatory lawyer signs off before launch

**CFM (Conselho Federal de Medicina)**
Telemedicine and digital health are regulated by CFM Resolution 2.314/2022. Health Tracker does not provide telemedicine — but the Conversation Starter report must not be framed as a clinical consultation or medical advice. The report is patient-initiated context sharing, not a diagnostic tool.

### Technical Constraints

**Security**
- All health data encrypted at rest (AES-256) and in transit (TLS 1.3)
- Row-Level Security (RLS) enforced at the database layer — no application-layer-only isolation
- Patient records are never visible across accounts regardless of application bugs
- Access tokens for doctor-shared links: scoped, time-limited, revocable
- Audit log for all access events: patient_id, professional_id, biomarker_set, timestamp — immutable, append-only
- No third-party analytics SDKs with access to health data (no Mixpanel, Amplitude, etc. receiving raw biomarker data)

**Privacy by Architecture**
- Operator dashboard for manual review queue shows anonymised records (patient_id only, no name or personal identifiers)
- The Letter is generated server-side and streamed — patient health data does not leave the server to a third-party LLM without a DPA (Data Processing Agreement) in place with the LLM provider
- LLM provider DPA must meet LGPD Art. 11 requirements for sensitive data processing

**AI Extraction Confidence Gate**
- Confidence threshold: <0.85 → result enters manual review queue, never auto-published
- Confidence is computed per field, not per document — a document can be partially published if some fields pass the gate
- Manual review queue items are anonymised for operators
- Patient is notified when a result is pending review vs published

Performance and availability requirements are defined as testable acceptance criteria in the Non-Functional Requirements section (NFR-P1 through NFR-P6 and NFR-R1 through NFR-R5). Compliance-critical thresholds — such as audit log write performance under LGPD — are noted there as regulatory constraints.

### Integration Requirements

**Brazilian Lab Formats (MVP)**
Lab reports from Fleury, DASA, Hermes Pardini, Einstein, and Lavoisier differ in layout, unit conventions, and decimal separators (comma vs period). The extraction pipeline must handle:
- PDF (digital, text-extractable)
- Image (photograph of printed report, camera roll)
- Comma as decimal separator (Brazilian standard)
- Multiple reference range formats (absolute ranges, percentage, flagged H/L)
- Bilingual field names (Portuguese lab terminology → LOINC code mapping)

**LOINC Normalization**
All biomarkers normalized to LOINC codes and UCUM units at ingestion. Top 20 Brazilian lab biomarkers in scope for MVP: CBC (haemoglobin, haematocrit, WBC, platelets), lipid panel (total cholesterol, LDL, HDL, triglycerides), metabolic (glucose, HbA1c, creatinine, urea), thyroid (TSH, free T4), iron (ferritin, serum iron, transferrin saturation), and CRP.

**LLM Provider**
A DPA must be in place with the LLM provider before any patient data is sent for The Letter or Conversation Starter generation. Provider selection criteria: LGPD-compatible data processing terms, no training on customer data, EU/BR data residency preferred.

Domain-specific compliance risks are consolidated in the **Risk Register** appendix at the end of this document (see R-01 through R-06).

## UX Design Principles

These principles are not features — they are constraints on every design decision in the product. UX designers and engineers should evaluate each screen, copy string, and interaction against these before shipping.

**Bad results are not bad news.** Out-of-range biomarkers and declining trends are the product's most valuable moments — they are the trigger for a patient to act. The product must frame these as actionable signals ("worth discussing with your doctor") never as failures or alarms. Colour coding and copy must support this: amber and red do not mean danger, they mean attention. No alarming language, no red banners, no urgent tones.

**Privacy is felt, not read.** The Access Log and sharing controls are not buried in settings. They are primary surfaces. Every time a patient uploads, the app shows who currently has access. No hidden access. No surprises. The act of choosing who sees data should feel like a deliberate, empowering ceremony — not a bureaucratic toggle.

**Patient sovereignty is absolute, with acknowledged consequences.** If a patient chooses not to upload, not to share, or not to use a feature, the product respects that without friction or guilt. The product is honest about what completeness enables (a fuller Fingerprint, a richer Letter) but never coerces. No dark patterns around data sharing, no "your doctor needs this" pressure copy.

**The upload is a threshold, not a task.** Uploading a blood test is emotionally loaded — patients are curious, sometimes anxious, always invested. Design the upload screen like a threshold: give the patient a breath, a choice, a place to land before the data appears. The Ritual Check-In (Growth) makes this intent explicit. Until then, progress states, confirmation screens, and the transition to the Fingerprint must feel unhurried and warm.

**Value must be immediate and felt.** The patient's history may be years old. Onboarding must immediately offer to import previously owned results. A patient who uploads three years of Fleury PDFs on day one has a different first experience than one who uploads nothing. Immediate value is not just an import feature — it is the mandate that shapes every decision from onboarding to first Fingerprint render.

**Shame is a design surface.** Out-of-range results and declining trends carry stigma — metabolic markers, inflammatory signals, weight data. The product must actively design against shame responses: no red alarm banners, no urgent copy, no green/bad red/good binary. Designers have explicit permission to soften clinical language, use non-alarming colour systems, and frame every result as information rather than verdict. This is not optimism — it is a deliberate design constraint.

**The patient is the expert on their own experience.** The app does not interpret the patient's life — it gives the patient tools to annotate it. Life events, voice memos, emotional check-ins: these features exist because the patient's context is as medically relevant as their ferritin level. Design these surfaces as meaning-making tools, not data-entry forms.

**Design for the health journey, not the test event.** The Fingerprint, the Letter, the life event overlay — all of these are expressions of one principle: a single lab result is an episode; the patient's health is a story. Every interaction should reinforce continuity. Avoid designs that treat each upload as an isolated event.

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. The Personal Baseline — Challenging the Population Reference Range**

The fundamental clinical assumption challenged: that population reference ranges are meaningful for individuals. A ferritin of 45 ng/mL sits in the "normal" range for a 35-year-old woman — and is a personal crisis for someone whose stable baseline is 90. Every lab in Brazil (and globally) compares patient values against population cohorts. Health Tracker computes deviation against the patient's own longitudinal history.

This is not a UI improvement. It is a different epistemology of health monitoring — and it cannot be replicated by any lab without undermining the format of their own current reports. A lab that adopts personal baselines invalidates decades of population-range reporting. The Longitudinal Fingerprint is structurally defensible against the most well-funded late entrant because the moat is patient data accumulated over time — data that competitors cannot purchase or recreate.

**2. Granular, Revocable, Patient-Initiated Sharing — A Category That Does Not Exist**

No existing digital health product enables a patient to share her lipid panel with a cardiologist but not her weight, or grant time-limited access for a one-off consultation. The market has two modes: provider-controlled (EMRs, Meu SUS Digital) or flat export (PDF, CSV, InsideTracker report). Patient-controlled per-biomarker sharing with revocation at any time is architecturally absent.

The innovation is not technical — granular ACL is a solved engineering problem. The innovation is the product decision to make privacy the primary UI, not a settings page. The Access Log (who viewed which biomarker, when) is a transparency mechanism no health app, lab portal, or EMR currently offers.

**3. The Doctor Acquisition Loop — Doctor as Distribution Channel**

Consumer health apps acquire users through app stores, paid social, and peer referral. No clinical health app has built a loop where the doctor is the distribution node. The sequence: patient shares record → doctor opens Conversation Starter in 90 seconds → doctor activates account → doctor invites patients → loop repeats. Doctor recommendation is the #1 acquisition lever for clinical health apps (outranking ratings, referral, and price). Building the loop that operationalises this is a structural growth advantage no peer-to-peer consumer app can replicate.

**4. Unified Clinical Data Types Under Patient Ownership**

Blood tests, bioimpedance, and skinfold measurements are tracked by three separate professional communities in Brazil — labs, fitness equipment providers, and nutritionists — with no single digital home. Health Tracker is the first product to unify all three under patient ownership. The cross-signal insight (HbA1c stable while visceral fat area increases) only becomes visible when two data streams that have never been in the same room are finally in the same room.

### Market Context & Competitive Landscape

The white space is confirmed by the competitive map:
- Samsung Health (36–39% Brazil smartphone market share): all clinical features locked to US
- Apple Health Records: iOS-only, US-only
- WHOOP Advanced Labs: US-only, phlebotomy-dependent
- InsideTracker: US-only, Quest Diagnostics dependency
- Meu SUS Digital: covers public system only, private lab data entirely excluded
- Brazilian clinical platforms (Mevo, Prontmed): provider-facing, no patient record layer

No competitor occupies the intersection of: Brazilian private lab data + patient-owned record + granular selective sharing + doctor acquisition loop. The government's own unification target is 2028 — three years of structurally protected market.

### Validation Approach

**Concept 1 Validation Gate — The Letter**
The riskiest assumption is that patients will engage deeply with health data framed as personal narrative. Gate: ≥2 of 3 behavioral acceptance criteria fire in ≥3 of 5 test participants within 6 days of prototype exposure.
- AC1: Participant opens The Letter within 48 hours
- AC2: Participant shares The Letter or quotes from it without prompting
- AC3: Participant expresses intent to return when new results arrive

Kill condition: if the gate does not open within 6 days of starting the cohort, defer The Letter to post-MVP and build the product on Fingerprint + sharing alone.

**Fingerprint Validation**
Bootstrapping challenge: personal baseline requires ≥2 draws to compute. The Fingerprint becomes meaningful at draw 3. Validation: does the patient return to upload draw 2 without external prompting? Day-30 retention ≥20% is the proxy signal.

**Doctor Loop Validation**
North star: ≥3 doctor-initiated patient invitations/week by month 3, trending upward for 3 consecutive weeks. If the Conversation Starter report does not drive professional account activation at ≥60% within 7 days of first patient share, the loop design needs rework before scaling.

Innovation and market risks are consolidated in the **Risk Register** appendix at the end of this document (see R-07 through R-11).

## Mobile + Web Specific Requirements

### Project-Type Overview

Health Tracker ships as a cross-platform mobile app (Expo / React Native — iOS + Android) and a companion web app (Next.js). The mobile app is the primary patient surface — most uploads happen from a phone camera or camera roll. The web app serves the doctor-facing Conversation Starter report (no install required) and power users who prefer desktop for record management.

### Platform Requirements

**Mobile (Expo / React Native)**
- iOS 16+ and Android 13+ minimum targets
- App Store (Apple) and Play Store (Google) distribution
- Healthcare app category — both stores require clear disclosure that the app is not a medical device and does not provide medical advice (reinforces ANVISA framing)
- App Store Connect: health data entitlement declarations required
- Play Store: Sensitive permissions declaration for camera access

**Web (Next.js)**
- Progressive Web App (PWA) support — patients on low-end Android can add to home screen without app store friction
- Doctor-facing Conversation Starter report: link requires doctor authentication (registration or login) before patient data is displayed; no app install required; renders correctly in any modern browser
- Responsive design: all core patient flows work on mobile browser as fallback

### Device Permissions

| Permission | Purpose | Required? |
|---|---|---|
| Camera | Photograph printed lab report from camera roll or direct capture | Required |
| Photo Library / Media | Select existing image or PDF from device storage | Required |
| Push Notifications | Extraction complete, The Letter ready, Access Log event | Optional (requested after first upload) |
| Biometric Auth (Face ID / Fingerprint) | Unlock app — health data, biometric lock appropriate | Optional (offered at onboarding) |
| Local Storage | Offline upload queue, cached Fingerprint for fast render | Required |

### Offline Mode

Full offline is not required. Targeted offline support:
- **Upload queue**: patient can select an image/PDF while offline; upload queues and executes when connectivity restores. Patient sees "waiting to upload" state — not a silent failure.
- **Cached Fingerprint**: last-computed Fingerprint cached locally; patient can view their trend without connectivity. Clearly labelled with "last updated" timestamp.
- **The Letter**: not available offline (LLM streaming requires connectivity). Graceful message if unavailable.
- **Doctor share links**: not available offline.

### Push Notification Strategy

Notifications are opt-in, requested after the first successful upload (not at onboarding). Notification types:

| Event | Message | Timing |
|---|---|---|
| Extraction complete | "Your [Lab Name] results are ready to review" | Immediate |
| The Letter ready | "A message from your past self is waiting" | Immediate |
| Manual review required | "One result needs your confirmation" | Immediate |
| Access Log event | "[Dr. Name] viewed your record" | Immediate |
| Fingerprint update | "Your Fingerprint updated with your latest results" | On draw confirmation |

No engagement-bait notifications (streaks, reminders to upload). Notification frequency is event-driven, not scheduled.

### Store Compliance

**Apple App Store**
- Category: Health & Fitness (not Medical)
- Health data handling disclosure required in App Privacy section
- No HealthKit in MVP — avoids additional Apple health entitlement review cycle
- In-app purchase: premium subscription via Apple IAP (R$39/month) — 30% Apple fee applies in year 1

**Google Play Store**
- Category: Health & Fitness
- Sensitive data declaration: camera, storage, health-adjacent content
- Subscription via Google Play Billing

**IAP Fee Mitigation**
Both stores take 15–30% of in-app subscription revenue. At R$39/month this is R$5.85–11.70 per subscriber per month. Web-subscription path (user signs up via web, accesses premium on mobile) is legally permitted and avoids store fees — decision deferred to monetization design.

### Implementation Considerations

**Expo Managed Workflow vs Bare**
Start with managed workflow; eject to bare only when a specific native module requires it.

**Next.js App Router**
Use App Router (Next.js 13+). Server Components handle the Conversation Starter report rendering for authenticated doctor views; the pre-auth landing page is a lightweight static shell showing patient name and share context only. Streaming responses via React Suspense for The Letter.

**Monorepo Structure**
Expo + Next.js in a pnpm + Turborepo monorepo with shared packages: `@healthtracker/ui` (shared components), `@healthtracker/api-client`, `@healthtracker/types` (shared TypeScript types, LOINC code definitions).

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Experience MVP — the minimum that creates the defining aha moment, not just the minimum that solves the problem. The aha moment is the Fingerprint at draw 2+: a patient seeing her ferritin decline as a personal trajectory, not a lab number. Everything in the MVP either enables that moment or makes it shareable.

**Resource Requirements:** Minimum viable team for 90-day MVP:
- 1 backend engineer — extraction pipeline, PostgreSQL + RLS, API
- 1 mobile/frontend engineer — Expo + Next.js, shared component layer
- 1 AI/ML engineer (or backend engineer with LLM experience) — OCR, confidence gate, LOINC normalization, Letter prompt engineering
- 1 PM — product, regulatory liaison, user research
- Part-time regulatory counsel — LGPD compliance review, ANVISA framing sign-off

### MVP Feature Set (Phase 1 — Days 1–90)

**Core User Journeys Supported:**
- Journey 1: WhatsApp-native Maria — first upload to first Fingerprint insight
- Journey 2 (partial): Organiser Maria — multi-draw record, The Letter
- Journey 3: Dr. Rodrigo — receiving and opening a Conversation Starter link
- Journey 4: Operator — manual review queue

**Must-Have Capabilities:**

| # | Capability | Rationale |
|---|---|---|
| 1 | PDF + image upload (camera roll) | Image upload required for WhatsApp-native Maria; PDF-only excludes 70% of primary user |
| 2 | AI extraction + LOINC normalization (top 20 biomarkers) | Core data ingestion; without this, nothing else works |
| 3 | Confidence gate (<0.85 → manual review) + patient confirmation screen | LGPD + patient safety; no auto-publish of uncertain values |
| 4 | Longitudinal Fingerprint (personal baseline z-score, 2+ draws) | The aha moment; the product's reason for existing |
| 5 | The Letter (streamed LLM narrative) | Engagement moat; Concept 1 validation gate |
| 6 | Manual BIA entry | Second data type; expands Fingerprint to body composition |
| 7 | Per-biomarker access control + Access Log | Privacy as architecture; enables doctor sharing; premium feature gate |
| 8 | Doctor Conversation Starter report (shareable link, authenticated) | Doctor Acquisition Loop enabler |
| 9 | Professional account activation + patient invitation flow | Loop completion |
| 10 | Data portability (JSON + PDF export) | LGPD Art. 18 — non-negotiable for launch |
| 11 | LGPD consent flows + DPO infrastructure | Legal requirement; must ship before any patient data is collected |
| 12 | Operator manual review dashboard (anonymised) | Required to operate the confidence gate at scale |
| 13 | Onboarding-time import of prior results | Value starts day one; patient's history matters from first session |
| 14 | Life event overlay on Fingerprint timeline | Core of Concept 1 — turns charts into a story; was in prototype |
| 15 | Time-limited sharing links (7-day default) | Privacy as architecture — permanent access is the anomaly; duration selection is the default sharing paradigm; `expires_at` in share_tokens schema supports this from day one |

### Post-MVP Features (Phase 2 — Month 4–9)

| Capability | Dependency |
|---|---|
| Skinfold measurement entry (Jackson-Pollock, Durnin-Womersley) | Requires nutritionist user segment validation |
| Doctor exam quest loop | Requires established doctor account base |
| AI specialist direction suggestions (persistent out-of-range) | Requires ANVISA framing review per feature |
| Push notification expansion | Baseline notification system (MVP) |
| Ritual Check-In at upload — emotional check-in before results appear; five emotional states; stored with upload, never shared without consent | Engagement data from month 1–3 to calibrate timing and copy |
| "Explain this to my doctor" — tap biomarker → AI-generated non-alarmist question for next appointment | Requires ANVISA framing review; depends on Fingerprint + LOINC infrastructure (MVP) |

### Vision (Phase 3 — Month 10–24)

| Capability | Dependency |
|---|---|
| Private lab API partnerships (Fleury, DASA, Hermes Pardini) | Requires lab BD relationships + volume to negotiate |
| Corporate wellness B2B2C channel | Requires established patient base + proof metrics |
| Bioimpedance device integrations (Tanita, InBody, Withings) | Requires device SDK agreements |
| Non-PDF lab format support (FHIR, HL7) | Market readiness; government unification progress |
| Voice memo tagging at upload — up to 30 seconds qualitative context at time of upload; stored with record, never shared without consent | Depends on mobile audio permission infrastructure; storage costs |

### Risk Mitigation Strategy

All risks are consolidated in the **Risk Register** appendix (R-01 through R-13). Key execution risks for the 90-day MVP:

**Resource contingency:** If team is 2 engineers instead of 3, defer manual BIA entry and operator dashboard to week 6 (basic email-based review queue instead); ship PDF-only extraction first, add image upload in week 4.

**Regulatory gate:** LGPD consent flows and ANVISA framing must be reviewed — by counsel or PM against documented requirements — before any patient data is collected. No launch without this gate passed.

## Functional Requirements

### Health Data Ingestion

- **FR1:** Patient can upload a blood test result as a PDF file from device storage
- **FR2:** Patient can upload a blood test result as an image (JPEG/PNG/HEIC) from camera roll or direct camera capture
- **FR3:** System can extract biomarker values, units, reference ranges, lab name, and collection date from uploaded PDFs and images
- **FR4:** System can normalize extracted biomarkers to LOINC codes and UCUM-standard units
- **FR5:** System can assign a per-field extraction confidence score and route low-confidence fields (<0.85) to manual review without auto-publishing
- **FR6:** Patient can review extracted values with confidence flags and confirm or correct individual fields before they are added to their record
- **FR7:** Patient can view the status of an upload (processing / pending review / published / failed)
- **FR8:** Patient can queue an upload for processing when offline; the upload executes automatically when connectivity restores
- **FR9:** Patient can manually enter bioimpedance (BIA) measurements including collection date and device name
- **FR10:** System can handle Brazilian lab decimal separator conventions (comma vs period) and multiple reference range formats

### Longitudinal Record & Fingerprint

- **FR11:** Patient can view their complete longitudinal biomarker record across all uploaded draws, sorted by collection date
- **FR12:** System can compute a personal baseline for each biomarker from the patient's own historical draws (2+ draws required)
- **FR13:** Patient can view the Longitudinal Fingerprint — a visualization of each biomarker's trend plotted against their personal baseline band
- **FR14:** System can flag biomarker values that deviate significantly from the patient's personal baseline, distinct from population reference range flags
- **FR15:** Patient can view a partial Fingerprint with population context at draw 1, with labelling indicating the baseline builds with additional draws
- **FR16:** Patient can view cached Fingerprint data without an active network connection, with a "last updated" timestamp

### AI Narrative (The Letter)

- **FR17:** Patient can receive a streamed narrative summary (The Letter) after a new draw is confirmed, framed as a message from their past self
- **FR18:** System can generate The Letter incorporating longitudinal patterns across all data types (blood markers + BIA) in the patient's record
- **FR19:** All AI-generated text is framed as suggestion rather than diagnosis, using "it may be worth discussing with a [specialist type]" framing
- **FR20:** Patient can re-read a previously generated Letter from the record history

### Sharing & Access Control

- **FR21:** Patient can configure which biomarker categories are shared with each named doctor or health professional
- **FR22:** Patient can revoke a doctor's access to their record at any time
- **FR23:** Patient can generate a time-limited shareable link to their Conversation Starter report for a specific doctor; duration selection is presented with a 7-day default, with options for 30 days, 24 hours, or no expiry (no-expiry requires an additional confirmation step)
- **FR24:** Patient can view the Access Log — a complete list of who viewed which biomarker categories and when
- **FR25:** Access log entries are immutable; they cannot be deleted by the patient or operator

### Doctor Experience

- **FR26:** Doctor can open a shared patient link without installing an app; authentication (registration or login) is required before any patient health data is displayed; the pre-auth landing page shows only the patient's name and share context
- **FR27:** Doctor can view the Conversation Starter report — biomarker trend cards with current value, previous value, trend direction, and patient's personal baseline band
- **FR28:** Doctor can view up to 3 AI-generated discussion prompts derived from the patient's data
- **FR29:** Doctor can activate a professional account from the shared link view
- **FR30:** Doctor can invite a patient by contact (email or phone) to create a Health Tracker account
- **FR31:** Doctor can configure biomarker staleness thresholds for their professional view

### Privacy & Compliance

- **FR32:** Patient must provide explicit, per-data-type consent before any health data is collected or processed
- **FR33:** System records consent events with timestamp, consent text version, and data type scope
- **FR34:** Patient can export their complete health record as a JSON file at any time
- **FR35:** Patient can export their complete health record as a formatted PDF at any time
- **FR36:** Patient can permanently delete their account and all associated data; deletion is confirmed and irreversible
- **FR37:** Patient can view a summary of all consent agreements currently active on their account

### Operator & Administration

- **FR38:** Operator can view a manual review queue of extraction results flagged below the confidence threshold, with anonymised patient identifiers
- **FR39:** Operator can confirm or reject individual extraction field values in the manual review queue
- **FR40:** Confirmed extraction results are published to the patient's record and the patient is notified
- **FR41:** System maintains an immutable audit log of all data access events (read, write, share, revoke) with actor, resource, and timestamp

### Account & Authentication

- **FR42:** Patient can create an account with email and password
- **FR43:** Patient can authenticate using biometric authentication (Face ID / fingerprint) as an alternative to password entry
- **FR44:** Patient can receive push notifications for key events (extraction complete, Letter ready, manual review required, access log event)
- **FR45:** Patient can manage notification preferences per event type
- **FR46:** Patient can upload prior lab results during onboarding, before account setup is fully complete, so their longitudinal record begins on day one
- **FR47:** Patient can add life events to their biomarker Fingerprint timeline (e.g., "started iron supplementation," "marathon training block") to mark personal context that may explain changes in their trends; events can be added retroactively at any time from the Fingerprint view, or immediately after confirming a new upload; a `privacy_flag` field governs visibility — default is patient-only, never included in shared doctor views without explicit consent
- **FR48 (Growth):** Patient can view a pre-results emotional check-in screen before new results appear, selecting one of five states — Hopeful / Worried / Curious / Exhausted / Not sure; the app acknowledges the selection with a brief single-sentence response before proceeding to results; the selected state is stored with the upload record and is never shared with any doctor without explicit patient consent
- **FR49 (Growth):** Patient can view a closing emotional check-in screen after reviewing results, mirroring the pre-results screen; the shift in emotional state between pre- and post-result is stored with the record and available to the patient as a personal longitudinal signal
- **FR50:** Patient can tap any biomarker in their record to receive a suggested, calm, non-alarmist question they can raise with a relevant specialist at their next appointment ("Explain this to my doctor" — Growth feature)
- **FR51:** Patient can record a voice memo (up to 30 seconds) at the time of upload to capture qualitative context; the memo is stored with the upload record and is never shared with any doctor or professional without explicit patient consent (Vision feature)

## Non-Functional Requirements

### Performance

- **NFR-P1:** Blood test PDF or image extraction completes and results are available to the patient within 30 seconds of upload submission for documents up to 10 pages / 5 MB, at p95, under up to 100 concurrent extraction jobs
- **NFR-P2:** The Letter streams its first token within 3 seconds of generation trigger; the full narrative (~300 words) completes within 15 seconds
- **NFR-P3:** The Longitudinal Fingerprint renders within 2 seconds of draw confirmation
- **NFR-P4:** The doctor-facing Conversation Starter report loads within 3 seconds of authentication on a standard mobile connection; the pre-auth landing page (patient name + share context only) loads within 1 second
- **NFR-P5:** Standard read API responses (record fetch, Fingerprint data, Access Log) complete within 500ms at p95 under expected load
- **NFR-P6:** The mobile app launch-to-interactive time is under 3 seconds on a mid-range Android device (equivalent to Moto G series)

### Security

- **NFR-S1:** All patient health data is encrypted at rest using AES-256 and in transit using TLS 1.3
- **NFR-S2:** Row-Level Security is enforced at the PostgreSQL layer; no application-layer query can access another patient's data
- **NFR-S3:** Doctor-shared links use signed, scoped tokens with configurable expiry; tokens are revocable by the patient at any time
- **NFR-S4:** The audit log for data access events is append-only and immutable; no actor (including operators) can modify or delete entries
- **NFR-S5:** No third-party analytics, crash reporting, or telemetry SDK receives raw biomarker values, patient identifiers, or health data of any kind
- **NFR-S6:** A signed Data Processing Agreement (DPA) meeting LGPD Art. 11 requirements must be in place with the LLM provider before any patient data is processed for The Letter or Conversation Starter generation
- **NFR-S7:** The manual review queue exposes only anonymised patient identifiers (patient_id) to operators — no name, email, or personal contact data
- **NFR-S8:** All patient health data is stored and processed within Brazil or EU data regions; no patient data is transmitted to infrastructure outside these regions without a LGPD Art. 11-compliant DPA in place with the receiving provider

### Scalability

- **NFR-SC1:** The extraction pipeline supports horizontal scaling — additional processing workers can be added without architectural changes to handle increased upload volume
- **NFR-SC2:** The system sustains baseline performance (NFR-P1 through NFR-P5) up to 10x the launch-day concurrent user count without architectural intervention
- **NFR-SC3:** LLM streaming infrastructure handles concurrent Letter generation requests without queuing delays visible to the patient (graceful degradation to queued delivery is acceptable beyond peak thresholds, with patient notification)
- **NFR-SC4:** Fingerprint computation queries complete within 500ms at p95 against a dataset of 10M biomarker records (patient_id, loinc_code, collected_at), as validated by load testing before launch

### Accessibility

- **NFR-A1:** The web application (Next.js) meets WCAG 2.1 Level AA for all core patient flows: upload, Fingerprint view, The Letter, Access Log, sharing configuration
- **NFR-A2:** The mobile application supports system-level text size preferences (Dynamic Type on iOS, font scale on Android) without layout breakage
- **NFR-A3:** All non-decorative images and icons include accessible labels; screen readers can navigate core patient flows without visual reference
- **NFR-A4:** Colour is never the sole means of conveying information (e.g., Fingerprint deviation indicators include text labels alongside colour coding)
- **NFR-A5:** Minimum contrast ratio of 4.5:1 for body text and 3:1 for large text and UI components across all screens

### Integration

- **NFR-I1:** The extraction pipeline handles PDF and image formats from at least Fleury, DASA, and Hermes Pardini lab report layouts at MVP launch, with documented per-lab format adapters
- **NFR-I2:** Extraction correctly parses Brazilian decimal separator conventions (comma as decimal) and multiple reference range formats (absolute ranges, H/L flags, percentage-based)
- **NFR-I3:** If the LLM provider is unavailable, upload processing and Fingerprint computation continue unaffected; The Letter is queued and delivered when the provider recovers, with patient notification of the delay
- **NFR-I4:** Data portability export (JSON and PDF) produces a complete, self-contained record that does not require Health Tracker infrastructure to interpret — all LOINC codes include human-readable biomarker names in the export

### Reliability

- **NFR-R1:** Core endpoints (ingestion, Fingerprint, Access Log) maintain 99.5% uptime measured monthly
- **NFR-R2:** Failed extraction jobs retry with exponential backoff; after 3 failed attempts the patient is notified and the upload enters the manual review queue
- **NFR-R3:** No patient health data is silently lost — every upload that enters the system either succeeds, enters manual review, or triggers a patient-visible failure notification
- **NFR-R4:** Recovery Point Objective (RPO): maximum 1 hour of data loss in the event of a catastrophic failure — daily backups with point-in-time recovery enabled on the patient data database
- **NFR-R5:** Recovery Time Objective (RTO): core ingestion and Fingerprint endpoints restored within 4 hours of a confirmed infrastructure failure

## Risk Register

All product risks consolidated from compliance, domain, innovation, and execution categories.

| ID | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-01 | ANVISA classifies product as MDSW | Medium | Legal review of all AI output framing before launch; "direction not diagnosis" enforced at prompt and output layer |
| R-02 | AI extraction error auto-published to patient record | High (without gate) | Confidence gate at 0.85; manual review queue; patient confirmation screen for flagged values |
| R-03 | Sensitive health data breach | Low (with controls) | RLS at DB layer; AES-256 at rest; TLS 1.3 in transit; audit log; breach notification process pre-built |
| R-04 | LLM provider processes data without LGPD-compliant DPA | High (if skipped) | DPA required before any patient data sent to LLM; provider vetted before launch |
| R-05 | Doctor-shared link forwarded beyond intended recipient | Low | Authentication required before any patient data is visible; signed, scoped tokens with configurable expiry; Access Log visible to patient; revocation available at any time |
| R-06 | Regulatory interpretation changes (LGPD/ANVISA) | Low | Quarterly regulatory review; counsel on retainer |
| R-07 | The Letter assumption fails Concept 1 validation | Medium | Kill condition defined; Fingerprint + sharing is a viable standalone product; do not build Letter's emotional arc infrastructure until gate opens |
| R-08 | Fingerprint bootstrapping — patients leave before draw 3 | Medium | Partial Fingerprint shown at draw 1 with population context, labelled "your baseline builds with each draw" |
| R-09 | Doctor Acquisition Loop doesn't close — doctors don't activate | Medium | Frictionless activation (no EMR integration, no app install for first report view); iterate on Conversation Starter format before scaling |
| R-10 | Competitor (Samsung Health) unlocks clinical features for Brazil before 2028 | Low | Data moat (longitudinal history) + doctor trust graph are not replicable by a late entrant; accelerate acquisition before window closes |
| R-11 | Personal baseline misinterpreted as medical advice | Medium | ANVISA framing enforced at output layer; patient-facing copy frames Fingerprint as "your pattern, not a diagnosis" |
| R-12 | Brazilian lab format diversity breaks extraction pipeline | High (without adapters) | Modular pipeline with per-lab format adapters; prioritise Fleury first; continuous test corpus of real lab PDFs |
| R-13 | LLM streaming latency degrades Letter experience on mobile | Medium | Railway (persistent server) over serverless — cold start latency is unacceptable for streamed narrative |
