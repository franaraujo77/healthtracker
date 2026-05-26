import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { and, eq, isNull, sql } from "@healthtracker/db";
import { Observations } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

/**
 * Story 5.1 — sharing helper module. Centralises identifier hashing
 * and share-token HMAC sign/verify so the patient-side router
 * (`packages/api/src/router/sharing.ts`) and the Epic 6 doctor-side
 * surface can import from one canonical location.
 *
 * Mirrors the `packages/api/src/letters.ts` split from Story 4.1
 * (router/letter.ts -> letters.ts).
 */

/**
 * SHA-256 hex digest of a doctor identifier (email or CRM). Used as
 * the `pending_invites.identifier_hash` column value. PII hygiene:
 * the raw value is never persisted.
 */
export function hashIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex");
}

/**
 * Boot-time gate for the HMAC secret. Production: required (throws
 * on cold start if missing). Dev/test: falls back to a deterministic
 * dev-only value with a console warning — mirrors NFR-S6 dev/prod
 * gating from Story 4.1 `ANTHROPIC_API_KEY`.
 */
const DEV_FALLBACK_HMAC_SECRET =
  "dev-only-share-token-hmac-secret-not-for-production-use";

function getHmacSecret(): string {
  const fromEnv = process.env.SHARE_TOKEN_HMAC_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SHARE_TOKEN_HMAC_SECRET is required in production (Story 5.1 / NFR-S6)",
    );
  }
  if (!warnedAboutDevSecret) {
    warnedAboutDevSecret = true;
    console.warn(
      "[sharing] SHARE_TOKEN_HMAC_SECRET is empty — using dev-only fallback (DO NOT ship to prod)",
    );
  }
  return DEV_FALLBACK_HMAC_SECRET;
}
let warnedAboutDevSecret = false;

/**
 * Generates a fresh opaque share token. Returns the raw token (for
 * embedding in the share URL once), the SHA-256 hash (for the
 * `token_hash` column — lookup key on the doctor side), and the
 * HMAC signature (for the `token_hmac` column — never logged, never
 * cached client-side).
 */
export function generateShareToken(): {
  raw: string;
  tokenHash: string;
  tokenHmac: string;
} {
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const tokenHmac = signShareToken(raw);
  return { raw, tokenHash, tokenHmac };
}

export function signShareToken(raw: string): string {
  return createHmac("sha256", getHmacSecret()).update(raw).digest("base64url");
}

/**
 * Constant-time HMAC verification. Returns `false` when the
 * provided signature does not match the expected one for `raw` —
 * authored now for the Epic 6 doctor-side surface to consume.
 */
export function verifyShareToken(raw: string, signature: string): boolean {
  const expected = signShareToken(raw);
  // Encode as Buffer; timingSafeEqual requires equal length.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Returns the distinct biomarker categories the patient has data
 * for. Used by `createShareToken` to pre-populate
 * `share_token_biomarkers`. Soft-delete-filtered; results are
 * lowercased/de-duped via SQL DISTINCT. Cap at 64 rows (matches the
 * Zod schema's `.max(64)` on `configureBiomarkers` input).
 *
 * Uses LOINC code when present (canonical category identifier) and
 * falls back to `biomarker_name` so manual / unmapped rows still
 * surface. Private helper — NOT exposed as a public tRPC procedure.
 */
export async function getDistinctCategoriesForPatient(
  database: AuditDb,
  patientId: string,
): Promise<string[]> {
  const rows = await database
    .select({
      category: sql<string>`coalesce(${Observations.loincCode}, ${Observations.biomarkerName})`,
    })
    .from(Observations)
    .where(
      and(
        eq(Observations.patientId, patientId),
        isNull(Observations.deletedAt),
      ),
    )
    .groupBy(
      sql`coalesce(${Observations.loincCode}, ${Observations.biomarkerName})`,
    )
    .limit(64);
  return rows
    .map((r) => r.category)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
}
