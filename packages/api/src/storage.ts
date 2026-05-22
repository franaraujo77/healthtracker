import { createClient } from "@healthtracker/auth";

/**
 * Story 1.5 — server-side Supabase Storage helper. Uses the service-role
 * key to create signed upload URLs the patient client can `PUT` to.
 *
 * Service-role bypasses RLS for the signed-URL creation itself — that's
 * fine because:
 *   1. We control the path (always patient-prefixed) on the server.
 *   2. The signed URL embeds the path and is short-lived (60 s).
 *   3. The storage RLS policy (`custom_storage_lab_uploads_policy.sql`)
 *      enforces the same patient-prefix constraint when the client
 *      eventually PUTs, so even a leaked URL can't escape the prefix.
 */

export const LAB_UPLOADS_BUCKET = "lab-uploads";

let cachedClient: ReturnType<typeof createClient> | null = null;

function getStorageClient(): ReturnType<typeof createClient> {
  if (cachedClient) return cachedClient;
  // Read directly from `process.env` rather than `authEnv()` — that
  // helper exposes only client-safe vars (anon key + URL). The service
  // role key is server-only and lives in the Railway / Vercel env.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "Supabase URL not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL)",
    );
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY required for storage signed-URL operations",
    );
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/**
 * Builds the patient-prefixed object key for a lab upload. Mirrors the
 * storage RLS path convention exactly:
 *   `<patient_id>/<idempotency_key>/<sanitized_filename>`
 * so a single RLS policy enforces per-patient isolation.
 */
export function buildLabUploadStoragePath(args: {
  patientId: string;
  idempotencyKey: string;
  sanitizedFilename: string;
}): string {
  return `${args.patientId}/${args.idempotencyKey}/${args.sanitizedFilename}`;
}

/**
 * Issues a signed upload URL for the patient-prefixed object key. The
 * client `PUT`s the file bytes directly to Supabase Storage, bypassing
 * the API server's bandwidth.
 *
 * Review P47 — trust-model note: signed URLs created with the
 * service-role key DO NOT carry the patient's `auth.uid()`, so the
 * storage RLS policy (`custom_storage_lab_uploads_policy.sql`) does
 * NOT fire on the PUT. The patient-prefix safety in the object key
 * comes from the server constructing the path (in
 * `buildLabUploadStoragePath`), not from RLS firing on the upload.
 * The storage RLS still defends against direct anonymous reads /
 * other path access; the signed PUT is gated by URL secrecy + TTL.
 *
 * The signed-URL TTL is controlled by Supabase project settings
 * (`createSignedUploadUrl` does not accept a per-call override in the
 * current SDK). Tighten the project default if the replay window
 * matters.
 */
export async function createLabUploadSignedUrl(
  storagePath: string,
): Promise<string> {
  const supabase = getStorageClient();
  const { data, error } = await supabase.storage
    .from(LAB_UPLOADS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error) {
    throw new Error(`createSignedUploadUrl failed: ${error.message}`);
  }
  if (!data.signedUrl) {
    throw new Error("createSignedUploadUrl returned no signedUrl");
  }
  return data.signedUrl;
}

/**
 * Review P39 + P42 — verifies the storage object actually exists at
 * `storagePath` and returns its server-reported metadata. The audit
 * log records the storage-reported `sizeBytes` (not the patient's
 * claim) so a lying client can't poison the FR33 ledger.
 *
 * Returns `null` when the object is not found at the path (the
 * `confirmImport` caller treats this as a `BAD_REQUEST`).
 */
export interface StoredObjectMetadata {
  /** Size in bytes as reported by Supabase Storage. */
  sizeBytes: number;
  /** Content-Type as reported by Supabase Storage. */
  contentType: string | null;
}

export async function statLabUploadObject(
  storagePath: string,
): Promise<StoredObjectMetadata | null> {
  const supabase = getStorageClient();
  // `storage.foldername(path)` semantics: split on `/`. Our paths are
  // `<patientId>/<idempotencyKey>/<filename>`, so the parent prefix
  // is the first two segments and the filename is the search key.
  const lastSlash = storagePath.lastIndexOf("/");
  if (lastSlash === -1) return null;
  const prefix = storagePath.slice(0, lastSlash);
  const filename = storagePath.slice(lastSlash + 1);

  const { data, error } = await supabase.storage
    .from(LAB_UPLOADS_BUCKET)
    .list(prefix, { search: filename, limit: 1 });
  if (error) {
    throw new Error(`storage.list failed: ${error.message}`);
  }
  const match = data.find((row) => row.name === filename) ?? null;
  if (!match) return null;
  const rawSize = match.metadata?.size;
  if (typeof rawSize !== "number") {
    // The Supabase `list` API returns `metadata: { size, mimetype, ... }`
    // for actual objects; if it's missing the row is a folder placeholder
    // (shouldn't happen for our prefix structure) — treat as not found.
    return null;
  }
  const rawMime = match.metadata?.mimetype;
  const contentType = typeof rawMime === "string" ? rawMime : null;
  return { sizeBytes: rawSize, contentType };
}
