/**
 * Story 2.3 + UX-DR12 — Brazilian decimal-comma normalization.
 *
 * Brazilian lab reports use the comma as the decimal separator and
 * the period as the thousands separator:
 *   - "2,4"        →  2.4
 *   - "1.234,5"    →  1234.5
 *   - "14,2"       →  14.2
 *
 * Returns `null` for unparseable input.
 *
 * Story 2.4 — the canonical implementation lives in
 * `@healthtracker/validators` (so the API + clients share it); the
 * worker keeps a local copy to avoid pulling the validators package
 * across the `postgres`-driver / Drizzle boundary into its bundle.
 * The two implementations are kept in sync — see the snapshot test
 * in `packages/validators/__tests__/decimal.test.ts`.
 */
export function parseBrazilianDecimal(text: string): number | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(trimmed)) {
    return null;
  }

  const withoutThousands = trimmed.replace(/\./g, "");
  const withDecimalDot = withoutThousands.replace(",", ".");
  const parsed = Number(withDecimalDot);
  return Number.isFinite(parsed) ? parsed : null;
}
