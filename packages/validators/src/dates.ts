/**
 * Story 5.3 — pt-BR relative + absolute date formatters for the
 * Access Log surface (`AccessLogItem`). Shared module so the renderer
 * and unit tests reference a single source of truth.
 *
 * Buckets (relative):
 *   - `< 60s`  → "agora"
 *   - `< 60m`  → "há {N} min"
 *   - `< 24h`  → "há {N} h"
 *   - `< 7d`   → "há {N} dias" (singular: "há 1 dia")
 *   - `>= 7d`  → falls through to `formatAbsolutePtBr`
 *
 * Hermes ICU support on Expo SDK 54 is sufficient for `Intl.DateTimeFormat`
 * with `dateStyle: "long"` (already exercised by
 * `formatConsentGrantedDate`). The absolute formatter uses explicit
 * `day` / `month` / `year` / `hour` / `minute` parts so output is stable.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatRelativeTimePtBr(
  date: Date,
  now: Date = new Date(),
): string {
  const delta = now.getTime() - date.getTime();
  // Future timestamps (clock skew) and same-instant both collapse to "agora".
  if (delta < MINUTE_MS) return "agora";
  if (delta < HOUR_MS) {
    const n = Math.floor(delta / MINUTE_MS);
    return `há ${n} min`;
  }
  if (delta < DAY_MS) {
    const n = Math.floor(delta / HOUR_MS);
    return `há ${n} h`;
  }
  if (delta < WEEK_MS) {
    const n = Math.floor(delta / DAY_MS);
    return n === 1 ? "há 1 dia" : `há ${n} dias`;
  }
  return formatAbsolutePtBr(date);
}

/**
 * Renders e.g. "23 de maio de 2026 às 14:32" — the exact shape AC2
 * specifies. Locale `pt-BR`; explicit numeric hour/minute so leading
 * zeros render consistently across runtimes.
 */
export function formatAbsolutePtBr(date: Date): string {
  const datePart = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${datePart} às ${timePart}`;
}
