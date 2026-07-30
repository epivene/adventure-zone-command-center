# Daily Operations Package and Resource Migration

Migration `0007_packages_resources` adds package selections, one shared
physical-attraction total, special requests, resource inventory and assignments,
package attribution, and audited conflict overrides. It must run after
`0006_daily_crm_foundation`.

This is a forward-only database migration. Do not use destructive reverse SQL
to drop the new columns or tables. Recovery means restoring the database from
the encrypted pre-migration backup.

## Required safeguards

Before the maintenance window:

1. Confirm the application revision contains migration `0007`, its matching
   snapshot and journal entry, and the reviewed seed runner.
2. Load `DATABASE_URL` and `BACKUP_ENCRYPTION_PASSPHRASE` from separate secret
   stores. Never copy either secret into the repository, shell history, logs, or
   an operations transcript.
3. Create a fresh encrypted custom-format backup with
   `scripts/backup-database.sh`. Record its exact path, size, SHA-256 digest,
   source environment, creation time, and operator.
4. Restore that exact encrypted backup to a verified disposable database with
   `scripts/restore-database.sh` and
   `CONFIRM_DISPOSABLE_DATABASE_RESTORE=I_CONFIRM_THIS_DATABASE_IS_DISPOSABLE`.
5. On the disposable restore, run the preflight, migration, seed, and all
   verification queries in this document. A decryptable backup without a
   successful restore rehearsal is not sufficient.

Follow [Database Backup and Restore](./backup-and-restore.md) for the encrypted
backup and disposable-restore commands. Stop if the backup, digest, restore, or
any validation step fails.

## Rehearse and migrate

Point `DATABASE_URL` at the disposable restored database first:

```bash
bash scripts/preflight-daily-operations-migration.sh
npx drizzle-kit migrate
npm run db:seed
```

The preflight correlates the target schema with Drizzle's default
`drizzle.__drizzle_migrations` metadata using the exact `0007` journal
timestamp. A clean `0006` database has neither the `0007` record nor any
`0007` target relation/booking column and passes. If `0007` is not recorded,
any of the eight table names, eight implicit primary-key index names, seven
explicit unique-index names, two lookup-index names, eight PostgreSQL
table-type names, or either new booking column is treated as a partial
migration or schema collision and blocks migration. Restore the reviewed
pre-migration database backup or obtain a separately reviewed remediation
plan; do not drop/rename objects or insert migration metadata by hand.

The same unapplied-schema gate independently rejects an existing
`bookings_physical_attraction_total_nonnegative` constraint on `bookings`,
even when neither new booking column exists. That constraint is created on a
pre-existing table and therefore is not represented by the new-table relation
inventory.

When `0007` is already recorded, the preflight permits a deliberate rerun only
if all eight target tables/table types exist and all 56 expected columns (54
across those tables plus the two new booking columns) have their expected type,
nullability, and default presence. All 17 indexes must be valid, ready, plain
non-partial/non-expression btree indexes with their expected table, uniqueness,
and ordered columns. All 38 primary-key, foreign-key, and check constraints
must match their expected table/name/type.
Foreign keys are also checked for source columns, target relation/columns,
update/delete actions, and validation; check constraints are checked for their
complete normalized validated expression, rather than matching selected
expression fragments. It then rejects an existing
`adventure_zone`, `weekend_warriors`, `pirates_rebellion`, or
`paintball_trailer` stable code whose defining values are incompatible with
the approved defaults. Do not automatically rewrite or delete an incompatible
row. Stop for reviewed data remediation.

PostgreSQL stores identifiers in at most 63 bytes. Four generated foreign-key
names in `0007` are longer ASCII identifiers and are stored as their
63-character prefixes. The applied-schema check deliberately compares those
expected names in PostgreSQL's stored form. The identifier audit found no
overlength explicit unique index; the longest is exactly 63 characters.

The seed is idempotent by stable code and preserves operator edits. It creates
only missing defaults: Adventure Zone (10), Weekend Warriors (5), Pirates
Rebellion (3), and the movable, counted-once paintball trailer. The paintball
trailer receives only the Weekend Warriors package tag. The migration and seed
must not infer package selections from legacy booking names or notes.

After the disposable rehearsal passes, destroy the disposable database through
the database platform's explicit delete workflow. During the production
maintenance window, create and record a new encrypted backup, run the preflight
against production, and then run the same migrate and seed commands. Any
nonzero exit stops the change.

## Verify rows and constraints

Capture the following output before the backup and after migration. Existing
booking, contact, and Act! link counts must match. Existing booking IDs,
`primary_contact_id`, `act_record_id`, and `notes` must remain unchanged.
Legacy bookings may have a null physical total and approval reason.

```sql
SELECT 'bookings' AS table_name, count(*) FROM bookings
UNION ALL SELECT 'contacts', count(*) FROM contacts
UNION ALL SELECT 'act_external_links', count(*) FROM act_external_links
UNION ALL SELECT 'package_templates', count(*) FROM package_templates
UNION ALL SELECT 'booking_package_selections', count(*) FROM booking_package_selections
UNION ALL SELECT 'booking_special_requests', count(*) FROM booking_special_requests
UNION ALL SELECT 'resources', count(*) FROM resources
UNION ALL SELECT 'resource_package_tags', count(*) FROM resource_package_tags
UNION ALL SELECT 'booking_resource_assignments', count(*) FROM booking_resource_assignments
UNION ALL SELECT 'booking_resource_package_attributions', count(*) FROM booking_resource_package_attributions
UNION ALL SELECT 'resource_conflict_overrides', count(*) FROM resource_conflict_overrides
ORDER BY 1;
```

Verify the stable defaults and the single initial paintball tag:

```sql
SELECT code, name, base_attraction_count, active
FROM package_templates
WHERE code IN ('adventure_zone', 'weekend_warriors', 'pirates_rebellion')
ORDER BY code;

SELECT
  resources.code,
  resources.name,
  resources.category,
  resources.counts_as_attraction,
  resources.movable,
  resources.status,
  package_templates.code AS package_code
FROM resources
LEFT JOIN resource_package_tags
  ON resource_package_tags.resource_id = resources.id
LEFT JOIN package_templates
  ON package_templates.id = resource_package_tags.package_template_id
WHERE resources.code = 'paintball_trailer'
ORDER BY package_templates.code;
```

Require exactly three stable package rows with base counts 10, 5, and 3;
exactly one `paintball_trailer` row with `counts_as_attraction = true` and
`movable = true`; and exactly one paintball tag, to `weekend_warriors`.

Verify all eight tables, the two nullable booking columns, foreign keys, unique
indexes, and check constraints:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'package_templates',
    'booking_package_selections',
    'booking_special_requests',
    'resources',
    'resource_package_tags',
    'booking_resource_assignments',
    'booking_resource_package_attributions',
    'resource_conflict_overrides'
  )
ORDER BY table_name;

SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bookings'
  AND column_name IN (
    'physical_attraction_total',
    'attraction_total_approval_reason'
  )
ORDER BY column_name;

SELECT conname, contype
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND (
    conname LIKE 'booking_package_selections_%'
    OR conname LIKE 'booking_special_requests_%'
    OR conname LIKE 'booking_resource_assignments_%'
    OR conname LIKE 'booking_resource_package_attributions_%'
    OR conname LIKE 'package_templates_%'
    OR conname LIKE 'resource_package_tags_%'
    OR conname LIKE 'resource_conflict_overrides_%'
    OR conname LIKE 'resources_%'
    OR conname = 'bookings_physical_attraction_total_nonnegative'
  )
ORDER BY conname;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'package_templates_pkey',
    'package_templates_code_unique',
    'booking_package_selections_pkey',
    'booking_package_selections_booking_package_unique',
    'booking_special_requests_pkey',
    'resources_pkey',
    'resources_code_unique',
    'resource_package_tags_pkey',
    'resource_package_tags_resource_package_unique',
    'booking_resource_assignments_pkey',
    'booking_resource_assignments_booking_resource_unique',
    'booking_resource_package_attributions_pkey',
    'booking_resource_package_attributions_assignment_package_unique',
    'resource_conflict_overrides_pkey',
    'resource_conflict_overrides_booking_conflict_unique'
  )
ORDER BY indexname;
```

Save the commands, complete output, exit statuses, counts, and reviewer in the
operations log. Do not proceed while a table, column, seed row, relationship,
constraint, or preserved legacy value is missing.

## Recovery

If migration, seed, or verification fails, stop application writes and retain
the failure output. Do not drop tables, drop columns, truncate data, delete seed
rows, or run a handwritten down migration. Provision a clean database and
restore the exact encrypted pre-migration backup using the documented database
restore procedure. Re-run the pre-migration row checks against the restored
database before returning traffic. Diagnose and review the migration separately
before another maintenance window.
