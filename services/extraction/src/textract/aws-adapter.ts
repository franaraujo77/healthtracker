import {
  AnalyzeDocumentCommand,
  TextractClient,
} from "@aws-sdk/client-textract";

import type { TextractAdapter } from "./adapter.js";
import { assertAwsTextractConfig } from "./aws-config.js";
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
 *   - Region + credential presence are gated at worker BOOT (Story 9.2,
 *     `assertAwsTextractConfig` in `index.ts`), so a misconfigured deploy
 *     crashes loud rather than dead-lettering uploads. `getClient()` below
 *     re-resolves the pinned `sa-east-1` region from the same gate (single
 *     source of truth). The default SDK credential chain supplies the
 *     DPA-signed credentials.
 *   - `extract()` does NOT catch Textract failures; throws propagate to
 *     the consumer's existing retry/dead-letter path. **Story 9.3** wraps
 *     that call site to dead-letter cleanly with a patient-visible reason.
 */

let client: TextractClient | undefined;

function getClient(): TextractClient {
  // Lazy + memoised so importing the module has no side effect. The region
  // comes from the boot gate (Story 9.2) — pinned to sa-east-1; the worker
  // would already have crashed at boot if it were misconfigured.
  client ??= new TextractClient({ region: assertAwsTextractConfig().region });
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
