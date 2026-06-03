import {
  AnalyzeDocumentCommand,
  TextractClient,
} from "@aws-sdk/client-textract";

import type { TextractAdapter } from "./adapter.js";
import { mapAnalyzeDocumentResponse } from "./aws-mapping.js";

/**
 * Story 9.1 — production AWS Textract adapter.
 *
 * Calls Textract `AnalyzeDocument` with `FeatureTypes: ['FORMS','TABLES']`
 * on the in-memory document bytes and maps the response into
 * `RawExtractedField[]` via the pure `mapAnalyzeDocumentResponse` (which
 * carries all the heuristics + is unit-tested against recorded fixtures —
 * no live AWS in CI, NFR-S8).
 *
 * Limitations (documented):
 *   - Synchronous `AnalyzeDocument` with `Bytes` is single-page (PDF) and
 *     ≤10 MB. Multi-page lab PDFs need async `StartDocumentAnalysis` + S3
 *     polling — a follow-up story, out of scope for 9.1. (`storagePath`
 *     is kept in the contract for that future async path.)
 *   - Credentials + region are NOT yet boot-gated here. This adapter
 *     reads `AWS_REGION` (default `sa-east-1`) and uses the default SDK
 *     credential chain. **Story 9.2 adds the fail-loud boot gate + the
 *     hard `sa-east-1` pin.** Until then a misconfigured
 *     `EXTRACTION_ADAPTER=aws` deploy throws at first dispatch — the same
 *     blast radius as the previous stub (acceptable until 9.2).
 *   - `extract()` does NOT catch Textract failures; throws propagate to
 *     the consumer's existing retry/dead-letter path. **Story 9.3** wraps
 *     that call site to dead-letter cleanly with a patient-visible reason.
 */

let client: TextractClient | undefined;

function getClient(): TextractClient {
  // Lazy + memoised so importing the module has no side effect and the
  // region is read once. Story 9.2 replaces this with a boot-gated,
  // region-pinned constructor.
  client ??= new TextractClient({
    region: process.env.AWS_REGION ?? "sa-east-1",
  });
  return client;
}

export const awsTextractAdapter: TextractAdapter = {
  async extract({ bytes }) {
    const response = await getClient().send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: bytes },
        FeatureTypes: ["FORMS", "TABLES"],
      }),
    );
    return mapAnalyzeDocumentResponse(response);
  },
};
