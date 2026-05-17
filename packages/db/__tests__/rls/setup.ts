// Requires: supabase start (Supabase CLI). Do NOT include in pnpm test.
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const supabaseUrl = process.env.SUPABASE_URL ?? "http://localhost:54321";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Run: supabase start, then set env vars.",
  );
}

// Service role client — bypasses RLS for seeding test data.
export const serviceClient = createClient(supabaseUrl, serviceRoleKey);

// Anon client — subject to RLS, used to verify unauthenticated access is blocked.
export const anonClient = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY ?? "",
);

// Seeds a post row using the service role (bypasses RLS) and returns its id.
export async function seedPost(id?: string): Promise<string> {
  const rowId = id ?? crypto.randomUUID();
  const { error } = await serviceClient
    .from("post")
    .insert({ title: "rls-test", content: "rls test content", id: rowId });
  if (error) throw new Error(`seed failed: ${error.message}`);
  return rowId;
}

// Queries the post table within a transaction that sets app.current_patient_id
// and app.current_user_role, mirroring what protectedProcedure does in production.
// Uses a raw postgres connection so SET LOCAL is scoped correctly.
export async function queryPostsAsPatient(
  patientId: string,
): Promise<{ id: string }[]> {
  const dbUrl = process.env.DATABASE_URL?.replace(":6543", ":5432");
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const sql = postgres(dbUrl, { max: 1 });
  try {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL app.current_patient_id = ${patientId}`;
      await tx`SET LOCAL app.current_user_role = ${"patient"}`;
      return tx<{ id: string }[]>`SELECT id FROM post`;
    });
    return rows;
  } finally {
    await sql.end();
  }
}

// Deletes all seeded test posts between tests.
export async function cleanupPosts(): Promise<void> {
  await serviceClient.from("post").delete().like("content", "rls test%");
}
