import { TRPCError } from "@trpc/server";

import { and, desc, eq, isNull, sql } from "@healthtracker/db";
import {
  ConsentGrants,
  Letters,
  Observations,
  Uploads,
} from "@healthtracker/db/schema";
import {
  BIOMARKER_AUDIT_GENERATED,
  LETTER_AUDIT_QUEUED,
} from "@healthtracker/validators";

import type { AuditDb } from "./audit";
import { writeAuditLog, writeAuditLogIfNew } from "./audit";
import { isPremium } from "./middleware/entitlements";
import { getNotificationPreferences } from "./notifications";

const LETTER_GENERATE_RETRY_LIMIT = 3;
const LETTER_GENERATE_RETRY_DELAY = 30;
const LETTER_GENERATE_RETRY_BACKOFF = true;

export type LetterEnqueueSkipReason =
  | "not_premium"
  | "consent_missing"
  | "preference_muted"
  | "already_queued"
  | "error";

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

  // Code-review F1 + F2 + F3 (Story 4.1) — race-safe dedup AND
  // tx-safe failure containment, unified inside a nested
  // transaction (SAVEPOINT semantics):
  //
  // F1 fix: the partial unique index on `audit_log(resource_id, event)`
  // dedupes on `resource_id`. The original code wrote
  // `resource_id = letters.id` (a fresh UUID per call) — so two
  // concurrent enqueues for the same upload generated two distinct
  // resource_ids and the index never collided. Switching the dedup
  // anchor to `uploadId` makes the index work: both enqueue sites
  // (this one + `services/extraction/.../letters-emit.ts`) attempt to
  // write the same `(uploadId, 'letter.queued')` row; only one wins.
  //
  // F2 fix: audit goes FIRST, via `onConflictDoNothing` (no 23505
  // ever thrown). On conflict the helper returns `{ written: false }`
  // — no letters row is created, no orphan.
  //
  // F3 fix (post-review): wrap audit+letters+pg-boss in a nested
  // Drizzle transaction (savepoint). If letters INSERT or pg-boss
  // INSERT throws AFTER the audit row was successfully written, the
  // savepoint rolls back the audit row too — preventing a permanent
  // orphan-audit block that would make the partial unique index
  // refuse all future re-enqueues for this upload. The outer tRPC
  // transaction (upload-confirm) remains uncompromised. NFR-I3
  // preserved: the caller logs and continues on `error`.
  try {
    return await database.transaction(async (sp) => {
      const audit = await writeAuditLogIfNew(sp, {
        actorId: args.patientId,
        actorType: "system",
        event: LETTER_AUDIT_QUEUED,
        resourceId: args.uploadId,
        resourceType: "letter",
        metadata: { uploadId: args.uploadId, triggeredBy: "api" },
      });
      if (!audit.written) {
        return { enqueued: false as const, reason: "already_queued" as const };
      }

      const [letterRow] = await sp
        .insert(Letters)
        .values({
          patientId: args.patientId,
          uploadId: args.uploadId,
          status: "queued",
        })
        .returning({ id: Letters.id });
      if (!letterRow) {
        throw new Error(
          "enqueueLetterGeneration: insert returned no letters row",
        );
      }

      await enqueueLetterGenerationJob(sp, { letterId: letterRow.id });

      return { enqueued: true as const, letterId: letterRow.id };
    });
  } catch (err) {
    // Programmer errors still bubble — a code regression shouldn't
    // be silently swallowed. Infra-shaped errors (DB blip, pg-boss
    // INSERT failure) become a Letter-only skip; the outer
    // upload-confirm tx is untouched and commits normally.
    if (
      err instanceof TypeError ||
      err instanceof ReferenceError ||
      err instanceof SyntaxError
    ) {
      throw err;
    }
    console.error(
      `[enqueueLetterGeneration] patientId=${args.patientId} uploadId=${args.uploadId}: letter enqueue failed — upload commit preserved (NFR-I3)`,
      err,
    );
    return { enqueued: false, reason: "error" };
  }
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

/**
 * Story 4.2 — map a `(collected_at, lab_name)` draw to its associated
 * Letter, if one exists. Patient-scoped by RLS plus an explicit
 * `patient_id` predicate (defense-in-depth so the SELECT plan stays
 * stable even if RLS context is ever misconfigured).
 *
 * `labName = ""` is the empty-string sentinel Story 3.1's
 * `historicoDrawDetailRoute` packs into the URL when the underlying
 * `uploads.lab_name` is `NULL`. We translate that sentinel here, not
 * at the caller — Story 3.1 reuses the same convention across the
 * Histórico → draw-detail surface.
 *
 * Returns the MOST RECENT `letters` row when multiple uploads exist
 * for the same draw (AC7) — Letters are per-draw narratives, not
 * per-upload artifacts.
 *
 * Returns `null` when no `letters` row exists; the caller's UX
 * silently omits the "Ler carta" surface (AC1 — the feature does
 * not advertise itself for pre-Epic-4 draws or for patients on the
 * free tier whose enqueue was skipped).
 */
export async function getLetterForDraw(
  database: AuditDb,
  args: { patientId: string; collectedAt: string; labName: string },
): Promise<{
  letterId: string;
  status: "queued" | "generating" | "complete" | "failed";
} | null> {
  const labNamePredicate =
    args.labName === ""
      ? isNull(Uploads.labName)
      : eq(Uploads.labName, args.labName);
  // Code-review F2 + F4 — EXISTS subquery instead of an inner-join on
  // `observations`. The previous shape joined every non-deleted
  // observation (30–50 rows per upload) just to satisfy a `LIMIT 1`,
  // AND made the Letter unreachable whenever every observation in the
  // upload was soft-deleted (Story 2.7 BIA overwrite edge). EXISTS
  // short-circuits on the first matching row and keeps the Letter
  // reachable as long as at least one live observation pins the draw
  // — same reachability as Story 3.1's draw list.
  const [row] = await database
    .select({
      id: Letters.id,
      status: Letters.status,
      createdAt: Letters.createdAt,
    })
    .from(Letters)
    .innerJoin(Uploads, eq(Letters.uploadId, Uploads.id))
    .where(
      and(
        eq(Letters.patientId, args.patientId),
        labNamePredicate,
        sql`EXISTS (
          SELECT 1 FROM ${Observations}
          WHERE ${Observations.uploadId} = ${Uploads.id}
            AND ${Observations.patientId} = ${args.patientId}::uuid
            AND ${Observations.collectedAt} = ${args.collectedAt}
            AND ${Observations.deletedAt} IS NULL
        )`,
      ),
    )
    .orderBy(desc(Letters.createdAt))
    .limit(1);
  if (!row) return null;
  return { letterId: row.id, status: row.status };
}

/**
 * Story 4.3 — synchronous proxy to the `services/llm`
 * `POST /api/biomarker-suggestion` endpoint. The mobile client never
 * talks to `services/llm` directly for this path — the API layer
 * applies the premium gate (via `premiumProcedure`), writes the
 * `biomarker_suggestion.generated` audit, and forwards the patient's
 * Supabase access token for the LLM service's own auth check.
 *
 * Audit row is written ONLY on a successful 200 response — premium
 * denials, cooldown 429s, and LLM 5xx failures do not produce an
 * audit. This keeps the audit log aligned with "the patient actually
 * read a suggestion," not "the patient tried to."
 *
 * **Optimism on audit-write failure (code-review F5).** The audit
 * INSERT happens AFTER the LLM service has returned a usable body
 * and AFTER `services/llm` has already bumped its in-memory
 * cooldown and Anthropic has been billed for tokens. If the audit
 * INSERT throws (DB blip, Postgres connection drop), we rethrow as
 * `INTERNAL_SERVER_ERROR` and the mobile client renders the generic
 * error message — the patient never sees the suggestion. The
 * server-side cost (cooldown bump + Anthropic spend) is intentionally
 * NOT rolled back: the cooldown lives in another process (services/
 * llm), and Anthropic doesn't refund. We accept this asymmetry
 * because (a) audit writes are highly reliable in practice (Story
 * 0.4 RLS + Drizzle tx), (b) the next retry will succeed unless the
 * DB outage persists past the 60 s cooldown — at which point the
 * user gets a fresh attempt — and (c) the alternative (writing the
 * audit BEFORE the LLM call) violates the "patient actually read a
 * suggestion" invariant the docblock above commits to.
 */
export interface BiomarkerSuggestionInput {
  biomarkerName: string;
  value: number;
  unitUcum: string;
  loincCode: string | null;
}

export async function generateBiomarkerSuggestion(
  database: AuditDb,
  args: {
    patientId: string;
    supabaseAccessToken: string;
    input: BiomarkerSuggestionInput;
  },
): Promise<{ suggestion: string }> {
  const llmServiceUrl = process.env.LLM_SERVICE_URL;
  if (!llmServiceUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "LLM_SERVICE_URL not configured",
    });
  }
  let response: Response;
  try {
    response = await fetch(`${llmServiceUrl}/api/biomarker-suggestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.supabaseAccessToken}`,
      },
      body: JSON.stringify(args.input),
    });
  } catch (err) {
    console.error(
      `[biomarker-suggestion] fetch to services/llm failed for patient=${args.patientId}`,
      err,
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "LLM_UNAVAILABLE",
    });
  }
  if (response.status === 429) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "COOLDOWN" });
  }
  if (!response.ok) {
    console.warn(
      `[biomarker-suggestion] services/llm returned ${response.status} for patient=${args.patientId}`,
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "LLM_UNAVAILABLE",
    });
  }
  const body = (await response.json()) as { suggestion?: unknown };
  if (typeof body.suggestion !== "string" || body.suggestion.length === 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "LLM_UNAVAILABLE",
    });
  }
  await writeAuditLog(database, {
    actorId: args.patientId,
    actorType: "patient",
    event: BIOMARKER_AUDIT_GENERATED,
    resourceId: crypto.randomUUID(),
    resourceType: "biomarker_suggestion",
    metadata: {
      loincCode: args.input.loincCode,
      biomarkerName: args.input.biomarkerName,
    },
  });
  return { suggestion: body.suggestion };
}
