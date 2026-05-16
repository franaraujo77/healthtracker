---
title: "Product Brief: Health Tracker"
status: "complete"
created: "2026-05-12"
updated: "2026-05-12"
inputs:
  - "_bmad-output/design-thinking-2026-04-28.md"
  - "_bmad-output/planning-artifacts/research/market-health-tracking-app-individuals-research-2026-05-12.md"
---

# Product Brief: Health Tracker

## Executive Summary

Every private health patient in Brazil is the only person who has been in every specialist's room. She has seen the endocrinologist, the sports medicine physician, the nutritionist. She has blood test results from Fleury across six draws, bioimpedance reports from a Tanita machine, and skinfold measurements in her nutritionist's notebook. When she walks into a new cardiologist's office, she brings a folder of printed PDFs. The cardiologist glances at the most recent one. Nobody sees her trajectory.

Health Tracker is a patient-owned longitudinal health record for Brazilian private health consumers. It extracts, normalizes, and trends clinical data from blood tests, bioimpedance, and skinfold measurements — and gives patients granular control over which professional sees which biomarker, revocable at any time. Patients arrive at appointments as the most informed person in the room. Doctors receive a clean, scannable summary that surfaces what changed since the last visit.

Brazil's 50 million private health consumers have no equivalent product. The government's Meu SUS Digital covers the public system only. Every global competitor (Apple Health, Samsung Health, Google Health, WHOOP, InsideTracker) has clinical features locked to the US market. The white space is confirmed, unoccupied, and growing at 16% CAGR (Grand View Research, Brazil mHealth Apps segment, 2024–2030). The government's own unification target is 2028 — three years of structurally unserved market.

---

## The Problem

A health-conscious Brazilian patient — Maria — has seen an endocrinologist, a sports medicine physician, and a nutritionist over the past three years. She has blood test results from Fleury across six draws, bioimpedance reports from a Tanita machine at her gym, and skinfold measurements from her nutritionist's notebook. When she sees a new cardiologist next month, she will bring a folder of printed PDFs. The cardiologist will glance at the most recent one.

Nobody sees her trajectory. Nobody sees that her ferritin declined steadily before her energy crashed. Nobody sees that her body fat composition improved while her inflammatory markers held stubbornly high. The data exists. The insight doesn't — because it's scattered across sources that have never been in the same room.

This is not a Maria problem. It is the default experience for every private health consumer in Brazil. The public system's Meu SUS Digital covers SUS patients; private lab data — Fleury, DASA, Hermes Pardini, Einstein, Lavoisier — is entirely outside any unified system. The government's unification target is 2028. Until then, fragmentation is structural.

The cost of the status quo: doctors make decisions without longitudinal context. Patients invest in health monitoring but cannot leverage the value of their own data. The handoff moment — walking into a new specialist's office — erases years of health history. 53% of Brazilians feel the health system treats them "like a number." This is why.

---

## The Solution

Health Tracker gives patients a single longitudinal health record they own, control, and can share selectively with any health professional they choose — independent of any clinic, hospital, or government system.

**For the patient:**
- Upload a blood test PDF from any Brazilian lab → AI extraction, normalization to common units, and longitudinal trending
- Log bioimpedance readings from any device (Tanita, InBody, Withings, Galaxy Watch, any smart scale)
- Record skinfold measurements using standard protocols (Jackson-Pollock, Durnin-Womersley)
- View **The Longitudinal Fingerprint** — personal baseline computed from their own history, not population averages; deviation flagged against their normal, not generic reference ranges
- Receive **The Letter from Your Past Self** — a warm narrative summary of how their health has evolved, streamed by AI as if written by a thoughtful friend who read all their files
- Control exactly who sees which biomarkers: per-doctor, per-data-type toggles; revocable at any time; time-limited links for one-off consultations
- See **The Access Log** — who viewed which biomarker, and when; always visible, always simple; a transparency mechanism no health app, lab portal, or EMR currently offers

**For the doctor / health professional:**
- Receive a patient-shared link → opens a **Conversation Starter report** with 3 AI-generated, non-alarming discussion prompts derived from the patient's data
- Biomarker trend cards: current value, previous value, trend direction, colour coding against the patient's own baseline (not population ranges)
- Upload exam requests → patient receives them as **"quests"** to complete before the next visit; completed results auto-appear in the shared record, closing the loop bidirectionally

**The AI layer** surfaces longitudinal patterns and suggests relevant medical specialisations when a biomarker is persistently out of range — direction, not diagnosis. The product is explicitly not a diagnostic tool. AI outputs are framed as "it may be worth discussing this with a [specialist type]."

---

## What Makes This Different

**The only product combining all three clinical data types in one patient-owned record.**
Blood tests, bioimpedance, and skinfold measurements are tracked by three separate professional communities in Brazil — labs, fitness equipment, nutritionists — with no single digital home. Health Tracker is the first to unify them under patient ownership.

**The personal baseline insight — the most defensible clinical position in the market.**
Existing labs and apps compare values against population reference ranges. This is medically crude. A ferritin of 45 ng/mL is "normal" by population standards and a personal crisis for someone whose baseline is 90. Health Tracker computes deviation against the patient's own history — making it impossible for any lab to replicate without undermining the format of their own current reports.

**Patient-controlled granular sharing — a category that does not exist.**
No competitor enables a patient to share their lipid panel with a cardiologist but not their weight, or grant time-limited access for a one-off consultation. Every existing approach is either provider-controlled (EMRs, Meu SUS Digital) or flat PDF export (InsideTracker). Granular, revocable, patient-initiated sharing is architecturally absent from the market.

**Built exclusively for Brazil's private health market.**
Samsung Health (36–39% Brazil market share) has all clinical features locked to the US. Apple Health Records is iOS-only and US-only. InsideTracker requires Quest Diagnostics phlebotomy in the US. Brazil's 50M private health consumers are structurally unserved by every global platform.

**The doctor as the distribution channel.**
Doctor recommendation is the #1 acquisition lever for clinical health apps — outranking app store ratings, peer referral, and price. The **Doctor Acquisition Loop**: patient shares a record → doctor opens a clean Conversation Starter report in 90 seconds → doctor activates account → doctor invites other patients → loop repeats. No consumer health app has built this. Clinical platforms (Mevo, Prontmed) are provider-facing with no patient record layer.

**Privacy as architecture, not policy.**
60% of Brazilians are concerned about biometric data (CETIC.br 2024). The Access Log — making visible who saw what and when — is a category-defining transparency mechanism. Privacy is not a settings page. It is the primary UI.

---

## Who This Serves

**Primary — Maria, the health-invested patient**
Health-conscious, 25–50, urban Brazil, private health insurance. Has seen multiple specialists across her care journey. Treats her health data as a record of the person she's working to become. Excited when results arrive. Frustrated by starting from zero with every new doctor. Not necessarily procedural — the product must serve equally the Google Drive organiser and the "results in a WhatsApp folder" type.

**Secondary — The Doctor / Specialist**
Endocrinologist, cardiologist, sports medicine physician, or primary care doctor. Currently receives stacks of PDFs from multiple labs, different reference ranges, sometimes different units. Becomes a distribution node when the patient-sharing experience saves cognitive load in the first 90 seconds. Configures their own staleness thresholds. Uploads exam requests through the platform.

**Tertiary — The Health Professional (nutritionist, personal trainer)**
Works longitudinally with body composition data. High session frequency with patients. Uses skinfold calipers and BIA machines routinely with no digital longitudinal home for the results. A lighter professional access mode for this segment creates a second, lower-friction acquisition channel that does not require physician buy-in.

---

## Success Criteria

**North star:** Doctor-initiated patient invitations per week — target ≥3/week by month 3, trending upward for 3 consecutive weeks.

| Metric | Target | Timeframe |
|---|---|---|
| Day-30 patient retention | ≥20% | Month 1–3 (vs. 3.9% category median) |
| Letter open rate | ≥70% within 48h | Month 1+ |
| Longitudinal Completeness Score | Median ≥60/100 | Day 90 |
| Organic return sessions | ≥40% of users, 2+/month | Month 3 |
| Doctor Profile Activation Rate | ≥60% within 7 days of first patient share | Month 1–3 |
| Doctor-initiated new patient activations | ≥30% of all new accounts | Month 6 |
| Trial-to-paid conversion | ≥12% (freemium benchmark: 2.18%) | Month 1–3 |
| 6-month patient retention | ≥40% | Month 6 |

**Validation gate (Concept 1, before building):** The Letter assumption — patients will engage deeply with health data framed as personal narrative. Gate opens if min 2 of 3 behavioural acceptance criteria fire in ≥3 of 5 test participants within 6 days.

---

## Scope

**Free tier (core value, no paywall):**
- Blood test PDF upload → AI extraction → longitudinal Fingerprint (up to 3 draws)
- Manual bioimpedance and skinfold entry
- The Letter from Your Past Self (1 per upload)
- Basic access log (own record only)

**Premium — R$39/month, 7-day free trial:**
- Unlimited draws and full longitudinal history
- Per-biomarker selective sharing with any doctor or professional
- The Access Log with professional view tracking
- Doctor Conversation Starter report (patient-initiated)
- AI specialist direction suggestions
- Exam request / quest loop
- Time-limited sharing links

**MVP build sequence (Days 1–90):**
1. Blood test PDF → AI extraction → LOINC normalization (top 20 Brazilian lab biomarkers: CBC, lipid panel, metabolic, thyroid, iron)
2. The Letter (streamed server-side LLM)
3. The Longitudinal Fingerprint (personal baseline z-score visualization)
4. Manual BIA and skinfold entry
5. Per-biomarker access control + Access Log
6. Doctor Conversation Starter report via shareable link

**Explicitly out of scope (12-month horizon):**
- Hospital/clinic EMR integration
- Marketplace or monetised attention
- Visible AI marketing (pattern recognition surfaces as quiet suggestions only)
- Consumer wearable real-time streaming
- Non-Brazilian markets
- AI diagnosis or clinical decision support

**Regulatory note:** Health data is sensitive data under LGPD (Art. 11); explicit consent is the legal basis for processing. The product's explicit "direction, not diagnosis" AI framing is designed to sit below ANVISA's medical software (MDSW) classification threshold (RDC 657/2022). A LGPD-compliant privacy architecture (DPO appointment, data minimization, breach notification) is a non-negotiable operational requirement, not a post-launch task. Data portability (patient can export full record as JSON or PDF at any time) is in scope for MVP, aligned with LGPD Art. 18.

---

## Vision

**12 months:** The go-to longitudinal health record for Brazil's private health consumer. Doctor trust graph established in the top clinical specialties that map to the product's data types (endocrinology, sports medicine, cardiology, clinical nutrition). Premium subscription activated at R$39/month.

**3 years:** The health data layer that private Brazilian labs, insurers, and specialist networks want to connect to — because it is where patients actually store, understand, and share their health history. Private lab API partnerships replace PDF upload as the primary ingestion path. Corporate wellness programs (Wellhub, Caju, Flash) provide a B2B2C acquisition channel.

**The moat — two compounding assets:**
1. **Asymmetric data depth:** Longitudinal Fingerprints built over years that took years to build. A competitor arriving in year 2 cannot give a patient her year-1 ferritin trend.
2. **The doctor trust graph:** Reputational relationships between patients and professionals recorded through the platform — the Conversation Starter reports opened, the exam quests completed, the access logs reviewed. These are social capital artifacts that cannot be purchased or replicated from outside the network.

Neither moat is copyable by a well-funded late entrant. The 2028 government unification deadline is the closing of the window — build the network before it is no longer the only option.

---

*Generated: 2026-05-12 | Inputs: Design Thinking 2026-04-28 + Market Research 2026-05-12*
