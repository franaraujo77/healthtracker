/**
 * Story 2.3 — Textract adapter interface.
 *
 * The extraction worker calls this interface to extract raw fields
 * from a document. Two implementations:
 *
 *   - `mockTextractAdapterFromFixtures` (CI + dev) — looks up the
 *     fixture by `storagePath` and returns canned `RawExtractedField[]`.
 *     Per architecture.md L84, CI cannot send real patient data to
 *     production LLM providers.
 *
 *   - `awsTextractAdapter` (prod) — stub this story; the real AWS
 *     SDK integration is a follow-up. The stub throws
 *     `NOT_IMPLEMENTED` so a misconfigured deploy fails loud.
 *
 * The adapter returns RAW field strings — normalization (decimal-comma,
 * LOINC lookup, UCUM canonicalization, date parsing) happens AFTER
 * the adapter call. This keeps the adapter contract minimal and the
 * normalization layer pure / testable.
 */

export interface RawExtractedField {
  /** Biomarker name as it appears in the source document. */
  biomarkerName: string;
  /** Raw textual value (may use Brazilian decimal comma). */
  valueText: string;
  /** Raw textual unit (may need canonicalization). */
  unitText?: string;
  /** Raw textual reference range low / high. */
  referenceRangeLowText?: string;
  referenceRangeHighText?: string;
  /** Lab name as it appears on the report header. */
  labName?: string;
  /** Collection date as it appears (commonly dd/mm/yyyy). */
  collectedAtText?: string;
  /** Per-field confidence score in `[0.0, 1.0]`. */
  confidence: number;
}

export interface TextractAdapter {
  extract(input: {
    bytes: Uint8Array;
    mimeType: string;
    storagePath: string;
  }): Promise<RawExtractedField[]>;
}
