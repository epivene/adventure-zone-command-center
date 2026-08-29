# Memory index

- [Next�Vite/Express port pattern](next-port-pattern.md) — Vercel app port: db shims per artifact, cookie-based managed Clerk, zod v4 alias; where the sharp edges are.
- [Render database connection](render-database.md) — RENDER_DATABASE_URL secret overrides Replit DATABASE_URL; SSL appended automatically; drizzle-kit push TTY workaround.
- [Travel leg ordering invariant](travel-leg-ordering.md) — active legs hold sort positions 1..A, archived legs trail; enforce in the service, not just the UI; schema changes need a tracked lib/db migration.
- [Organization consolidation](org-consolidation.md) — retired profiles stamped with consolidated_into_id; contact FK order, trigger constraint, repeat-safe logic, and redirect detection pattern.
- [Empty database bootstrap](empty-database-bootstrap.md) — bootstrap from one aggregate Drizzle schema; exported composite FKs need unique indexes first and canonical startup object names.
- [Custom migration idempotency](custom-migration-idempotency.md) — forward SQL must tolerate objects already created by the aggregate schema before migration tracking catches up.
- [Canvas presentation](canvas-presentation.md) — canvas screenshots use the registered artifact directory label; live previews are presented by registered artifact ID.
- [Navigation progressive disclosure](navigation-progressive-disclosure.md) — desktop and mobile navigation intentionally use different disclosure levels while sharing the same route inventory.
- [Plain organization merge safety](plain-organization-merge-safety.md) — plain duplicate merges must reparent every org reference and delete only inside one outer transaction.
- [Design Studio ownership boundary](design-studio-boundaries.md) — Marketing owner sessions map to an enabled Office account so Studio records remain scoped and auditable across workspaces.
- [Design Studio autosave safety](design-studio-autosave.md) — autosave acknowledgements must not mark newer in-flight edits as saved.
- [Role login routing boundary](role-login-routing.md) — broad owner middleware must not intercept Office, Manager, or development login routes.
- [PostgreSQL prepared DO blocks](postgres-prepared-do-blocks.md) — application parameters are not visible inside dollar-quoted DO bodies; guard optional tables outside PL/pgSQL.