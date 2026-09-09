# Google Drive backup operations

The export is one-way from Command Center to a dedicated app-owned folder named **Adventure Zone Command Center Backup**. Never select, rename, merge, or reuse Amy's existing Drive folders. The application never deletes Drive content.

## Before enabling

1. Deploy with `GOOGLE_DRIVE_BACKUP_ENABLED=false`.
2. Reconnect the designated company Google account and verify the grant includes `https://www.googleapis.com/auth/drive.file`.
3. In Settings → Google Workspace → Drive backup, create the dedicated root and confirm the displayed account is correct.
4. Run the dry-run preview. Review totals, every year/type bucket, sample paths, and every `Needs Filing` warning.
5. Start a pilot of at most 25 profiles. Do not begin full backfill until counts reconcile and spot checks prove each profile folder contains only the two rolling PDFs.

## Runtime

Set `GOOGLE_DRIVE_BACKUP_ENABLED=true` to start the worker. Optional settings are:

- `GOOGLE_DRIVE_BACKUP_IDLE_POLL_MS` (default 2000)
- `GOOGLE_DRIVE_BACKUP_BATCH_LOW_WATER_MARK` (default 100)
- `GOOGLE_DRIVE_BACKUP_MAX_AUTOMATIC_ATTEMPTS` (default 10)

New app changes use priority 100; backfill uses priority 10. Monitor job counts by status, the latest run, last successful export, and redacted error codes on the admin page.

## Recovery

- 401/403 or missing `drive.file`: processing blocks and state becomes `reauthorization_required`. Reconnect the same account, verify the root, then retry.
- 429/5xx/timeouts: jobs retry with bounded exponential backoff.
- Corrupt/missing object storage: correct the source document, then use owner retry.
- Containment failure: pause immediately. Verify the saved root, folder mappings, and Drive parents; do not repoint the root at an existing personal folder.
- Source removed in Command Center: the mapping is marked removed; the Drive copy remains untouched.

## Pause and rollback

Pause the active run from the admin page and set `GOOGLE_DRIVE_BACKUP_ENABLED=false`. This stops future writes without losing queue state. Do not automatically delete exported files. Resume only after the cause is understood and a small pilot/retry reconciles.
