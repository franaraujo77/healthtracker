/**
 * RLS adversarial test identity helper.
 * Wraps a raw Postgres connection to issue SET LOCAL claims matching each of
 * the 6 identity types required by architecture AR18.
 *
 * Requires: supabase start (Supabase CLI). Do NOT include in pnpm test.
 */
import postgres from "postgres";

export type IdentityType =
  | "correctPatient"
  | "wrongPatient"
  | "doctorWithAccess"
  | "doctorWithoutAccess"
  | "expiredToken"
  | "revokedToken"
  // Story 5.1 — doctor principal under the `app.current_share_token_id`
  // GUC. Pass `shareTokenId` to bind. These three identities are
  // adversarial RLS surfaces used by `share_*.rls.test.ts`.
  | "doctorWithActiveToken"
  | "doctorWithExpiredToken"
  | "doctorWithRevokedToken"
  // Story 5.2 — doctor principal bound to a token whose `expires_at`
  // is NULL (the "Sem prazo" branch). MUST SELECT successfully under
  // the updated `(IS NULL OR > now())` RLS predicate.
  | "doctorWithNoExpiryToken"
  // Story 8.1 — operator principal: binds `app.current_user_role =
  // 'operator'` (and optionally `app.current_operator_id`). No
  // patient/doctor GUC, so patient/doctor RLS predicates can't match —
  // the operator only sees `extraction_review_queue` rows whose policy
  // keys on the role GUC, and zero rows of `users` / `uploads`.
  | "operator";

export interface IdentityOptions {
  patientId: string;
  otherPatientId?: string;
  doctorId?: string;
  otherDoctorId?: string;
  shareToken?: string;
  /** Story 5.1 — doctor-principal GUC value (`app.current_share_token_id`). */
  shareTokenId?: string;
  /**
   * Story 6.3 — doctor's Supabase user id, bound to
   * `app.current_doctor_user_id` by `doctorProcedure`. Used by the
   * `professionals` RLS policy (activation is `auth.uid()`-scoped).
   */
  doctorUserId?: string;
  /** Story 8.1 — operator's Supabase uid, bound to `app.current_operator_id`. */
  operatorId?: string;
}

function getDbUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL not set");
  // Parse the URL so only the connection port is rewritten — a bare string
  // replace of ":6543" could also corrupt a password or host that contains it.
  const url = new URL(raw);
  if (url.port === "6543") url.port = "5432";
  return url.toString();
}

/**
 * Returns a function that executes `fn` inside a transaction with SET LOCAL
 * claims set for the given identity type.
 *
 * Usage:
 *   const run = asIdentity("correctPatient", { patientId });
 *   const rows = await run(tx => tx`SELECT id FROM health_observations`);
 */
export function asIdentity(identity: IdentityType, options: IdentityOptions) {
  return async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => {
    const sql = postgres(getDbUrl(), { max: 1 });
    try {
      const result = await sql.begin(async (tx) => {
        await applyClaims(tx, identity, options);
        return fn(tx);
      });
      return result as T;
    } finally {
      await sql.end();
    }
  };
}

/**
 * Sets a transaction-scoped GUC via `set_config(name, value, is_local=true)`.
 *
 * PostgreSQL rejects parameter placeholders in `SET` commands; postgres.js
 * (and Drizzle) parameterize template-literal interpolations by default,
 * so `tx\`SET LOCAL app.x = ${value}\`` issues `SET LOCAL app.x = $1`
 * which Postgres errors with `syntax error at or near "$1"`. The
 * `set_config()` function form accepts parameters and `is_local=true`
 * makes it equivalent to `SET LOCAL`. Caught at Epic 1 PR open in CI
 * — see `packages/api/src/trpc.ts` for the same fix on the production
 * `protectedProcedure` / `doctorProcedure` middleware.
 */
async function setLocal(
  tx: postgres.TransactionSql,
  name: string,
  value: string,
): Promise<void> {
  await tx`SELECT set_config(${name}, ${value}, true)`;
}

/**
 * Drops to the Supabase `authenticated` role for the rest of the
 * transaction. PostgreSQL bypasses RLS for table owners and superusers
 * — `DATABASE_URL` from `supabase start` is `postgres://postgres:…`,
 * the superuser, which means policies don't fire and every test
 * assertion that depends on RLS enforcement is meaningless. Switching
 * to `authenticated` (the role Supabase's PostgREST + RLS contract is
 * built around) restores enforcement. The `postgres` role is a member
 * of `authenticated` so `SET ROLE` succeeds without GRANT.
 *
 * Caught at Epic 1 PR open in CI — Story 0.4's harness was wired with
 * `it.todo()` stubs (per Epic 0 retro), so the wrong-role connection
 * was latent until Story 1.1+ ran real RLS assertions.
 *
 * No template-literal interpolation here, so postgres.js doesn't
 * parameterize — `SET LOCAL ROLE` issues the literal role name and
 * Postgres accepts it.
 */
async function dropToAuthenticatedRole(
  tx: postgres.TransactionSql,
): Promise<void> {
  await tx`SET LOCAL ROLE authenticated`;
}

async function applyClaims(
  tx: postgres.TransactionSql,
  identity: IdentityType,
  opts: IdentityOptions,
): Promise<void> {
  // Drop to `authenticated` before applying any GUC so the role-switch
  // affects every subsequent statement in the transaction (including
  // the test's own SELECT / INSERT). All identity types — including
  // `wrongPatient` and `revokedToken` — flow through this path.
  await dropToAuthenticatedRole(tx);

  switch (identity) {
    case "correctPatient":
      await setLocal(tx, "app.current_patient_id", opts.patientId);
      await setLocal(tx, "app.current_user_role", "patient");
      break;

    case "wrongPatient":
      await setLocal(
        tx,
        "app.current_patient_id",
        opts.otherPatientId ?? crypto.randomUUID(),
      );
      await setLocal(tx, "app.current_user_role", "patient");
      break;

    case "doctorWithAccess":
      await setLocal(tx, "app.current_patient_id", opts.patientId);
      await setLocal(tx, "app.current_user_role", "doctor");
      await setLocal(
        tx,
        "app.share_token",
        opts.shareToken ?? crypto.randomUUID(),
      );
      break;

    case "doctorWithoutAccess":
      await setLocal(tx, "app.current_patient_id", opts.patientId);
      await setLocal(tx, "app.current_user_role", "doctor");
      // No share token set — doctor has no access grant
      break;

    case "expiredToken":
      // Simulate an expired JWT by setting an invalid/expired token marker.
      // Actual enforcement happens via RLS policy checking token expiry.
      await setLocal(tx, "app.current_patient_id", opts.patientId);
      await setLocal(tx, "app.current_user_role", "patient");
      await setLocal(tx, "app.token_expires_at", "1970-01-01T00:00:00Z");
      break;

    case "revokedToken":
      await setLocal(tx, "app.current_patient_id", opts.patientId);
      await setLocal(tx, "app.current_user_role", "doctor");
      await setLocal(
        tx,
        "app.share_token",
        opts.shareToken ?? "revoked-share-token",
      );
      await setLocal(tx, "app.token_revoked", "true");
      break;

    // Story 5.1 — share-token-principal identities. Bind via
    // `app.current_share_token_id` (mirrors `app.current_patient_id`).
    // The `expires_at` / `revoked_at` predicates are enforced inside
    // the RLS policy SQL — caller seeds the appropriate row state.
    case "doctorWithActiveToken":
    case "doctorWithExpiredToken":
    case "doctorWithRevokedToken":
    case "doctorWithNoExpiryToken":
      await setLocal(tx, "app.current_user_role", "doctor");
      if (opts.shareTokenId) {
        await setLocal(tx, "app.current_share_token_id", opts.shareTokenId);
      }
      // Story 6.3 — bind the doctor's Supabase uid so RLS policies
      // gated on `app.current_doctor_user_id` (e.g. `professionals`)
      // can be exercised in the matrix.
      if (opts.doctorUserId) {
        await setLocal(tx, "app.current_doctor_user_id", opts.doctorUserId);
      }
      break;

    // Story 8.1 — operator principal. Only the role GUC is bound (the
    // operator `extraction_review_queue` SELECT policy keys on it);
    // `app.current_operator_id` is bound for completeness / Story 8.2.
    // NO patient/doctor GUC — that is exactly why the operator gets
    // zero rows of `users`/`uploads` (denial-by-RLS-absence).
    case "operator":
      await setLocal(tx, "app.current_user_role", "operator");
      await setLocal(
        tx,
        "app.current_operator_id",
        opts.operatorId ?? crypto.randomUUID(),
      );
      break;
  }
}
