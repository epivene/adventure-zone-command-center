# Database Backup and Restore

These procedures create a PostgreSQL custom-format dump, encrypt it with
GnuPG AES-256, and restore it only from an explicit encrypted file. Run them
from the application repository root.

## Prerequisites

- `pg_dump` and `pg_restore` from the same PostgreSQL major version as the
  database server
- GnuPG 2.x
- An existing, non-symlink backup directory that is not `/`
- `DATABASE_URL` from the deployment secret store
- `BACKUP_ENCRYPTION_PASSPHRASE` from a separate secret store

Do not put either secret in shell history, logs, the repository, or a command
transcript. Load them through the deployment platform's secret injection or a
local password manager, and run `unset DATABASE_URL
BACKUP_ENCRYPTION_PASSPHRASE` when finished.

## Create an encrypted backup

Choose an existing restricted directory and run:

```bash
BACKUP_DIRECTORY=/secure/adventure-zone-backups
./scripts/backup-database.sh "$BACKUP_DIRECTORY"
```

The script requires `DATABASE_URL` and `BACKUP_ENCRYPTION_PASSPHRASE` in its
environment. On success it prints:

```text
Encrypted backup created: /secure/adventure-zone-backups/adventure-zone-YYYYMMDDTHHMMSSZ.dump.gpg
```

The timestamp is UTC. The script exits nonzero if `pg_dump` or GnuPG fails,
removes its plaintext temporary dump through an exit trap, removes a partial
encrypted output, and refuses to overwrite an existing timestamped backup.

Record the encrypted file's path, byte size, SHA-256 digest, database
environment, and creation time in the operations log. Store the digest
separately from the backup:

```bash
sha256sum "$BACKUP_DIRECTORY"/adventure-zone-YYYYMMDDTHHMMSSZ.dump.gpg
```

## Restore only to a disposable test database

Never use a production or shared `DATABASE_URL` for a restore drill. Provision
an empty, disposable PostgreSQL database with separate credentials. Verify the
resolved host and database name with the database administrator before
continuing.

Set `DATABASE_URL` to that disposable target, then name one explicit regular
backup file:

```bash
BACKUP_FILE=/secure/adventure-zone-backups/adventure-zone-YYYYMMDDTHHMMSSZ.dump.gpg
./scripts/restore-database.sh "$BACKUP_FILE"
```

The script requires `DATABASE_URL` and `BACKUP_ENCRYPTION_PASSPHRASE` in its
environment. It refuses a missing path, directory, or symlink. On success it
prints:

```text
Restore completed successfully from /secure/adventure-zone-backups/adventure-zone-YYYYMMDDTHHMMSSZ.dump.gpg.
```

`pg_restore` may print notices while `--clean --if-exists` drops objects that
do not exist in a fresh database. A successful drill requires exit status
zero, the script's success line, and matching validation counts—not merely a
decryptable file.

## Validate the restored rows

Run the same count query against the source database immediately before the
backup and against the disposable restored database:

```bash
psql "$DATABASE_URL" --no-align --tuples-only --command "
SELECT 'organizations', count(*) FROM organizations
UNION ALL SELECT 'contacts', count(*) FROM contacts
UNION ALL SELECT 'travel_legs', count(*) FROM travel_legs
UNION ALL SELECT 'bookings', count(*) FROM bookings
UNION ALL SELECT 'follow_ups', count(*) FROM follow_ups
UNION ALL SELECT 'audit_entries', count(*) FROM audit_entries
UNION ALL SELECT 'act_import_runs', count(*) FROM act_import_runs
UNION ALL SELECT 'act_external_links', count(*) FROM act_external_links
ORDER BY 1;"
```

Save both outputs in the operations log and compare every table count. Also
confirm that `travel_legs` has exactly four rows and inspect a small sample of
booking, follow-up, and audit records. Destroy the disposable database after
validation using the database platform's explicit database-delete workflow;
do not use these repository scripts to delete a database.

## Retention

- Keep 14 daily backups.
- Keep 8 weekly backups.
- Keep 12 month-end backups.
- Keep at least one current copy in a separate encrypted storage location.
- Perform and record a disposable-database restore drill at least quarterly
  and after PostgreSQL major-version or backup-script changes.

Before deleting an expired backup, resolve and review the exact encrypted file
path and confirm that another retained copy has passed a restore drill. Never
run recursive deletion, a wildcard deletion, or deletion against `/`, a home
directory, the repository root, or an unresolved environment variable.

## Verification status for this implementation

On 2026-07-25, behavioral command-contract tests exercised success and failure
paths with controlled PostgreSQL command doubles. The GnuPG 2.4.4 binary was
present, but the sandbox could not start `gpg-agent`, so an actual encryption
round trip could not be completed. The environment did not provide `pg_dump`,
`pg_restore`, `psql`, shellcheck, a PostgreSQL server, or an explicitly
authorized disposable restore database. Therefore no live backup or restore
drill was performed, and no live row-count comparison is claimed.

Complete the production-readiness verification in an environment with those
prerequisites:

```bash
shellcheck scripts/backup-database.sh scripts/restore-database.sh
bash -n scripts/backup-database.sh scripts/restore-database.sh
./scripts/backup-database.sh "$BACKUP_DIRECTORY"
./scripts/restore-database.sh "$BACKUP_FILE"
```

Then run the row-count query above against the source and disposable restore,
record the exact command output and exit statuses, and update the operations
log with the drill date and operator.
