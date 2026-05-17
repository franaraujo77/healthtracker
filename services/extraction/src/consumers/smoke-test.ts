import type { PgBoss } from 'pg-boss'
import type { JobPayload, SmokeTestPayload } from '@healthtracker/types'

export async function registerSmokeTestConsumer(boss: PgBoss): Promise<void> {
  await boss.work<JobPayload<SmokeTestPayload>>(
    'extraction.smoke_test',
    { localConcurrency: 5 },
    (jobs) => {
      for (const job of jobs) {
        console.log(`[extraction.smoke_test] job ${job.id} processing: ${job.data.payload.message}`)
        console.log(`[extraction.smoke_test] job ${job.id} completed`)
      }
      return Promise.resolve()
    },
  )
}
