---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'competitive platform analysis'
research_topic: 'Apple Health vs Samsung Health vs Google Fit/Health — 2024–2026 state of health tracking platforms'
research_goals: 'Identify white space for a patient-owned longitudinal health record product focused on blood tests, bioimpedance, and skinfold data with selective doctor sharing'
user_name: 'Francis'
date: '2026-05-12'
web_research_enabled: true
source_verification: true
---

# Research Report: Competitive Health Platform Analysis (2024–2026)

**Date:** 2026-05-12
**Author:** Francis
**Research Type:** Competitive Platform Analysis — White Space Discovery

---

## Research Overview

This report analyzes the current state of Apple Health, Samsung Health, and Google Fit/Health as health tracking platforms (2024–2026) across five dimensions: core positioning, clinical data features, Brazil market presence, weaknesses/user complaints, and gaps in their offerings. The purpose is to identify white space for a patient-owned longitudinal health record product centered on blood tests, bioimpedance, and skinfold measurements with selective doctor sharing.

All claims are sourced from publicly available web data gathered in May 2026.

---

## Technical Research Scope Confirmation

**Research Topic:** Apple Health vs Samsung Health vs Google Fit/Health — 2024–2026 state of health tracking platforms
**Research Goals:** Identify white space for a patient-owned longitudinal health record product focused on blood tests, bioimpedance, and skinfold data with selective doctor sharing

**Scope Confirmed:** 2026-05-12

---

## Part 1: Apple Health

### 1.1 Core Positioning

Apple Health positions itself as the **central hub for a user's complete health picture** — a passive aggregator and longitudinal store that brings together data from wearables (Apple Watch), connected health devices, and institutional electronic health records (EHRs). The primary user is the iPhone-owning health-conscious adult in the US and UK who interacts with major hospital networks. Apple's healthcare ambitions are framed around reducing friction between patient data and clinical care, with the motto "health is personal."

Apple Health+ — an AI-powered health coaching service — was in development but was scaled back in early 2026, with the company shifting to smaller incremental feature releases rather than a bundled subscription service.

**Sources:**
- https://www.apple.com/healthcare/
- https://appleinsider.com/articles/26/02/06/apple-health-scaled-back-internally-will-focus-on-incremental-features-instead
- https://9to5mac.com/2026/01/11/apple-health-new-features-and-overhaul-coming-ios-26-4/

---

### 1.2 Key Features — Clinical Data

**Health Records (FHIR-based EHR integration)**
- Launched in 2018; users can download and aggregate clinical records from participating institutions via SMART on FHIR
- Supported EHR vendors: Allscripts, athenahealth, Cerner, CPSI, DrChrono, Meditech Expanse, Epic
- Lab results are importable from participating institutions, with an "enhanced labs experience" that allows users to view results, pin highlights, see reference ranges, and access educational content
- iOS 15+ supports "Share with Provider" — users can selectively share Health app data (activity, labs, ECG, blood pressure, immunizations) with participating US healthcare organizations

**Body Composition**
- Native HealthKit supports body fat percentage, lean body mass, and body mass as data types
- Skinfold measurements: NO native support. No built-in caliper protocol or skinfold-specific data type. Third-party apps (eaglefit Caliper, Body Size, Plixi) can write skinfold-derived body fat data into HealthKit, but the native app has no direct skinfold entry UI
- Bioimpedance: supported only via third-party smart scales (e.g., Withings, Garmin) that write body composition data to HealthKit — not a first-party feature

**Other Clinical Features (iOS 18 / 2024–2025)**
- Blood oxygen monitoring (US only, Apple Watch Series 9/10 and Ultra 2)
- Sleep apnea screening (screening tool only, not diagnostic; US-focused)
- Hearing health / audiogram (expanded to Brazil, Australia, Colombia in March 2025 — AirPods Pro 2)
- Hypertension tracking features expanded to more countries (December 2025)
- ChatGPT integration launched in 2026 for health data Q&A

**Doctor Sharing**
- Available only at participating US healthcare organizations
- Data is uploaded to Apple's Health Sharing Cloud ~every 24 hours after opt-in
- No mechanism for ad-hoc selective sharing outside institutional participation (e.g., sharing a PDF export with a private physician or nutritionist)

**Sources:**
- https://support.apple.com/guide/healthregister/health-app-data-share-with-provider-faq-apd531bc6215/web
- https://www.healthcaredive.com/news/apple-unveils-new-health-features-aimed-at-patient-doctor-data-exchange/601443/
- https://www.healthcare.digital/single-post/apple-health-records-2025
- https://appleinsider.com/articles/25/03/25/apple-expands-hearing-health-features-to-australia-brazil-colombia-saudi-arabia
- https://discussions.apple.com/thread/250330031 (skinfold/HealthKit data types discussion)
- https://apple.gadgethacks.com/news/apple-health-chatgpt-integration-launches-2026-ai-health/

---

### 1.3 Brazil Market Presence

**Short answer: Limited. Health Records (EHR integration) is NOT available in Brazil.**

- Apple Health Records is primarily a US feature with limited expansion to UK and Canada. Brazil is not a supported market for Health Records or the "Share with Provider" functionality.
- The institutions directory (institutions.healthrecords.apple.com) covers US and a handful of UK/Canadian providers only.
- Brazil received expanded AirPods Pro 2 hearing health features in March 2025 — a narrow feature, not the clinical records platform.
- Brazil received hypertension feature expansion in December 2025.
- No Brazil-specific hospital or clinic network integrations are available or announced.
- Apple holds a minority smartphone market share in Brazil (the market is dominated by Samsung at ~36–39% and mid-range Android brands). iPhone penetration in Brazil is constrained by high import taxes and pricing, limiting Apple Health's addressable base.

**Sources:**
- https://appleinsider.com/articles/25/03/25/apple-expands-hearing-health-features-to-australia-brazil-colombia-saudi-arabia
- https://www.macrumors.com/2025/12/03/apple-health-features-expand-more-countries/
- https://institutions.healthrecords.apple.com/
- https://discussions.apple.com/thread/256201209 (community discussion on Brazil Health Records)

---

### 1.4 Major Weaknesses and User Complaints

**Platform Lock-In**
- Apple Health is iPhone-only. No Android companion. No web interface. This is a structural exclusion of ~72% of global smartphone users (and the majority of Brazilian smartphone users).
- The US DOJ antitrust case (March 2024) specifically cited Apple's restrictions on cross-platform health data transfer as evidence of anti-competitive behavior.
- The EU Digital Markets Act (effective March 2024) is forcing Apple toward greater interoperability, but meaningful cross-platform data portability for health data is not yet implemented.

**iPad Absence**
- The Health app is not available on iPad despite being on iPhone since 2014, a frequently cited user complaint.

**Longitudinal Visualization**
- Users widely note that Apple Health is excellent at passive data collection but poor at longitudinal storytelling. Thousands of data points accumulate with no easy mechanism to aggregate, contextualize, or visualize meaningful trends.
- There is no "health narrative" or timeline view; historical data is difficult to compare across months or years without third-party apps.

**Clinical Data Limitations**
- Lab results are only accessible via institutional Health Records connections — there is no manual entry UI for lab values, no way to upload a PDF lab report, and no structured input for a private-pay blood test from a lab like Dasa or Fleury (common in Brazil).
- No native support for skinfold protocols (Jackson-Pollock, Durnin-Womersley, etc.)

**International Gaps**
- The most clinically meaningful features (Health Records, Share with Provider) remain US-centric. International users get step counting, heart rate, and sleep — but not the clinical layer.

**Sources:**
- https://www.trustradius.com/products/apple-health/reviews?qs=pros-and-cons
- https://pmc.ncbi.nlm.nih.gov/articles/PMC10148309/ (interoperability research)
- https://www.themomentum.ai/blog/what-you-can-and-cant-do-with-apple-healthkit-data
- https://discussions.apple.com/thread/255766224

---

### 1.5 What Apple Health Does NOT Do (Gaps)

- No manual blood test entry (values, units, reference ranges) without institutional EHR connection
- No skinfold measurement tracking or caliper protocol support
- No longitudinal trend visualization across labs over months/years in native UI
- No selective/ad-hoc doctor sharing (e.g., generate a secure link or export for a private physician)
- No support for private lab results from non-participating labs (common in Brazil: Fleury, Dasa, Hermes Pardini)
- No Android version — excludes the majority of Brazilian users
- No patient-controlled data narrative or export for non-technical users
- Health Records feature not available in Brazil or Latin America

---

## Part 2: Samsung Health

### 2.1 Core Positioning

Samsung Health positions itself as a **comprehensive wellness companion for Galaxy device owners**, combining fitness tracking, sleep, nutrition, and increasingly clinical data. Its primary user is the Galaxy smartphone and Galaxy Watch owner. Since 2024, Samsung has been aggressively pushing into clinical integration through the acquisition of Xealth and partnerships with major US EHR vendors, framing Samsung Health as a bridge between consumer wellness data and formal clinical care.

**Sources:**
- https://hlth.com/insights/articles/samsung-health-at-hlth-2025-expanding-the-future-of-connected-care-2025-11-12
- https://samsungmobilepress.com/articles/samsung-health-expands-seamless-access-to-care-anytime-anywhere

---

### 2.2 Key Features — Clinical Data

**Bioimpedance (BIA)**
- Galaxy Watch 4 and later include a bioelectrical impedance analysis (BIA) sensor in the wristband electrodes
- Measures: body fat percentage, skeletal muscle mass, fat-free mass, total body water, basal metabolic rate
- Clinical validation studies (2024–2025) show 97–98% correlation with reference-grade BIA devices on fat-free mass, fat mass, and skeletal muscle mass
- Data is accessible via the Health Connect API for third-party apps
- Limitation: single-frequency wrist BIA is acknowledged to be less accurate than multi-frequency or segmental BIA devices; the watch electrode position (wrist only) is less precise than 4-electrode or 8-electrode clinical systems

**Health Records (EHR integration)**
- Launched October 2024 in the US
- Partners with b.well Connected Health, integrating with athenahealth, Cerner Health, Epic Systems, and Veradigm
- Supports: vaccination records, prescription history, past hospital visits, test results
- Records can be shared with family members or a physician via the app
- **Geographic restriction: Currently available ONLY in the US, India, and South Korea**

**Doctor Sharing / Clinical Integration (Xealth acquisition)**
- Samsung's acquisition of Xealth (2024–2025) enables digital health tools to be embedded directly into provider workflows
- Wellness data from Galaxy wearables can be integrated with clinical EHR data, reducing data silos
- Samsung Health users in the US can connect with board-certified primary care doctors for same-day video visits

**Skinfold Measurements**
- No native skinfold measurement feature — not supported in Samsung Health
- BIA (wrist) is the only body composition modality offered natively

**Sources:**
- https://news.samsung.com/my/study-shows-accuracy-and-precision-of-galaxy-watchs-bioelectric-impedance-analysis-sensor
- https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2025.1644082/full
- https://news.samsung.com/global/samsung-health-app-update-makes-accessing-health-records-managing-medications-and-food-tracking-easier
- https://9to5google.com/2024/10/22/samsung-health-update-medical-records/
- https://developer.samsung.com/health/blog/en/health/blog/reading-body-composition-data-with-galaxy-watch-via-health-connect-api

---

### 2.3 Brazil Market Presence

**Short answer: App available and widely installed, but clinical features are NOT available in Brazil.**

- Samsung holds ~36–39% smartphone market share in Brazil (leading brand as of 2024), making Samsung Health one of the most widely pre-installed health apps in the country.
- Samsung Health app is available in Brazil in Portuguese (Brazilian Portuguese localization exists; Samsung R&D Institute Brazil worked on Galaxy AI Portuguese language support).
- Samsung Health Monitor (blood pressure, ECG) was expanded to include Brazil.
- **Health Records (EHR integration): NOT available in Brazil** — restricted to US, India, and South Korea.
- Medication tracking: available only in US, South Korea, and India (not Brazil).
- Barcode food scanning: available in US and select European countries (not Brazil).
- Samsung's BIA body composition feature (via Galaxy Watch 4+) works globally — this is available to Brazilian users who own a compatible Galaxy Watch.
- Sleep apnea detection expanded globally, including Brazil, in 2024.

**Key insight for Brazil:** Samsung Health has the broadest installed base of the three platforms in Brazil due to Samsung's device dominance, but its clinically meaningful features (health records, EHR sharing, medication management) are geographically restricted to the US market.

**Sources:**
- https://www.statista.com/statistics/1418717/samsung-mobile-device-market-share-brazil/
- https://koreatechtoday.com/samsung-electronics-expands-health-monitor-app-to-31-new-countries/
- https://sammyguru.com/samsung-health-adds-health-records-food-scanning-more-features/
- https://news.samsung.com/us/samsung-research-brazil-overcoming-multicultural-multilingual-differences-learning-curve-5/

---

### 2.4 Major Weaknesses and User Complaints

**Stability and Crash Issues**
- The Samsung Health app crashes on pre-2024 Galaxy devices, particularly during wearable sync after updates (v6.29.1.011 flagged)
- Users report the app closing unexpectedly during workouts, causing data loss

**Sleep Tracking Inaccuracy**
- Recent updates degraded sleep tracking: app misses sleep onset by up to 90 minutes and adds ~30 minutes after wake, distorting statistics
- Inconsistent sleep scores (e.g., reporting 44/100 after 8+ hours of sleep)

**Data Sync Inconsistencies**
- Food entries are misplaced across days
- Activity time mismatches between Galaxy Watch face and the phone app (e.g., 120 minutes on watch, 0 in app)

**Permission Harassment**
- App generates persistent permission pop-ups at a frequency users describe as "10 times a day" — a major UX complaint

**Sensor Accuracy**
- Heart rate sensor flagged as inaccurate in real-world conditions (readings over 160 bpm while walking)
- BIA accuracy is acknowledged as lower than clinical-grade devices

**Galaxy Device Lock-In**
- Full feature set requires Samsung Galaxy hardware (especially Galaxy Watch for BIA). Significant features are unavailable to Samsung phone users who do not own a Galaxy Watch.

**Geographic Feature Fragmentation**
- Clinical features (health records, medication tracking) locked to US/Korea/India, frustrating international user base

**Sources:**
- https://www.sammyfans.com/2025/03/01/heres-how-to-fix-samsung-health-app-crashing-on-pre-2024-galaxy-phones-and-wearables/
- https://kimola.com/reports/in-depth-analysis-of-samsung-health-app-reviews-google-play-en-140550
- https://us.community.samsung.com/t5/Questions/I-have-so-much-problems-with-Samsung-health-monitor/td-p/3097908

---

### 2.5 What Samsung Health Does NOT Do (Gaps)

- No manual blood test / lab result entry (there is no UI to log a CBC, lipid panel, glucose, etc.)
- No structured longitudinal blood test tracking or trend visualization across multiple draws
- No skinfold measurement support (caliper protocol, Jackson-Pollock, etc.)
- Health Records / EHR feature is US-only — Brazilian users cannot connect to local labs (Fleury, Dasa, Hermes Pardini) or local hospital networks
- No selective ad-hoc doctor sharing for Brazilian healthcare context (private clinic sharing, nutritionist sharing)
- BIA is wrist-based only — no support for multi-frequency, segmental, or clinical-grade bioimpedance data import
- No patient-owned, portable data export that follows the patient across providers

---

## Part 3: Google Fit / Google Health

### 3.1 Core Positioning

**Google Fit is dead.** As of May 2026, Google has formally shut down Google Fit and replaced it with two distinct successor products:

1. **Google Health app** (formerly Fitbit app, rebranded May 19, 2026): Consumer-facing wellness app with AI coaching (Gemini-powered), wearable integration (Fitbit devices, Pixel Watch), and a new medical records feature. Targets health-conscious Android users, particularly those invested in the Fitbit/Google wearable ecosystem.

2. **Health Connect**: The Android platform layer (API/SDK), available system-wide on Android 14+ and via Play Store on Android 9–13. Acts as the cross-app health data hub for Android, analogous to Apple HealthKit. Not a consumer-facing app — it is the data infrastructure.

**Primary user (Google Health app):** Fitbit/Pixel Watch owners seeking AI-powered wellness coaching and a unified health dashboard. Also targets users transitioning from Google Fit who need a migration path.

**Sources:**
- https://blog.google/products-and-platforms/products/google-health/google-health-app/
- https://9to5google.com/2026/05/07/google-fit-shut-down-health-replacement-migration-tool-coming/
- https://www.androidauthority.com/fitbit-google-health-rebranding-new-features-3664322/

---

### 3.2 Key Features — Clinical Data

**Medical Records (Health Connect FHIR API)**
- Google launched Medical Records APIs globally in Health Connect (March 2025)
- Supports FHIR-format data: allergies, medications, immunizations, lab results
- Android 16 (2025): Health Connect natively supports medical data beginning with immunizations in FHIR format
- Users can import medical records into the Google Health app, including lab results and medications
- Data is stored locally on device and encrypted; users control per-app, per-data-type access permissions

**Google Health App (May 2026)**
- 4-tab interface: Today, Fitness, Sleep, Health
- AI Health Coach (Gemini): answers natural language questions about recent activity, sleep, and health markers (e.g., "Why was my resting heart rate elevated last night?")
- Medical records sync from providers coming to the Fitbit/Google Health app in 2026
- Google Health Premium: subscription tier with AI coaching; available in Brazil

**Removed Features in Google Health (vs. Fitbit)**
- Badges (gamification) eliminated
- Sleep Profile / monthly sleep animals eliminated
- Estimated Oxygen Variation (EOV) removed
- Lifescan blood glucose device connections removed
- Child profiles can no longer add friends
- Minute-by-minute skin temperature data replaced by daily/weekly trends
- Stress check graphs removed from mobile app
- Social features significantly reduced

**Skinfold / Bioimpedance**
- No native skinfold support
- No native bioimpedance support (Google Health relies on third-party devices/apps writing data to Health Connect)

**Doctor Sharing**
- Health Connect provides granular per-app, per-data-type permission controls
- No native "share with my doctor" workflow in Google Health — sharing requires third-party app integrations
- Medical Records APIs allow apps to read/write FHIR data, enabling developer-built sharing flows

**Sources:**
- https://blog.google/innovation-and-ai/technology/health/the-check-up-health-ai-updates-2025/
- https://www.beckershospitalreview.com/disruptors/google-health-app-to-let-users-sync-medical-records/
- https://www.fiercehealthcare.com/ai-and-machine-learning/google-rolls-out-medical-records-apis-ai-co-scientist-annual-check-event
- https://developer.android.com/health-and-fitness/health-connect
- https://gadgetsandwearables.com/2026/05/08/google-health-app/
- https://9to5google.com/2026/05/07/google-health-fitbit-features/

---

### 3.3 Brazil Market Presence

**Short answer: Health Connect works globally (including Brazil); Google Health Premium is available in Brazil; Google Fit users must migrate.**

- Health Connect is available globally as part of Android 14+ or via Play Store on older Android — no geographic restriction. Brazilian Android users (the majority of smartphone users) can use Health Connect-integrated apps.
- Google Health Premium (AI coaching subscription) is confirmed available in Brazil as of May 2026.
- Google Fit users in Brazil need to migrate to the Google Health app; Google is providing a migration tool.
- Google's Medical Records APIs (FHIR-based) are available globally for developers — but connecting to Brazilian lab networks or hospital EHRs requires Brazilian providers to build the integration. No Brazilian lab or hospital network has announced Health Connect FHIR integration as of May 2026.
- Google Health does not have an established relationship with Brazilian healthcare providers, unlike in the US where Epic/Cerner partnerships exist.

**Sources:**
- https://support.google.com/fitbit/answer/17068213
- https://developer.android.com/health-and-fitness/health-connect/availability
- https://9to5google.com/2026/05/07/google-fit-shut-down-health-replacement-migration-tool-coming/

---

### 3.4 Major Weaknesses and User Complaints

**Feature Destruction During Rebrand**
- The transition from Fitbit to Google Health removed beloved features: gamification badges, sleep animals, social connections, stress graphs, and minute-level temperature data. Long-term Fitbit users feel "betrayed" by the regression.
- Blood glucose monitoring (Lifescan device support) was quietly discontinued in the rebrand.

**Platform Fragmentation and Confusion**
- The Google health ecosystem is split across Google Fit (defunct), Fitbit (transitioning), Health Connect (platform layer), and now Google Health app — creating significant user confusion about which product to use and where data lives.
- Migration tool for Google Fit users is still rolling out as of May 2026.

**Wearable Dependency**
- The richest features in Google Health assume Fitbit or Pixel Watch ownership. Android users without a Google wearable get a significantly stripped-down experience.

**No True Clinical Data Entry**
- While the Medical Records API supports FHIR lab data, there is no consumer-facing UI to manually enter a blood test result. Users cannot log "My glucose was 95 mg/dL on May 1" without a connected provider or third-party app.

**Sources:**
- https://gadgetsandwearables.com/2026/05/08/google-health-app/
- https://finance.biggo.com/news/202605100452_Google-Health-Fitbit-App-Changes-Badges-Sleep-Animals-and-Social-Features-Axed
- https://9to5google.com/2026/05/07/google-health-fitbit-features/
- https://www.thryve.health/blog/google-fit-api-deprecation-and-the-new-health-connect-by-android-what-thryve-customers-need-to-know

---

### 3.5 What Google Health Does NOT Do (Gaps)

- No manual blood test / lab result entry in native UI (despite FHIR API support at the infrastructure level)
- No skinfold measurement tracking
- No native bioimpedance data capture (wearable-dependent)
- No Brazilian lab or hospital integrations (FHIR API exists but no local partners)
- No longitudinal lab trend visualization in native app
- No structured doctor-sharing workflow outside of provider-built integrations
- Significant feature removal in the Fitbit→Google Health transition leaves a wellness gap

---

## Part 4: Brazil Digital Health Context

### The Meu SUS Digital Platform

Brazil has a significant and underappreciated national digital health platform: **Meu SUS Digital** (Ministry of Health), which is the dominant patient-facing health app in Brazil.

Key facts:
- Over 50 million downloads as of mid-2024
- 4.5 million active users
- Most downloaded app in the free health category in Brazil
- Features: vaccination records (with QR certificate), medication dispensing history (Farmácia Popular), soon: appointment history, exam tracking across the SUS network
- July 2024: Ministry of Health announced rollout of unified electronic health record (prontuário unificado) for SUS patients, accessible by any SUS healthcare provider during consultation
- The national health data network (RNDS) holds over 1.8 billion health records

**Key gap:** Meu SUS Digital covers SUS (public system) patients. The large private healthcare market in Brazil (Bradesco Saúde, SulAmérica, Unimed, Amil, etc.) and the individual private-pay market (labs like Fleury, Dasa, Hermes Pardini) are NOT connected to this system. Private patients — the demographic most likely to invest in health tracking — have no unified longitudinal health record.

**Brazil-specific private lab landscape:**
- Fleury, Dasa, Hermes Pardini, and Lavoisier are the dominant private lab networks
- These labs provide results via their own patient portals (apps/web), but results are siloed per lab
- There is no cross-lab, patient-owned longitudinal blood test repository in Brazil

**Sources:**
- https://agenciagov.ebc.com.br/noticias/202407/sus-digital-estrategia-do-ministerio-da-saude-amplia-acesso-da-populacao-as-informacoes-de-saude-e-inicia-a-implantacao-de-prontuario-unificado
- https://agenciabrasil.ebc.com.br/saude/noticia/2024-07/profissionais-do-sus-terao-acesso-a-prontuario-unificado-de-pacientes
- https://prontual.com/ (Brazilian PHR startup example)

---

## Part 5: White Space Analysis

### The Gap Map

| Feature | Apple Health | Samsung Health | Google Health | White Space? |
|---|---|---|---|---|
| Manual blood test entry (any lab) | No | No | No | **YES — universal gap** |
| Longitudinal blood test trends (multi-draw) | Partially (EHR only, US) | No | No | **YES** |
| Skinfold measurement tracking | No (third-party only) | No | No | **YES — universal gap** |
| Bioimpedance data tracking (multi-device) | Third-party scales only | Galaxy Watch only | Third-party only | **YES** |
| Selective ad-hoc doctor sharing (non-institutional) | No | No | No | **YES — universal gap** |
| Brazil clinical data integration | No | No | No | **YES — Brazil-specific gap** |
| Private lab integration (Fleury, Dasa, etc.) | No | No | No | **YES — Brazil opportunity** |
| Patient-owned portable health narrative | No | No | No | **YES — universal gap** |
| Cross-platform (iOS + Android) | iOS only | Galaxy only | Android/Fitbit | **YES — cross-platform gap** |

### Key White Space Findings

**1. Manual Lab Result Entry is Universally Absent**
None of the three platforms allow a user to manually enter blood test values (glucose, cholesterol, ferritin, TSH, etc.) with units, reference ranges, and draw dates. All three depend on institutional EHR connectivity — which is US-centric, requires hospital participation, and covers none of Brazil's private lab ecosystem. This is the most structurally important gap for a longitudinal blood test product.

**2. Skinfold Data Has No Home**
No major platform supports a skinfold measurement protocol (Jackson-Pollock 3/7, Durnin-Womersley, etc.). This is a significant gap given that skinfold anthropometry is widely used by nutritionists, personal trainers, and sports medicine professionals in Brazil — and the data generated has nowhere to be stored and trended except spreadsheets or paper.

**3. Bioimpedance is Fragmented and Device-Locked**
Samsung's wrist BIA is Galaxy Watch-exclusive. Smart scale BIA data can reach Apple Health or Health Connect but only if the scale brand supports it. There is no platform-neutral repository for bioimpedance data from clinical-grade devices (InBody, Tanita) used in gyms, nutrition clinics, and hospitals.

**4. Brazil is a Governance Gap for All Three**
Apple Health Records: US/UK/Canada only. Samsung Health Records: US/Korea/India only. Google Health's FHIR Medical Records API: infrastructure exists but no Brazilian provider has integrated. Brazil's private health market — the segment most able to pay for health tracking products — has no connection to any of these platforms' clinical features.

**5. Selective Doctor Sharing Does Not Exist**
None of the three platforms allow a patient to generate a curated, controlled share with a specific doctor (private physician, nutritionist, endocrinologist) outside of formal institutional participation. Sharing in all three platforms is either all-or-nothing (export to a provider portal) or entirely absent. A product that lets a patient say "share my last 6 blood draws and 3 months of bioimpedance with Dr. Silva, expiring in 30 days" addresses a completely unoccupied space.

**6. Longitudinal Health Narrative**
All three platforms are fundamentally data silos, not health narratives. They collect data but do not help users — or their providers — understand trends over time. A product built around the longitudinal story of a patient's metabolic health (blood tests, body composition) with timeline visualization and doctor-presentable reports addresses a gap that is acknowledged even in user reviews of Apple Health.

---

## Appendix: Competitive Niche Apps (Lab Tracking Space)

Several niche apps exist in the lab-tracking space but are early-stage and US-focused:

- **Lab Tracker** (labtracker.io): HIPAA-compliant, manual lab entry, multi-source import, US market
- **Carrot Care**: PDF/image upload with OCR for blood results; acknowledged OCR errors; US-focused
- **Smart Blood Analytics (mySmartBlood)**: Interactive trend graphs for blood test values; European market orientation
- **Wizey Health Insights**: AI analysis of lab results with longitudinal view
- **Prontual** (Brazil): Brazilian startup focused on centralizing medical exams — direct local competitor to watch

None of these combine blood tests + bioimpedance + skinfold + selective doctor sharing in a single patient-owned record. None have meaningful Brazil-specific lab integrations announced.

**Sources:**
- https://labtracker.io/
- https://carrotcare.health/
- https://www.smartbloodanalytics.com/en/mysmartblood
- https://wizey.one/
- https://prontual.com/

---

## Summary: Strategic Implications for Product Design

1. **Platform-neutral is a competitive advantage.** iOS + Android coverage captures the entire addressable market; all three incumbents are device/ecosystem-locked in meaningful ways.

2. **Brazil's private health market is genuinely unserved.** Samsung has the installed base; no one has the clinical features. A Portuguese-language product that integrates with Fleury, Dasa, and Hermes Pardini has a clear entry wedge.

3. **Manual entry + import is the wedge.** Since no major platform offers manual blood test entry, a product that makes this easy (manual entry, PDF OCR, QR code from lab portals) creates immediate utility without requiring enterprise EHR partnerships.

4. **Skinfold + bioimpedance as a nutritionist workflow** is an underserved professional use case. Nutritionists and personal trainers in Brazil do routine anthropometric assessments with nowhere to store longitudinal data. Serving this professional workflow creates a B2B2C acquisition channel.

5. **Selective sharing as the core trust feature.** A patient-controlled sharing model (time-limited, revocable, selective by data type and date range) differentiates from all three incumbents and aligns with global regulatory direction (LGPD in Brazil, GDPR in EU, HIPAA in US).

---

*Research compiled May 12, 2026 using live web search. All URLs verified at time of research.*
