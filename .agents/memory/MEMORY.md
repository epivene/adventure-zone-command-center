# Memory index

- [Next�Vite/Express port pattern](next-port-pattern.md)  Vercel app port: db shims per artifact, cookie-based managed Clerk, zod v4 alias; where the sharp edges are.
- [Render database connection](render-database.md)  RENDER_DATABASE_URL secret overrides Replit DATABASE_URL; SSL appended automatically; drizzle-kit push TTY workaround.
- [Travel leg ordering invariant](travel-leg-ordering.md)  active legs hold sort positions 1..A, archived legs trail; enforce in the service, not just the UI; schema changes need a tracked lib/db migration.
- [Organization consolidation](org-consolidation.md)  retired profiles stamped with consolidated_into_id; contact FK order, trigger constraint, repeat-safe logic, and redirect detection pattern.
- [Empty database bootstrap](empty-database-bootstrap.md) — bootstrap from one aggregate Drizzle schema; exported composite FKs need unique indexes first and canonical startup object names.
- [Custom migration idempotency](custom-migration-idempotency.md) — forward SQL must tolerate objects already created by the aggregate schema before migration tracking catches up.
