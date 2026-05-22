import type { TextractAdapter } from "./adapter.js";

/**
 * Story 2.3 — STUB. Real AWS Textract SDK integration is a follow-up
 * story (architecture mandates a CI mock anyway per NFR-S8 +
 * architecture.md L84; live integration is a runtime-only concern).
 *
 * Flipping `EXTRACTION_ADAPTER=aws` in production WILL throw
 * `NOT_IMPLEMENTED` at first job dispatch. This is intentional — a
 * misconfigured deploy must fail loud, not silently no-op.
 *
 * Follow-up story will:
 *   1. Add `@aws-sdk/client-textract` as a dep.
 *   2. Implement `AnalyzeDocument` with `FeatureTypes: ['FORMS', 'TABLES']`.
 *   3. Map the Textract response into `RawExtractedField[]`.
 *   4. Configure the SDK for `sa-east-1` (NFR-S8 data residency).
 *   5. Wire a DPA-signed credentials path (LGPD Art. 33).
 */
export const awsTextractAdapter: TextractAdapter = {
  extract() {
    return Promise.reject(
      new Error(
        "[awsTextractAdapter] NOT_IMPLEMENTED — Story 2.3 ships only the mock adapter. " +
          "Real AWS Textract integration is a follow-up story; do not enable " +
          "`EXTRACTION_ADAPTER=aws` in production until that ships.",
      ),
    );
  },
};
