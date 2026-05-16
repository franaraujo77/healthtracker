---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'technical'
research_topic: 'Health Tracking Platforms Competitive Analysis 2024-2026'
research_goals: 'Identify white space for a patient-owned longitudinal health record focused on blood tests, bioimpedance, and skinfold data with selective doctor sharing'
user_name: 'Francis'
date: '2026-05-12'
web_research_enabled: true
source_verification: true
---

# Research Report: Health Tracking Platforms Competitive Analysis 2024–2026

**Date:** 2026-05-12
**Author:** Francis
**Research Type:** Technical / Market Competitive Analysis

---

## Research Overview

This report analyzes the current state (2024–2026) of four health tracking platform categories:
1. Withings Health Mate (consumer health device + app ecosystem)
2. Terra API (health data aggregation infrastructure)
3. InsideTracker (blood biomarker optimization platform)
4. Brazil-specific health apps and PHR platforms (Mevo, Beep Saúde, Docway, Prontmed, Meu SUS Digital)

The goal is to identify white space for a patient-owned, longitudinal health record product centered on blood tests, bioimpedance, and skinfold data with selective doctor sharing.

**Research Methodology:** Current web data verified across multiple sources, including official product pages, G2/Reclame Aqui reviews, developer documentation, and Brazilian health industry coverage.

---

## Technical Research Scope Confirmation

**Research Topic:** Health Tracking Platforms Competitive Analysis 2024–2026
**Research Goals:** Identify white space for a patient-owned longitudinal health record focused on blood tests, bioimpedance, and skinfold data with selective doctor sharing

**Technical Research Scope:**
- Architecture Analysis — design patterns, frameworks, system architecture of each platform
- Implementation Approaches — how data is collected, normalized, stored, and shared
- Technology Stack — devices, sensors, APIs, and integrations
- Integration Patterns — clinical lab data, wearable data, EHR/PHR interoperability
- Performance Considerations — longitudinal data handling, patient-controlled sharing

**Research Methodology:**
- Current web data with rigorous source verification
- Multi-source validation for critical claims
- Confidence levels noted for uncertain information
- Gap analysis framed against the target product vision

**Scope Confirmed:** 2026-05-12

---

## Platform 1: Withings Health Mate (rebranded to "Withings" app, v5.14+)

### 1. Core Positioning

Withings positions itself as a **connected health device ecosystem** for health-conscious consumers who want clinical-grade biometrics in home-friendly form factors. The company describes its mission as bridging consumer wellness and preventive medicine. The primary users are:
- Health-conscious adults tracking weight, cardiovascular health, and sleep
- Patients with chronic conditions (hypertension, obesity) using RPM (Remote Patient Monitoring) via their B2B arm, Withings Health Solutions
- Healthcare providers using the B2B Body Pro 2 scale for clinical monitoring

The app was renamed from "Health Mate" to simply "Withings" in version 5.14 (2023), signaling a brand consolidation.

**Sources:**
- https://support.withings.com/hc/en-us/community/posts/13606017588625--Official-Withings-5-14-Health-Mate-becomes-Withings
- https://www.withings.com/us/en/blog/heart/why-is-health-mate-the-most-advanced-health-management-app

### 2. Key Features

**Bioimpedance (BIA):**
- Consumer scales: Body+, Body Comp, Body Cardio — 4-electrode BIA measuring weight, fat mass, muscle mass, water, bone mass, BMI, metabolic age
- Body Scan (FDA-cleared, 2023): 8-electrode segmental BIA via scale + handle, measuring torso, arms, and legs separately; 98% correlation with Tanita 780; r=0.99 vs DEXA in 2025 study
- BIA limitations: sensitive to hydration, dry skin, foot contact; pacemaker users cannot use BIA

**Clinical/Lab Data:**
- No native lab blood test entry or import
- U-Scan (2023): urine analysis device placed in toilet, measures hydration, diet markers, hormonal changes — results accessible by healthcare professionals with patient permission
- No structured integration with external laboratory (Quest, Fleury, DASA, etc.) results
- HealthKit / Health Connect integration allows data from connected apps, but not structured lab panel import

**Doctor Sharing:**
- PDF health report export shareable with any doctor
- B2B RPM dashboard (Withings Health Solutions): clinical teams can monitor patients' biometric trends in real time
- No permissioned, granular sharing where a patient can select specific metrics to share with specific providers

**Other Features:**
- Health Improvement Score (1–100 composite)
- Sleep analysis (ScanWatch), activity tracking, heart rate
- Integrates with 100+ apps: Strava, MyFitnessPal, Apple Health, Google Fit
- API available for enterprise/RPM integration

**Sources:**
- https://support.withings.com/hc/en-us/articles/10974250686353-Body-Scan-Learn-more-about-Segmental-Body-Composition
- https://withingshealthsolutions.com/the-science-behind-body-pro-2-body-composition/
- https://gadgetsandwearables.com/2023/09/25/withings-ios-android-6-0-update-health-mate/

### 3. Brazil Market Presence

- **Minimal direct presence.** Withings operates in 40+ countries globally but has no dedicated Brazil distribution, no Portuguese-language support team, and no local lab partnerships.
- Devices are available in Brazil via grey market import / Amazon Brazil (limited SKUs), but the company has no official Brazilian storefront.
- Revenue reported at ~$83M USD globally in 2024 (withings.com only); Brazil contribution not disclosed.
- The consumer opportunity in Brazil is largely untapped for this brand.

**Sources:**
- https://ecdb.com/resources/sample-data/retailer/withings
- https://canvasbusinessmodel.com/blogs/growth-strategy/withings-growth-strategy

### 4. Major Weaknesses and User Complaints

- **App instability post-rebrand:** Users report crashes, broken Bluetooth sync, and beta releases breaking previously working features (2024 support forum)
- **Regression in data visualization:** Loss of intuitive weight graphs; users reporting 8 years of data lost after updates
- **Android-specific bugs:** Month steps view missing days; GPS broken for walk workouts unless app is open
- **No lab data:** The platform is entirely device-dependent — there is no pathway to import blood test results
- **Ecosystem lock-in:** Data is most useful if you own Withings hardware; the app has no value for manual longitudinal health tracking
- **No skinfold support:** No pathway for anthropometric skinfold data entry

**Sources:**
- https://support.withings.com/hc/en-us/community/posts/19375711439633-Problems-with-Withings-Healthmate-app
- https://justuseapp.com/en/app/542701020/withings-health-mate/reviews

### 5. What They Do NOT Do (Gaps)

- Cannot import or manually enter blood test / lab panel results
- No skinfold caliper data entry
- No granular, patient-controlled selective sharing with specific doctors
- No longitudinal trend analysis across blood + body composition combined
- No support for Brazilian lab formats (Fleury, DASA, Einstein, Hermes Pardini)
- No Portuguese-language localization for consumer market
- The clinical RPM product (Health Solutions) is B2B only — patients cannot self-enroll

---

## Platform 2: Terra API

### 1. Core Positioning

Terra is a **pure B2B developer infrastructure** platform — it is NOT a consumer-facing product. Terra provides a unified API that normalizes health and fitness data from 500+ wearables, apps, and devices into a single schema. Their customers are digital health startups, wellness platforms, insurance companies, clinical research teams, and corporate wellness programs.

**Primary user:** Software developers and health tech companies building health features. End patients never interact with Terra directly.

Terra was founded in 2021 (Y Combinator W22) and by 2025 had expanded into AI health agents via its "Tyran AI" platform.

**Sources:**
- https://tryterra.co/
- https://www.ycombinator.com/companies/terra-api
- https://docs.tryterra.co/health-and-fitness-api/getting-started

### 2. Key Features

**Data Aggregation:**
- Connects to 500+ providers: Garmin, Fitbit, Apple Health, Google Fit, Oura, WHOOP, Polar, Eight Sleep, Strava, Withings, Samsung Health, Cronometer, MyFitnessPal, Suunto, and more
- Single normalized data schema across all sources
- Supports: activity, sleep, nutrition, heart rate, HRV, VO2max, body metrics, menstrual cycle, CGM data

**Lab/Blood Data:**
- Blood lab integrations available (home kits and phlebotomy) for hormones, vitamins, cholesterol, glucose — but this is an enterprise add-on
- Not a longitudinal patient record; data flows through Terra to client applications

**Real-time Streaming:**
- WebSocket Streaming API for beat-by-beat heart rate and live biometric dashboards

**AI Layer (2025):**
- Tyran AI: enables developers to build AI Health Agents on top of Terra data infrastructure

**Compliance:**
- HIPAA compliant, GDPR compliant, SOC 2 Type II certified

**Pricing:**
- Starts at $399/month (annual plan); usage-based per active user

**Sources:**
- https://tryterra.co/pricing
- https://docs.tryterra.co/health-and-fitness-api/pricing
- https://tryterra.co/blog/may-2025-updates

### 3. Brazil Market Presence

Terra is a global API platform with no Brazil-specific positioning. Their pricing and tooling are aimed at US/EU digital health companies. Brazilian startups could technically integrate Terra, but the $399+/month entry point and USD pricing creates friction for early-stage Brazilian healthtechs. No Brazilian-specific integrations (Fleury, DASA, etc.) documented.

### 4. Major Weaknesses

- **Not consumer-facing at all** — no patient experience layer
- **Pricing inaccessible for small developers/startups** — minimum $399/month
- **Clinical data limitations:** Strong for fitness/wearables, falls short for structured clinical lab data needed in healthcare or research use cases
- **Not a PHR:** Terra does not store or maintain a longitudinal patient record — it pipes data to client systems
- **No skinfold or anthropometric data support**

**Sources:**
- https://humanitcare.com/en/the-3-best-apis-for-wearables-and-medical-devices-in-2025/
- https://elion.health/products/terra
- https://us.fitgap.com/products/010859/terra-api

### 5. What They Do NOT Do (Gaps)

- No patient-facing interface — patients cannot log in, view their data, or control sharing
- No longitudinal personal health record maintained on behalf of patients
- No blood test result storage or trend visualization for patients
- No skinfold data support
- No doctor-sharing permissioning model for patients
- Not relevant for individual users — only for companies building on top of it

---

## Platform 3: InsideTracker

### 1. Core Positioning

InsideTracker is a **personalized health optimization platform** built around blood biomarker analysis, biological age estimation, and science-backed recommendations. Primary users are:
- Health-conscious adults and biohackers seeking longevity optimization
- Athletes optimizing performance and recovery
- US-based adults who can access Quest Diagnostics phlebotomy network

The company was founded in 2009 at MIT/Tufts and has published peer-reviewed research validating its biomarker intervention approach.

**Sources:**
- https://www.insidetracker.com/
- https://journals.plos.org/digitalhealth/article?id=10.1371%2Fjournal.pdig.0001271

### 2. Key Features

**Blood Biomarker Tracking:**
- Analyzes 48–54 biomarkers per draw (Ultimate plan) across 10 health categories: Cognition, Fitness, Endurance, Inflammation, Gut health, and others
- InnerAge 2.0: biological age estimate using machine learning trained on longitudinal health data
- Recommends retesting every 3–6 months; supports longitudinal trend tracking across draws

**Lab Data:**
- US/Canada users: blood draw at Quest Diagnostics; results auto-imported to platform
- International users: upload existing lab results manually (PDF/CSV) for $149/year membership
- Supports upload of existing doctor lab results — does not require InsideTracker-branded tests

**Doctor Sharing:**
- PDF export and CSV download from dashboard — shareable with physicians
- No structured in-platform physician access or permissioned sharing portal
- No real-time physician dashboard or role-based access

**Body Composition:**
- Can integrate wearable data (Apple Watch, Garmin, etc.) but no native bioimpedance or skinfold support
- No body composition device integration or dedicated tracking

**AI / Recommendations:**
- AI assistant explains biomarker context
- Static algorithm-generated action plans (nutrition, supplements, exercise, lifestyle)
- Recommendations update only when new blood draw is uploaded — not adaptive in real-time

**Sources:**
- https://www.insidetracker.com/a/articles/blood-biomarkers-insidetracker-measures
- https://store.insidetracker.com/products/insidetracker-membership
- https://support.insidetracker.com/en-US/can-i-share-my-results-with-my-doctor-or-nutritionist-288898

### 3. Brazil Market Presence

- **Effectively unavailable in Brazil for core service.** Blood draw via Quest Diagnostics is US/Canada only.
- International users can manually upload results — but the workflow is designed for US lab formats, not Brazilian lab PDF formats (Fleury, DASA, Hermes Pardini, Einstein)
- No Portuguese localization
- No partnerships with Brazilian laboratory networks
- No pricing in BRL; USD pricing creates significant barrier ($149–$1,781/year)

**Sources:**
- https://www.innerbody.com/insidetracker-review
- https://store.insidetracker.com/products/ultimate

### 4. Major Weaknesses and User Complaints

- **Dashboard regression (2024–2025):** Updated dashboard prioritizes upsell prompts over actual biomarker data; users must navigate away from home screen to see their results — widely criticized in reviews
- **Static recommendations:** Action plans feel detached from daily life; no in-app food log or smart integration connecting meal choices to current biomarker goals
- **High cost:** $589+ for Ultimate blood plan + $149/year membership; more expensive than comparable services (Function Health at $365/year for 160 biomarkers)
- **No body composition integration:** No BIA, skinfold, or DEXA import
- **Limited genetic transparency:** SNPs used in genetic risk scores not fully disclosed
- **No real doctor collaboration:** Sharing is PDF export only — no structured physician access
- **Competitive pressure (2025–2026):** Function Health (160 biomarkers, $365/year), Superpower ($199/year, 100+ biomarkers with clinician notes), and Vitals Vault are eroding InsideTracker's pricing advantage

**Sources:**
- https://crowncounseling.com/reviews/insidetracker-review-and-alternative/
- https://www.usebetterproducts.com/inside-tracker-app-review/
- https://www.mygenefood.com/blog/my-inside-tracker-review/
- https://finvsfin.com/function-health-vs-superpower-vs-insidetracker-vs-lifeforce/

### 5. What They Do NOT Do (Gaps)

- No bioimpedance or skinfold data tracking — zero body composition measurement integration beyond wearable steps/HR
- No patient-controlled selective doctor sharing (only PDF export)
- No support for Brazilian laboratory formats or Portuguese-language interface
- No real-time or continuous longitudinal tracking between blood draws
- No multi-provider health record (only InsideTracker-sourced or manually uploaded data)
- Recommendations are static between draws — not adaptive as lifestyle data changes

---

## Platform 4: Brazil-Specific Health Apps and PHR Platforms

### 4A. Mevo

**Core Positioning:**
Mevo is a **B2B digital prescription and clinical documentation platform** for healthcare professionals — not a patient-owned health record. It enables physicians and dentists to issue digital prescriptions, exam requests, certificates, and clinical documents from mobile devices.

In April 2025, Mevo acquired Receita Digital, consolidating its position as Brazil's leading digital prescription infrastructure provider.

**Key Features:**
- Digital prescription issuance with medication database, allergy alerts, and drug interaction checking
- Exam request issuance and document management
- Patient treatment history (from the provider's perspective)
- Integration with 700+ health institutions including 13 of Brazil's top 15 hospitals (Sírio-Libanês, Rede D'Or, Moinhos de Vento, HCor)
- Free document sending to patients via WhatsApp

**Patient Perspective:** Patients receive documents but do not have a self-managed longitudinal health record through Mevo. The platform is provider-centric.

**Funding:** R$140 million Series B in 2024 (largest in Brazilian healthtech that year)

**What it does NOT do:**
- No patient-owned health record
- No lab result longitudinal tracking for patients
- No bioimpedance or body composition data
- No blood biomarker trend analysis
- Not a PHR — it is a clinical workflow tool

**Sources:**
- https://mevo.com.br/
- https://futurodasaude.com.br/mevo-abre-plataforma-de-prescricao-digital-para-acesso-gratuito-de-medicos/
- https://economiasp.com/2025/04/16/mevo-adquire-receita-digital-e-fortalece-atuacao-no-setor-de-saude/

---

### 4B. Beep Saúde

**Core Positioning:**
Beep Saúde is Brazil's largest **home-based diagnostic services company** — it sends nurses to patients' homes to collect blood, urine, and feces samples and administer vaccines. It is a logistics and collection service, not a health record platform.

**Key Features:**
- 1,000+ laboratory exams available for home collection
- Fully digital scheduling (website or app, under 3 minutes)
- Serves São Paulo, Rio de Janeiro, and Brasília
- Health insurance and private payment accepted
- Specialized exams: prenatal (NIPT), genetic, neonatal screening
- Rating: 8.8/10 on Reclame Aqui (strong for Brazilian consumer services)

**Recent Developments:**
- September 2024: R$100 million investment led by Lightsmith (US fund); company valued at R$1.2 billion

**What it does NOT do:**
- Does not provide a longitudinal personal health record
- Does not show trends over time across multiple draws
- Does not integrate bioimpedance or body composition data
- Does not support doctor sharing or permissioned access
- Does not analyze or contextualize results — only delivers them
- Coverage limited to 3 cities

**Sources:**
- https://beepsaude.com.br/
- https://exame.com/insight/beep-de-vacinas-e-exames-a-domicilio-recebe-aporte-de-r-100-milhoes-e-ja-vale-r-12-bi/p
- https://www.reclameaqui.com.br/empresa/beep-saude_190426/

---

### 4C. Docway

**Core Positioning:**
Docway is a **B2B telemedicine and digital health platform** primarily serving health insurance operators (operadoras) and large employers. Present in 260+ Brazilian cities.

**Key Features:**
- Digital pronto-atendimento (urgent care) via telemedicine
- Symptom checker for patient triage
- Digital exam requests and e-prescriptions issued by doctors during consultations
- Patient beneficiary app (for insured members)

**Patient Perspective:**
The patient app is an access portal to telemedicine consultations — not a health record. Patients do not control or own a longitudinal data record.

**What it does NOT do:**
- No patient-owned longitudinal health record
- No lab result import or trend tracking for patients
- No body composition data
- Not available for uninsured/private-pay individuals easily

**Sources:**
- https://docway.com.br/
- https://app.docway.com.br/aplicativo-do-beneficiario

---

### 4D. Prontmed

**Core Positioning:**
Prontmed is a **B2B electronic medical record (EMR) system** for clinics, health administrators, and large healthcare networks. It has processed 15+ million consultations. The Fleury Group is a noted partner.

**Key Features:**
- Structured electronic medical record: personal history, clinical history, vaccination calendar, diagnoses (ICD-10), referrals, telemedicine integration
- Patient video appears on same screen as clinical notes during teleconsultation
- Drug database for prescribing support
- Administrative automation

**Patient Perspective:**
Patients do not have direct access to their own Prontmed record. This is a provider-controlled system. Patient data access depends entirely on what the clinic chooses to share.

**What it does NOT do:**
- No patient-controlled PHR
- No patient-facing app for self-managed health data
- No blood test trend visualization for patients
- No bioimpedance or skinfold integration
- No selective doctor-sharing by patients

**Sources:**
- https://www.prontmed.com/
- https://conteudo.prontmed.com/prontmed-e-fleury

---

### 4E. Meu SUS Digital (Government PHR)

**Core Positioning:**
Meu SUS Digital is the **Brazilian government's official digital health app** for SUS (Sistema Único de Saúde) beneficiaries. It is the most widely adopted patient-facing health app in Brazil with 50+ million downloads and 4.5 million active users.

**Key Features (2024–2025):**
- Access to vaccination history and certificates
- COVID-19 and select lab exam results (sent by labs via RNDS integration)
- Medication tracking (Farmácia Popular)
- Organ transplant queue status
- Health diary ("Meu Diário de Saúde") for self-reported data
- Locating nearby health services
- Pilot of unified electronic medical record (prontuário unificado) for healthcare professionals — not yet patient-accessible

**Regulatory Context:**
The SUS Digital program was formalized by Portaria GM/MS nº 3.232 in March 2024. The RNDS (Rede Nacional de Dados em Saúde) is the national interoperability backbone that labs and providers integrate with to push data to the platform.

**Limitations:**
- Lab results only available if the performing lab has integrated with RNDS — private labs often haven't
- No private lab integration (Fleury, DASA, Hermes Pardini not required to submit to RNDS)
- No body composition data
- No bioimpedance or skinfold support
- No longitudinal trend visualization across biomarkers
- No selective sharing with private physicians (sharing model is provider-pull, not patient-controlled)
- No support for health data from wearables or home devices

**Sources:**
- https://agenciagov.ebc.com.br/noticias/202407/sus-digital-estrategia-do-ministerio-da-saude-amplia-acesso-da-populacao-as-informacoes-de-saude-e-inicia-a-implantacao-de-prontuario-unificado
- https://www.techtudo.com.br/listas/2024/01/meu-sus-digital-app-substitui-o-conecte-sus-saiba-como-usar-edapps.ghtml
- https://www.mobiletime.com.br/noticias/23/02/2024/transformacao-digital-do-ministerio-da-saude-comeca-pelo-app-meu-sus-digital/

---

## Emerging Competitors Worth Monitoring (US Market, 2025–2026)

| Platform | Biomarkers | Price/yr | Body Comp | Doctor Sharing | Brazil |
|---|---|---|---|---|---|
| Function Health | 160 | $365 | No | No | No |
| Superpower | 100+ | $199 | No | Care team access | No |
| Vitals Vault | Variable | Varies | No | Dashboard | No |
| InsideTracker | 48–54 | $589+ | No | PDF export | No |
| Withings | BIA only | Hardware cost | BIA (scale) | PDF export | No |

None of these competitors combine blood biomarker longitudinal tracking with bioimpedance AND skinfold data, nor do any offer patient-controlled granular sharing in the Brazilian market.

---

## White Space Analysis: Where No One Is Playing

Based on the research, the following gaps are consistently unaddressed across all platforms reviewed:

### Gap 1: Combined Blood + Bioimpedance + Skinfold in a Single Longitudinal Record
No platform combines all three data modalities (laboratory panels, BIA body composition, and anthropometric skinfold measurements) into a unified longitudinal timeline. Withings handles BIA but not blood or skinfold. InsideTracker handles blood but not body composition. No one tracks skinfold data at all in a structured digital format.

### Gap 2: Patient-Owned, Patient-Controlled Selective Sharing
Existing platforms either:
- Give data to providers (Prontmed, Docway) with no patient control
- Export PDF blobs with no granularity (InsideTracker, Withings)
- Are B2B infrastructure with no patient layer (Terra, Mevo)
No product allows a patient to say "share my lipid panel and body fat % trends with Dr. X, but not my glucose or weight."

### Gap 3: Portuguese-Language Longitudinal Health Record Integrated with Brazilian Labs
The Brazilian private laboratory ecosystem (Fleury, DASA, Hermes Pardini, Einstein, Lavoisier) is large, fragmented, and not integrated into any patient-facing longitudinal health record. Meu SUS Digital covers SUS data but not private lab results. No product imports Brazilian lab PDFs, normalizes reference ranges, and tracks trends over time.

### Gap 4: Skinfold as a Health Tracking Data Type
Anthropometric skinfold measurement (commonly used by personal trainers, nutritionists, and sports medicine physicians in Brazil) has no digital home. No app, API, or platform supports structured skinfold data entry, multi-site protocols (Jackson-Pollock, Durnin-Womersley), or longitudinal tracking. This is a significant gap for the fitness professional + patient collaboration space in Brazil.

### Gap 5: B2C in Brazil's Private Health Consumer Segment
The Brazilian private health consumer (plano de saúde holder, academia goer, performance-focused adult) is underserved. Meu SUS Digital serves the SUS population. B2B platforms (Mevo, Prontmed, Docway) serve providers. No product serves the individual private health consumer who wants to own their data across multiple providers over time.

---

## Confidence Notes

- Withings Brazil data: LOW confidence (no official Brazil market data found; grey market assessment is inferred)
- InsideTracker international availability: HIGH confidence (confirmed US/Canada blood draw only; upload workaround confirmed)
- Terra B2B-only positioning: HIGH confidence (multiple sources confirm no consumer product)
- Mevo patient-facing capability: HIGH confidence (confirmed provider-centric from official site + news)
- Beep Saúde coverage limitations: HIGH confidence (official site confirms 3-city coverage)
- Meu SUS Digital RNDS private lab gap: HIGH confidence (confirmed by government communications)

---

## Sources

- https://tryterra.co/
- https://tryterra.co/pricing
- https://docs.tryterra.co/health-and-fitness-api/getting-started
- https://www.ycombinator.com/companies/terra-api
- https://www.g2.com/products/terra-api/reviews
- https://humanitcare.com/en/the-3-best-apis-for-wearables-and-medical-devices-in-2025/
- https://elion.health/products/terra
- https://www.insidetracker.com/
- https://www.insidetracker.com/a/articles/blood-biomarkers-insidetracker-measures
- https://store.insidetracker.com/products/insidetracker-membership
- https://store.insidetracker.com/products/ultimate
- https://support.insidetracker.com/en-US/can-i-share-my-results-with-my-doctor-or-nutritionist-288898
- https://crowncounseling.com/reviews/insidetracker-review-and-alternative/
- https://www.usebetterproducts.com/inside-tracker-app-review/
- https://www.innerbody.com/insidetracker-review
- https://www.mygenefood.com/blog/my-inside-tracker-review/
- https://journals.plos.org/digitalhealth/article?id=10.1371%2Fjournal.pdig.0001271
- https://finvsfin.com/function-health-vs-superpower-vs-insidetracker-vs-lifeforce/
- https://withingshealthsolutions.com/the-science-behind-body-pro-2-body-composition/
- https://support.withings.com/hc/en-us/articles/10974250686353-Body-Scan-Learn-more-about-Segmental-Body-Composition
- https://support.withings.com/hc/en-us/community/posts/13606017588625--Official-Withings-5-14-Health-Mate-becomes-Withings
- https://support.withings.com/hc/en-us/community/posts/19375711439633-Problems-with-Withings-Healthmate-app
- https://www.withings.com/us/en/body-scan
- https://gadgetsandwearables.com/2023/09/25/withings-ios-android-6-0-update-health-mate/
- https://ecdb.com/resources/sample-data/retailer/withings
- https://mevo.com.br/
- https://futurodasaude.com.br/mevo-abre-plataforma-de-prescricao-digital-para-acesso-gratuito-de-medicos/
- https://economiasp.com/2025/04/16/mevo-adquire-receita-digital-e-fortalece-atuacao-no-setor-de-saude/
- https://beepsaude.com.br/
- https://exame.com/insight/beep-de-vacinas-e-exames-a-domicilio-recebe-aporte-de-r-100-milhoes-e-ja-vale-r-12-bi/p
- https://www.reclameaqui.com.br/empresa/beep-saude_190426/
- https://docway.com.br/
- https://app.docway.com.br/aplicativo-do-beneficiario
- https://www.prontmed.com/
- https://conteudo.prontmed.com/prontmed-e-fleury
- https://agenciagov.ebc.com.br/noticias/202407/sus-digital-estrategia-do-ministerio-da-saude-amplia-acesso-da-populacao-as-informacoes-de-saude-e-inicia-a-implantacao-de-prontuario-unificado
- https://agenciabrasil.ebc.com.br/saude/noticia/2024-07/profissionais-do-sus-terao-acesso-a-prontuario-unificado-de-pacientes
- https://www.techtudo.com.br/listas/2024/01/meu-sus-digital-app-substitui-o-conecte-sus-saiba-como-usar-edapps.ghtml
- https://www.mobiletime.com.br/noticias/23/02/2024/transformacao-digital-do-ministerio-da-saude-comeca-pelo-app-meu-sus-digital/
- https://mercadohoje.uai.com.br/2026/05/09/mercado-de-saude-digital-no-brasil-numeros-tendencias-e-oportunidades-para-2026/
- https://blog.carefy.com.br/index.php/saude-digital-brasil/
