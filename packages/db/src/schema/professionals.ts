import { pgEnum, pgTable } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * Story 6.3 — `professionals` table.
 *
 * One row per activated doctor (PK = `user_id` = Supabase `auth.uid()`).
 * Populated exclusively by `sharingRouter.activateProfessionalAccount`
 * (AC3); banner/modal render is conditional on row existence via
 * `getActivationStatus` (AC4).
 *
 * **Activation is `auth.uid()`-scoped, NOT share-token-scoped** — a
 * doctor activated via patient A's token IS activated when viewing
 * patient B's report. This is the Doctor Acquisition Loop closure.
 *
 * **FK cascade rule (Story 5.6):** `onDelete: cascade` complies with
 * the LGPD-erasure rule for every new FK to `users(id)`. When the
 * doctor deletes their account, their `professionals` row goes too.
 *
 * RLS policies live in `packages/db/policies/custom_rls_professionals.sql`
 * (select_own / insert_own / service_role_all). No UPDATE / DELETE
 * policies — display-name edits are a future story; deletion piggybacks
 * on the `users` cascade.
 *
 * **Migration discipline (Story 6.3 scope):** no `supabase/migrations/*`
 * file ships in this story — production deploy lands in Story 6.6's
 * Epic 6 consolidated migration (mirrors Story 3.5 / 4.4 / 5.x).
 * Tracked in `_bmad-output/implementation-artifacts/deferred-work.md`.
 */
export const professionalCategoryEnum = pgEnum("professional_category_enum", [
  "endocrinologista",
  "cardiologista",
  "medicina_esportiva",
  "nutrologo",
  "nutricionista",
  "clinico_geral",
  "outro",
]);

export const Professionals = pgTable("professionals", (t) => ({
  userId: t
    .uuid()
    .notNull()
    .primaryKey()
    .references(() => Users.id, { onDelete: "cascade" }),
  displayName: t.text().notNull(),
  category: professionalCategoryEnum("category").notNull(),
  createdAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
}));

export type Professional = typeof Professionals.$inferSelect;
export type NewProfessional = typeof Professionals.$inferInsert;
