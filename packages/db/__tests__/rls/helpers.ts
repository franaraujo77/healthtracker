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

async function applyClaims(
  tx: postgres.TransactionSql,
  identity: IdentityType,
  opts: IdentityOptions,
): Promise<void> {
  switch (identity) {
    case "correctPatient":
      await tx`SET LOCAL app.current_patient_id = ${opts.patientId}`;
      await tx`SET LOCAL app.current_user_role = ${"patient"}`;
      break;

    case "wrongPatient":
      await tx`SET LOCAL app.current_patient_id = ${opts.otherPatientId ?? crypto.randomUUID()}`;
      await tx`SET LOCAL app.current_user_role = ${"patient"}`;
      break;

    case "doctorWithAccess":
      await tx`SET LOCAL app.current_patient_id = ${opts.patientId}`;
      await tx`SET LOCAL app.current_user_role = ${"doctor"}`;
      await tx`SET LOCAL app.share_token = ${opts.shareToken ?? crypto.randomUUID()}`;
      break;

    case "doctorWithoutAccess":
      await tx`SET LOCAL app.current_patient_id = ${opts.patientId}`;
      await tx`SET LOCAL app.current_user_role = ${"doctor"}`;
      // No share token set — doctor has no access grant
      break;

    case "expiredToken":
      // Simulate an expired JWT by setting an invalid/expired token marker.
      // Actual enforcement happens via RLS policy checking token expiry.
      await tx`SET LOCAL app.current_patient_id = ${opts.patientId}`;
      await tx`SET LOCAL app.current_user_role = ${"patient"}`;
      await tx`SET LOCAL app.token_expires_at = ${"1970-01-01T00:00:00Z"}`;
      break;

    case "revokedToken":
      await tx`SET LOCAL app.current_patient_id = ${opts.patientId}`;
      await tx`SET LOCAL app.current_user_role = ${"doctor"}`;
      await tx`SET LOCAL app.share_token = ${opts.shareToken ?? "revoked-share-token"}`;
      await tx`SET LOCAL app.token_revoked = ${"true"}`;
      break;
  }
}
