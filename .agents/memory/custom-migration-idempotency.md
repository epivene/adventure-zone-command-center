---
name: Custom migration idempotency
description: Why custom SQL migrations must tolerate schema objects that already exist.
---

Custom forward migrations must be repeat-safe even when their tracking row is absent. Guard columns, indexes, tables, and named constraints individually instead of assuming an untracked migration starts from an old schema.

**Why:** Post-merge setup can run after the aggregate application schema has already created newer objects. Migration tracking may still consider the historical SQL pending, so unconditional `ADD COLUMN`, `ADD CONSTRAINT`, or `CREATE TABLE` statements fail despite the database already having the intended structure.

**How to apply:** Use native `IF NOT EXISTS` where PostgreSQL supports it. For named constraints, query `pg_constraint` by relation and constraint name inside a `DO` block before adding them. Keep real definition or data errors fatal.

Keep tracked SQL filenames stable when correcting migration order; represent prerequisites explicitly instead of renaming historical files.

**Why:** Same-date alphabetical names can put dependent upgrades before the tables they require. Renaming an already tracked file would give it a new identity and could reapply historical data changes.

**How to apply:** Preserve independent migrations’ existing order, run prerequisite files first, and reject missing or cyclic dependencies. A business-data safeguard failure is separate from schema ordering; do not fabricate prerequisite records or mark a failed backfill applied.