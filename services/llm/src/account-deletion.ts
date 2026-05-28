import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Story 5.6 — pure helpers for the `generate-account-deletion`
 * consumer. Split out so the JS pseudonymization function can be
 * round-trip-tested against the SQL helper (`pseudonymize_patient_id`)
 * defined in `packages/db/policies/custom_rls_account_deletion_requests.sql`.
 */

/**
 * Patient-scoped Supabase Storage buckets that the worker must
 * empty before the cascade-DELETE. Future patient-scoped buckets
 * MUST be added here (and to CLAUDE.md → "Account deletion
 * discipline"). Order does not matter (best-effort + log + continue).
 */
export const PATIENT_STORAGE_BUCKETS = [
  // Story 5.5 — record exports (`exports/{patient_id}/{id}.{format}`).
  "exports",
  // Story 1.5 / 2.x — uploaded lab files (`lab_uploads/{patient_id}/<filename>`).
  "lab_uploads",
] as const;
export type PatientStorageBucket = (typeof PATIENT_STORAGE_BUCKETS)[number];

/**
 * Deterministic 64-hex-char pseudonym for the patient id. Mirrors the
 * SQL function `pseudonymize_patient_id(uuid, text)` byte-for-byte so
 * a round-trip test asserts both surfaces produce identical output.
 * Output: `'pseudonymized-' || sha256_hex(uuid::text || salt)`.
 */
export function pseudonymizePatientId(patientId: string, salt: string): string {
  const hex = createHash("sha256")
    .update(patientId + salt, "utf8")
    .digest("hex");
  return `pseudonymized-${hex}`;
}

/**
 * Boot-time salt resolver. Mirrors Story 5.5 R1 patch #8
 * `getSupabaseClient()` eager-invoke pattern: a missing
 * `ACCOUNT_DELETION_SALT` in production should abort the process
 * immediately rather than accept jobs and crash on the first
 * deletion attempt.
 *
 * Development / test falls back to a deterministic dev-only salt
 * with a console warning (NFR-S6 pattern). Salt rotation
 * invalidates linkability across the boundary — accepted limitation;
 * documented in CLAUDE.md.
 */
export function getAccountDeletionSalt(): string {
  const fromEnv = process.env.ACCOUNT_DELETION_SALT;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const env = process.env.NODE_ENV ?? "development";
  if (env === "production") {
    throw new Error(
      "[llm-service] ACCOUNT_DELETION_SALT is required in production " +
        "(Story 5.6). Generate with `openssl rand -base64 64 | tr -d '\\n'`.",
    );
  }
  console.warn(
    "[llm-service] ACCOUNT_DELETION_SALT not set — using deterministic " +
      "dev-only salt. Set the env var for non-dev environments.",
  );
  return "dev-only-account-deletion-salt-not-for-production";
}

export interface StorageCleanupResult {
  bucket: string;
  removed: number;
  errors: number;
}

/**
 * Lists + removes all Storage objects under
 * `${bucket}/${patientId}/` for every bucket in PATIENT_STORAGE_BUCKETS.
 * Best-effort: a missing bucket or per-object 404 logs a warning and
 * continues. Returns per-bucket counts for the consumer's structured
 * log (NOT for control flow).
 *
 * Page size: a single patient is not expected to exceed 1000 files in
 * any bucket; if that becomes false later, add pagination here.
 */
export async function removeAccountStorageObjects(
  supabase: SupabaseClient,
  patientId: string,
): Promise<StorageCleanupResult[]> {
  const results: StorageCleanupResult[] = [];
  for (const bucket of PATIENT_STORAGE_BUCKETS) {
    const result: StorageCleanupResult = {
      bucket,
      removed: 0,
      errors: 0,
    };
    try {
      // R1 fix — pagination loop. Supabase `list()` defaults to limit 100;
      // max page size is 1000. A long-time patient with hundreds of files
      // would silently orphan everything past page 1 without this loop
      // (LGPD Art. 18 — erasure must be complete).
      const PAGE = 1000;
      const paths: string[] = [];
      let offset = 0;
      let listFailed = false;
      while (true) {
        const { data, error: listErr } = await supabase.storage
          .from(bucket)
          .list(patientId, { limit: PAGE, offset });
        if (listErr) {
          console.warn(
            `[account.delete] storage.list(${bucket}/${patientId}, offset=${offset}) failed: ${listErr.message}`,
          );
          result.errors += 1;
          listFailed = true;
          break;
        }
        if (data.length === 0) break;
        for (const entry of data) {
          if (entry.name && !entry.name.startsWith(".")) {
            paths.push(`${patientId}/${entry.name}`);
          }
        }
        if (data.length < PAGE) break;
        offset += PAGE;
      }
      if (listFailed) {
        results.push(result);
        continue;
      }
      console.log(
        `[account.delete] storage_cleanup bucket=${bucket} patientId=${patientId} count=${paths.length}`,
      );
      if (paths.length === 0) {
        results.push(result);
        continue;
      }
      // Supabase `remove()` accepts up to 1000 paths per call.
      let removed = 0;
      for (let i = 0; i < paths.length; i += 1000) {
        const batch = paths.slice(i, i + 1000);
        const { error: removeErr } = await supabase.storage
          .from(bucket)
          .remove(batch);
        if (removeErr) {
          console.warn(
            `[account.delete] storage.remove(${bucket}) batch failed: ${removeErr.message}`,
          );
          result.errors += 1;
        } else {
          removed += batch.length;
        }
      }
      result.removed = removed;
    } catch (err) {
      // Narrow-catch — Storage SDK throws on network/transport failures.
      // Programmer errors (TypeError) propagate.
      if (err instanceof TypeError) throw err;
      console.warn(`[account.delete] storage cleanup for ${bucket} threw`, err);
      result.errors += 1;
    }
    results.push(result);
  }
  return results;
}
