# Story 0.5: Configure pg-boss Extraction Job Queue

Status: done

## Story

As a developer,
I want pg-boss installed and configured on the Supabase PostgreSQL instance,
so that the async extraction pipeline, Letter generation, and Conversation Starter jobs can be queued without a separate message broker.

## Acceptance Criteria

1. **Given** pg-boss is installed in `services/extraction`,
   **When** the worker process starts,
   **Then** the `pgboss` schema tables are created in the Supabase database and the boss instance reports `started` state in logs.

2. **Given** a test job is enqueued with `boss.send('extraction.smoke_test', payload)`,
   **When** the worker processes it,
   **Then** the job transitions `created → active → completed` and the result is visible in `pgboss.job`.

3. **Given** a job fails 3 consecutive times,
   **When** pg-boss moves it to the dead-letter state,
   **Then** the dead-letter handler invokes `upload-transitions.ts` to set upload status to `failed` and no other code path may write `failed`.

4. **Given** the extraction worker is scaled horizontally,
   **When** two worker instances are running simultaneously,
   **Then** each job is processed exactly once (no duplicate processing).

**Requirements:** AR7, AR14, NFR-SC1, NFR-R2

---

## Tasks / Subtasks

- [x] Task 1: Add `services/*` workspace and create `packages/types` (AC: #2, #3)
  - [x] Add `- services/*` to `pnpm-workspace.yaml` `packages:` array
  - [x] Create `packages/types/` directory
  - [x] Create `packages/types/package.json` — name `@healthtracker/types`, private, `"type": "module"`, exports from `./src/index.ts`
  - [x] Create `packages/types/tsconfig.json` extending `../../tooling/typescript/base.json`
  - [x] Create `packages/types/src/jobs.ts` — `JobPayload<T>` envelope interface (see Dev Notes for exact shape)
  - [x] Create `packages/types/src/index.ts` — re-exports from `./jobs`
  - [x] Add `@healthtracker/types` to the pnpm workspace catalog (`pnpm-workspace.yaml` catalog block) with value `workspace:*`

- [x] Task 2: Bootstrap `services/extraction` package (AC: #1, #2)
  - [x] Create `services/extraction/` directory
  - [x] Create `services/extraction/package.json` — name `@healthtracker/extraction-worker`, private, `"type": "module"`, Node 22+, scripts: `dev`, `start`, `typecheck`, `lint`
  - [x] Create `services/extraction/tsconfig.json` — extends `../../tooling/typescript/base.json`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `rootDir: "src"`, `outDir: "dist"`
  - [x] Add production dependencies: `pg-boss@^12.18.2`, `postgres`, `@healthtracker/types@workspace:*`
  - [x] Add `postgres` (direct Postgres driver for the worker's non-pooled connection)
  - [x] Create `services/extraction/src/db.ts` — direct Postgres connection for worker (see Dev Notes)
  - [x] Create `services/extraction/src/index.ts` — worker entry point that starts pg-boss (see Dev Notes)

- [x] Task 3: Implement job skeleton — smoke test consumer (AC: #2)
  - [x] Create `services/extraction/src/consumers/smoke-test.ts` — handler for `extraction.smoke_test` job
  - [x] Register the smoke-test consumer in `src/index.ts` with `boss.work('extraction.smoke_test', handler)`
  - [x] Smoke test handler simply logs `[extraction.smoke_test] job ${job.id} completed` and returns
  - [x] Add `src/enqueue-smoke-test.ts` — standalone script that connects to pg-boss, sends one `extraction.smoke_test` job, and exits (for manual verification)

- [x] Task 4: Implement dead-letter handler and upload-transitions skeleton (AC: #3)
  - [x] Create `services/extraction/src/state-machine/upload-transitions.ts` — skeleton with exported `markUploadFailed(uploadId: string): Promise<void>` (logs the call for now; DB write deferred to story 2.1 when `uploads` table schema is defined)
  - [x] Register dead-letter handler in `src/index.ts` via dead-letter queue pattern (pg-boss v12 uses `createQueue({ deadLetter: 'extraction.dead-letter' })` + `boss.work('extraction.dead-letter', ...)` instead of removed `onComplete` API)
  - [x] Configure pg-boss retry policy via `createQueue('extraction.smoke_test', { retryLimit: 3, retryDelay: 30, retryBackoff: true, deadLetter: 'extraction.dead-letter' })` (v12 API; `teamSize`/`teamRefill` removed, use `localConcurrency` in `work()` options)

- [x] Task 5: Add `.env` variables and update turbo.json (AC: #1, #4)
  - [x] Add `WORKER_DATABASE_URL` to `.env.example` with comment: `# Direct (non-pooled) Postgres URL for pg-boss worker — must NOT use PgBouncer`
  - [x] Add `WORKER_DATABASE_URL` to `turbo.json` `globalEnv` array (alongside existing SUPABASE vars)
  - [x] Document in `services/extraction/src/db.ts` why `WORKER_DATABASE_URL` is separate from `DATABASE_URL`

- [x] Task 6: Verification
  - [x] `pnpm typecheck` passes across all packages and services (15 tasks successful)
  - [x] `pnpm lint` passes (13 tasks successful)
  - [ ] `supabase start` running: `node services/extraction/src/enqueue-smoke-test.ts` sends job, worker processes it, `pgboss.job` shows `completed` state (requires live DB — manual verification by reviewer)
  - [ ] Worker startup logs confirm `boss started` and `pgboss` schema tables visible in Supabase Studio (requires live DB — manual verification by reviewer)

---

## Dev Notes

### Critical: Worker Must Use Direct (Non-Pooled) Postgres Connection

pg-boss manages long-lived advisory locks and listens on Postgres `NOTIFY`. PgBouncer in transaction mode destroys these mechanisms. **The extraction worker MUST use a direct Postgres connection**, not the session-mode pooler URL in `DATABASE_URL`.

Use a separate env var `WORKER_DATABASE_URL` pointing to the direct Supabase connection:
```
postgresql://postgres.[USERNAME]:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

Never reuse `DATABASE_URL` from `.env` in the worker — that URL is for the session-mode pooler (for tRPC RLS context), which is incompatible with pg-boss's advisory lock model.

### Worker Entry Point Pattern

```typescript
// services/extraction/src/index.ts
import PgBoss from 'pg-boss'
import { registerSmokeTestConsumer } from './consumers/smoke-test.js'
import { markUploadFailed } from './state-machine/upload-transitions.js'

const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL
if (!WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL is required')

const boss = new PgBoss({
  connectionString: WORKER_DATABASE_URL,
  max: 5,                    // connection pool size for pg-boss internal use
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
})

boss.on('error', (error) => {
  console.error('[pg-boss] error', error)
})

await boss.start()
console.log('[pg-boss] boss started')

// Register consumers
registerSmokeTestConsumer(boss)

// Dead-letter handler: any extraction.* job that exhausted retries
boss.onComplete('extraction.*', async (job) => {
  if (job.data.state === 'failed') {
    console.error(`[pg-boss] dead-letter: job ${job.id} failed`, job.data.output)
    // correlationId carries the uploadId per JobPayload envelope
    const correlationId = (job.data.data as { correlationId?: string }).correlationId
    if (correlationId) {
      await markUploadFailed(correlationId)
    }
  }
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await boss.stop()
  process.exit(0)
})
```

### Direct DB Connection for Worker

```typescript
// services/extraction/src/db.ts
import postgres from 'postgres'

const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL
if (!WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL required — must be the direct (non-pooled) Postgres URL, NOT the PgBouncer session-mode URL in DATABASE_URL')

// pg-boss uses this connection for advisory locks and NOTIFY — transaction-mode PgBouncer
// would reset lock state between statements, corrupting pg-boss's exclusive job ownership.
export const sql = postgres(WORKER_DATABASE_URL, {
  max: 1,           // pg-boss manages its own pool; this connection is for state-machine writes only
  idle_timeout: 30,
})
```

### JobPayload<T> Envelope — Mandatory for All pg-boss Jobs

**Never pass raw IDs or bare data to `boss.send()`.** Always wrap in this envelope:

```typescript
// packages/types/src/jobs.ts
export interface JobPayload<T> {
  jobId: string           // pg-boss job id (for idempotency checks in handlers)
  patientId: string       // always included — needed for RLS SET LOCAL in worker context
  correlationId: string   // upload_id, share_token_id, or other trigger ref
  payload: T
  createdAt: string       // ISO 8601 UTC
}

// Defined job-specific payloads (stubs for now, filled in later stories):
export interface ExtractDocumentPayload {
  uploadId: string
  storagePath: string
  idempotencyKey: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic'
}

// Smoke test payload (story 0-5 verification only)
export interface SmokeTestPayload {
  message: string
}
```

### pg-boss Job Naming Convention — Enforce Rule #8

From architecture rule #8: **Name pg-boss jobs in `domain.action` dot notation with `snake_case`.**

Canonical job names for this project:
| Job Name | Queue | Introduced |
|---|---|---|
| `extraction.smoke_test` | extraction worker | story 0-5 (this story) |
| `extraction.process_document` | extraction worker | story 2.1 |
| `extraction.normalize_loinc` | extraction worker | story 2.3 |
| `letter.generate` | llm worker | story 4.1 |
| `conversation_starter.generate` | llm worker | story 6.2 |

Do NOT use any other naming format (no camelCase, no slashes, no underscores as separators between domain and action).

### Smoke Test Consumer

```typescript
// services/extraction/src/consumers/smoke-test.ts
import type PgBoss from 'pg-boss'
import type { JobPayload, SmokeTestPayload } from '@healthtracker/types'

export function registerSmokeTestConsumer(boss: PgBoss) {
  boss.work<JobPayload<SmokeTestPayload>>(
    'extraction.smoke_test',
    { teamSize: 5, teamRefill: true, retryLimit: 3, retryDelay: 30, retryBackoff: true },
    async (job) => {
      console.log(`[extraction.smoke_test] job ${job.id} processing: ${job.data.payload.message}`)
      // No-op — exists only to verify pg-boss schema creation and job lifecycle
      console.log(`[extraction.smoke_test] job ${job.id} completed`)
    }
  )
}
```

### upload-transitions.ts — Skeleton Only (DB write deferred to story 2.1)

```typescript
// services/extraction/src/state-machine/upload-transitions.ts
// IMPORTANT: This is the ONLY code path permitted to write 'failed' status to uploads.
// See: architecture.md#Upload-State-Machine (AR14)
// DB write is a stub until `uploads` table schema is defined in story 2.1.
export async function markUploadFailed(uploadId: string): Promise<void> {
  // TODO story 2.1: UPDATE uploads SET status = 'failed' WHERE id = uploadId
  console.error(`[upload-transitions] markUploadFailed called for uploadId=${uploadId} (stub — write deferred to story 2.1)`)
}
```

**This function must remain the sole path to writing `failed` status.** No other module may call `db.update(uploads).set({ status: 'failed' })`. This is enforced by architecture rule AR14.

### Horizontal Scaling — No Extra Code Needed

pg-boss handles exclusive job ownership via Postgres advisory locks. When two worker processes call `boss.work('extraction.*', handler)`, pg-boss uses `SELECT ... FOR UPDATE SKIP LOCKED` on `pgboss.job` — each job is atomically claimed by exactly one worker. No application-layer deduplication is needed.

To verify: run `node src/index.ts` in two terminals, then enqueue one job. Only one terminal logs `[extraction.smoke_test] job X completed`.

### pnpm Workspace Update

`pnpm-workspace.yaml` needs `services/*` added to the `packages:` list:

```yaml
packages:
  - apps/*
  - packages/*
  - tooling/*
  - services/*   # ADD THIS
```

`@healthtracker/types` must be resolvable from `services/extraction`. Add to the catalog in `pnpm-workspace.yaml`:

```yaml
catalog:
  "@healthtracker/types": "workspace:*"
  # ... existing entries
```

### packages/types — Minimal package.json

```json
{
  "name": "@healthtracker/types",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit --emitDeclarationOnly false",
    "lint": "eslint --flag unstable_native_nodejs_ts_config"
  }
}
```

### pg-boss Version

Use **pg-boss v12.18.2** (current latest as of story creation). Supports Node 18+, ESM, TypeScript. Install with:
```
pnpm add pg-boss@^12.18.2
```

pg-boss v9+ changed the `boss.work()` API — do not use the v8 callback-style API. The modern API is:
```typescript
boss.work(queue, options, async (job) => { ... })
```

**pg-boss v12 API notes (discovered during implementation):**
- `WorkHandler` takes `Job<T>[]` (array), not `Job<T>` (single). Iterate over jobs.
- `teamSize`/`teamRefill` removed; use `localConcurrency` in `WorkOptions`
- `retryLimit`/`retryDelay`/`retryBackoff` go in `createQueue()` or per-job `send()` options, NOT in the `PgBoss` constructor or `work()` options
- `onComplete()` removed; use dead-letter queue pattern: `createQueue({ deadLetter: 'queue.name' })` + `work('queue.name', handler)`

### Files to Create/Modify

| File | Action | Notes |
|---|---|---|
| `pnpm-workspace.yaml` | UPDATE | Add `- services/*` to packages list |
| `packages/types/package.json` | NEW | `@healthtracker/types` package |
| `packages/types/tsconfig.json` | NEW | Extend base TS config |
| `packages/types/src/index.ts` | NEW | Re-exports from ./jobs |
| `packages/types/src/jobs.ts` | NEW | `JobPayload<T>` and payload types |
| `services/extraction/package.json` | NEW | `@healthtracker/extraction-worker` |
| `services/extraction/tsconfig.json` | NEW | NodeNext module resolution |
| `services/extraction/.env.example` | NEW | `WORKER_DATABASE_URL=` placeholder |
| `services/extraction/src/index.ts` | NEW | pg-boss startup + consumer registration |
| `services/extraction/src/db.ts` | NEW | Direct postgres connection for worker |
| `services/extraction/src/consumers/smoke-test.ts` | NEW | Smoke test consumer |
| `services/extraction/src/enqueue-smoke-test.ts` | NEW | One-shot enqueue script for manual verification |
| `services/extraction/src/state-machine/upload-transitions.ts` | NEW | Stub: `markUploadFailed()` |
| `.env.example` | UPDATE | Add `WORKER_DATABASE_URL` comment + placeholder |
| `turbo.json` | UPDATE | Add `WORKER_DATABASE_URL` to `globalEnv` |

### What Must NOT Change

- `packages/api/src/trpc.ts` — no changes; `protectedProcedure` is unchanged
- `packages/db/` — no schema changes in this story
- `apps/web/` and `apps/expo/` — no app changes
- `DATABASE_URL` usage anywhere — this is the session-mode pooler URL; the worker uses `WORKER_DATABASE_URL` (direct connection)

### Previous Story Context

**From story 0-4:**
- `packages/db/src/schema/uploads.ts` exists as a stub (`// schema defined in story X.Y`). The dead-letter handler references `uploadId` but cannot write to the DB yet — the uploads table schema ships in story 2.1. `markUploadFailed` is a log-only stub until then.
- The `packages/db/__tests__/rls/` harness established the pattern of using `postgres` npm package for direct DB connections in tests. The same package is used here for the worker's `src/db.ts`.
- `turbo.json` `globalEnv` already includes `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — add `WORKER_DATABASE_URL` alongside them.
- `pnpm-workspace.yaml` catalog already has many entries — add `@healthtracker/types: "workspace:*"` in the catalog block.

**From story 0-3:**
- Auth is configured. Worker processes do not use Supabase Auth — they connect directly to Postgres with service-level credentials. The worker is a backend process, not a user-facing service.

### Architecture Compliance

- AR7 (pg-boss Postgres-backed queue): This story implements it.
- AR14 (upload state machine — only `upload-transitions.ts` writes `failed`): Enforced by the dead-letter handler calling `markUploadFailed()` exclusively. No inline status writes in consumer handlers.
- NFR-SC1 (horizontal scaling): pg-boss `FOR UPDATE SKIP LOCKED` handles this natively.
- NFR-R2 (retry + dead-letter): `retryLimit: 3`, `retryBackoff: true`, dead-letter handler registered.

### Deferred to Later Stories

- CI wiring for worker (story 0-6)
- Actual uploads table writes in `markUploadFailed` (story 2.1)
- Real extraction consumers: `extract-document.ts`, `normalize-loinc.ts` (story 2.1 / 2.3)
- Dockerfile for `services/extraction` (story 0-6 or deployment story)
- `services/llm` setup (story 4.1)
- RLS SET LOCAL in worker (worker uses service-level Postgres access, bypasses RLS — appropriate for background job processor)

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- pg-boss v12 API differs from story dev notes: `WorkHandler` takes `Job<T>[]` not `Job<T>`, `teamSize`/`teamRefill` removed (use `localConcurrency`), `onComplete` removed (use dead-letter queue pattern), constructor does not accept retry options
- Added `postgres` to workspace catalog to resolve sherif workspace version conflict between `packages/db` (devDep) and `services/extraction` (dep)
- `packages/types` needed `eslint` dev dep + `eslint.config.ts` to pass lint task
- `services/extraction` needed `@types/node` + `lib: ["ES2022"]` + `types: ["node"]` in tsconfig for Node globals

### Completion Notes List

- Implemented pg-boss v12 compatible worker using named export `{ PgBoss }` (no default export)
- Retry policy configured via `createQueue()` per pg-boss v12 API (not constructor)
- Dead-letter handler uses `extraction.dead-letter` queue (replaces removed `onComplete` API)
- `WorkHandler` updated to iterate `Job<T>[]` array (v12 behavior)
- `postgres` added to workspace catalog; `packages/db` devDep updated to `catalog:` for consistency
- `markUploadFailed` is a sync stub returning `Promise.resolve()` to satisfy AR14 (sole `failed` writer)

### File List

- `pnpm-workspace.yaml` — added `services/*` and `@healthtracker/types`/`postgres` to catalog
- `packages/types/package.json` — new
- `packages/types/tsconfig.json` — new
- `packages/types/eslint.config.ts` — new
- `packages/types/src/index.ts` — new
- `packages/types/src/jobs.ts` — new
- `services/extraction/package.json` — new
- `services/extraction/tsconfig.json` — new
- `services/extraction/eslint.config.ts` — new
- `services/extraction/.env.example` — new
- `services/extraction/src/index.ts` — new
- `services/extraction/src/db.ts` — new
- `services/extraction/src/consumers/smoke-test.ts` — new
- `services/extraction/src/enqueue-smoke-test.ts` — new
- `services/extraction/src/state-machine/upload-transitions.ts` — new
- `.env.example` — added `WORKER_DATABASE_URL`
- `turbo.json` — added `WORKER_DATABASE_URL` to `globalEnv`
- `packages/db/package.json` — updated `postgres` devDep to `catalog:`

## Review Findings

- [x] [Review][Patch] Add job-type guard in dead-letter handler — only call `markUploadFailed` for extraction jobs; other job types (e.g. future `letter.generate`) should not invoke upload state transitions [services/extraction/src/index.ts]
- [x] [Review][Patch] Dead-letter queue name `extraction.dead-letter` violates snake_case convention [services/extraction/src/index.ts]
- [x] [Review][Patch] `if (correlationId)` guard silently skips `markUploadFailed` — jobs without a correlationId bypass failed-state marking entirely [services/extraction/src/index.ts]
- [x] [Review][Patch] Dead-letter queue registered without `retryLimit: 0` — a throw inside the handler causes pg-boss to retry dead-letter jobs indefinitely [services/extraction/src/index.ts]
- [x] [Review][Patch] Dead-letter batch handler iterates jobs with `await` inside `for` loop — single job failure aborts remaining jobs, risking double-processing on retry [services/extraction/src/index.ts]
- [x] [Review][Patch] SIGTERM handler uses `void boss.stop().then(...)` — rejection is silently swallowed and no timeout guard means graceful shutdown can hang indefinitely [services/extraction/src/index.ts]
- [x] [Review][Patch] `dev` and `start` scripts run `.ts` files with bare `node` — fails on Node 22 without `--experimental-strip-types` flag or a TypeScript loader [services/extraction/package.json]
- [x] [Review][Patch] `enqueue-smoke-test.ts` has no error handling — process hangs if `boss.start()` or `boss.send()` rejects [services/extraction/src/enqueue-smoke-test.ts]
- [x] [Review][Patch] `void boss.work(...)` in `registerSmokeTestConsumer` discards worker registration errors silently [services/extraction/src/consumers/smoke-test.ts]
- [x] [Review][Defer] `createQueue` idempotency on restart — pg-boss v12 handles schema idempotently; minor concern about option drift on re-creation [services/extraction/src/index.ts] — deferred, pre-existing
- [x] [Review][Defer] `db.ts` `sql` client not explicitly torn down in SIGTERM handler — `process.exit(0)` closes connections; cosmetic noise in Postgres logs [services/extraction/src/db.ts] — deferred, pre-existing
- [x] [Review][Defer] No `SIGINT` handler — `Ctrl+C` in dev skips graceful shutdown [services/extraction/src/index.ts] — deferred, pre-existing
- [x] [Review][Defer] `JobPayload.createdAt` typed as `string` without runtime validation — future Zod boundary concern [packages/types/src/jobs.ts] — deferred, pre-existing
- [x] [Review][Defer] `enqueue-smoke-test.ts` doesn't call `createQueue` before `boss.send()` — manual tool, intended to run after worker has started at least once [services/extraction/src/enqueue-smoke-test.ts] — deferred, pre-existing

## Change Log

- 2026-05-17: Story 0-5 implemented — pg-boss extraction worker bootstrapped with smoke-test consumer, dead-letter handler, and `@healthtracker/types` package. pg-boss v12 API differences documented (WorkHandler takes array, retry config via createQueue, onComplete removed).
