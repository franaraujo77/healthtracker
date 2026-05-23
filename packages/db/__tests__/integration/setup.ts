/**
 * Testcontainer integration-test scaffold (Epic 2 retro).
 *
 * Boots an ephemeral Postgres 16 container per suite, applies the
 * Drizzle schema via `drizzle-kit push --force`, and exposes a
 * `postgres` client + connection URL to tests.
 *
 * **Bootstrap requirements:**
 *   - Docker daemon running locally / in CI.
 *   - `pnpm install` has been run (pulls `@testcontainers/postgresql`).
 *
 * **Why this exists** — Epic 2 retro collapsed five "mock SQL is
 * lying to us" F-items (F103, F112, F128, F134, F140, F166) into a
 * single recommendation: stand up a real Postgres in tests for the
 * cases mocks cannot reach (partial-index WHERE clauses, JSONB
 * operators, ON CONFLICT semantics, RLS policy assertions that don't
 * depend on Supabase's policy hooks).
 *
 * Use this for the *integration* seam. Continue using the mocked
 * `sql` template-tag for fast unit tests of pure logic; only reach
 * for testcontainers when the SQL itself is the thing under test.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

const DB_PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const POLICIES_DIR = join(DB_PACKAGE_ROOT, "policies");

export interface IntegrationDb {
  url: string;
  sql: postgres.Sql;
  container: StartedPostgreSqlContainer;
}

/**
 * Starts a Postgres container, pushes the current Drizzle schema,
 * and returns a `postgres` client bound to it. Caller owns the
 * teardown (`await db.sql.end(); await db.container.stop();`) —
 * vitest's `afterAll` is the typical home.
 */
export async function startIntegrationDb(): Promise<IntegrationDb> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("healthtracker_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const url = container.getConnectionUri();

  // drizzle-kit push uses DATABASE_URL via the project's drizzle.config.ts.
  // `--force` skips the interactive truncation prompt (the container DB is
  // empty anyway). Run from the @healthtracker/db package root so the
  // config + schema resolve correctly.
  const push = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
    cwd: DB_PACKAGE_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    await container.stop();
    throw new Error(
      `drizzle-kit push failed (exit ${push.status}):\n${push.stdout}\n${push.stderr}`,
    );
  }

  const sql = postgres(url, { max: 4 });

  // Apply RLS / Storage policy files (`custom_*.sql`) in the same C-locale
  // glob order CI uses (.github/workflows/ci.yml "Apply custom RLS +
  // Storage policies" step). Without this, the testcontainer lacks any
  // RLS policy / trigger that lives only in a policy file (e.g. the
  // `consent_grants_revoke_only_revoked_at` trigger introduced by Story
  // 1.4 and consolidated into `custom_rls_consent_grants_zz_revoke.sql`
  // by Story 3.5 round-3 review fix #3).
  //
  // `storage.*` policies are SKIPPED — the bare postgres:16-alpine
  // container has no `storage` schema (it's Supabase-managed). Tests that
  // need storage policy assertions belong in the `test:rls` suite which
  // runs against `supabase start`.
  const policyFiles = readdirSync(POLICIES_DIR)
    .filter((f) => f.startsWith("custom_rls_") && f.endsWith(".sql"))
    .sort(); // C-locale (codepoint) sort — matches Ubuntu/CI default
  for (const file of policyFiles) {
    const sqlText = readFileSync(join(POLICIES_DIR, file), "utf8");
    try {
      await sql.unsafe(sqlText);
    } catch (err) {
      await sql.end();
      await container.stop();
      throw new Error(
        `policy apply failed for ${file}: ${(err as Error).message}`,
      );
    }
  }

  return { url, sql, container };
}
