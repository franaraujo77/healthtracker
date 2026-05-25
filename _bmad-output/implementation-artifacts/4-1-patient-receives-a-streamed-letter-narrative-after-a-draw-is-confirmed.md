# Story 4.1: Patient receives a streamed Letter narrative after a draw is confirmed

Status: ready-for-dev

> **Epic 4 kickoff.** First story of "Patient Receives a Personal Health Narrative." This story introduces three brand-new pieces of infrastructure to the monorepo: (1) a `services/llm` worker + SSE server (Anthropic Claude Sonnet), (2) a `letters` schema + tRPC router, and (3) a full-screen `LetterReader` mobile screen with the Lora serif typeface (the **only** non-DM-Sans surface in the product). Every downstream Epic-4 story (4.2, 4.3) builds on the scaffolding landed here. Treat the scaffolding decisions as load-bearing — get them right the first time.

## Story

**As a** patient,
**I want** to receive a streamed personal narrative after each new draw is confirmed,
**so that** I understand my longitudinal patterns in a human, accessible way — not as a list of lab numbers.

## Acceptance Criteria

1. **AC1 — Generation trigger.** Given a draw is confirmed (upload status transitions to `complete` — either via the worker-direct path in `services/extraction/src/consumers/document.ts` **or** via the patient-confirms-last-review path in `packages/api/src/uploads-review.ts:484–541`), when the upload transitions to `complete` inside the same transaction that flips status, then a `letter.generate` pg-boss job is enqueued **atomically** with the status transition (same tx as the existing `enqueueNotificationSend({ kind: "complete" })` call), gated on `notification_preferences.lettersReady = true` AND the patient's `consent_type_enum = 'llm_letter_generation'` consent being granted. A row is INSERTed into `letters` with `status='queued'`. An `audit_log` row with `event='letter.queued'` is written in the same tx via `writeAuditLog`.

2. **AC2 — Claude Sonnet call uses the ANVISA system prompt.** When the `services/llm` letter consumer runs the `letter.generate` job, the Anthropic Messages API call MUST include the ANVISA system instruction loaded from `services/llm/src/prompts/anvisa-system.ts` (verbatim text per architecture.md §6 lines 742–756). The call uses Claude Sonnet (`claude-sonnet-4-6` — current Sonnet 4.6 model ID; **do not** use `claude-3-5-sonnet*` or other retired identifiers). On generation start: `letters.status='generating'`. On stream completion: `letters.body=<full text>`, `letters.status='complete'`, `letters.generatedAt=now()`, `letters.model=<model id>`, `letters.tokensUsed=<usage.input_tokens + usage.output_tokens>`. An `audit_log` row with `event='letter.generated'` is written (atomic with the row UPDATE).

3. **AC3 — SSE streaming endpoint.** The `services/llm` server exposes `GET /api/stream/letter/:letterId` (event format per architecture.md §7 lines 757–772 — verbatim):
   - `data: {"type":"token","content":"..."}\n\n`
   - `data: {"type":"done","letterId":"..."}\n\n`
   - `data: {"type":"error","code":"LETTER_UNAVAILABLE"}\n\n`

   The endpoint authenticates the Supabase JWT (Authorization header), authorizes the caller to read this `letterId` (`patient_id` must match `auth.uid()`), and writes an `audit_log` row with `event='letter.read'` at stream-open.

4. **AC4 — First token < 3 s.** Time-to-first-token (measured from SSE connection open to first `type:"token"` event being flushed) is ≤ 3 seconds under nominal load (NFR-P2). This is a first-class metric: emit a `letter.firstTokenMs` server-side log at first flush. **Do not** buffer Anthropic's stream before forwarding — use `anthropic.messages.stream()` and forward each `text_delta` event as it arrives.

5. **AC5 — `LetterReader` renders correctly.** When the patient opens the notification or taps the Letter entry point, the `apps/expo/src/app/cartas/[letterId].tsx` screen renders as a full-screen presentation (Expo Router 6 `presentation: 'fullScreenModal'`). Body uses the **Lora** typeface, weight 400, size 17px, line-height 28px (per `text.letterBody` token in UX spec line 534 — Lora 18px in the component-spec body section is a known conflict, defer to the token). Background is warm off-white (Tamagui token, **NOT** a hex literal). The streaming region carries `role="article"` and `aria-label="Carta do Seu Eu Passado — {data formatada pt-BR}"`, with `aria-live="polite"` on the inner streaming-text node (UX spec §1318). The **bottom tab bar remains visible** — full-screen feel is created via status-bar hiding and dark-vignette overlay only (UX spec §1132–1134). Per UX-DR11, the tab bar is NEVER hidden during LetterReader.

6. **AC6 — Tab navigation works during generation.** Given the Letter is generating, when the patient navigates to another tab (Histórico, Compartilhar, Acessos), then the bottom tab bar remains visible and navigation is not blocked. The SSE connection is preserved (do not tear down on background-tab navigation; only close on `unmount` of the LetterReader route or on `done`/`error`).

7. **AC7 — ANVISA framing in output.** The Claude Sonnet output, when sampled across the AC8 fixture replay test, contains **zero** matches for the regex `\b(você tem|isso indica|você deve)\b` (Portuguese diagnostic phrasings). Every suggestion in the narrative is framed as a question or "pode valer a pena discutir com [tipo de especialista]" — enforced by the ANVISA system prompt (architecture.md §6 line 742–756, verbatim). The output sanitizer pipeline (a downstream re-prompt + reject-and-regenerate guard, **not** a string-strip) is left as a follow-up for Story 4.2; Story 4.1 enforces ANVISA at the prompt layer only.

8. **AC8 — Reduced motion fallback.** When `useReducedMotion()` returns `true`, the LetterReader does **not** animate tokens word-by-word. Instead, the full text is rendered immediately when generation completes (or as a non-animated incremental insert during streaming). UX spec §1327. The streaming SSE connection still happens; only the rendering differs.

9. **AC9 — Pre-bind safety / no double-mount.** The Lora typeface is loaded via `expo-font` in `apps/expo/src/app/_layout.tsx` and the `<Stack>` subtree is gated on `fontsLoaded` (mirror the `persisterBootstrapped` gate at `_layout.tsx:357` per Story 3.4 R1-P271). The Letter route does **not** render before fonts are loaded; on web, `<link rel="stylesheet">` for Lora (Google Fonts subset `latin,latin-ext`) is added.

10. **AC10 — Premium gate.** The `letter.generate` tRPC mutation is wrapped in `premiumProcedure` (architecture.md §9, lines 812–827). A free-tier patient still receives draw-confirmed push notifications, but the `letter.generate` enqueue **is skipped** for free-tier patients in the enqueueing site. A free-tier patient opening the LetterReader sees the `error` SSE event `{type:"error", code:"PREMIUM_REQUIRED"}` and the screen renders an upgrade CTA (copy from `packages/validators` constant `LETTER_PREMIUM_REQUIRED_PT_BR` — author this string in this story; pt-BR per UX-DR20).

11. **AC11 — LLM unavailable fallback.** When the Anthropic call fails (network error, 5xx, rate limit, or DPA-not-yet-signed env-flag), the SSE endpoint emits `{type:"error", code:"LETTER_UNAVAILABLE"}` and the LetterReader renders the inline message defined in `packages/validators` as `LETTER_UNAVAILABLE_PT_BR` (copy verbatim from UX spec §881: pt-BR translation of "Your letter is taking longer than expected — check back in a few minutes" — author the exact pt-BR string in this story; reviewers will grep `packages/validators`). Letter `status='failed'`, `failureReason=<short code>`. This NEVER blocks the Fingerprint (UX spec §881). Push-notification dispatch for the upload is unaffected (NFR-I3).

12. **AC12 — Audit events.** Three audit kinds are introduced in this story: `letter.queued`, `letter.generated`, `letter.read`. All three follow the `noun.verb` past-tense convention (architecture.md §8). Add them to whatever enum / constants file enumerates `event` values (search `packages/api/src/audit.ts` and `packages/db/src/schema/audit.ts` for the canonical location). Add a partial-unique-index on `audit_log(resource_id, event) WHERE event = 'letter.queued'` to close the TOCTOU SELECT-EXISTS-INSERT race for the queue trigger (mirrors Story 2.5 R2-P172). **Do not** add a partial-unique-index for `letter.read` (legitimate multiple reads).

## Tasks / Subtasks

> Plan: 1) schema → 2) services/llm scaffold → 3) tRPC + enqueue wiring → 4) mobile font + LetterReader + premium handling → 5) tests + env/docs.

- [ ] **T1. Drizzle schema for `letters` table (AC1, AC2, AC11, AC12).** (AC: 1, 2, 11, 12)
  - [ ] T1.1 Add `packages/db/src/schema/letters.ts` per architecture §15 + Schema spec below: `id uuid pk`, `patientId uuid notNull references users(id) on delete cascade`, `uploadId uuid notNull references uploads(id)`, `status letterStatus enum('queued','generating','complete','failed') notNull default 'queued'`, `body text`, `model text`, `tokensUsed integer`, `failureReason text`, `generatedAt timestamptz`, `createdAt timestamptz default now() notNull`, `expiresAt timestamptz`. Define `letterStatusEnum` via `pgEnum` (mirror `extraction_review_queue.ts:17`).
  - [ ] T1.2 Indexes: `(patient_id, created_at desc)` for Histórico lookup (Story 4.2 prep); **no** partial unique on `letters(upload_id)` — leave room for regeneration. Add to barrel `packages/db/src/schema/index.ts`.
  - [ ] T1.3 Add new audit event partial-unique-index on `audit_log(resource_id, event) WHERE event = 'letter.queued'` — extend the existing migration of `audit_log_notification_event_unique` style (architecture §8). **Important:** per CLAUDE.md ops note, this index changes the `WHERE` clause of a partial unique index; for **dev environments only**, `pnpm db:push` is acceptable; production will pick this up in Story 4.4's incremental migration file (do **not** ship a separate ad-hoc migration).
  - [ ] T1.4 Update `packages/db/__tests__/integration/letters.integration.test.ts` (NEW) — testcontainer fixture proving the table comes up and the partial-unique-index rejects the second `letter.queued` for the same resource_id.

- [ ] **T2. Scaffold `services/llm/` workspace (AC2, AC3, AC4, AC11).** (AC: 2, 3, 4, 11)
  - [ ] T2.1 `services/llm/package.json` — name `@healthtracker/llm-service`, `private: true`, `type: module`, `engines.node: ">=22"`, deps: `@healthtracker/types: workspace:*`, `@healthtracker/db: workspace:*`, `@anthropic-ai/sdk: ^0.39.0` (or current latest — **query Context7 `/anthropics/anthropic-sdk-typescript` first**), `pg-boss: 12.18.2`, `postgres: catalog:`, `@supabase/supabase-js: catalog:`, `fastify: ^5.x` (or `express` — pick one and justify; Fastify recommended for SSE streaming ergonomics). Scripts mirror `services/extraction/package.json` (`dev: node --experimental-strip-types --watch src/index.ts`).
  - [ ] T2.2 `services/llm/src/prompts/anvisa-system.ts` — export `ANVISA_SYSTEM_PROMPT` constant with the **verbatim** text from architecture.md §6 lines 742–756 (the English instruction, plus the pt-BR framing example). Add a unit test asserting the string contains `"pode valer a pena discutir"`, `"never state, imply, or suggest a diagnosis"`, `"never recommend specific medications"`.
  - [ ] T2.3 `services/llm/src/prompts/letter-prompt.ts` — builds the user-message payload from observation rows: patient-anonymized longitudinal biomarker summary. Strict: never include `loinc_code` strings or extraction-confidence numbers in the patient-facing output (architecture.md enforcement rule 6, line 900). Pull observations via the same `getRecord` SQL shape `observations.getRecord` uses.
  - [ ] T2.4 `services/llm/src/adapters/anthropic.ts` — `LLMAdapter` interface (define in `@healthtracker/types` if not already present; add a corresponding `LLMAdapter` export). Implements `streamLetter({letterId, prompt, system, onToken, onDone, onError, signal})` using `anthropic.messages.stream({model, max_tokens, system, messages})` and forwards each `text_delta` event. Records `firstTokenMs` (Date.now() at first delta minus at stream open).
  - [ ] T2.5 `services/llm/src/consumers/generate-letter.ts` — pg-boss consumer subscribing to `letter.generate`. Loads `letters` + `observations` rows; transitions `letters.status` `queued → generating`; runs the Anthropic stream; writes tokens incrementally to a **per-letter in-memory ring buffer** keyed by `letterId` (so the SSE endpoint can fan out — see T2.6); on complete, writes final body + `status='complete'` + `audit_log.letter.generated` in one tx (mirror `services/extraction/src/notifications/emit.ts` audit + downstream pattern). On error: `status='failed'`, `failureReason='LETTER_UNAVAILABLE'` (or specific code). **Narrow catches** — explicitly catch `Anthropic.APIError`, `Anthropic.APIConnectionError`, network `ECONNRESET`; rethrow `TypeError`/`ReferenceError`/`SyntaxError` (Epic 2 retro discipline; CLAUDE.md §"Narrow catches by default").
  - [ ] T2.6 `services/llm/src/routes/letter-stream.ts` — Fastify route `GET /api/stream/letter/:letterId`. Auth: Supabase JWT verification (server-side using `SUPABASE_SERVICE_ROLE_KEY`-derived JWT verifier — share helper with extraction). Authorization: SELECT `letters.patient_id` and compare to `auth.uid()`; `404` on mismatch (do **not** `403` — leaks existence). On open: write `audit_log.letter.read`. Subscribes to the ring buffer for the `letterId` and pushes SSE events; on `done` event, closes the connection. **No tRPC** (architecture §3, line 247–253).
  - [ ] T2.7 `services/llm/src/index.ts` — Fastify bootstrap: register the SSE route, start pg-boss consumer registration (`generate-letter`). Listen on `PORT` (default 3001). Add `railway.json` per architecture §11 line 1196–1219 (NEW file, persistent-server config — Railway is the AR12/NFR-P2 target).
  - [ ] T2.8 `pnpm-workspace.yaml` already includes `services/*` (line 5) — no edit needed. Confirm.
  - [ ] T2.9 Add `ANTHROPIC_API_KEY` + `LLM_SERVICE_URL` to `.env.example` and update CLAUDE.md "Required vars" list.

- [ ] **T3. Wire `letter.generate` enqueue at the two confirmation sites (AC1, AC10).** (AC: 1, 10)
  - [ ] T3.1 `packages/api/src/letters.ts` (NEW) — helper `enqueueLetterGeneration(database, {patientId, uploadId, sessionUser})`. Logic: (a) load `notification_preferences.lettersReady` (default true if row missing — frozen-defaults pattern, Story 2.8 R1-P219); (b) check `consent` row exists with `type='llm_letter_generation'` and `granted_at IS NOT NULL`; (c) check `sessionUser.subscriptionTier === 'premium'`; if **any** check fails, return `{enqueued: false, reason}` — **do not** throw (this is invoked from the upload-confirm tx, which must continue even when the Letter is skipped — NFR-I3 decoupling). When all checks pass: INSERT into `letters` (`status='queued'`), `writeAuditLog({event:'letter.queued', resourceId:letters.id, resourceType:'letter'})`, `enqueuePgBossJob('letter.generate', {letterId})` — all in the **same** tx handle passed in.
  - [ ] T3.2 `packages/api/src/uploads-review.ts:484–541` — invoke `enqueueLetterGeneration` from within the existing tx **immediately after** the `enqueueNotificationSend({kind:"complete"})` call. Narrow `catch (err)` for `23505` (resource_id partial-unique conflict) → log and continue; rethrow others.
  - [ ] T3.3 `services/extraction/src/consumers/document.ts` (the worker-direct path) — invoke an equivalent worker-side enqueue. Since the worker uses raw `postgres` (not Drizzle — research §2), write a raw-SQL helper in `services/extraction/src/notifications/letters-emit.ts` (NEW) following the `emit.ts` shape: atomic INSERT-letter + INSERT-audit `ON CONFLICT ... DO NOTHING RETURNING id`, then `pgBoss.send('letter.generate', {letterId})` gated on rows returned.
  - [ ] T3.4 `packages/api/src/router/letter.ts` (NEW) — router registered in `packages/api/src/router/index.ts` as `letter: letterRouter`. Procedures: `getStatus({letterId})` (`premiumProcedure.query`, returns `letters.status` + `body` if `complete`); **no** `generate` mutation (generation is event-driven, not patient-initiated). Audit `letter.read` is written by the SSE endpoint, not here, to avoid double-counting.

- [ ] **T4. Mobile: Lora font + `LetterReader` (AC5, AC6, AC8, AC9, AC10, AC11).** (AC: 5, 6, 8, 9, 10, 11)
  - [ ] T4.1 Add `expo-font` to `apps/expo/package.json` (current Expo SDK 54 matching version). Add Lora `.ttf` files (weights 400, 500, 700) under `apps/expo/assets/fonts/` — use the `Lora-Variable.ttf` if possible (single file, smaller bundle). License: Lora is OFL 1.1 — bundle the OFL.txt next to the font file.
  - [ ] T4.2 `apps/expo/src/app/_layout.tsx` — load fonts via `useFonts({Lora: ...})`; pair with `expo-splash-screen` (already installed) `preventAutoHideAsync`/`hideAsync` recipe; **gate `<Stack>` on `fontsLoaded && persisterBootstrapped`** (extend existing bootstrap gate from Story 3.4 R1-P271 — do **not** introduce a parallel gate). Web: inject Lora `<link rel="stylesheet">` via `apps/web/src/app/layout.tsx` head.
  - [ ] T4.3 `packages/ui/src/components/LetterReader/LetterReader.tsx` (NEW; barrel via `index.ts`) — props: `{letterId: string, initialStatus: 'queued'|'generating'|'complete'|'failed', initialBody?: string}`. Renders Tamagui `ScrollView` with warm-off-white background (`$letterBackground` semantic token — author the token in `packages/ui/src/theme/tokens.ts`), dark vignette overlay, Lora body text, author attribution at close. States: `streaming | complete | error` per UX §878–881. Uses `useLetterStream(letterId)` hook (T4.4) to receive SSE events. Reduced-motion: `useReducedMotion()` from `react-native` (RN core hook); when true, accumulate tokens into a string state that updates once per second instead of per-token (so VoiceOver `aria-live="polite"` announces in chunks).
  - [ ] T4.4 `apps/expo/src/hooks/use-letter-stream.ts` (NEW) — wraps `EventSource` (or `fetch`-based ReadableStream for RN — `EventSource` polyfill needed; use `react-native-event-source` or `react-native-sse`). Connects to `${EXPO_PUBLIC_LLM_SERVICE_URL}/api/stream/letter/${letterId}` with `Authorization: Bearer ${supabaseSession.access_token}`. Returns `{status, body, error}`. Tears down on `unmount` or `error`/`done`. Does **not** auto-reconnect (Story 4.2's responsibility).
  - [ ] T4.5 `apps/expo/src/app/cartas/[letterId].tsx` (NEW; full-screen modal route) — declares `presentation: 'fullScreenModal'` in route options. Reads `letterId` from params. Mounts `<LetterReader/>`. On `error`: renders inline `LETTER_UNAVAILABLE_PT_BR` (free-tier shows `LETTER_PREMIUM_REQUIRED_PT_BR` with upgrade CTA). Tab bar **is not** hidden (UX-DR11 — full-screen modal in Expo Router 6 by default keeps the tab bar; verify).
  - [ ] T4.6 `apps/web/src/app/cartas/[letterId]/page.tsx` (NEW) — Next.js 15 RSC streaming counterpart (server component reads `letters.body` server-side if `status='complete'`; otherwise renders client component that subscribes to the same SSE endpoint). Lora loaded via the `<link>` injected in T4.2.

- [ ] **T5. Notification entry point + copy (AC1, AC11).** (AC: 1, 11)
  - [ ] T5.1 Extend `NotificationKind` in `services/extraction/src/consumers/notifications.ts:60` to include `"letter_ready"`. Push copy: title `"Sua carta está pronta"`, body `"Sua nova carta personalizada chegou. Toque para abrir."` (factual register per UX-DR20; no urgency). Deep link: `${EXPO_DEEP_LINK_SCHEME}://cartas/${letterId}`. The `letter_ready` push is fired by the `services/llm` letter consumer **on `status='complete'` transition** (T2.5), gated on `notification_preferences.lettersReady`.
  - [ ] T5.2 Add `letter_ready` to the existing notification-preference mapping (Story 2.8 R2-P229: `NOTIFICATION_KIND_TO_PREFERENCE` snapshot — extend that const + extend its snapshot test).

- [ ] **T6. Copy + constants in `packages/validators` (AC10, AC11, UX-DR20).** (AC: 10, 11)
  - [ ] T6.1 `packages/validators/src/index.ts` (append-only) — add named exports:
    - `LETTER_READER_ARIA_LABEL_PT_BR_FN = (data: string) => \`Carta do Seu Eu Passado — ${data}\``
    - `LETTER_AUTHOR_ATTRIBUTION_PT_BR_FN = (data: string) => \`Seu registro de saúde, compilado em ${data}\``
    - `LETTER_UNAVAILABLE_PT_BR = "Sua carta está demorando mais do que o esperado. Volte em alguns minutos."`
    - `LETTER_PREMIUM_REQUIRED_PT_BR = "Cartas personalizadas estão disponíveis no plano Premium. Toque para saber mais."`
    - `LETTER_NOTIFICATION_TITLE_PT_BR = "Sua carta está pronta"`
    - `LETTER_NOTIFICATION_BODY_PT_BR = "Sua nova carta personalizada chegou. Toque para abrir."`
    - Audit-event constants: `LETTER_AUDIT_QUEUED = "letter.queued"`, `LETTER_AUDIT_GENERATED = "letter.generated"`, `LETTER_AUDIT_READ = "letter.read"` (use these everywhere — never inline-string the event name; greppability per Epic 1 retro).
    - `LETTER_FIRST_TOKEN_MAX_MS = 3000` (NFR-P2 budget).

- [ ] **T7. Tests (every AC).** (AC: all)
  - [ ] T7.1 Unit: `services/llm/__tests__/prompts/anvisa-system.test.ts` — assertions on prompt content (T2.2).
  - [ ] T7.2 Unit: `services/llm/__tests__/adapters/anthropic.test.ts` — mocked Anthropic stream; assert `firstTokenMs` recorded, `text_delta` forwarded.
  - [ ] T7.3 Integration: `packages/db/__tests__/integration/letters.integration.test.ts` — schema + partial-unique-index (T1.4).
  - [ ] T7.4 Integration: `packages/api/__tests__/letters/enqueue.integration.test.ts` — `enqueueLetterGeneration` skips correctly for missing consent, free tier, lettersReady=false; INSERTs letters + audit + pg-boss job on happy path (testcontainer + pg-boss-in-memory).
  - [ ] T7.5 Snapshot: `LetterReader` rendered for `streaming | complete | error` states (Tamagui RN snapshot via `@testing-library/react-native`).
  - [ ] T7.6 Replay test: a recorded pt-BR Anthropic stream fixture (a few hundred tokens) is replayed through the consumer; assert the resulting body matches the `\b(você tem|isso indica|você deve)\b` zero-match regex from AC7. Fixture lives in `services/llm/__tests__/fixtures/letter-sample.sse.txt`.
  - [ ] T7.7 Update `NOTIFICATION_KIND_TO_PREFERENCE` snapshot test for the new `letter_ready` kind (T5.2).

- [ ] **T8. Env, docs, CLAUDE.md updates.**
  - [ ] T8.1 `.env.example`: `ANTHROPIC_API_KEY=`, `LLM_SERVICE_URL=http://localhost:3001`, `EXPO_PUBLIC_LLM_SERVICE_URL=http://localhost:3001`.
  - [ ] T8.2 CLAUDE.md "Required vars" list: add `ANTHROPIC_API_KEY`, `LLM_SERVICE_URL`, `EXPO_PUBLIC_LLM_SERVICE_URL`.
  - [ ] T8.3 CLAUDE.md "Commands" → add `pnpm --filter @healthtracker/llm-service dev`.

## Dev Notes

### Architecture references (authoritative)

- **System prompt verbatim text:** `_bmad-output/planning-artifacts/architecture.md` §6 lines 742–756. Bake into `services/llm/src/prompts/anvisa-system.ts` byte-for-byte.
- **SSE event format verbatim:** architecture.md §7 lines 757–772.
- **`letters` schema spec:** architecture.md §15 (Gap 1 resolution) lines 1450–1463. Table name is **`letters`** (NOT `letter_cache`).
- **pg-boss naming:** architecture.md line 564 — `letter.generate` (snake_case domain.action).
- **State machine:** architecture.md §14 lines 793–810 — the worker-direct path and the patient-confirm path both end at `complete`. Both are valid Letter triggers.
- **NFR-P2:** Letter first token < 3 s requires persistent server (Railway). Vercel Edge caps SSE at ~25 s (architecture §3) — so the SSE endpoint **must** live in `services/llm`, not in Next.js.
- **NFR-S6 (DPA blocker):** A DPA with Anthropic must be signed before `services/llm` processes patient data in **production** (architecture §4, line 449–457). Dev/staging can proceed against the API key freely. Surface this as a Story 4.1 _non-implementable infra blocker_ — the code lands but production deploy is gated externally.
- **NFR-I3:** LLM failure does NOT block uploads. Implication: `enqueueLetterGeneration` returns `{enqueued: false, reason}` rather than throwing; the upload-confirm tx commits regardless.

### UX references (authoritative)

- **UX-DR5** (epics.md:164): full-screen Lora serif; `aria-live="polite"`; tab bar persists; reduced-motion instant-reveal fallback.
- **UX-DR11** (epics.md:170): bottom tab bar **never** hidden during LetterReader. 4 tabs: Início / Histórico / Compartilhar / Acessos.
- **UX-DR20** (epics.md:179): pt-BR copy; ANVISA framing; push notifications never use urgency.
- **Component spec:** UX spec lines 870–887. Note conflict: line 874 says Lora **18px**; type-scale token `text.letterBody` (line 534) says **17px / 28px Lora 400**. **Defer to the token (17px)** — design-system tokens beat ad-hoc component-spec callouts.
- **a11y:** UX spec line 1318 — `role="article"`, `aria-label="Carta do Seu Eu Passado — [data]"`, `aria-live="polite"` on the streaming inner region.
- **Reduced motion:** UX spec line 1327 — full text rendered immediately when `prefers-reduced-motion`.
- **Author attribution:** UX spec line 874 English source `"Your health record, compiled {date}"` — translate per UX-DR20: `"Seu registro de saúde, compilado em {data}"` (validators constant T6.1).

### Patterns to copy (don't reinvent)

- **Atomic audit + enqueue:** `services/extraction/src/notifications/emit.ts:31` — INSERT audit `ON CONFLICT … DO NOTHING RETURNING id`, then enqueue gated on rows returned. Mirror for `letter.queued`.
- **Narrow catches:** every `try/catch` in this story must articulate the error shapes swallowed (Epic 2 retro: Story 2.5 R2-P193, Story 2.8 R2-P226). 23505 (unique violation) is the only swallowable error; rethrow programmer/runtime errors.
- **Patient-namespaced AsyncStorage if any client cache lands** — but this story is **stream-only** on the client; do **not** persist Letter body to AsyncStorage in 4.1 (Story 4.2's responsibility for re-read).
- **Validators-as-shared-truth:** all pt-BR copy + all magic numbers in `packages/validators` (Epic 2 retro). Reviewers grep this package.
- **Tamagui semantic tokens:** `$letterBackground`, `$letterText`, `$letterAuthorAttribution` — author in `packages/ui/src/theme/tokens.ts`. Never use hex literals.
- **tRPC v11 + TanStack v5 query keys** are `[['<router>','<procedure>'], { input?, type? }]` — Story 3.4 R1-P270. Critical if any `letter.getStatus` query is cached/invalidated on the client.
- **Bootstrap gate:** `apps/expo/src/app/_layout.tsx:357` — extend, don't duplicate (Story 3.4 R1-P271).

### Anti-patterns explicitly forbidden in 4.1

- Do **not** proxy the SSE stream through tRPC (architecture §3 line 247–253).
- Do **not** buffer the Anthropic stream before forwarding (kills NFR-P2 budget).
- Do **not** hide the bottom tab bar during LetterReader (UX-DR11).
- Do **not** use a red Tamagui token for the `error` state — amber/neutral only; red is reserved for system failures (UX spec line 1079; Story 3.4 retro).
- Do **not** inline pt-BR strings; everything goes in `packages/validators` (Epic 2 retro).
- Do **not** inline-string audit event names; use the `LETTER_AUDIT_*` constants from validators (T6.1).
- Do **not** ship a partial-unique-index `WHERE` change via `pnpm db:push` to prod (CLAUDE.md ops note) — Story 4.4 will ship the migration.
- Do **not** introduce a parallel font-load gate; extend the existing bootstrap gate.
- Do **not** add LOINC codes or extraction confidence numbers to the patient-facing Letter prompt (architecture enforcement rule 6).
- Do **not** use a retired Claude model identifier (`claude-3-*`, `claude-2-*`). Current Sonnet model: `claude-sonnet-4-6`.

### Latest tech notes (query Context7 before locking versions)

- **`@anthropic-ai/sdk` (TypeScript)** — query `/anthropics/anthropic-sdk-typescript` for the current streaming API (`anthropic.messages.stream({...})` → AsyncIterable of `MessageStreamEvent`; `text_delta` events carry incremental tokens). Confirm version supports Sonnet 4.6 model ID.
- **Fastify SSE** — Fastify 5 streaming: `reply.raw.write(\`data: ${JSON.stringify(...)}\n\n\`)`. Confirm headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` (Nginx-friendly).
- **`react-native-sse` vs `react-native-event-source`** — pick the one with active maintenance and Authorization-header support (RN's built-in `EventSource` does not forward custom headers reliably). Author one trivial wrapper around `fetch`-stream + ReadableStream as a fallback.
- **`expo-font` SDK 54** — supports variable fonts via `Font.useFonts({Lora: require('../../../assets/fonts/Lora-Variable.ttf')})`.

### Previous story intelligence — Story 3.4 (most recent)

Story 3.4 was the most recent client-only Story; key takeaways the 4.1 dev MUST internalize:

1. **R1-P270 (CRITICAL):** tRPC v11 + TanStack v5 query keys are **path arrays + input objects**, not dotted strings. Any `letter.getStatus` cached query MUST use the v5 key shape.
2. **R1-P271 (HIGH):** Async-bound subtrees must not mount before the bootstrap gate flips. Extend the existing gate; do not parallel-gate.
3. **R2-P275 (HIGH, cross-cutting reversal):** On Supabase `SIGNED_OUT`, in-memory React Query data is **not** wiped by `invalidateQueries` — it only marks stale. Use `queryClient.removeQueries({ queryKey: [['letter','getStatus']], exact: false })` in the auth-listener for any `letter.*` cached data. Critical for household-shared devices.
4. **Context7-first:** Story 3.4 explicitly queried Context7 for TanStack Query v5 shape before locking. Do the same here for `@anthropic-ai/sdk`.

### Project Structure Notes

All new file locations align with existing conventions:

- `packages/db/src/schema/letters.ts` — matches existing one-table-per-file naming.
- `packages/api/src/letters.ts` (helper) + `packages/api/src/router/letter.ts` (router) — matches the `uploads-review.ts`+`router/uploads.ts` split.
- `services/llm/` — first new service since `services/extraction/`. Mirror that workspace's structure (research §2).
- `apps/expo/src/app/cartas/[letterId].tsx` — pt-BR-named route segment (`cartas`), matches the rest of `apps/expo/src/app/` (e.g. `privacidade/`, `configuracoes/`, `medicao/`).
- `packages/ui/src/components/LetterReader/` — barrel directory matches existing components (architecture §11 line 1138–1140).

No structural conflicts.

### Testing standards summary

- DB integration: testcontainer-postgres-16; per `CLAUDE.md` §"Database tests".
- API integration: testcontainer + pg-boss-in-memory; run alongside DB tests.
- Mobile: `@testing-library/react-native` snapshot/behavior.
- Replay test: deterministic SSE fixture file under `services/llm/__tests__/fixtures/`.
- All tests live next to the package being tested (no top-level `tests/`).

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1 lines 1097–1121]
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR5 line 164]
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR11 line 170]
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR20 line 179]
- [Source: _bmad-output/planning-artifacts/architecture.md#ANVISA system prompt lines 742–756]
- [Source: _bmad-output/planning-artifacts/architecture.md#SSE streaming pattern lines 757–772]
- [Source: _bmad-output/planning-artifacts/architecture.md#Premium procedure lines 812–827]
- [Source: _bmad-output/planning-artifacts/architecture.md#Audit log write pattern lines 829–847]
- [Source: _bmad-output/planning-artifacts/architecture.md#letters schema gap 1 lines 1450–1463]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data flow lines 1307–1326]
- [Source: _bmad-output/planning-artifacts/architecture.md#Upload state machine lines 793–810]
- [Source: _bmad-output/planning-artifacts/architecture.md#NFR-P2 line 41; NFR-S6 line 45; NFR-I3 line 51]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#LetterReader component lines 870–887]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Typography lines 510–540]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#aria-live + role article line 1318]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Tab bar persistence lines 1132–1134]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Reduced motion line 1327]
- [Source: _bmad-output/implementation-artifacts/3-4-patient-views-cached-fingerprint-data-while-offline.md — patterns + R1-P270/R1-P271/R2-P275]
- [Source: services/extraction/src/notifications/emit.ts:31 — atomic audit + enqueue pattern to mirror]
- [Source: packages/api/src/uploads-review.ts:484–541 — patient-confirm trigger site]
- [Source: packages/db/src/schema/notification_preferences.ts:18 — `lettersReady` column already exists]
- [Source: packages/db/src/schema/audit.ts — `audit_log_notification_event_unique` partial-unique-index precedent]
- [Source: CLAUDE.md — narrow-catches discipline; ops note on partial-unique-index migrations]

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Known infra blockers (out-of-code)

- **DPA with Anthropic** must be signed before production deploy of `services/llm` (NFR-S6). Dev/staging unblocked.
- **Railway** persistent-server project must be provisioned (NFR-P2). Dev: `pnpm --filter @healthtracker/llm-service dev` on localhost:3001.
- **ANTHROPIC_API_KEY** must be set in dev/staging/prod env. CI/E2E can stub via fixture-replay test (T7.6).
- **Premium subscription tier** infrastructure (`ctx.session.user.subscriptionTier`) — confirm this property is populated by Supabase JWT today; if not, free-tier check at T3.1 must default to "non-premium" (skip enqueue) so free users don't accidentally get a generation.
