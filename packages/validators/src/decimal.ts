/**
 * Story 2.3 / 2.4 + UX-DR12 — Brazilian decimal-comma normalization.
 *
 * Brazilian lab reports use the comma as the decimal separator and
 * the period as the thousands separator (the reverse of US/UK):
 *   - "2,4"        →  2.4
 *   - "1.234,5"    →  1234.5
 *   - "14,2"       →  14.2
 *   - "0,85"       →  0.85
 *
 * Returns `null` for unparseable input rather than throwing — callers
 * route null-value fields to the review queue or surface an inline
 * validation error.
 *
 * Lives in `@healthtracker/validators` (a pure no-deps package) so the
 * web app, the Expo app, the API, and the extraction worker can all
 * share it (Story 2.4 moved it here from the worker).
 */
export function parseBrazilianDecimal(text: string): number | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // Negative sign + digits + optional thousands sep + optional comma + fraction.
  // Reject anything that isn't a recognizable number shape.
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(trimmed)) {
    return null;
  }

  const withoutThousands = trimmed.replace(/\./g, "");
  const withDecimalDot = withoutThousands.replace(",", ".");
  const parsed = Number(withDecimalDot);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Story 2.4 — render a JS number in Brazilian decimal-comma format
 * for input pre-fill. Inverse of `parseBrazilianDecimal` for the
 * common case (no thousands separators applied — keep input simple).
 */
export function formatBrazilianDecimal(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value).replace(".", ",");
}
