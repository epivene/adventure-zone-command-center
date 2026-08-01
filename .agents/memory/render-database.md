---
name: Render database connection
description: How the app connects to the Render-hosted PostgreSQL database in dev and prod.
---

## Connection pattern
The app reads `RENDER_DATABASE_URL` (Replit Secret) first, falling back to the Replit-managed `DATABASE_URL`. `lib/db/src/index.ts` appends `?sslmode=require` automatically when `RENDER_DATABASE_URL` is set and no sslmode param is already present.

**Why:** Replit runtime manages `DATABASE_URL` and it cannot be overridden via setEnvVars/requestSecrets. A separate `RENDER_DATABASE_URL` secret sidesteps this while keeping dev and prod portable.

## Schema state
Render DB schema is fully applied. The `organization_contacts_organization_contact_unique` constraint already existed on the Render DB before this task — drizzle-kit push was not strictly required but was confirmed via psql.

## drizzle-kit push quirk
Running `drizzle-kit push` in a non-TTY shell (ShellExec) fails when Drizzle detects schema differences requiring a data-destructive confirmation prompt. Workaround: apply the SQL directly via psql first, then push succeeds (or skip push when schema is already in sync).

**How to apply:** Always run schema changes via `RENDER_DATABASE_URL="${RENDER_DATABASE_URL}?sslmode=require" pnpm drizzle-kit push` from `lib/db/`. If it hangs on a TTY prompt, apply the SQL via psql directly.
