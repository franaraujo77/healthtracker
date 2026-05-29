/**
 * RLS adversarial test matrix for the `users` table (Story 1.1).
 * Requires: supabase start (Supabase CLI). Do NOT include in pnpm test.
 *
 * Verifies the token-principal model (AR5): a patient sees and writes only
 * the row whose id matches app.current_patient_id, and unauthenticated
 * callers see nothing.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import {
  anonClient,
  seedUser as baseSeedUser,
  cleanupSeededUsers,
} from "./setup";

const seededIds: string[] = [];

async function seedUser(id?: string): Promise<string> {
  const rowId = id ?? crypto.randomUUID();
  await baseSeedUser(rowId);
  seededIds.push(rowId);
  return rowId;
}

afterEach(async () => {
  if (seededIds.length === 0) return;
  await cleanupSeededUsers(seededIds);
  seededIds.length = 0;
});

describe("users table RLS isolation", () => {
  it("correctPatient sees exactly their own row", async () => {
    const patientId = await seedUser();
    // Seed a second, unrelated row so a leak would be visible.
    await seedUser();

    const run = asIdentity("correctPatient", { patientId });
    const rows = await run((tx) => tx<{ id: string }[]>`SELECT id FROM users`);

    expect(rows).toEqual([{ id: patientId }]);
  });

  it("wrongPatient sees zero rows even when other rows exist", async () => {
    await seedUser();
    const otherPatientId = crypto.randomUUID();

    const run = asIdentity("wrongPatient", {
      patientId: crypto.randomUUID(),
      otherPatientId,
    });
    const rows = await run((tx) => tx<{ id: string }[]>`SELECT id FROM users`);

    expect(rows).toEqual([]);
  });

  it("WITH CHECK blocks inserting a row for another id (Postgres 42501)", async () => {
    const patientId = crypto.randomUUID();
    const foreignId = crypto.randomUUID();

    const run = asIdentity("correctPatient", { patientId });

    // Assert on the Postgres RLS error code so a different failure mode
    // (e.g. missing GRANT, unique constraint) doesn't pass the test.
    await expect(
      run((tx) => tx`INSERT INTO users (id) VALUES (${foreignId})`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("unauthenticated PostgREST request gets zero rows or an explicit error", async () => {
    await seedUser();

    const { data, error } = await anonClient.from("users").select("id");

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });
});
