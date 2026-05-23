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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

const DB_PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

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
  return { url, sql, container };
}
