export interface JobPayload<T> {
  jobId: string;
  patientId: string;
  correlationId: string;
  payload: T;
  createdAt: string;
}

export interface ExtractDocumentPayload {
  uploadId: string;
  storagePath: string;
  idempotencyKey: string;
  // Story 2.2 P81 — iOS Safari sometimes labels HEIC as `image/heif`;
  // the extraction worker needs to accept the same allowlist as the
  // upload validators.
  mimeType:
    | "application/pdf"
    | "image/jpeg"
    | "image/png"
    | "image/heic"
    | "image/heif";
}

export interface SmokeTestPayload {
  message: string;
}
