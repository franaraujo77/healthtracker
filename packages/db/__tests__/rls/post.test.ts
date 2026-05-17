// Requires: supabase start (Supabase CLI). Do NOT include in pnpm test.
import { afterEach, describe, expect, it } from "vitest";

import {
  anonClient,
  cleanupPosts,
  queryPostsAsPatient,
  seedPost,
} from "./setup";

afterEach(cleanupPosts);

describe("post table RLS isolation", () => {
  it("correct_patient reads own rows", async () => {
    const patientId = crypto.randomUUID();
    const postId = await seedPost();

    // Placeholder policy: any non-null app.current_patient_id grants access.
    const rows = await queryPostsAsPatient(patientId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.id === postId)).toBe(true);
  });

  // Pending: placeholder policy (`current_patient_id IS NOT NULL`) does not enforce
  // per-row isolation — any authenticated session sees all rows. Assertion tightens
  // to `expect(rows.length).toBe(0)` once the author_id-based policy ships in story 1.x.
  it.todo(
    "wrong_patient gets zero rows (requires author_id policy — story 1.x)",
  );

  it("unauthenticated client gets zero rows from PostgREST", async () => {
    await seedPost();

    // PostgREST blocks anon reads once RLS is enabled and no anon SELECT policy exists.
    const { data, error } = await anonClient.from("post").select("id");

    // Expect either an error (RLS denial) or zero rows — not both null/empty simultaneously.
    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data.length).toBe(0);
    }
  });
});
