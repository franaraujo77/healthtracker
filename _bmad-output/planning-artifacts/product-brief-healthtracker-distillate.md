---
title: "Product Brief Distillate: Health Tracker"
type: llm-distillate
source: "product-brief-healthtracker.md"
created: "2026-05-12"
purpose: "Token-efficient context for downstream PRD creation"
---

# Health Tracker — Detail Pack for PRD Creation

## Product Identity

- **Name:** Health Tracker
- **Category:** Patient-owned longitudinal health record (NOT a wellness dashboard, NOT a diagnostic tool)
- **Primary market:** Brazil private health consumers — people with planos de saúde, using private labs (Fleury, DASA, Hermes Pardini, Einstein, Lavoisier)
- **Independent of:** all clinic/hospital EMR systems, government SUS infrastructure, any single lab network
- **Regulatory position:** Explicitly "direction, not diagnosis" AI — designed to sit below ANVISA MDSW classification (RDC 657/2022). AI outputs are framed as specialist referral suggestions, never clinical decisions.
- **LGPD:** Health data is sensitive data under Art. 11. Legal basis = explicit consent. DPO appointment required. Data portability (JSON/PDF export) is MVP scope per LGPD Art. 18.

---

## Primary User — Maria (full archetype)

- Health-conscious, 25–50, urban Brazil, private health insurance
- Has seen multiple specialists across her care journey (endocrinologist, sports medicine, nutritionist, cardiologist)
- Treats health data as a record of the person she is working to become — emotionally invested, not clinically detached
- Gets excited when results arrive; frustrated that each new doctor makes her start from zero
- Two subtypes that must both be served:
  - **The Organiser:** already stores results in Google Drive folders; needs the product to make those PDFs useful, not just stored
  - **The WhatsApp-native:** lab results live in camera roll, WhatsApp forwards, email attachments; has never saved a PDF intentionally — onboarding must serve her or the TAM is cut in half
- Privacy feels empowering to Maria — choosing who sees her data is an identity statement, not a settings toggle
- Core pain triggers at the **handoff moment**: walking into a new specialist's office and starting from zero
- Not afraid of her data — afraid of what it says about her to someone who has power over her

## Secondary User — Doctor / Specialist

- Endocrinologist, cardiologist, sports medicine physician, clinical nutritionist (highest relevance to product data types)
- Currently receives stacks of PDFs from different labs, different reference ranges, sometimes different languages/units
- 15-minute appointment context — cannot review 90 days of patient data; needs a scannable summary
- Relief when good results are clear; concern when bad ones are visible — emotionally present, not neutral
- Becomes a distribution node when the 90-second patient-sharing experience saves cognitive load
- Configures own staleness thresholds for biomarkers they track
- Uploads exam requests through the platform (becomes a quest for the patient)
- **Doctor activation barrier:** currently receives an unsolicited patient-shared link; needs a clear value proposition for creating an account. Open question: what does the doctor get beyond the Conversation Starter report? Lightweight patient population view? Exam request workflow? This is unresolved and critical to the loop.

## Tertiary User — Health Professional (nutritionist, personal trainer)

- Uses skinfold calipers (Jackson-Pollock 7-site, Durnin-Womersley) and BIA machines (Tanita, InBody) routinely
- Results currently live in paper notebooks or clinic spreadsheets — no digital longitudinal home anywhere in the market
- High session frequency with their clients (weekly or monthly)
- A lighter professional access tier for this segment = second acquisition channel independent of physician buy-in
- Skinfold tracking is absent from every global competitor — this segment has no alternative

---

## Core Concepts and Named Features

### The Longitudinal Fingerprint
- Personal baseline computed from the patient's own history — NOT population reference ranges
- Deviation flagged against the patient's normal, not generic lab reference intervals
- Example: ferritin of 45 ng/mL is "normal" by population standards and a personal crisis for someone whose baseline is 90
- Rendered as a z-score band (within 1σ = green, 1–2σ = amber, >2σ = red)
- Biomarker timeline with life event overlay (patient can drop events: "started new protocol," "had surgery")
- Requires multiple data points to be statistically meaningful — cold-start problem: product must deliver value to a user with only 1–2 draws before the Fingerprint has statistical depth
- **Cold-start value proposition is unresolved** — what does a new user with one blood draw see that makes them return?

### The Letter from Your Past Self
- AI-generated warm narrative summary (~200–300 words) of how the patient's health has evolved
- Tone: a thoughtful friend who read all the files — not clinical, not alarming
- Streams in real-time (server-side LLM, not a spinner)
- Three required elements: specific time reference, a change the patient drove, a forward-looking invitation
- Ends one beat before the data resolution — last line pulls the reader into the chart ("Your body was telling you something that whole winter. Here's what it looked like —")
- **The core product assumption being tested in Concept 1:** patients will engage deeply with health data if framed as personal story, not a dashboard
- Tested via: does user read the entire letter before touching "Show me the charts"?

### The Access Log
- Always visible, always simple: "Dr. Lima viewed your data on April 3rd"
- Per-biomarker granularity — which data types were visible in each access event
- No health app, lab portal, or EMR currently offers this — category-defining transparency mechanism
- Should have its own named moment in onboarding, not buried in settings
- Privacy is not a policy page — it is the primary UI

### The Conversation Starter Report (Doctor view)
- 3 AI-generated, non-alarming discussion prompts derived from the patient's longitudinal data
- Example: "Maria's sleep and ferritin move together — worth exploring"
- Each prompt expands inline to full chart
- Biomarker cards: current value, previous value, colour coding (green/amber/red against patient's own baseline)
- "What I want from this visit" field — patient writes one sentence; appears at top of doctor's view
- Must be useful in 90 seconds — this is the make-or-break product moment for doctor adoption

### The Exam Quest Loop
- Doctor uploads an exam request through the platform
- Patient receives it as a visible "quest" card on their home screen
- Completing the quest (uploading results) auto-populates the shared record visible to that doctor
- Closed-loop bidirectional retention mechanic — strongest engagement driver in the product
- Should be in MVP success criteria, not just the feature list

### Ritual Check-In (prototype-phase feature, not core MVP)
- Before results appear: one question — "How are you arriving today?" Five emotional states
- Context travels with the data but never shared without consent
- Closing mirror: "How are you leaving today?" Shift in state = product working
- Tested in Concept 1 prototype but may not make MVP v1

---

## Technical Context and Constraints

**Stack decisions (from design thinking):**
- Expo + Next.js + TypeScript monorepo (pnpm + Turborepo)
- Backend: Node/TypeScript
- Database: PostgreSQL with Row-Level Security (RLS)
- The Letter: streamed on-demand, server-side LLM
- Observation schema: `(patient_id, loinc_code, value_numeric, unit_ucum, collected_at, source_type, source_ref)`
- Index on: `(patient_id, loinc_code, collected_at)`
- `collected_at` stored as DATE not TIMESTAMPTZ for lab reports (timezone corruption = silent false-negative risk)
- Test: `assert reading.collected_at.date() == date(2024, 3, 15)` must pass before any session runs

**Data ingestion:**
- Primary MVP path: PDF upload → AI extraction (OCR + LLM)
- LLM confidence gate: <0.85 extraction confidence → flag for manual review, NEVER auto-publish
- Wizard of Oz approach for early validation: manually extract first results before pipeline is built
- LOINC normalization for top 20 Brazilian lab biomarkers at MVP: CBC, lipid panel, metabolic panel, thyroid, iron studies
- Same biomarker reported in different units across labs → normalization layer handles this (not a UX problem)
- `source_type` enum must be defined before adding any new ingestion source
- Brazilian lab PDF formats (Fleury, DASA, Hermes Pardini) are proprietary — each requires extraction engineering; number of supported lab formats at MVP is unresolved

**Sharing/access control:**
- RLS policy must be written to extend to `share_grants` scope without a full rewrite
- Upload state machine: `pending → processing → complete → failed`
- `professional_id`: FK to `users` table or UUID in `pending_invites`? — unresolved architectural decision
- Per-doctor, per-biomarker access toggles
- Time-limited sharing links (e.g., 48h for one-off consultations)
- Data export: patient can export full record as JSON or PDF at any time (LGPD Art. 18, also trust architecture)

**BIA / bioimpedance:**
- Manual entry from any device at MVP (Tanita, InBody, Withings, Galaxy Watch, smart scales)
- Consumer BIA diverges from clinical-grade by 3–5%+ — product should contextualize BIA readings alongside lab results rather than treating them as standalone
- Samsung Galaxy Watch BIA works in Brazil (confirmed); Apple HealthKit BIA via third-party scales only

**Skinfold:**
- Jackson-Pollock 7-site protocol at MVP
- Durnin-Womersley as secondary
- Results entered manually by patient or professional
- Data quality risk: non-professional users entering bad skinfold data corrupts their Fingerprint — need a measurement protocol guide in-app

---

## Pricing and Monetisation

**Free tier:**
- Blood test PDF upload → AI extraction → Fingerprint (up to 3 draws)
- Manual BIA and skinfold entry
- The Letter (1 per upload)
- Basic access log (own record only)

**Premium — R$39/month, 7-day free trial:**
- Unlimited draws and full longitudinal history
- Per-biomarker selective sharing with any doctor or professional
- Full Access Log with professional view tracking
- Doctor Conversation Starter report (patient-initiated)
- AI specialist direction suggestions
- Exam request / quest loop
- Time-limited sharing links

**Open questions on pricing:**
- R$59–79/month may be viable without resistance given that Brazil's private health insurance averages R$400–600/month (positioning as <10% of existing health spend)
- Annual pricing option not yet considered — likely increases LTV materially
- No CAC estimate, LTV model, or payback period has been calculated — this is a gap before Series A conversations

**Conversion benchmarks from research:**
- Freemium without trial gate: 2.18% conversion
- Free trial → subscription (health/fitness): 12–39.9%
- Optimal trial length converging to 7 days
- Subscription is 62.83% of health app revenue in 2025

---

## Go-to-Market and Growth

**Primary acquisition channel: Doctor Acquisition Loop**
1. Patient demonstrates their Health Tracker record
2. Doctor sends one invitation link to another patient
3. New patient onboards in 3 minutes
4. Loop repeats
- Doctor recommendation is the #1 acquisition lever for clinical health apps
- Only works if the 90-second doctor experience delivers undeniable value
- Doctor activation requires a clear value proposition beyond "cognitive load saved" — open question

**Secondary channel: Nutritionist/Trainer B2C2B**
- Professional uses Health Tracker with clients for skinfold and BIA longitudinal tracking
- No competing product exists for this use case
- Professional's recommendation to client = trusted referral
- Lower-friction entry point than physician buy-in

**Potential B2B2C channel (not MVP):**
- Corporate wellness platforms: Wellhub (Gympass), Caju, Flash
- Large employers fund private health plans and wellness programs
- Health Tracker as a benefit bypasses individual consumer CAC entirely

**Geographic strategy (open question):**
- São Paulo-first is implied but not committed — Fleury's strongest market, highest private health consumer density
- DASA stronger in Rio — expanding extraction to DASA formats = Rio market opens
- Starting with São Paulo constrains engineering scope and creates a contained validation environment

**Patient-to-patient referral (not yet designed):**
- Health-conscious Brazilians cluster in social networks: gyms, CrossFit boxes, nutrition communities, WhatsApp groups
- Referral mechanic with shared benefit (extended trial, unlocked feature) could run in parallel to doctor loop
- Not in MVP scope

---

## Validation Protocol (Concept 1 — before writing code)

**What is being tested:** The Letter assumption — patients engage deeply with health data if framed as personal narrative

**Method:** Wizard of Oz (maximum faking, minimum building)

**Participants:** 5–7 people. Sources: chronic condition Facebook groups, r/QuantifiedSelf, Francis's own network. Honest people, not kind ones.

**What is faked:** OCR extraction (fixture JSON), LOINC normalization (hardcoded for 5–8 markers), Letter content (pre-written, not generated — except the LLM call, which must be real), personal baseline band (hardcoded from fixture data), life events (2 pre-seeded)

**What must actually work:** The LLM call for The Letter, tap/transition between screens, life event add interaction (non-persistent), closing emotional check-in mirror

**Four participant tasks (goals, not instructions):**
1. "You've just received your health results. Go ahead."
2. "Tell us what changed for you over the past year based on what you're seeing."
3. "Drop something on the timeline you think is relevant."
4. "What would you want to show someone else — a doctor, a partner, a friend?"

**Gate opens if (hard behavioral signals, observer-coded — not self-reported):**
- AC1: Reads The Letter aloud / asks "can I share this?" — emotional ownership
- AC2: Points at data and says "I didn't know that about myself" — unprompted pattern recognition
- AC3: Says "my doctor should see this" / names a specific clinician unprompted — doctor bridge in embryo
- Minimum: 2 of 3 ACs fire across at least 3 of 5+ participants, zero kill conditions observed

**Kill conditions (any one observed in n≥3 participants closes the gate):**
- Zero AC signals across all participants
- 4+ participants skip The Letter without reading
- 3+ express discomfort with personal framing unprompted
- Zero possessive language about data ("my baseline," "mine")
- 3+ reframe ownership toward doctor ("the doctor should decide")

**Timeline:** Day 1 — write Letter by hand. Day 2 — static Figma/Keynote Fingerprint. Day 3 — message 5 people. Day 4–5 — run sessions. Day 6 — assumption lives or dies.

---

## Rejected Ideas (do not re-propose)

| Idea | Rationale for rejection |
|---|---|
| Hospital/clinic EMR integration | Out of scope for 12 months — adds enterprise sales complexity, delays consumer product validation |
| Marketplace or monetised attention | Contradicts patient data ownership positioning |
| Visible AI marketing | Pattern recognition must surface as quiet suggestions only; AI label creates liability and distrust in Brazil |
| Consumer wearable real-time streaming | Out of scope for MVP — manual entry is sufficient and reduces engineering complexity |
| Non-Brazilian markets in Phase 1 | Focus is required; Brazil private health gap is large enough |
| AI diagnosis or clinical decision support | Hard regulatory boundary (ANVISA MDSW, CFM); product is direction, not diagnosis |
| Living Atlas (visual body map) | Good as a "full record" destination, not an entry point; deferred |
| The Awakening Scroll (single biomarker timeline drawing itself) | Tested as ideation concept; not selected — The Longitudinal Fingerprint is the chosen visualization |
| The Contact Sheet (grid of sparklines) | For health-literate power users; not primary UX — deferred |
| Research opt-in as identity (donate anonymised data to studies) | Interesting but out of MVP scope |
| Predictive AI for next health event | Beyond "direction engine" boundary; regulatory risk |

---

## Competitive Intelligence Summary

**The five universal gaps across all 10 competitors:**
1. Manual blood test entry from any source — no major platform does this universally
2. Skinfold tracking — completely absent from all platforms globally
3. Patient-controlled granular selective doctor sharing (per-biomarker, revocable) — not offered by anyone
4. Brazilian private lab integration (Fleury, DASA, Hermes Pardini) — no platform has this
5. Patient-owned portable longitudinal health narrative — dashboards only, no narrative layer

**Most credible near-term threat:** WHOOP Advanced Labs going global (uploads started late 2025, Brazilian Portuguese not yet supported). WHOOP requires $200+ hardware + $359/year subscription + data is subscription-locked. Maria archetype is not a WHOOP customer.

**Second threat:** Samsung Health unlocking clinical features for Brazil (36–39% market share, BIA hardware already works in Brazil, Health Records currently US/India/South Korea only). Window to build doctor trust graph before Samsung activates: ~12–24 months.

**Government threat:** Meu SUS Digital targets 2028 for private sector integration. Even if achieved, government apps historically underdeliver on UX, narrative, and selective sharing. Not a product risk — a timeline signal.

**Key Brazil-specific competitive facts:**
- Meu SUS Digital: 50M downloads, 4.5M active users — covers SUS only; private labs not required to submit to RNDS
- Beep Saúde (R$1.2B valuation): home blood draw, not a record platform; São Paulo / Rio / Brasília only
- Mevo (R$140M Series B): B2B digital prescription for physicians — no patient data ownership layer
- Prontmed: B2B EMR for clinics — provider-controlled, no patient-facing app

---

## Open Questions for PRD Phase

1. **Doctor activation incentive** — what explicit value proposition does a doctor receive for creating a Health Tracker account? Beyond Conversation Starter: patient population view? Exam request workflow? This is the single largest risk to the Doctor Acquisition Loop.

2. **Cold-start value proposition** — what does a user with only 1 blood draw see that makes them return before the Fingerprint has statistical depth? The Letter works. What else?

3. **WhatsApp-native onboarding** — Maria who sends results via WhatsApp is the majority. Is there a "share PDF to Health Tracker from WhatsApp" flow? Does the app register as a share target on Android?

4. **Lab format scope at MVP** — how many Brazilian lab PDF formats are supported at launch? Fleury-only is safest for engineering; all-labs is the correct market position. What's the minimum viable lab coverage?

5. **Price point** — R$39/month is the conservative estimate. R$59–79/month may be viable given private insurance context. Should be tested in Concept 1 pricing experiments.

6. **São Paulo-first vs. open launch** — geographic concentration reduces extraction engineering scope but limits TAM signal.

7. **Free vs. premium tier boundary for The Letter** — is The Letter free (1 per upload) or premium? Currently proposed as free; reviewers flagged ambiguity since the Fingerprint is also described as AI-powered.

8. **Longitudinal Completeness Score definition** — what inputs determine it? Is it patient-visible? Does it drive prompts or unlock features?

9. **Professional access tier** — what does a nutritionist or trainer get that a patient account doesn't? Can they view multiple client records? Does this require a separate app mode or just a permission flag?

10. **Data export standard** — JSON, FHIR, PDF, or all three? FHIR alignment would aid future lab API partnerships but adds engineering complexity.

---

## Market Data Points (for PRD evidence)

- Brazil mHealth apps: USD 713M (2023) → USD 2.02B (2030), CAGR 16.0% (Grand View Research)
- 80% of Brazilians interested in digital health; only 20% using it (SESI/Nexus Research, May 2025, n=2,000+)
- 88% of Brazilians believe healthcare providers should share data with each other (Axway survey)
- 60% of Brazilians concerned about biometric data (CETIC.br 2024)
- 81% of LatAm consumers willing to pay for preventive health apps; weighted average USD 8.90/month (McKinsey)
- 80%+ of health app users abandon in the first 1–10 days (JMIR 2024)
- Only 10% of physicians integrate patient app data into clinical workflows (PatentPC)
- Doctor recommendation is the #1 acquisition lever for clinical health apps (IQVIA 2024)
- Samsung Health: 36–39% Brazil smartphone market share; clinical features locked to US/India/South Korea
- Apple Health Records: not available in Brazil or Latin America
- Meu SUS Digital: 50M downloads, 4.5M active users; private labs not connected to RNDS
- Brazil digital health unification government target: 2028

---

*Distillate generated: 2026-05-12 | Sessions: Design Thinking (2026-04-28) + Market Research (2026-05-12) + Product Brief (2026-05-12)*
