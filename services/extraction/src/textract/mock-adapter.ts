import type { RawExtractedField, TextractAdapter } from "./adapter.js";

/**
 * Story 2.3 — fixture-driven mock adapter for CI + dev.
 *
 * Per architecture.md L84: CI cannot send real patient data to
 * production LLM providers. This adapter looks up the fixture by
 * `storagePath` and returns canned fields; throws if no fixture
 * matches (so tests fail loud rather than silently returning empty).
 *
 * Usage:
 *
 *   const adapter = mockTextractAdapterFromFixtures([
 *     {
 *       storagePath: 'patient-1/key-abc/exam.pdf',
 *       fields: [
 *         { biomarkerName: 'Hemoglobina', valueText: '14,2', unitText: 'g/dL', confidence: 0.92 },
 *       ],
 *     },
 *   ]);
 */
export interface MockFixture {
  storagePath: string;
  fields: RawExtractedField[];
}

export function mockTextractAdapterFromFixtures(
  fixtures: MockFixture[],
): TextractAdapter {
  const byPath = new Map(fixtures.map((f) => [f.storagePath, f.fields]));
  return {
    extract({ storagePath }) {
      const fields = byPath.get(storagePath);
      if (!fields) {
        return Promise.reject(
          new Error(
            `[mockTextractAdapter] no fixture for storagePath=${storagePath}`,
          ),
        );
      }
      return Promise.resolve(fields);
    },
  };
}
