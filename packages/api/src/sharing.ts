import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { ServerAccessLogTokenStatus } from "@healthtracker/validators";
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

// Patch #14 — declared BEFORE `getHmacSecret` to avoid the TDZ
// footgun (function declarations hoist; `let` bindings don't).
let warnedAboutDevSecret = false;

function getHmacSecret(): string {
  const fromEnv = process.env.SHARE_TOKEN_HMAC_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // Patch #8 — deny-by-default outside development/test. Empty
  // NODE_ENV (or staging / preview / anything else) MUST refuse boot;
  // staging-with-no-secret was silently signing tokens with the
  // source-controlled dev fallback under the previous `=== "production"`
  // gate. Mirrors NFR-S6.
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") {
    throw new Error(
      "SHARE_TOKEN_HMAC_SECRET is required outside development/test (Story 5.1 / NFR-S6)",
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
/**
 * Patch #11 — returns both the stable category id (LOINC code when
 * present, falling back to `biomarker_name` — the UPSERT join key)
 * AND a human-readable patient-facing `label` (always
 * `biomarker_name`). The screen renders `label`; the
 * `share_token_biomarkers.biomarker_category` column persists
 * `category`. Decoupling these two keeps the join key stable across
 * biomarker-name renames while letting the UI show "Hemoglobina"
 * instead of "718-7".
 */
export interface PatientCategoryRow {
  category: string;
  label: string;
}

/**
 * Story 5.2 T7.2 — composes the magic-link share URL.
 *
 * Shape: `${WEB_APP_URL}/m/${shareTokenId}.${tokenHmac}`. The `/m/`
 * doctor-side route is owned by Epic 6; Story 5.2 only generates the
 * URL the share-sheet hands to whichever app the patient picks.
 *
 * `WEB_APP_URL` is rejected at boot in non-development/test envs to
 * prevent a missing var from silently emitting `undefined/...` links.
 */
export function buildShareUrl(shareTokenId: string, tokenHmac: string): string {
  const base = getWebAppUrl();
  return `${base}/m/${shareTokenId}.${tokenHmac}`;
}

let warnedAboutDevWebAppUrl = false;
const DEV_FALLBACK_WEB_APP_URL = "http://localhost:3000";

function getWebAppUrl(): string {
  const fromEnv = process.env.WEB_APP_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") {
    throw new Error(
      "WEB_APP_URL is required outside development/test (Story 5.2)",
    );
  }
  if (!warnedAboutDevWebAppUrl) {
    warnedAboutDevWebAppUrl = true;
    console.warn(
      "[sharing] WEB_APP_URL is empty — using dev-only fallback http://localhost:3000",
    );
  }
  return DEV_FALLBACK_WEB_APP_URL;
}

/**
 * Story 5.2 review-fix Patch #8 — eager boot-gate for sharing env
 * vars. Invoked at module-load (below) so a missing `WEB_APP_URL` /
 * `SHARE_TOKEN_HMAC_SECRET` in staging/preview/prod fails fast at
 * import time rather than on the first share request. Mirrors the
 * NFR-S6 dev-vs-prod gating posture.
 */
export function validateSharingEnv(): void {
  getHmacSecret();
  getWebAppUrl();
}

// Module-load eager check. In dev/test this exercises (and stores) the
// dev fallback warning at most once; in staging/preview/prod it throws
// if either env var is missing. If a downstream caller needs to opt out
// for a unit test, they should set NODE_ENV=test before importing.
validateSharingEnv();

export async function getDistinctCategoriesForPatient(
  database: AuditDb,
  patientId: string,
): Promise<PatientCategoryRow[]> {
  const rows = await database
    .select({
      category: sql<string>`coalesce(${Observations.loincCode}, ${Observations.biomarkerName})`,
      label: sql<string>`min(${Observations.biomarkerName})`,
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
    .filter(
      (r): r is { category: string; label: string } =>
        typeof r.category === "string" &&
        r.category.length > 0 &&
        typeof r.label === "string" &&
        r.label.length > 0,
    )
    .map((r) => ({ category: r.category, label: r.label }));
}

// ---------------------------------------------------------------------------
// Story 5.3 — Access Log helpers (pure; unit-tested without a DB).
// ---------------------------------------------------------------------------

/**
 * AC12 — `{iso-timestamp}|{audit_log.id uuid}` cursor encoder. Pure
 * string concat so the format is stable and inspectable in
 * round-trip tests.
 */
export function encodeAccessLogCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

/**
 * AC12 — counterpart decoder. Returns `null` for any input that
 * doesn't match the `iso|uuid` shape so a malicious client sending a
 * forged cursor falls through to "start from newest" rather than
 * blowing up. The strict parse guards against:
 *   - missing pipe (legacy ISO-only cursors)
 *   - empty parts
 *   - timestamps Date parses as NaN
 */
export function decodeAccessLogCursor(
  cursor: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const pipeIdx = cursor.indexOf("|");
  if (pipeIdx <= 0 || pipeIdx === cursor.length - 1) return null;
  const tsRaw = cursor.slice(0, pipeIdx);
  const idRaw = cursor.slice(pipeIdx + 1);
  const ts = new Date(tsRaw);
  if (Number.isNaN(ts.getTime())) return null;
  // RFC 4122 UUID shape — same loose regex Zod's `z.uuid()` accepts.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idRaw,
    )
  ) {
    return null;
  }
  return { createdAt: ts, id: idRaw };
}

/**
 * AC4 — compose `tokenStatus` from `expires_at` + `revoked_at` +
 * `now()`. Returns `null` when the audit row has no joined
 * share_token (e.g. `pending_invite.created`).
 *
 * Precedence (mirrors Story 5.2 / 5.4 RLS semantics):
 *   1. `revoked_at IS NOT NULL` → "revogado"
 *   2. `expires_at IS NULL`     → "sem prazo"
 *   3. `expires_at <= now`      → "expirado"
 *   4. otherwise                → "ativo"
 */
export function computeAccessLogTokenStatus(
  expiresAt: Date | null,
  revokedAt: Date | null,
  now: Date = new Date(),
): ServerAccessLogTokenStatus | null {
  if (revokedAt) return "revogado";
  if (expiresAt === null) return "sem prazo";
  if (expiresAt.getTime() <= now.getTime()) return "expirado";
  return "ativo";
}

// ---------------------------------------------------------------------------
// Story 6.1 — Pre-auth landing helpers (doctor-side)
// ---------------------------------------------------------------------------

/**
 * Story 6.1 T2.1 — Constant-time compare of two persisted HMAC
 * strings. The pre-auth resolver receives one HMAC from the URL
 * (`tokenHmac` segment after the `.`) and looks up the other from
 * `share_tokens.token_hmac`. Both are already signatures; there is
 * no `raw` value on the doctor side, so `verifyShareToken(raw, sig)`
 * is the wrong primitive — use this instead.
 *
 * Returns `false` on differing lengths (`timingSafeEqual` throws on
 * unequal-length buffers; we guard explicitly). Returns `false` on
 * any difference. Never throws on string content.
 */
export function constantTimeEqualHmac(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Story 6.1 T2.2 — Derive a patient-facing first name from an email
 * local-part. Lower-cases the local-part, splits on `[._-]+`, and
 * Title-Cases each non-empty word. Returns `null` for inputs that
 * cannot be sensibly humanized (no local-part / only separators).
 *
 * Examples:
 *   - `francis.araujo@x.com` → `"Francis Araujo"`
 *   - `f@x.com`              → `"F"`
 *   - `@x.com`               → `null`
 *   - `""`                   → `null`
 *   - `f__o-bar.baz@x`       → `"F O Bar Baz"`
 *
 * Pure — does not throw, does not call any service.
 */
export function humanizeEmailLocal(email: string): string | null {
  if (typeof email !== "string" || email.length === 0) return null;
  const atIdx = email.indexOf("@");
  const local = atIdx === -1 ? email : email.slice(0, atIdx);
  if (local.length === 0) return null;
  const parts = local
    .toLowerCase()
    .split(/[._-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  if (parts.length === 0) return null;
  return parts.join(" ");
}

/**
 * Story 6.1 T2.3 — Resolve the patient's first name for the pre-auth
 * landing UI. Uses Supabase Auth Admin API to read the user's email,
 * then `humanizeEmailLocal` to produce a displayable string. No
 * `users.first_name` column exists yet (Story 6.4 may add one); this
 * derivation is the MVP path.
 *
 * MUST NOT THROW. Any failure — admin call rejects, returns no user,
 * empty email — degrades to `null` so the UI renders the "Alguém"
 * fallback rather than 500-ing the landing page. The catch is narrow:
 * `TypeError` / `ReferenceError` / `SyntaxError` still propagate
 * (CLAUDE.md narrow-catch discipline).
 */
// ---------------------------------------------------------------------------
// Story 6.4 — Patient-invite (doctor → patient) token helpers
// ---------------------------------------------------------------------------

/**
 * Story 6.4 AC8 — domain-prefix isolation between share-token and
 * patient-invite HMACs. Both surfaces reuse `SHARE_TOKEN_HMAC_SECRET`
 * (NFR-S6 — one secret, one boot-gate); the prefix ensures a signature
 * minted for a `share_tokens.id` UUID can never be reused as a
 * `patient_invites.id` signature even if the raw UUIDs collided.
 *
 * **Load-bearing security guarantee.** Any future refactor that drops
 * the prefix is a vulnerability. CLAUDE.md "Patient invite discipline"
 * documents the invariant; the regression test
 * `signShareToken(raw) !== signPatientInviteToken(raw)` locks it in.
 */
// **Exported (R1-L2)** so regression tests can assert against the
// literal value directly. The constant itself MUST NOT change — any
// future refactor that drops the prefix is a vulnerability.
export const PATIENT_INVITE_HMAC_DOMAIN_PREFIX = "patient_invite:";

/**
 * Generates a fresh opaque patient-invite token. Returns the raw token
 * (embedded once in the magic URL) and the HMAC signature (lookup +
 * authorization key). Note: no `tokenHash` — the doctor-side lookup
 * path is by `patient_invites.id` directly (no opaque-raw lookup), so
 * there's no parity column needed.
 */
export function generatePatientInviteToken(): {
  raw: string;
  tokenHmac: string;
} {
  const raw = randomBytes(32).toString("base64url");
  const tokenHmac = signPatientInviteToken(raw);
  return { raw, tokenHmac };
}

export function signPatientInviteToken(raw: string): string {
  return createHmac("sha256", getHmacSecret())
    .update(PATIENT_INVITE_HMAC_DOMAIN_PREFIX + raw)
    .digest("base64url");
}

/**
 * Constant-time HMAC verification for patient-invite tokens. Pairs with
 * `signPatientInviteToken` — applies the SAME domain prefix internally
 * so callers pass the raw, not the prefixed value.
 *
 * **R1-L3 note — test-only contract.** No production code path holds
 * the raw token: the doctor distributes the URL containing
 * `<inviteId>.<tokenHmac>`, and the resolver-side check uses
 * `constantTimeEqualHmac(persistedHmac, urlHmac)` (the URL itself
 * carries the signature, not the raw). This helper exists so the
 * regression tests in `patient-invite-helpers.test.ts` can lock the
 * sign/verify round-trip + cross-surface replay invariant without
 * reaching into the resolver internals. Do not remove — the tests
 * are the reason it ships.
 */
export function verifyPatientInviteToken(
  raw: string,
  signature: string,
): boolean {
  const expected = signPatientInviteToken(raw);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Story 6.4 AC5 — composes the `${WEB_APP_URL}/convite/${inviteId}.${tokenHmac}`
 * URL the doctor distributes to the patient. Mirrors `buildShareUrl`;
 * reuses the `WEB_APP_URL` boot-gate.
 */
export function buildPatientInviteUrl(
  inviteId: string,
  tokenHmac: string,
): string {
  const base = getWebAppUrl();
  return `${base}/convite/${inviteId}.${tokenHmac}`;
}

export async function resolvePatientFirstName(
  supabaseAdmin: {
    auth: {
      admin: {
        getUserById: (id: string) => Promise<{
          data: { user: { email?: string | null } | null };
          error: { message: string } | null;
        }>;
      };
    };
  },
  patientId: string,
): Promise<string | null> {
  let result: {
    data: { user: { email?: string | null } | null };
    error: { message: string } | null;
  };
  try {
    result = await supabaseAdmin.auth.admin.getUserById(patientId);
  } catch (err) {
    // Programmer errors propagate; SDK/network failures fall through
    // to a null return (the UI's "Alguém" fallback handles it).
    if (
      err instanceof TypeError ||
      err instanceof ReferenceError ||
      err instanceof SyntaxError
    ) {
      throw err;
    }
    return null;
  }
  if (result.error) return null;
  const email = result.data.user?.email;
  if (typeof email !== "string" || email.length === 0) return null;
  return humanizeEmailLocal(email);
}

/**
 * AC4 — `tokenStatus` for a row that has no joined share_token
 * (e.g. `pending_invite.created` with `resource_type = 'pending_invite'`).
 * Wraps `computeAccessLogTokenStatus` plus the no-token sentinel.
 */
export function resolveAccessLogTokenStatus(args: {
  hasJoinedToken: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  now?: Date;
}): ServerAccessLogTokenStatus | null {
  if (!args.hasJoinedToken) return null;
  return computeAccessLogTokenStatus(args.expiresAt, args.revokedAt, args.now);
}
