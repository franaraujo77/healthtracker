/**
 * Story 2.3 + UX-DR12 — Brazilian decimal-comma normalization.
 *
 * Brazilian lab reports use the comma as the decimal separator and
 * the period as the thousands separator (the reverse of US/UK):
 *   - "2,4"        →  2.4
 *   - "1.234,5"    →  1234.5
 *   - "14,2"       →  14.2
 *   - "0,85"       →  0.85
 *
 * Returns `null` for unparseable input rather than throwing — the
 * dispatcher routes null-value fields to the review queue (the
 * confidence may be high but the value didn't parse).
 *
 * Pure function — no side effects. Stable across locale (the
 * implementation does not use `Intl.NumberFormat` which has
 * runtime-locale-dependent behavior).
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

  // Strip thousands separators (periods), then replace decimal comma
  // with a period. The result is parseable by `Number()`.
  const withoutThousands = trimmed.replace(/\./g, "");
  const withDecimalDot = withoutThousands.replace(",", ".");
  const parsed = Number(withDecimalDot);
  return Number.isFinite(parsed) ? parsed : null;
}
