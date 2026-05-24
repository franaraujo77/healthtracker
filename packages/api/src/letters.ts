import { and, eq, isNull, sql } from "@healthtracker/db";
import { ConsentGrants, Letters } from "@healthtracker/db/schema";
import { LETTER_AUDIT_QUEUED } from "@healthtracker/validators";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";
import { isPremium } from "./middleware/entitlements";
import { getNotificationPreferences } from "./notifications";

const LETTER_GENERATE_RETRY_LIMIT = 3;
const LETTER_GENERATE_RETRY_DELAY = 30;
const LETTER_GENERATE_RETRY_BACKOFF = true;

export type LetterEnqueueSkipReason =
  | "not_premium"
  | "consent_missing"
  | "preference_muted"
  | "already_queued";

export type LetterEnqueueResult =
  | { enqueued: true; letterId: string }
  | { enqueued: false; reason: LetterEnqueueSkipReason };

interface EnqueueArgs {
  patientId: string;
  uploadId: string;
  /** Supabase user object — `app_metadata.subscriptionTier` is read for the gate. */
  sessionUser: unknown;
}

/**
 * Story 4.1 — sanctioned enqueue site for Letter generation. Called
 * from the two confirmation paths (`uploads-review.ts` patient-confirm
 * and `services/extraction/src/consumers/document.ts` worker-direct;
 * the latter uses a raw-SQL twin under `services/extraction`).
 *
 * Returns `{enqueued: false, reason}` instead of throwing so the
 * caller's upload-confirm transaction commits regardless of Letter
 * skip (NFR-I3 — LLM failure does NOT block uploads).
 *
 * The four gates (in order, fail-fast):
 *   1. Premium subscription (architecture.md §9).
 *   2. `notification_preferences.lettersReady` (Story 2.8 toggle).
 *   3. `consent_grants.llm_letter_generation` granted (LGPD).
 *   4. No prior `letter.queued` audit for this `(uploadId)` —
 *      enforced by the partial unique index on `audit_log(resource_id,
 *      event) WHERE event = 'letter.queued'` (Story 4.1 schema
 *      extension of R2-P172). The `INSERT INTO audit_log` raises
 *      `unique_violation` (SQLSTATE 23505) on the second concurrent
 *      writer; we catch and return `already_queued`.
 */
export async function enqueueLetterGeneration(
  database: AuditDb,
  args: EnqueueArgs,
): Promise<LetterEnqueueResult> {
  if (!isPremium(args.sessionUser)) {
    return { enqueued: false, reason: "not_premium" };
  }

  const prefs = await getNotificationPreferences(database, args.patientId);
  if (!prefs.lettersReady) {
    return { enqueued: false, reason: "preference_muted" };
  }

  const consentRows = await database
    .select({ id: ConsentGrants.id })
    .from(ConsentGrants)
    .where(
      and(
        eq(ConsentGrants.patientId, args.patientId),
        eq(ConsentGrants.consentType, "llm_letter_generation"),
        isNull(ConsentGrants.revokedAt),
      ),
    )
    .limit(1);
  if (consentRows.length === 0) {
    // LGPD — generation is gated on explicit consent. The
    // onboarding `ai_narrative` consent (Story 1.2) does not
    // satisfy this — the broader `llm_letter_generation` is the
    // architecture-defined LGPD surface. Story 1.2 leaves a path
    // open to grant `llm_letter_generation` separately.
    return { enqueued: false, reason: "consent_missing" };
  }

  const [letterRow] = await database
    .insert(Letters)
    .values({
      patientId: args.patientId,
      uploadId: args.uploadId,
      status: "queued",
    })
    .returning({ id: Letters.id });
  if (!letterRow) {
    throw new Error("enqueueLetterGeneration: insert returned no letters row");
  }

  try {
    await writeAuditLog(database, {
      actorId: args.patientId,
      actorType: "system",
      event: LETTER_AUDIT_QUEUED,
      resourceId: letterRow.id,
      resourceType: "letter",
      metadata: { uploadId: args.uploadId },
    });
  } catch (err) {
    // Narrow — only the partial-unique-index 23505 collision means
    // "another writer queued first". Anything else (TypeError,
    // network blip, real DB error) rethrows.
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code !== "23505") throw err;
    return { enqueued: false, reason: "already_queued" };
  }

  await enqueueLetterGenerationJob(database, { letterId: letterRow.id });

  return { enqueued: true, letterId: letterRow.id };
}

async function enqueueLetterGenerationJob(
  database: AuditDb,
  args: { letterId: string },
): Promise<void> {
  const wrapped = {
    jobId: crypto.randomUUID(),
    correlationId: args.letterId,
    payload: { letterId: args.letterId } satisfies { letterId: string },
    createdAt: new Date().toISOString(),
  };
  // Singleton-key on `letterId` so an idempotent retry of the
  // enqueue site does not double-fire the `letter.generate` job.
  const singletonKey = `letter.generate.${args.letterId}`;
  await database.execute(sql`
    INSERT INTO pgboss.job
      (name, data, retry_limit, retry_delay, retry_backoff, singleton_key)
    VALUES (
      'letter.generate',
      ${JSON.stringify(wrapped)}::jsonb,
      ${LETTER_GENERATE_RETRY_LIMIT},
      ${LETTER_GENERATE_RETRY_DELAY},
      ${LETTER_GENERATE_RETRY_BACKOFF},
      ${singletonKey}
    )
    ON CONFLICT DO NOTHING
  `);
}

/**
 * Story 4.1 — read the persisted Letter for the tRPC `letter.getStatus`
 * surface and any future Story 4.2 re-read flow.
 */
export async function getLetterStatusForPatient(
  database: AuditDb,
  args: { patientId: string; letterId: string },
): Promise<{
  status: "queued" | "generating" | "complete" | "failed";
  body: string | null;
  failureReason: string | null;
} | null> {
  const [row] = await database
    .select({
      patientId: Letters.patientId,
      status: Letters.status,
      body: Letters.body,
      failureReason: Letters.failureReason,
    })
    .from(Letters)
    .where(eq(Letters.id, args.letterId))
    .limit(1);
  if (row?.patientId !== args.patientId) return null;
  return {
    status: row.status,
    body: row.body,
    failureReason: row.failureReason,
  };
}
