# PII / Privacy Code Review Checklist

Use this checklist when reviewing any PR that touches Sentry instrumentation, error handling, logging, consent flows, or data collection (LGPD compliance).

## Sentry PII Scrubbing — `beforeSend`

- [ ] `sentryBeforeSend` scrubs all of the following top-level event fields:
  - `event.user` — wipe or replace with anonymised identifier
  - `event.extra` — recursive scrub
  - `event.contexts` — recursive scrub
  - `event.tags` — recursive scrub
  - `event.breadcrumbs[].data` — recursive scrub per breadcrumb entry
  - `event.request.data` — request body
  - `event.request.headers` — must remove: `authorization`, `x-api-key`, `set-cookie`, `cookie`
- [ ] Scrubbing is applied recursively; verify that depth limits are sufficient to reach nested objects (e.g., contexts with nested user sub-objects)
- [ ] The scrub key list includes all current sensitive PII fields:
  - `patient_id`, `email`, `phone`, `cpf`, `full_name`, `name` (when inside user context), `date_of_birth`, `address`
- [ ] Any new biomarker or health data fields introduced in this PR are added to the scrub key list — cross-check against the current data model

## Sentry Configuration

- [ ] `tracesSampleRate` is environment-aware — `1.0` is acceptable only in development/staging; production must use a lower rate before high-traffic launch
- [ ] `NEXT_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_DSN` are not committed to source; they are injected via env at build time
- [ ] `SENTRY_AUTH_TOKEN` is used only server-side (source maps upload) and never exposed to the client bundle

## Known Scrubbing Limitations (document, do not block)

- [ ] Breadcrumb `message` strings and exception `value` strings are NOT scrubbed by `beforeSend` — flag in PR comments if these strings may contain PII patterns (email addresses, CPF numbers)
- [ ] If this PR introduces new logging or breadcrumb calls, verify they do not embed raw PII strings

## Consent & LGPD Compliance

- [ ] Collection of sensitive health data (blood results, BIA measurements, biomarkers) is gated behind an explicit consent check in the tRPC resolver — LGPD Art. 11 requires explicit consent for sensitive data categories
- [ ] Consent records are stored without patient-identifying fields in the Sentry payload — no `patient_id` or `cpf` in Sentry breadcrumbs or extras when logging consent events
- [ ] Data deletion / export endpoints (LGPD right of access / erasure) are not broken by schema changes in this PR
- [ ] Any new data field that constitutes personal data under LGPD is documented in the data model and flagged for DPA review if it is a new sensitive category

## General Logging

- [ ] Server-side logs (console, structured logger) do not include raw PII fields — use anonymised IDs or omit
- [ ] Error boundaries and catch blocks do not log full request objects that may contain PII headers or body payloads
- [ ] No PII appears in URL query parameters that would end up in access logs (use POST body or headers instead)
