## Summary

<!-- Describe what this PR does and why. -->

## Architecture checklist

- [ ] **ANVISA framing**: Any health-data feature is framed correctly per ANVISA requirements
- [ ] **Premium features**: `premiumProcedure` used for all premium-gated tRPC procedures
- [ ] **PII scrubbing**: No PII appears in logs, error messages, or Sentry breadcrumbs
- [ ] **No hardcoded hex colours**: UI uses design tokens only (no `#rrggbb` literals in components)
- [ ] **`SET LOCAL` (not `SET`)**: All RLS claim-setting SQL uses `SET LOCAL` scoped to the transaction
- [ ] **No inline `audit_log` inserts**: Audit logging goes through the designated audit helper only
- [ ] **`drizzle-kit check` passes locally**: Run `pnpm db:check` before pushing; destructive operations require an `-- @drizzle-override:` comment in the migration file

## Test coverage

- [ ] Unit tests added or updated for changed business logic
- [ ] RLS adversarial tests updated if a patient-data table was modified
- [ ] Accessibility: no new WCAG 2.1 AA violations introduced (run `pnpm test:a11y -F @healthtracker/web` locally if touching UI)
