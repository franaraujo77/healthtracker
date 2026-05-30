import { z } from "zod/v4";

/**
 * Story 6.5 — staleness threshold defaults + schemas + helpers.
 *
 * Doctor preference: per-biomarker-category maximum age (in days)
 * before the BiomarkerCard renders a "Resultado antigo" chip in the
 * Conversation Starter view. Lives in a dedicated module so the
 * resolver, the BiomarkerCard render path, and the unit tests share
 * one source of truth.
 *
 * **Default semantics:** absent row → `STALENESS_DEFAULT_DAYS` (180)
 * applied at READ time only. Defaults are NEVER persisted as rows
 * (avoids row-bloat for every doctor × every category × every save).
 */

/** Story 6.5 AC5 — system default when the doctor has no row for a category. */
export const STALENESS_DEFAULT_DAYS = 180;

/** Story 6.5 AC4 — hard cap on per-call thresholds. */
export const STALENESS_THRESHOLDS_MAX_ENTRIES = 64;

/** Story 6.5 AC4 — domain for `threshold_days`. */
export const STALENESS_THRESHOLD_MIN_DAYS = 1;
export const STALENESS_THRESHOLD_MAX_DAYS = 3650;

/**
 * Age of a `collectedAt` observation in calendar days vs `now`. Pure
 * function; explicit `now` injection so tests don't rely on real wall
 * clock. UTC ms-math — no DST / locale concerns.
 */
export function ageInDays(now: Date, collectedAt: Date): number {
  return Math.floor((now.getTime() - collectedAt.getTime()) / 86_400_000);
}

/**
 * Story 6.5 AC4 — `updateStalenessThresholds` input. Empty array =
 * no-op (does NOT delete existing rows; AC4 deletion-semantics).
 * Duplicates by category rejected via refine.
 */
export const stalenessThresholdEntrySchema = z.object({
  biomarkerCategory: z.string().trim().min(1).max(120),
  thresholdDays: z
    .number()
    .int()
    .min(STALENESS_THRESHOLD_MIN_DAYS)
    .max(STALENESS_THRESHOLD_MAX_DAYS),
});

export const updateStalenessThresholdsInputSchema = z
  .object({
    thresholds: z
      .array(stalenessThresholdEntrySchema)
      .min(0)
      .max(STALENESS_THRESHOLDS_MAX_ENTRIES),
  })
  .refine(
    (val) => {
      const seen = new Set<string>();
      for (const entry of val.thresholds) {
        if (seen.has(entry.biomarkerCategory)) return false;
        seen.add(entry.biomarkerCategory);
      }
      return true;
    },
    { message: "STALENESS_THRESHOLD_DUPLICATE_CATEGORY" },
  );
export type UpdateStalenessThresholdsInput = z.infer<
  typeof updateStalenessThresholdsInputSchema
>;

export const updateStalenessThresholdsOutputSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});
export type UpdateStalenessThresholdsOutput = z.infer<
  typeof updateStalenessThresholdsOutputSchema
>;

/** Story 6.5 AC7 — `listStalenessThresholds` output. */
export const listStalenessThresholdsInputSchema = z.object({}).strict();

export const listStalenessThresholdsOutputSchema = z.object({
  categories: z.array(
    z.object({
      biomarkerCategory: z.string(),
      labelPtBr: z.string(),
      thresholdDays: z.number().int(),
      isDefault: z.boolean(),
    }),
  ),
  defaultDays: z.number().int(),
});
export type ListStalenessThresholdsOutput = z.infer<
  typeof listStalenessThresholdsOutputSchema
>;
