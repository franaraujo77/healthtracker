# packages/db

Drizzle ORM schema and database client for Healthtracker.

## Connection URL Requirements

**`DATABASE_URL` must use the session-mode pooler (port 5432).**

Get this from: Supabase Dashboard → Settings → Database → Connection string → **Session mode**.

### Why Session Mode?

Story 0.4 adds `SET LOCAL app.current_patient_id = <uuid>` to every tRPC request context for RLS enforcement. `SET LOCAL` scopes a variable to the current transaction. This only works reliably with a **persistent backend connection** (session mode).

Supabase's default transaction-mode PgBouncer (port 6543) releases the PostgreSQL connection back to the pool after each transaction. The next request gets a different connection and `current_setting('app.current_patient_id')` returns empty, causing RLS to either deny access or leak data between users.

### Connection URL Reference

| URL                     | Port | Use                      | Notes                                                                         |
| ----------------------- | ---- | ------------------------ | ----------------------------------------------------------------------------- |
| Session-mode pooler     | 5432 | Runtime (`DATABASE_URL`) | Required for `SET LOCAL` / RLS; set in `.env`                                 |
| Transaction-mode pooler | 6543 | **Never use**            | Breaks `SET LOCAL`; PgBouncer default                                         |
| Direct connection       | 5432 | Schema migrations only   | `drizzle.config.ts` strips `:6543` → `:5432` automatically for `pnpm db:push` |

### Schema Operations

`drizzle.config.ts` automatically converts any port 6543 → 5432 in `DATABASE_URL` for `drizzle-kit` operations (`pnpm db:push`). This ensures `drizzle-kit` always uses a direct connection, which is required for DDL operations.

```ts
// drizzle.config.ts
const nonPoolingUrl = process.env.DATABASE_URL.replace(":6543", ":5432");
```

You do not need a separate `DIRECT_URL` variable — just set `DATABASE_URL` to the session-mode pooler URL and the config handles the rest.
