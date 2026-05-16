# Design Thinking Session: Health Tracker

**Date:** 2026-04-28
**Facilitator:** Francis
**Design Challenge:** Patient-owned longitudinal health record with selective sharing

---

## 🎯 Design Challenge

### Design Challenge

Patients collect health data across multiple disconnected formats and sources — lab blood test reports, bioimpedance machine printouts, skinfold measurement records, and smartphone sleep trackers — but have no unified place to store, trend over time, and selectively share this data with health professionals. Today patients resort to printed reports, photos, and screenshots taken manually. The opportunity is to give patients full ownership of their longitudinal health record and the ability to share it — on their terms — with any doctor or health professional, without depending on existing clinic or hospital systems.

### Challenge Statement

**"How do we empower patients to own, organize, and selectively share their complete health measurement history — starting with blood tests, bioimpedance, and skinfold data — so that any health professional they choose can immediately understand their health trajectory without friction?"**

**Key framing decisions:**

| Dimension | Decision |
|---|---|
| Primary user | Patient — owns and controls the data |
| Secondary user | Doctors / health professionals — receive shared access |
| Priority data types | Blood tests, bioimpedance, skinfold |
| Privacy model | Patient decides who sees what — granular access control |
| System dependency | Independent database — not coupled to clinic/EMR systems |
| Technical approach | Web + mobile app on shared database; initial data ingestion via image processing jobs (e.g. Google Drive as source) |
| Out of scope (for now) | Integration with clinic/hospital EMR systems |

---

## 👥 EMPATHIZE: Understanding Users

### User Insights

**Patient (primary user)**
- Patients are emotionally invested in their own health data — they get excited when results arrive because data represents their evolution and progress
- Patients range from procedural (already organise results in Google Drive) to non-procedural (data gets lost in camera rolls, email attachments, WhatsApp forwards) — the system must serve both
- Some patients can understand individual results, but they rely on doctors to interpret trends and set protocols or strategies
- Privacy feels *empowering* — the act of choosing who sees their data is an identity statement, not just a settings toggle
- The core pain is triggered at the **handoff moment**: walking into a new doctor's office and starting from zero

**Doctor / Health Professional (secondary user)**
- Doctors feel relief when they see good results in a report and concern when they see bad ones — they are emotionally present, not neutral
- Currently doctors receive stacks of PDFs from different labs, different reference ranges, sometimes different languages — they triangulate in real time while trying to stay present with the patient
- A clean, scannable summary that surfaces what changed since the last visit is the experience that earns doctor trust and turns them into advocates
- Doctors requesting exams for patients is a natural workflow that can be integrated into the notification loop

### Key Observations

1. **Two data tiers with completely different failure modes:**
   - *Daily data* (sleep, steps, HRV) — ambient, forgiving. A missing day is non-critical. Design can be quiet and automatic.
   - *Periodic clinical data* (blood tests, bioimpedance, skinfold) — ceremonial, unforgiving. Missing this data prevents doctor evaluation. This tier demands near-zero tolerance for loss or misread values.

2. **Missing periodic data is an opportunity, not just a gap:** The platform can proactively notify patients when an exam period is approaching AND remind doctors to send test requests — closing the loop on both sides.

3. **The MVP proving story is one flow:** Patient uploads blood test PDF → system extracts and normalises values → health professional sees a clean, dated trend. Everything else is downstream.

4. **AI is the endgame value unlock — framed correctly:** The goal is NOT to diagnose. It is to surface longitudinal patterns and recommend the patient consult a doctor when a concerning scenario is detected. Pattern recognition as a gift to the clinical conversation, not a replacement for it.

5. **Google Drive is a pragmatic MVP bridge, not the final model:** Many patients already have Google accounts. After MVP validation, mobile/web app upload replaces Drive ingestion seamlessly — the data model must stay stable across ingestion sources.

6. **Doctors are the most powerful distribution channel:** The first time a doctor opens a patient-shared report and saves cognitive load instead of adding to it, they become an advocate. That 90-second experience is a make-or-break product moment.

### Empathy Map Summary

**Patient**
| | |
|---|---|
| **Says** | "I can't find my data when I need it" / "I wish my new doctor could see my full history" |
| **Thinks** | "Is my protocol actually working?" / "What do these numbers mean over time?" |
| **Does** | Stores PDFs in Drive or WhatsApp, brings printed reports to appointments, describes results from memory |
| **Feels** | Excited when data arrives / Empowered by controlling access / Frustrated starting from zero with new doctors |

**Doctor**
| | |
|---|---|
| **Says** | "Can you bring your previous results next time?" |
| **Thinks** | "I have 12 minutes and three labs from three different clinics to parse" |
| **Does** | Triangulates across disconnected documents, falls back on what they measured themselves |
| **Feels** | Relief at good results, concern at bad ones / Grateful when a patient arrives prepared |

---

## 🎨 DEFINE: Frame the Problem

### Point of View Statement

**Primary POV:**
> *A health-conscious patient who treats their data as a record of personal evolution needs a way to carry their complete longitudinal health story across every clinical encounter — with full control over who sees it — because starting from zero with a new doctor doesn't just waste time, it erases the person they've worked hard to become.*

**Constraint (non-negotiable):**
> *A patient who understands that sharing health data is an act of selective vulnerability needs the platform itself to enforce and make visible their sovereignty at every step — because the moment the system makes a privacy decision without them, the entire therapeutic relationship with their own data collapses.*

### How Might We Questions

**Data Capture & Ingestion**
- HMW-1: How might we make uploading a blood test feel as effortless as sharing a photo to a friend? → *Solved: mobile app acts as a share target; patients share files to the app like they share to WhatsApp. App owns storage.*
- HMW-2: How might we design for the patient who will never organise their health data? → *Solved: app handles storage transparently; patient never manages folders.*
- HMW-3: How might we handle two labs reporting the same biomarker with different reference ranges? → *Resolved: normalisation layer handles this; not a UX problem.*

**Patient Experience & Motivation**
- HMW-4: How might we make a patient want to log a bad result as much as a good one? → *Solved: reframe bad results as "important to consider next steps" — not negative, actionable.*
- HMW-5: How might we design so the platform feels like it belongs to the patient? → *Solved: patient controls access toggles per doctor; every upload shows who currently has access.*
- HMW-6: How might we turn "starting from zero with a new doctor" into a feature? → *Solved: patient searches doctor accounts and toggles share on; doctor immediately sees longitudinal history.*

**Doctor & Professional Experience**
- HMW-7: How might we earn a doctor's trust in 90 seconds? → *Solved: biomarker cards with current + previous value, color coding (green / yellow / red), visual trend at a glance.*
- HMW-8: How might we support doctors requesting exams without becoming a clinical tool we're not qualified to be? → *Solved: doctors can upload exam requests through the app and share them to patients; we are the conduit, not the requester.*
- HMW-9: How might we present trend data to a time-pressured specialist? → *Solved: biomarker cards with colour signals + staleness notifications; doctor configures their own staleness thresholds.*

**Notifications & Proactive Engagement**
- HMW-10: How might we notify patients about overdue exams without feeling like surveillance? → *Solved: reminder scope is narrow — only doctor-requested exams pending before next appointment. Patient configures lead time.*
- HMW-11: How might we know when to be silent? → *Solved: notifications are appointment-anchored, not time-based nagging. Doctors also see staleness indicators they configured themselves.*

**AI & Insight Generation**
- HMW-12: How might we design AI insights that are useful but legally unambiguous? → *Solved: if biomarker is out of healthy range or patient shows no improvement over time, app suggests relevant medical specialisation — not a diagnosis, a direction.*
- HMW-13: How might we surface pattern recognition that prompts a doctor visit without alarming the patient? → *Solved: framing is "it may be worth discussing this with a [specialist type]" — actionable, not alarming.*

**Privacy & Access Control**
- HMW-14: How might we make revoking access as natural as granting it? → *Solved: per-doctor toggle (share / unshare) on doctor's profile; reversible at any time.*
- HMW-15: How might we build a system where what patients choose not to share is respected — including from us? → *Solved philosophically: patient owns their data, accepts consequences of what they choose not to share. Platform's role is transparency, not enforcement.*

### Key Insights

1. **The handoff is the product's founding promise.** Every architectural decision — ingestion, normalisation, sharing, portability — must be evaluated by whether it makes the "new doctor, starting from zero" moment disappear.

2. **Data arrives in two streams with two different designs:** doctor-requested clinical data (blood tests) that patients must actively collect and upload, and automatic ambient data (smartphone, Google Health, Samsung Health, bioimpedance apps) that flows passively.

3. **Bad results are not bad news — they are the most valuable next-step triggers.** The product's emotional design must frame out-of-range results as actionable signals, not failures.

4. **Transparency at every upload is the privacy contract.** Each time a patient uploads, the app surfaces which doctors currently have access. No hidden access. No surprises.

5. **Patient sovereignty is absolute — with acknowledged consequences.** If patients choose not to share or upload data, that is their right. The product is honest about what completeness enables but never coerces.

6. **Doctors are co-participants in the notification loop.** They configure their own staleness thresholds; they upload exam requests; they are active actors in the platform, not passive recipients.

7. **The AI layer is a direction engine, not a diagnosis engine.** Out-of-range biomarkers or prolonged stagnation → suggest a medical specialisation. The patient decides what to do with that suggestion.

8. **Account creation is the first data collection moment.** Onboarding must immediately offer to import previously owned results — the product's value starts on day one, not after months of fresh data.

---

## 💡 IDEATE: Generate Solutions

### Selected Methods

- **Brainstorming** — 38 ideas generated across upload experience, trend reveal, doctor report, notifications, and privacy/sharing
- **Analogous Inspiration** — drew from documentary filmmaking (narrative arc), photography (contact sheet), ritual design (sealed envelope, vault door)
- **Provotype Sketching** — pushed past the obvious into unexpected territory (health year postcard, voice memo at upload, doctor trust score)
- **Jobs-to-be-Done clustering** — grouped ideas by the assumption each tests, not by feature similarity

### Generated Ideas (Top Selection)

**Upload & Capture**
- Mobile app as share target — patients share files like sending to WhatsApp; app owns storage
- Ritual Check-In — before results appear, a quiet emotional check-in ("how are you feeling?"); context travels with the data but never shared without consent
- Voice memo tagging at upload — 10 seconds of context that lives with the record forever
- Exam request as a "quest" — doctor-uploaded request becomes a visible quest card on the patient home screen

**Trend Reveal**
- **(Chosen) The Letter From Your Past Self** — warm narrative summary written as if by a thoughtful friend who read the files; charts available below as a second layer
- The Awakening Scroll — single biomarker timeline draws itself like a heartbeat, no numbers first
- The Contact Sheet — grid of sparklines for health-literate patients who want to scan everything

**Doctor Experience**
- **(Chosen) Conversation Starter** — 3 curious, non-alarming prompts generated from patient data ("Maria's sleep and ferritin move together — worth exploring"); each expands to full chart inline
- Executive Brief — 4-section scannable brief (who this person is, what's stable, what's worth discussing, what patient wants from this visit)
- "What I want from this visit" field — patient writes one sentence; appears at top of doctor's view
- Living Atlas — visual map of body systems; best as "full record" destination, not entry point

**Privacy & Sharing**
- Per-biomarker sharing granularity — share lipid panel with cardiologist, hide mental health markers
- Access log — always visible, always simple ("Dr. Lima viewed your data on April 3rd")
- Vault door animation — sharing toggle as a tactile ceremony
- Time-limited sharing links — expires in 48 hours for one-off consultations

**AI & Insights**
- Longitudinal Fingerprint — personal baseline computed from patient's own history; deviation flagged against THEIR normal, not population averages
- "Explain this to my doctor" — tap biomarker, get a calm non-alarmist question to ask in the appointment
- Doctor-patient shared annotation — both parties can leave notes on any biomarker; becomes a permanent dialogue

**Growth**
- Doctor Acquisition Loop — patient demonstrates their record → doctor sends one invitation link → new patient onboards in 3 minutes → loop repeats
- Research opt-in as identity — donate anonymised data to studies, receive a receipt ("your data contributed to 4 studies this year")

### Top Concepts

**Concept 1 — "The Longitudinal Self" ⭐ Start Here**
The Letter From Your Past Self + Longitudinal Fingerprint baseline + life event overlay on the biomarker timeline. Patient gets a narrative summary of how they've changed over time, seen against their own baseline (not population averages), with the ability to drop life events onto the timeline to make sense of what drove the changes.
*Assumption tested: patients will engage deeply with their own health data if it is framed as a personal story — not a dashboard. If this doesn't create an "aha" moment, the product is just another chart viewer.*

**Concept 2 — "The Trustworthy Handoff"**
Ritual Check-In upload ceremony + Access Log + per-biomarker sharing granularity. Patient uploads data with intention, controls exactly who sees what at the biomarker level, and always knows who looked and when.
*Assumption tested: patients will share more — and more sensitive — data if they feel genuinely in control of their own record, not just legally informed of their rights.*

**Concept 3 — "The Doctor Bridge"**
Doctor Acquisition Loop (shareable link) + "What I want from this visit" field + Conversation Starter report + "Explain this to my doctor" AI feature. Full arc: patient acquires a doctor, prepares for the visit, shows up with one clear sentence at the top of the doctor's view, and has AI-assisted language to discuss what the data shows.
*Assumption tested: a patient sharing a link and a doctor actually opening it creates enough bilateral value that it becomes a self-sustaining growth engine.*

**Build sequence:** Concept 1 first (Fingerprint must exist before the Doctor Loop has anything to demonstrate). North star metric: **doctor-initiated patient invitations per week, trending upward for 3 consecutive weeks.**

**Primary user archetype: Maria** — health-conscious, emotionally invested in her own evolution, not necessarily procedural, has seen multiple doctors across her care journey, treats her health data as a record of the person she's working to become.

---

## 🛠️ PROTOTYPE: Make Ideas Tangible

### Prototype Approach

**Method:** Wizard of Oz — maximum faking, minimum building. Test the emotional frame, not the technical pipeline.
**Concept under test:** Concept 1 — "The Longitudinal Self"
**Assumption being tested:** Patients will engage deeply with their own health data if framed as a personal story, not a dashboard.
**Prototype fidelity:** 3 screens, pre-written letter, one hardcoded biomarker chart, static personal baseline band.

**What is faked:**
- OCR extraction (fixture JSON pre-loaded)
- LOINC normalisation (hardcoded lookup for 5–8 prototype markers)
- Letter content (pre-written, not generated — except LLM call, which must be real)
- Personal baseline band (hardcoded from fixture data)
- Life events (2 pre-seeded; add interaction non-persistent)

**What must actually work:**
- The LLM call for The Letter (this is what's being tested)
- Tap/transition between screens
- Life event add interaction (even if non-persistent)
- Closing emotional check-in mirror

### Prototype Description

**Screen 1 — Ritual Check-In**
Soft gradient, no clinical white. One question: *"Before we look at your results — how are you arriving today?"* Five human emotional states: Hopeful / Worried / Curious / Exhausted / Not sure. One tap advances.

**Screen 2 — The Letter From Your Past Self**
Full-screen narrative. Warm, first-person, ~200–300 words. Three elements: a specific time reference, a change the patient drove, a forward-looking invitation. Single button below: *"Show me the charts."* The letter streams in real time (LLM streamed on-demand, server-side) — the letter writes itself, which is better UX than a spinner.

**Screen 3 — The Longitudinal Fingerprint**
One biomarker (ferritin or CRP — emotionally resonant, commonly discussed). Personal baseline rendered as a z-score band (within 1σ green, 1–2σ amber, >2σ red) — deviation against patient's own history, not population ranges. Two pre-seeded life events on timeline. Prompt: *"Does this match what you remember?"* Plus a tap-to-add life event interaction.

**Closing screen:** Mirror of Screen 1. *"How are you leaving today?"* Same five states. Shift in emotional state = product working.

### Key Features to Test

**Maria's four tasks (goals, not instructions):**
1. "You've just received your health results. Go ahead." → observe: does she read the full letter before touching the chart button?
2. "Tell us what changed for you over the past year based on what you're seeing." → observe: does she reference the letter or the chart?
3. "Drop something on the timeline you think is relevant." → observe: does she want to? Does it feel like meaning-making or data entry?
4. "What would you want to show someone else — a doctor, a partner, a friend?" → observe: does she want to share the letter or only the chart?

**Assumption confirmed if:**
- She reads the entire letter before touching "Show me the charts" — unprompted
- She uses emotionally loaded language in debrief ("I didn't realise," "that actually makes sense now," "I felt seen")
- She adds a life event and explains why without being prompted
- She references the *letter*, not the chart, when asked what changed
- She says unprompted: "my doctor should see this" or "I wish I'd shown this at my last appointment"

**Assumption dead if:**
- She skims the letter and goes straight for the charts
- She calls it "nice but not necessary"
- She treats life-event entry as a form, not meaning-making
- She can't answer "what does this tell you about yourself?" — only "what does this say about my numbers?"

**Technical non-negotiables before first user session:**
- `collected_at` stored as `DATE` not `TIMESTAMPTZ` for lab reports (timezone corruption is the silent false-negative risk)
- Test: `assert reading.collected_at.date() == date(2024, 3, 15)` passes before any session runs
- LLM confidence gate: < 0.85 extraction confidence → flag for manual review, never auto-publish

**Stack:** Expo + Next.js + TypeScript monorepo (pnpm + Turborepo). Backend: Node/TypeScript. DB: PostgreSQL with RLS. The Letter: streamed on-demand, server-side. Observation schema: `(patient_id, loinc_code, value_numeric, unit_ucum, collected_at, source_type, source_ref)` — indexed on `(patient_id, loinc_code, collected_at)`.

**Who to test with:** 5–7 people from chronic condition Facebook groups, r/QuantifiedSelf, and Francis's own network. People who are honest, not kind.

**Timeline:** Day 1 — write the letter by hand. Day 2 — static Figma/Keynote fingerprint. Day 3 — message five people. Day 4–5 — run sessions. Day 6 — the assumption lives or dies.

---

## ✅ TEST: Validate with Users

### Testing Plan

**Concept under test:** Concept 1 — "The Longitudinal Self"
**Assumption:** Patients will engage deeply with their own health data if framed as a personal story — not a dashboard.
**Participants:** 5–7 people. Sources: chronic condition Facebook groups (lupus, hashimoto's, type 2 diabetes), r/QuantifiedSelf, Francis's own network. Recruit people who will be honest, not kind.
**Session length:** 45 minutes target. One facilitator, one dedicated observer — never the same person.

**Opening script (verbatim):**
> *"What you're about to see is early and unfinished — intentionally. We're not testing you. We're learning from you. There's no way to do this wrong. Just move through it like you would at home, alone, at 10pm. I'll be very quiet. That's respect."*

**Think-aloud invitation:**
> *"If something surprises, confuses, or makes you feel anything — just say it out loud. Like you're texting a friend while this happens. Not explaining. Just reacting."*

When participant goes silent 8+ seconds: *"What's happening for you right now?"* — once, softly, then stay still.

**Four participant tasks (goals, not instructions):**
1. "You've just received your health results. Go ahead."
2. "Tell us what changed for you over the past year based on what you're seeing."
3. "Drop something on the timeline you think is relevant."
4. "What would you want to show someone else — a doctor, a partner, a friend?"

**Closing question (after all tasks):**
> *"If this existed and you used it for a year — what would be different about how you understand yourself?"*
Wait through the first answer. Wait through the pause. The honest answer comes in the second breath.

**Three acceptance criteria (hard signals, observer-coded — not self-reported):**
- **AC1:** Reads The Letter aloud / asks "can I share this?" — emotional ownership
- **AC2:** Points at data and says "I didn't know that about myself" — unprompted pattern recognition
- **AC3:** Says unprompted "my doctor should see this" / names a specific clinician — doctor bridge in embryo

**Gate opens if:** Min 2 of 3 ACs fire as hard signals across at least 3 of 5+ participants, zero kill-conditions observed.

**Kill conditions (any one observed in n≥3 participants closes the gate):**
- Zero AC signals across all participants
- 4+ participants skip The Letter without reading
- 3+ express discomfort with personal framing unprompted
- Zero possessive language about data ("my baseline," "mine") across all sessions
- 3+ reframe ownership toward doctor ("the doctor should decide") — authority transfer, not empowerment

**In-session capture (observer records in real time):**
- Behavioral timestamps: Letter reading start/end, first re-read, first data touch, first self-reference, first clinician mention, any sharing gesture
- Verbal log: each utterance coded [AC1][AC2][AC3][Q][R][E] with verbatim quote
- Engagement rating at three moments (end Check-In / end Letter / end Fingerprint): level 1–5, valence, body language
- Pre-debrief index card (participant alone, 60 seconds): one word for how you feel, one thing you'd keep, one question you'd ask

**Key observational signals:**
- The Re-Read: scrolls back up in The Letter unprompted → desire, not confusion
- The Touch: taps non-interactive element → claiming ownership
- The Body Turn: rotates toward facilitator while looking at screen → wants to share
- The Held Breath: inhale that doesn't exhale for a beat → body understood before brain found words
- The Name Drop: mentions a doctor or family member mid-experience → AC3 arriving as aside
- The Broken Letter Moment: eyes move to scroll-bottom before finishing → completing a task, not following a story; all data after this point is compromised
- The Jaw-Set: taps non-interactive element then micro-resignation → wanted to go deeper, prototype wouldn't let them; they'll say "it's interesting"

**Between-session iteration rule:**
If sessions 1–3 show participants reading The Letter but immediately scrolling past the chart: cut the last line of The Letter — remove the resolution one beat before the answer. Leave: *"Your body was telling you something that whole winter. Here's what it looked like —"* Then the chart appears as the answer. The scroll-past stops because she can't close the loop without it.

**Letter calibration signals across 5 sessions:**
- Too long → delayed lean-in on chart (emotionally fatigued before reaching it)
- Too short → flat expression through fingerprint (narrative runway missing)
- Too vague → 3+ say "interesting" unprompted (politest way to say "I didn't feel it")
- Not specific enough → frustrated exhale + scan for why a line moves (letter emotional, chart precise, they never shook hands)

### User Feedback

*To be captured during and after user testing sessions.*

### Key Learnings

**Decision tree post-testing:**

| Result | Action |
|---|---|
| All 3 ACs pass | Move immediately to Concept 2 prototype |
| AC1+AC2, no AC3 | Build Concept 2; add prompt layer for doctor instinct |
| AC1+AC3, no AC2 | Build Concept 2; sharpen Letter insight engine |
| AC2+AC3, no AC1 | Pause. Fix emotional ownership before building handoff |
| Only AC1 | This is a journaling app. Don't build Concept 2 yet |
| Only AC2 | Radical Letter rewrite. Data works, narrative doesn't |
| Only AC3 | Compliance, not engagement. Treat as fail |
| 0 ACs | Don't iterate. Go back upstream: is the *assumption* wrong, or the execution? |

**What Concept 1 testing answers that Concept 2 depends on:**
1. Does the patient feel like the *author* of their story? (AC1) — if no, Concept 2's patient-initiated sharing assumption breaks
2. What exact language do patients use when they want to share? (AC3 verbatim quotes) — that language is the Concept 2 UI copy
3. What do they not want the doctor to see? (any hesitation moment) — that's the selective sharing architecture for Concept 2

**The one insight to carry forward regardless of outcome:**
> *The patient is not afraid of their data. They're afraid of what it says about them to someone who has power over them.*

Everything — The Letter, the handoff, the doctor bridge — lives or dies on whether this product resolves that fear or accidentally confirms it.

---

## 🚀 Next Steps

### Refinements Needed

**Concept 1 — Before Prototype:**
- Write The Letter in three tones (clinical / narrative / hybrid) and test verbally with one real person before any code
- Define what The Letter must say to feel true — this is the creative brief, not a technical task
- Build the Longitudinal Fingerprint in a Google Sheet with fake data as a demo artifact for week-one calls

**Concept 1 — After Validation:**
- Cut the Letter's final line before the chart reveal — end one beat before resolution to pull the reader into the data
- Add life event overlay as a first-class feature (not an afterthought)
- Define the `source_type` enum before adding any new ingestion source

**Concept 2 — Prerequisites from Concept 1:**
- RLS policy must be written to extend to `share_grants` scope without a full rewrite
- Upload state machine (`pending → processing → complete → failed`) must exist before Concept 2 adds the ceremony layer
- Decide now: is `professional_id` a FK to `users` or a UUID in `pending_invites`?

**Strategic boundary (non-negotiable, 12 months):**
- No hospital enterprise integrations
- No marketplace or monetized attention
- No visible AI marketing — let pattern recognition surface as quiet suggestions

### Action Items

**This Week (writing, not coding):**
1. Write 3 versions of The Letter by hand — read aloud to one real person
2. Find 5 people with a drawer of unsorted lab results — schedule 30-minute calls
3. Build Longitudinal Fingerprint in Google Sheets with fake Maria data (5 biomarkers, 4 time points, 1 life event)
4. Run calls Thu–Fri: show spreadsheet, read Letter, ask one question — *"Would you have wanted this before your last appointment?"*
5. Write down verbatim what made them lean in vs. check their phone

**Days 8–30 (pipeline + Concept 1 prototype):**
6. Set up Expo + Next.js monorepo with PostgreSQL + RLS (one afternoon)
7. Build Textract → LLM extraction pipeline, validate on 3 real PDFs from week-one participants
8. LOINC normalisation for top 20 biomarkers
9. Fingerprint UI — functional, show to same 5 people
10. Streaming Letter generation — tuned against winning hand-written version
11. End-to-end test with one real user: their PDF, their Fingerprint, their Letter

**Days 31–90 (Concept 2 + Doctor Bridge, if Concept 1 validates):**
12. Build upload ceremony (Ritual Check-In) + per-biomarker access control + access log
13. Design and build one-page conversation starter doctor report
14. Build lightweight doctor-facing landing page + invitation link flow
15. Run the doctor loop with 3 real doctor-patient pairs — attend the appointment context
16. Instrument north star metric dashboard — doctor-initiated invitations per week

### Success Metrics

**North Star:** Doctor-initiated patient invitations per week — trending upward for 3 consecutive weeks.

**Patient engagement:**
| Metric | Threshold |
|---|---|
| Longitudinal Completeness Score (0–100) | Median ≥ 60 by day 90 |
| Organic return sessions | ≥ 40% of users, 2+ sessions/month by month 3 |
| Letter Open Rate | ≥ 70% within 48h of generation |
| AI recommendation acknowledgment | ≥ 50% after month 4 |

**Doctor adoption:**
| Metric | Threshold |
|---|---|
| Doctor Profile Activation Rate | ≥ 60% within 7 days of appointment |
| Time-to-First-Invitation | Median ≤ 30 days from first access |
| Doctor-initiated new activations | ≥ 30% of all new accounts by month 6 |
| Invitation Conversion Rate | ≥ 55% |

**Data quality:**
| Metric | Threshold |
|---|---|
| Structured upload rate | ≥ 65% by month 3 |
| AI error flag rate | ≤ 15% |
| Duplicate record rate | ≤ 10% |

**Business health:**
| Metric | Threshold |
|---|---|
| 6-month patient retention | ≥ 40% |
| Support escalation rate | ≤ 5% of MAU |
| Feature adoption breadth | Average ≥ 3.5 of 6 features by month 6 |

**Weekly dashboard (6 numbers):**
Doctor Invitations Sent · Doctor Activation Rate · Median Completeness Score · AI Error Flag Rate · Organic Return Sessions · 6-month Retention Cohort

**Strategic position at 12 months:**
> The moat is asymmetric depth (fingerprints that took years to build) plus a doctor trust graph (reputational acts that cannot be copied). Build the network, not the product — and guard patient-ownership with the ferocity of a patent.

---

_Generated using BMAD Creative Intelligence Suite - Design Thinking Workflow_
