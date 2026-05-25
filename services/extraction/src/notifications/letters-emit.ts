import type postgres from "postgres";

/**
 * Story 4.1 — worker-side raw-SQL twin of
 * `packages/api/src/letters.ts:enqueueLetterGeneration`. The
 * extraction worker uses the `postgres` driver (not Drizzle) so it
 * can't import the API helper directly (Story 2.3 R1-P94 deviation;
 * same pattern as `services/extraction/src/notifications/emit.ts`).
 *
 * Mirrors the same four-gate check the API helper applies, in the
 * same order:
 *   1. Premium subscription — read from `auth.users.
 *      raw_app_meta_data->>'subscriptionTier'` (Supabase exposes
 *      `auth.users` via service-role bypass; the worker is service-
 *      role). Missing or non-`'premium'` → skip.
 *   2. `notification_preferences.lettersReady` — defaults to true
 *      when the row is missing (mirrors `getNotificationPreferences`).
 *   3. `consent_grants.llm_letter_generation` granted (revoked_at IS NULL).
 *   4. Race-safe enqueue via `audit_log` partial unique index — a
 *      concurrent enqueue from the API path (`uploads-review.ts`)
 *      returns zero rows and we skip.
 *
 * NFR-I3 — caller commits regardless of Letter skip; this helper
 * never throws on a skip (only on programmer / infra faults).
 */

const LETTER_GENERATE_RETRY_LIMIT = 3;
const LETTER_GENERATE_RETRY_DELAY = 30;
const LETTER_GENERATE_RETRY_BACKOFF = true;

export type LetterEmitResult =
  | { enqueued: true; letterId: string }
  | {
      enqueued: false;
      reason:
        | "not_premium"
        | "consent_missing"
        | "preference_muted"
        | "already_queued";
    };

export async function emitLetterQueued(
  tx: postgres.Sql | postgres.TransactionSql,
  args: { patientId: string; uploadId: string },
): Promise<LetterEmitResult> {
  // 1. Premium gate. The Supabase JWT will eventually carry
  // `subscriptionTier`; in the meantime the worker reads it directly
  // from `auth.users.raw_app_meta_data`. Default-deny on missing.
  const userRows = await tx<{ tier: string | null }[]>`
    SELECT raw_app_meta_data->>'subscriptionTier' AS tier
    FROM auth.users
    WHERE id = ${args.patientId}::uuid
    LIMIT 1
  `;
  const tier = userRows[0]?.tier ?? null;
  if (tier !== "premium") {
    return { enqueued: false, reason: "not_premium" };
  }

  // 2. Preference gate. Default-true on missing row (mirrors the
  // API-side `DEFAULT_NOTIFICATION_PREFERENCES`).
  const prefRows = await tx<{ letters_ready: boolean }[]>`
    SELECT letters_ready
    FROM notification_preferences
    WHERE patient_id = ${args.patientId}::uuid
    LIMIT 1
  `;
  const lettersReady = prefRows[0]?.letters_ready ?? true;
  if (!lettersReady) {
    return { enqueued: false, reason: "preference_muted" };
  }

  // 3. Consent gate. The `llm_letter_generation` row must exist and
  // not be revoked.
  const consentRows = await tx<{ id: string }[]>`
    SELECT id
    FROM consent_grants
    WHERE patient_id = ${args.patientId}::uuid
      AND consent_type = 'llm_letter_generation'
      AND revoked_at IS NULL
    LIMIT 1
  `;
  if (consentRows.length === 0) {
    return { enqueued: false, reason: "consent_missing" };
  }

  // Code-review F1 + F2 (Story 4.1) — race-safe dedup, no orphan rows.
  //
  // The original CTE created a `letters` row FIRST, then attempted the
  // audit insert with `new_letter.id` as `resource_id`. Two flaws:
  //   - F1: `resource_id = new_letter.id` is a fresh UUID per call, so
  //     the partial unique index on `audit_log(resource_id, event)`
  //     never collided between concurrent API + worker writers — both
  //     "won" and produced duplicate Letters.
  //   - F2 (worker-side equivalent): when ON CONFLICT fired, the CTE's
  //     new_letter INSERT had already committed in the data-modifying
  //     CTE's effective ordering, leaving an orphan `letters` row that
  //     a fallback DELETE (racy with the winner's snapshot) had to
  //     compensate for.
  //
  // Fix: write the audit FIRST with `resource_id = uploadId`. The
  // partial unique index now dedupes correctly across both writers.
  // The `letters` INSERT only happens when the audit row was actually
  // written — no orphans, no compensating DELETE, no race with the
  // winner's commit.
  const auditRows = await tx<{ id: string }[]>`
    INSERT INTO audit_log
      (actor_id, actor_type, event, resource_id, resource_type, metadata)
    VALUES (
      ${args.patientId}::uuid,
      'system',
      'letter.queued',
      ${args.uploadId}::uuid,
      'letter',
      ${JSON.stringify({ uploadId: args.uploadId, triggeredBy: "worker" })}::jsonb
    )
    ON CONFLICT ON CONSTRAINT audit_log_notification_event_unique
    DO NOTHING
    RETURNING id
  `;
  if (auditRows.length === 0) {
    return { enqueued: false, reason: "already_queued" };
  }

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO letters (patient_id, upload_id, status)
    VALUES (${args.patientId}::uuid, ${args.uploadId}::uuid, 'queued')
    RETURNING id
  `;
  const letterId = inserted[0]?.id;
  if (!letterId) {
    throw new Error(
      `emitLetterQueued: letters INSERT returned no rows for uploadId=${args.uploadId}`,
    );
  }

  // Enqueue the pg-boss job. Singleton-keyed on `letterId` so
  // an idempotent worker retry doesn't double-fire.
  const wrapped = {
    jobId: crypto.randomUUID(),
    correlationId: letterId,
    payload: { letterId },
    createdAt: new Date().toISOString(),
  };
  await tx`
    INSERT INTO pgboss.job
      (name, data, retry_limit, retry_delay, retry_backoff, singleton_key)
    VALUES (
      'letter.generate',
      ${JSON.stringify(wrapped)}::jsonb,
      ${LETTER_GENERATE_RETRY_LIMIT},
      ${LETTER_GENERATE_RETRY_DELAY},
      ${LETTER_GENERATE_RETRY_BACKOFF},
      ${"letter.generate." + letterId}
    )
    ON CONFLICT DO NOTHING
  `;

  return { enqueued: true, letterId };
}
