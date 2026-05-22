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
  | "revokedToken";

export interface IdentityOptions {
  patientId: string;
  otherPatientId?: string;
  doctorId?: string;
  otherDoctorId?: string;
  shareToken?: string;
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
  }
}
