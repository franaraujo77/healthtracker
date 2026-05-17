import { PgBoss } from 'pg-boss'
import type { JobPayload, SmokeTestPayload } from '@healthtracker/types'
import { randomUUID } from 'node:crypto'

const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL
if (!WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL is required')

const boss = new PgBoss({ connectionString: WORKER_DATABASE_URL })

try {
  await boss.start()

  const jobPayload: JobPayload<SmokeTestPayload> = {
    jobId: randomUUID(),
    patientId: 'smoke-test-patient',
    correlationId: 'smoke-test-correlation',
    payload: { message: 'smoke test job — verify pg-boss lifecycle' },
    createdAt: new Date().toISOString(),
  }

  const jobId = await boss.send('extraction.smoke_test', jobPayload)
  console.log(`[enqueue-smoke-test] enqueued job id=${jobId}`)
} finally {
  await boss.stop()
  process.exit(0)
}
