// IMPORTANT: This is the ONLY code path permitted to write 'failed' status to uploads.
// See: architecture.md#Upload-State-Machine (AR14)
// DB write is a stub until `uploads` table schema is defined in story 2.1.
export function markUploadFailed(uploadId: string): Promise<void> {
  // TODO story 2.1: UPDATE uploads SET status = 'failed' WHERE id = uploadId
  console.error(
    `[upload-transitions] markUploadFailed called for uploadId=${uploadId} (stub — write deferred to story 2.1)`,
  )
  return Promise.resolve()
}
