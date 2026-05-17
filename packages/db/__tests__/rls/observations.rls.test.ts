/**
 * RLS adversarial test matrix for health_observations table.
 * Requires: supabase start (Supabase CLI). Do NOT include in pnpm test.
 *
 * Each identity type required by architecture AR18 is represented.
 * Stubs pass trivially until RLS policies for health_observations are
 * established in later stories (1.x+).
 */
import { describe, it } from "vitest";

describe("health_observations table RLS — 6 identity types (AR18)", () => {
  it.todo("correctPatient: reads own rows and can write own rows");

  it.todo("wrongPatient: gets zero rows (row-level isolation by patient_id)");

  it.todo(
    "doctorWithAccess: reads rows scoped to active share token for patient",
  );

  it.todo("doctorWithoutAccess: gets zero rows (no share grant)");

  it.todo(
    "expiredToken: auth rejected or zero rows returned (token exp < now())",
  );

  it.todo("revokedToken: gets zero rows (share token revoked)");
});
