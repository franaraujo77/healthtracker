export interface JobPayload<T> {
  jobId: string
  patientId: string
  correlationId: string
  payload: T
  createdAt: string
}

export interface ExtractDocumentPayload {
  uploadId: string
  storagePath: string
  idempotencyKey: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic'
}

export interface SmokeTestPayload {
  message: string
}
