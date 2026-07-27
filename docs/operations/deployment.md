# Deployment and Release Operations

Stage 1 is a private, single-owner application. Do not expose a deployment
until database migrations, owner authorization, authenticated acceptance
tests, and a disposable-database restore drill have all passed.

## Prerequisites

- Node.js 20.9 or newer
- PostgreSQL with TLS and automated platform-level snapshots
- A Clerk application with one authorized owner
- A production hosting environment that supports Next.js
- PostgreSQL client tools, GnuPG 2.x, and ShellCheck on the operations runner
- A separate disposable PostgreSQL database for restore drills

Install exactly the committed dependency graph:

```bash
npm ci
```

## Production configuration

Store every value in the deployment platform's secret/configuration store.
Never commit values to `.env.example`, logs, screenshots, or support tickets.

| Name | Purpose | Exposure |
| --- | --- | --- |
| `DATABASE_URL` | TLS PostgreSQL connection used by the app and migrations | Secret |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk browser initialization | Public by design |
| `CLERK_SECRET_KEY` | Clerk server authentication | Secret |
| `OWNER_CLERK_USER_ID` | Exact Clerk user ID allowed into private routes | Secret configuration |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MapLibre-compatible style URL | Public by design |
| `BACKUP_ENCRYPTION_PASSPHRASE` | AES-256 database-backup encryption | Secret; store separately from backups |

Set `OWNER_CLERK_USER_ID` to the owner's exact Clerk user ID, not an email
address or display name. Sign in as the owner and confirm `/today` loads. Then
sign in with a separate authenticated test user and confirm private pages are
rejected. Do not weaken owner checks to make a test account work.

`NEXT_PUBLIC_MAP_STYLE_URL` must point to a production MapLibre style whose
tiles and glyphs permit the deployed origin. Because this name begins with
`NEXT_PUBLIC_`, never place a private provider token in it unless that token is
specifically designed for browser exposure and restricted by origin and quota.
If the value is empty, the app uses its plain local fallback style.

## Database migration and four-leg seed

Take and verify an encrypted backup before changing an existing production
database.

### Existing-database preflight

Before applying migration `0002_stage_one_final_guards` to any database that
already contains Adventure Zone data, restore the current encrypted backup to
an explicitly disposable database. Point `DATABASE_URL` at that disposable
copy and run:

```bash
npm run db:preflight
```

The command executes the equivalent of these read-only checks:

```sql
SELECT entity_type, act_record_id, count(*) AS link_count
FROM act_external_links
GROUP BY entity_type, act_record_id
HAVING count(*) > 1;

SELECT id, name, color, sort_order
FROM travel_legs
WHERE sort_order NOT BETWEEN 1 AND 4
ORDER BY sort_order, id;
```

Both result sets must contain zero rows. Duplicate Act! link owners would block
the new unique index, and out-of-range travel-leg rows would block the new check
constraint. If either query returns rows, stop. Do not delete, merge, renumber,
or otherwise rewrite the rows automatically. Preserve the query results and
use a separately reviewed data-remediation procedure that identifies the
correct records from business evidence and records an audit trail.

After a zero-result preflight, rehearse the migration and seed against the
disposable copy:

```bash
npx drizzle-kit migrate
npm run db:seed
```

Run the verification queries below and the release gate against that migrated
copy. Only after the rehearsal succeeds may the production maintenance window
proceed. Immediately before the production migration, take a fresh encrypted
backup and run `npm run db:preflight` again against production. A nonzero result
or any preflight error stops the production migration.

For a brand-new, verified-empty database, the existing-data preflight does not
apply because the application tables do not exist yet; apply the committed
migrations, seed, and then run all post-migration verification. If there is any
uncertainty about whether a database is empty, treat it as an existing database
and stop for operator review.

The seed inserts missing defaults for sort orders 1–4 and does nothing when a
slot already exists. Reseeding therefore preserves operator-configured names
and colors. The migration enforces unique sort orders and rejects values
outside 1–4; together with the four required seed slots, that gives the
application exactly four independently configurable travel legs. Advertised
packages are not routes.

Verify both the count and the complete ordered list:

```sql
SELECT count(*) AS travel_leg_count
FROM travel_legs;

SELECT name, color, sort_order
FROM travel_legs
ORDER BY sort_order;
```

The count must be exactly `4`, and the list must contain sort orders `1`, `2`,
`3`, and `4`, once each. If either check differs, stop the release and
escalate for an explicit data review. Do not delete operational data
automatically. Resolve it through a separately reviewed data-change procedure,
then rerun both queries and the release gate. Confirm the four legs are
visible and editable on Routes before accepting bookings. Renaming or
recoloring a leg is operational data management; a later seed run must leave
those values unchanged.

## Business-date policy

Stage 1 interprets booking dates, follow-up due dates, Today sections, calendar
days, and map date filters in the `America/Chicago` business time zone.
Date-only form values are stored as Chicago-local noon instants so they keep
the same calendar date through UTC conversion and daylight-saving changes.
Day boundaries are Chicago midnights and can therefore span 23, 24, or 25
hours. Do not replace this policy with server-local or browser-local date
comparisons.

## Build and deploy

Run the complete release gate against the exact commit being deployed:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
shellcheck scripts/backup-database.sh scripts/restore-database.sh
```

The Playwright run must use a migrated disposable/test database,
`PLAYWRIGHT_AUTH_STATE` for the configured owner, and installed Chromium.
Critical-path tests may not be skipped. Do not create the `stage-1-ready` tag
unless every command exits zero and the manual checklist in the implementation
plan passes.

Deploy the immutable build artifact while retaining the previous successful
deployment. After deployment:

1. Request `GET /api/health` and require HTTP 200 with `{"status":"ok"}`.
2. Sign in as the configured owner and confirm the installed/root flow opens
   `/today`.
3. Confirm an unauthenticated request to a private page is sent to sign-in.
4. Confirm a non-owner authenticated user cannot open a private page.
5. Open Today, Bookings, Calendar, Routes, Import, and Quick Add at phone and
   desktop widths.
6. Confirm no private API, HTML, booking, contact, contract, or route response
   appears in Cache Storage.

The health endpoint proves only that the web process responds. It does not
replace authenticated database checks.

## Backup schedule and restore evidence

Run `scripts/backup-database.sh` every day from a restricted operations runner.
Keep 14 daily, 8 weekly, and 12 month-end encrypted backups, with at least one
current copy in a separate encrypted location. Alert on any nonzero exit and
record each file's path, size, SHA-256 digest, environment, and UTC creation
time.

Follow [backup-and-restore.md](./backup-and-restore.md) for command details.
Perform a restore into an explicitly disposable database at least quarterly,
after backup-script changes, and before the initial Stage 1 release. Compare
all table counts and inspect sample records. A created backup is not proven
restorable until that drill succeeds. The restore command additionally
requires the one-off exact confirmation phrase documented there; do not store
that confirmation in application configuration or a shared environment file.

## Rollback

If health, authentication, private-cache, or database smoke checks fail:

1. Stop routing new traffic to the failed deployment.
2. Select the immediately previous known-good immutable deployment in the
   hosting platform and restore traffic to it.
3. Re-run the health, owner-authentication, and private-cache checks.
4. Do not reverse a database migration automatically. First inspect whether
   the previous application version is compatible with the migrated schema.
5. If data restoration is required, stop writes, preserve the failed database,
   and restore a named encrypted backup to a new database using the documented
   procedure. Validate counts before changing the production connection.
6. Record the failed commit, previous deployment ID, timestamps, symptoms,
   database decision, and operator in the incident log.

Never use `git reset`, delete migrations, or run an unreviewed SQL downgrade as
a production rollback.
