import type { SupabaseClient } from "@supabase/supabase-js";
import type { PgBoss } from "pg-boss";
import type postgres from "postgres";

import type { JobPayload } from "@healthtracker/types";

import {
  pseudonymizePatientId,
  removeAccountStorageObjects,
} from "../account-deletion.js";
import { getSupabaseClient } from "../supabase.js";

interface GenerateAccountDeletionPayload {
  requestId: string;
  patientId: string;
}

interface DeletionRequestRow {
  id: string;
  patient_id: string;
  status: "queued" | "processing" | "complete" | "failed";
}

const RETRY_LIMIT = 3;

/**
 * Story 5.6 AC3 — `account.delete.generate` consumer. Executes the
 * 7-step LGPD Art. 18 erasure ceremony:
 *
 *   1. Mark `account_deletion_requests.status='processing'`.
 *   2. Pseudonymize audit_log rows owned by this patient (AR20 +
 *      NFR-S4). The append-only invariant is preserved: rows survive,
 *      identifying links are replaced.
 *   3. Best-effort delete Storage objects under
 *      `${bucket}/${patient_id}/*` for every patient-scoped bucket.
 *   4. Cascade-DELETE public-schema rows via
 *      `DELETE FROM users WHERE id = $patientId`. Every patient-FK
 *      table has `onDelete: cascade` (T2 FK cascade audit).
 *      `account_deletion_requests` is EXEMPT (no FK by design).
 *   5. `supabase.auth.admin.deleteUser(patientId)`. HTTP 404 ⇒
 *      already-deleted; treat as success.
 *   6. UPDATE `account_deletion_requests` SET status='complete'.
 *   7. Audit `account.deletion_completed` (system-actor; actor_id =
 *      the pseudonym uuid derived in step 2).
 *
 * Pseudonymization detail: `audit_log.actor_id` and `resource_id` are
 * `uuid NOT NULL`. The full pseudonym `'pseudonymized-' || sha256_hex`
 * is a text string that cannot be cast to uuid. We therefore split the
 * representation:
 *   - `actor_id` / `resource_id` ⇐ a deterministic uuid-shape carved
 *     from the first 32 hex chars of the same sha256(patient_id ||
 *     salt). Pure derivation; no collision risk for ordinary patient
 *     traffic.
 *   - `metadata.pseudonym` ⇐ the full `'pseudonymized-' || hex` string
 *     (for compliance traceability — auditors can correlate across
 *     rows without uuid-shape spoofing concerns).
 * The SQL helper `pseudonymize_patient_id(uuid, text)` returns the
 * full pseudonym string; the in-line `substr(encode(digest(...)))`
 * derives the uuid-shape directly from the same sha256 input.
 *
 * Narrow catches per CLAUDE.md §"Narrow catches":
 *   - Postgres errors with `code` field
 *   - Supabase Auth admin API errors with HTTP `status`
 *   - Storage errors caught + logged inside
 *     `removeAccountStorageObjects` (best-effort).
 * Programmer errors (TypeError / ReferenceError / SyntaxError)
 * rethrow.
 *
 * On the FINAL attempt (`retrycount + 1 >= RETRY_LIMIT`), persist
 * `status='failed'` + emit `account.deletion_failed` audit BEFORE the
 * rethrow so the failure is traced even on programmer errors.
 * Mirrors Story 5.5 R1 patch #2.
 */
export interface GenerateAccountDeletionDeps {
  sql: postgres.Sql;
  supabase?: SupabaseClient;
  /** Resolved once at boot via `getAccountDeletionSalt()`. */
  salt: string;
}

export async function registerGenerateAccountDeletionConsumer(
  boss: PgBoss,
  deps: GenerateAccountDeletionDeps,
): Promise<void> {
  await boss.work<JobPayload<GenerateAccountDeletionPayload>>(
    "account.delete.generate",
    // AC5 — serialize. A deletion job spans Storage + cascade +
    // auth admin delete; concurrency 1 keeps retries deterministic.
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const { requestId, patientId } = job.data.payload;
        const rawRetrycount = (job as unknown as { retrycount?: unknown })
          .retrycount;
        const retrycount =
          typeof rawRetrycount === "number" ? rawRetrycount : 0;
        await processOne(deps, requestId, patientId, retrycount);
      }
    },
  );
}

export async function processOne(
  deps: GenerateAccountDeletionDeps,
  requestId: string,
  patientId: string,
  retrycount: number,
): Promise<void> {
  // Idempotent retry — terminal states short-circuit.
  const existing = await deps.sql<DeletionRequestRow[]>`
    SELECT id, patient_id, status
    FROM account_deletion_requests
    WHERE id = ${requestId}::uuid
    LIMIT 1
  `;
  const row = existing[0];
  if (!row) {
    console.warn(
      `[account.delete] requestId=${requestId}: row missing — skipping`,
    );
    return;
  }
  if (row.status === "complete" || row.status === "failed") {
    console.log(
      `[account.delete] requestId=${requestId}: already ${row.status} — skipping`,
    );
    return;
  }

  const supabase = deps.supabase ?? getSupabaseClient();
  const pseudonymFull = pseudonymizePatientId(patientId, deps.salt);
  // Deterministic uuid-shape derived from the same sha256(patient_id ||
  // salt) bytes — see the file header for the split-representation
  // rationale. Pure JS so we don't round-trip a SELECT just to format
  // the hex (the audit UPDATE below still derives it server-side for
  // tx-atomicity).
  const hex = pseudonymFull.slice("pseudonymized-".length);
  const pseudonymUuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

  try {
    // Step 1 — status='processing'. Outside the inner tx so it's
    // visible to a polling reader even if a subsequent step throws.
    await deps.sql`
      UPDATE account_deletion_requests
      SET status = 'processing'
      WHERE id = ${requestId}::uuid AND status = 'queued'
    `;

    // Step 2 — pseudonymize audit_log. One tx for the three UPDATEs
    // so a mid-stream failure doesn't leave half-rewritten rows.
    await deps.sql.begin(async (tx) => {
      // (a) actor_id link — patient as actor.
      await tx`
        UPDATE audit_log
        SET actor_id = ${pseudonymUuid}::uuid,
            metadata = jsonb_set(metadata, '{pseudonym}', to_jsonb(${pseudonymFull}::text))
        WHERE actor_id = ${patientId}::uuid
      `;
      // (b) resource_id link — patient as resource (e.g.
      // `patient.created` resource_id = patient_id).
      await tx`
        UPDATE audit_log
        SET resource_id = ${pseudonymUuid}::uuid
        WHERE resource_id = ${patientId}::uuid
      `;
      // (c) metadata JSONB scrub — embedded patient_id literals
      // replaced with the full pseudonym hex. Shape-preserving (uuid
      // → string both fit JSON strings). The LIKE pre-filter avoids
      // rewriting rows that have no embedded reference.
      await tx`
        UPDATE audit_log
        SET metadata = regexp_replace(
          metadata::text,
          ${patientId}::text,
          ${pseudonymFull}::text,
          'g'
        )::jsonb
        WHERE metadata::text LIKE ${"%" + patientId + "%"}
      `;
    });

    // Step 3 — Storage cleanup. Best-effort; logs + continues.
    await removeAccountStorageObjects(supabase, patientId);

    // Step 4 — pg-boss job cleanup (Decision A from R1).
    // Cancel in-flight jobs that reference this patient_id in their
    // JSONB payload BEFORE cascade-DELETE so the queue payloads don't
    // leak the raw uuid until pg-boss's archive sweep. Best-effort —
    // won't kill already-running jobs (consumers gracefully no-op on
    // missing rows post-cascade).
    const queueDelete = await deps.sql`
      DELETE FROM pgboss.job
      WHERE name IN ('letter.generate','record.export.generate','conversation_starter.generate')
        AND data->>'patientId' = ${patientId}
    `;
    const archiveDelete = await deps.sql`
      DELETE FROM pgboss.archive
      WHERE name IN ('letter.generate','record.export.generate','conversation_starter.generate')
        AND data->>'patientId' = ${patientId}
    `;
    console.log(
      `[account.delete] requestId=${requestId}: pg-boss cleanup queue=${queueDelete.count} archive=${archiveDelete.count}`,
    );

    // Step 5 — cascade-DELETE public-schema rows. T2 FK cascade
    // audit ensures every patient-FK table has onDelete:cascade.
    // `account_deletion_requests` is EXEMPT (intentionally no FK).
    await deps.sql`
      DELETE FROM users WHERE id = ${patientId}::uuid
    `;

    // Step 6a — final-attempt forensics pre-emit (Decision B from R1).
    // Emit `account.deletion_failed` BEFORE the auth admin call so that
    // a partial-auth-side failure is traced even if the process dies
    // mid-call. If auth succeeds, this row stays as a "pre_auth_
    // precaution" record and is superseded by `account.deletion_
    // completed` at step 7. Auditors distinguish via metadata.status.
    const isFinalAttempt = retrycount + 1 >= RETRY_LIMIT;
    if (isFinalAttempt) {
      await deps.sql`
        INSERT INTO audit_log
          (actor_id, actor_type, event, resource_id, resource_type, metadata)
        VALUES (
          ${pseudonymUuid}::uuid,
          'system',
          'account.deletion_failed',
          ${requestId}::uuid,
          'account_deletion_request',
          ${JSON.stringify({
            pseudonym: pseudonymFull,
            originalActorErased: true,
            status: "pre_auth_precaution",
            attemptedAt: new Date().toISOString(),
          })}::jsonb
        )
      `;
    }

    // Step 6b — Supabase Auth admin delete. 404 ⇒ already-deleted
    // (idempotent retry). 401/403 → UnrecoverableAuthError (skip
    // retry budget — env misconfig won't auto-heal). 5xx → retry.
    const { error: authErr } = await supabase.auth.admin.deleteUser(patientId);
    if (authErr) {
      const status = (authErr as { status?: number }).status;
      if (status === 404) {
        console.log(
          `[account.delete] requestId=${requestId}: auth user already deleted (404 — success)`,
        );
      } else if (status === 401 || status === 403) {
        throw new UnrecoverableAuthError(
          `supabase.auth.admin.deleteUser permission denied (status=${status}): ${authErr.message}`,
        );
      } else {
        throw new Error(
          `supabase.auth.admin.deleteUser failed (status=${status ?? "?"}): ${authErr.message}`,
        );
      }
    }

    // Steps 6 + 7 — ledger flip + system-actor completion audit.
    await deps.sql.begin(async (tx) => {
      await tx`
        UPDATE account_deletion_requests
        SET status = 'complete', completed_at = now()
        WHERE id = ${requestId}::uuid
      `;
      await tx`
        INSERT INTO audit_log
          (actor_id, actor_type, event, resource_id, resource_type, metadata)
        VALUES (
          ${pseudonymUuid}::uuid,
          'system',
          'account.deletion_completed',
          ${requestId}::uuid,
          'account_deletion_request',
          ${JSON.stringify({ pseudonym: pseudonymFull })}::jsonb
        )
      `;
    });
  } catch (err) {
    const isPgError =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "string";
    const isAuthError =
      err instanceof Error && /supabase\.auth\.admin/i.test(err.message);
    const isNetworkError =
      err instanceof Error &&
      /ECONNRESET|ECONN|ETIMEDOUT|fetch failed|network/i.test(err.message);
    const recognized = isPgError || isAuthError || isNetworkError;

    console.error(
      `[account.delete] requestId=${requestId}: failure (retrycount=${retrycount}, recognized=${recognized})`,
      err,
    );

    const isUnrecoverable = err instanceof UnrecoverableAuthError;
    const isFinalAttempt = retrycount + 1 >= RETRY_LIMIT || isUnrecoverable;

    const reason = isUnrecoverable
      ? "AUTH_PERMISSION_ERROR"
      : isPgError
        ? "DB_ERROR"
        : isAuthError
          ? "AUTH_ADMIN_ERROR"
          : isNetworkError
            ? "NETWORK_ERROR"
            : "INTERNAL_ERROR";

    if (!isFinalAttempt) {
      // Earlier attempts — revert processing→queued so the next
      // retry re-enters the happy path. Also emit a system-actor
      // `account.deletion_retry` audit so retries 1-2 are traceable
      // (R1 fix — was previously silent).
      await deps.sql.begin(async (tx) => {
        await tx`
          UPDATE account_deletion_requests
          SET status = 'queued'
          WHERE id = ${requestId}::uuid AND status = 'processing'
        `;
        await tx`
          INSERT INTO audit_log
            (actor_id, actor_type, event, resource_id, resource_type, metadata)
          VALUES (
            ${pseudonymUuid}::uuid,
            'system',
            'account.deletion_retry',
            ${requestId}::uuid,
            'account_deletion_request',
            ${JSON.stringify({
              pseudonym: pseudonymFull,
              retrycount,
              reason,
            })}::jsonb
          )
        `;
      });
      throw err;
    }

    // Final attempt — terminal failure. Persist `failed` status. The
    // `account.deletion_failed` audit row was pre-emitted at step 6a
    // (before the auth admin call) using the pseudonym; we do NOT
    // double-insert here — only flip the ledger row's status.
    await deps.sql`
      UPDATE account_deletion_requests
      SET status = 'failed', failure_reason = ${reason}
      WHERE id = ${requestId}::uuid
    `;
    throw err;
  }
}

/**
 * Sentinel for HTTP 401/403 from `supabase.auth.admin.deleteUser`.
 * Bypasses the pg-boss retry budget — env misconfig won't auto-heal.
 */
export class UnrecoverableAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableAuthError";
  }
}
