# Memory index

- [Next→Vite/Express port pattern](next-port-pattern.md) — Vercel app port: db shims per artifact, cookie-based managed Clerk, zod v4 alias; where the sharp edges are.
- [Render database connection](render-database.md) — RENDER_DATABASE_URL secret overrides Replit DATABASE_URL; SSL appended automatically; drizzle-kit push TTY workaround.
- [Travel leg ordering invariant](travel-leg-ordering.md) — active legs hold sort positions 1..A, archived legs trail; enforce in the service, not just the UI; schema changes need a tracked lib/db migration.
