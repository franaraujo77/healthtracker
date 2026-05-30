/**
 * Story 2.3 / 2.4 — collection-date normalization.
 *
 * Brazilian lab reports default to `dd/mm/yyyy`; some PDFs include
 * ISO-8601 `yyyy-mm-dd`. Returns `null` on unparseable input.
 *
 * Pure function; no locale-dependent behavior.
 *
 * Moved to `@healthtracker/validators` in Story 2.4 so the API's
 * patient-confirm path and the worker share the same parser.
 */
export function parseCollectedAt(text: string): Date | null {
  if (typeof text !== "string") return null;
  // R1-P103 — strip trailing time portion ("dd/mm/yyyy hh:mm[:ss]")
  const trimmed = text.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");

  const brMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3]);
    if (!validDateParts(year, month, day)) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }

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

/**
 * Story 7.1 — resolver-time "today" in America/Sao_Paulo as `yyyy-mm-dd`.
 *
 * Computed via `Intl.DateTimeFormat` with `timeZone: 'America/Sao_Paulo'`
 * so the answer is stable regardless of the server runtime's local TZ
 * (Lambda / Vercel both run UTC; CI may run elsewhere). Called at
 * Zod-refine time (NOT module load) so a server process that lives
 * across midnight São Paulo doesn't freeze "today" at boot.
 *
 * Used by the AC6 retroactive-only refine for `life_events.event_date`
 * and by any other resolver that needs a São Paulo calendar boundary.
 */
export function todayInSaoPauloIso(): string {
  // `en-CA` locale yields `yyyy-mm-dd` natively.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
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
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}
