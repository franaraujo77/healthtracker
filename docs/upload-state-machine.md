# Upload State Machine

This is the contract that governs the `uploads` row's `status` field
throughout its lifecycle. Single source of truth is
`packages/api/src/upload-transitions.ts` — this document mirrors the
intent in prose.

## States (`upload_status_enum`)

| Status           | Meaning                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `queued`         | Initial state. The patient has confirmed the upload; the storage object exists; an `extraction.document` job has been enqueued. |
| `processing`     | The extraction worker has picked up the job and is parsing the document.                                                        |
| `pending_review` | At least one extracted field has confidence in `[0.01, 0.85)` and needs the patient's confirmation (Story 2.4).                 |
| `complete`       | All extracted fields are published to `observations`. Terminal.                                                                 |
| `failed`         | The pipeline could not produce any usable observations. Terminal.                                                               |

## Legal transitions

```
queued ──► processing ──► complete
              │
              └─► pending_review ──► complete
                                 └─► failed
              │
              └─► failed
```

Plus a dead-letter override (`applyDeadLetter`) that forces `failed`
from any non-terminal state when the worker exhausts retries.

**`failed → queued` is NOT legal.** A re-queue is a NEW row with a NEW
idempotency key. Transitioning a `failed` row to `queued` would mask
the failure history and break the audit chain.

## Sanctioned write path

Every transition MUST go through one of:

- `applyUploadTransition(db, { uploadId, from, to, metadata? })` — for
  the legal arcs above.
- `applyDeadLetter(db, { uploadId, metadata? })` — for the dead-letter
  override.

Both helpers issue a single `UPDATE` with an optimistic-lock clause
(`WHERE id = $uploadId AND status = $from`) so two workers racing on
the same row don't lose updates. The helper returns
`{ updated: false, currentStatus: null }` when the optimistic-lock
matches zero rows — caller decides how to react (typically: log and
skip).

The helper also stamps `processing_started_at` on the first transition
into `processing` and `processing_completed_at` on the first transition
into `complete` / `failed`. Both use `COALESCE` to preserve the
original timestamps if a row briefly re-enters the same state.

## RLS posture

`custom_rls_uploads.sql` ships SELECT + INSERT own policies only (Story
1.5 design — patients don't transition state). Story 2.3 will add a
narrow service-role UPDATE policy when the extraction worker first
needs to advance `queued → processing`. Until then, the helper is
only exercisable via direct DB access (service-role connection) or
through unit tests with mocked DB chains.

## pg-boss queue contract

The `extraction.document` queue is configured in
`services/extraction/src/index.ts`:

- `retry_limit = 3`
- `retry_delay = 60s` (with backoff)
- `dead_letter = 'extraction.dead_letter'`

When `retry_limit` is exhausted, pg-boss routes the job to the
dead-letter queue. The dead-letter consumer should call
`applyDeadLetter(db, { uploadId, metadata: { reason: 'retries_exhausted' } })`
to transition the row to `failed` so the patient surface shows the
failure cleanly.

## References

- Architecture: `_bmad-output/planning-artifacts/architecture.md` — upload state machine (L117), idempotency contract (L154).
- Schema: `packages/db/src/schema/uploads.ts`.
- Helper: `packages/api/src/upload-transitions.ts`.
- Tests: `packages/api/__tests__/upload-transitions.test.ts`.
- pg-boss queue config: `services/extraction/src/index.ts`.
