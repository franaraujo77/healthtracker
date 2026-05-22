import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";

/**
 * `users` — the application-domain row for an authenticated patient.
 *
 * `id` equals the Supabase `auth.uid()` of the account; it is supplied at
 * insert time (no default) so the app row and the auth account share a key.
 * Email and password live in Supabase-managed `auth.users`, never here.
 */
export const Users = pgTable("users", (t) => ({
  id: t.uuid().notNull().primaryKey(),
  subscriptionTier: t.text().notNull().default("free"),
  createdAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => sql`now()`),
}));
