import postgres from 'postgres'

const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL
if (!WORKER_DATABASE_URL) {
  throw new Error(
    'WORKER_DATABASE_URL required — must be the direct (non-pooled) Postgres URL, ' +
      'NOT the PgBouncer session-mode URL in DATABASE_URL. ' +
      'pg-boss uses advisory locks and NOTIFY; transaction-mode PgBouncer would reset lock ' +
      'state between statements, corrupting pg-boss exclusive job ownership.',
  )
}

// pg-boss manages its own connection pool internally. This sql client is used
// only for state-machine writes (e.g. markUploadFailed) outside pg-boss's scope.
export const sql = postgres(WORKER_DATABASE_URL, {
  max: 1,
  idle_timeout: 30,
})
