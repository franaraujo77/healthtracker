/**
 * Story 2.3 — collection-date normalization.
 *
 * Brazilian lab reports default to `dd/mm/yyyy`; some PDFs include
 * ISO-8601 `yyyy-mm-dd`. Returns `null` on unparseable input — the
 * dispatcher routes the field to the review queue (the collection
 * date is required for `observations.collected_at`).
 *
 * Pure function; no locale-dependent behavior.
 */
export function parseCollectedAt(text: string): Date | null {
  if (typeof text !== "string") return null;
  // Story 2.3 R1-P103 — strip trailing time portion ("dd/mm/yyyy hh:mm[:ss]")
  // before regex; labs commonly emit collected-at with the collection
  // time appended.
  const trimmed = text.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");

  // dd/mm/yyyy or dd-mm-yyyy
  const brMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3]);
    if (!validDateParts(year, month, day)) return null;
    // UTC midnight to avoid timezone-shift surprises when stored as DATE.
    return new Date(Date.UTC(year, month - 1, day));
  }

  // ISO yyyy-mm-dd
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!validDateParts(year, month, day)) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }

  return null;
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Reject day-of-month overflow (e.g., 31/02).
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}
