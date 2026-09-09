# Google Drive Backup Export Design

**Status:** User-approved design; pending implementation plan  
**Date:** 2026-09-09

## Goal

Add a one-way Google Drive backup exporter to Adventure Zone Command Center. The exporter preserves business documents and readable profile/follow-up summaries in an app-owned Drive folder while keeping Amy's existing Drive organization untouched.

The backup must be useful to a human browsing Drive, remain compact as profiles accumulate activity, recover safely from transient failures, and never create a second editable CRM source of truth.

## Approved product decisions

- Command Center remains the source of truth for app-created and app-managed data.
- Google Drive is a one-way backup destination, not a two-way synchronization surface.
- The app writes only inside a dedicated root named `Adventure Zone Command Center Backup`.
- The backup root is structurally separate from Amy's existing Drive folders.
- The first release exports:
  - protected business documents;
  - current profile summaries;
  - current and recent follow-up summaries.
- Email history appears only as date, sender, subject, short summary, and an app link. Full email bodies are not exported.
- A one-time, paced backfill exports all existing eligible app data before normal incremental operation catches up.
- Profile folders remain compact: normally two current PDF files, updated in place.
- Individual notes, calls, emails, and follow-ups do not become separate Drive files.
- Drive backup copies are never deleted automatically when an app record is deleted or archived.

## Relationship to the existing Google Workspace integration

The current Google Workspace design and business-document importer remain authoritative for Google-to-app ingestion:

- approved Drive and Gmail sources may be copied into the Command Center;
- Google originals remain untouched;
- matching and review remain conservative and auditable.

This feature adds the opposite, isolated direction for app-owned backups:

```text
Approved Google sources -> Command Center canonical storage
Command Center canonical storage -> App-owned Drive backup root
```

An imported Drive file must not loop back into Drive as an uncontrolled duplicate. If it is later exported for backup, the exporter uses the Command Center document identity and a stable export mapping so exactly one backup copy is maintained.

## Approaches considered

### 1. Dedicated app-owned backup root — selected

Create and maintain a predictable folder tree under `Adventure Zone Command Center Backup`.

Benefits:

- clean separation from Amy's working folders;
- narrow write permissions;
- deterministic placement;
- reliable duplicate prevention;
- easier audit and recovery.

### 2. Write directly into Amy's existing folders — rejected

This feels familiar but inherits inconsistent names, permissions, ownership, and historical organization. It also increases the risk of collisions or of the app changing a human-managed file.

### 3. Add backup subfolders throughout Amy's existing tree — rejected

This improves separation somewhat, but the app would still need to understand and write across a shifting human-managed hierarchy. It is harder to secure and maintain than one controlled root.

## Drive folder structure

```text
Adventure Zone Command Center Backup/
├── Profiles/
│   ├── Colorado/
│   │   └── Gold Rush Days (Victor) CO/
│   │       ├── Profile Summary.pdf
│   │       └── Follow-ups.pdf
│   ├── Idaho/
│   ├── Montana/
│   ├── Nevada/
│   ├── New Mexico/
│   ├── Utah/
│   ├── Wyoming/
│   └── Other or Unknown/
├── Documents/
│   ├── 2026/
│   │   ├── Contracts/
│   │   │   └── Gold Rush Days (Victor) CO/
│   │   ├── COIs & Insurance/
│   │   ├── Receipts/
│   │   ├── Applications/
│   │   ├── Inspections/
│   │   ├── Maintenance/
│   │   ├── Reviews/
│   │   ├── Templates/
│   │   └── Other/
│   └── Unknown Year/
└── Needs Filing/
```

Folder components use sanitized display names plus stable identity metadata stored in the Command Center. Renaming a profile changes the display path through a controlled move of app-owned folders; it does not produce a second folder.

The state folder comes from the verified profile location. A missing or ambiguous state uses `Other or Unknown`.

The document year is selected in this order:

1. linked booking/event year;
2. confirmed document year metadata;
3. trustworthy date parsed during approved classification;
4. `Unknown Year`.

A document without a confident profile or category match goes to `Needs Filing`. The exporter never guesses a profile based only on weak filename similarity.

## Compact profile backups

Each profile folder normally contains two files.

### Profile Summary.pdf

The current snapshot includes:

- organization/event name and status;
- verified address and location;
- contacts and roles;
- website and approved communication details;
- relationship notes;
- booking history and current booking status;
- latest contact date;
- recent calls and note summaries;
- email date, sender, subject, short summary, and app link;
- links to exported documents;
- generation timestamp and stable Command Center profile ID.

### Follow-ups.pdf

The current snapshot includes:

- all open follow-ups;
- due date, type, owner, profile/contact, and description;
- completed and dismissed follow-ups from the most recent 12 months;
- completion/dismissal date where available;
- app links;
- generation timestamp and stable profile ID.

The exporter replaces the content of these same two Drive file identities. It does not create daily or per-edit PDFs. Google Drive version history provides recoverable prior versions without cluttering the folder.

A profile with no follow-up history may omit `Follow-ups.pdf` until the first follow-up exists. Once created, the file remains and may show that no follow-ups are currently open.

## Document backups

Eligible canonical business documents are copied in their original format. Examples include contracts, proposals, COIs, insurance files, W-9s, permits, vendor applications, inspections, deposit receipts, maintenance records, event reviews, operational templates, and marketing files.

Placement is determined by year, approved document type, and linked profile. Unclassified or ambiguously linked documents remain in `Needs Filing`.

The exporter records:

- Command Center document ID;
- Drive file ID;
- destination folder ID;
- exported checksum and size;
- source version identity;
- last successful export time;
- last attempted export time;
- current export status.

If document bytes and destination are unchanged, the job is a no-op. A changed canonical document updates the existing app-owned Drive file so version history is retained.

## Authorization and containment

The existing read-only Google ingestion scopes remain unchanged for intake.

The backup exporter requests the narrow Google Drive permission needed to create and update app-created files, preferring `drive.file` rather than broad Drive write access. The app creates or explicitly adopts one backup root and stores its Drive folder ID.

Every write operation must verify that the target is the configured backup root or a descendant created/adopted by the exporter. The exporter must refuse to write to Amy's source folders even when the connected account can access them.

Only owners/administrators may:

- connect or reconnect the backup destination;
- select/adopt the backup root;
- run previews, pilots, and backfills;
- retry failed exports;
- change backup configuration.

Server-side authorization is required for every configuration and export-status endpoint.

## Components

### Backup configuration service

Owns the connected account, granted scope state, root folder ID, enablement state, and reconnect requirements.

### Backup path resolver

Converts verified profile/document metadata into a deterministic, sanitized logical path. It does not call Google APIs and is independently testable.

### Profile summary renderer

Builds the approved profile and follow-up snapshot models and renders accessible PDFs. It excludes full email bodies and unapproved private data.

### Drive export client

Creates folders, creates files, replaces file content, moves app-owned files after deterministic path changes, and reads app-owned file metadata required for reconciliation.

### Durable export outbox

Records export intent in the same database transaction as the successful app change. This prevents an app change from being committed without a recoverable export job.

### Export worker

Claims queued jobs, coalesces repeated changes, renders or retrieves content, resolves the destination, and performs idempotent Drive writes.

### Backup administration UI

Shows configuration, preview results, pilot/backfill progress, last success, queued/failed counts, safe error messages, reconnect state, retry controls, and a link to the backup root.

## Data flow

### Incremental profile change

1. A profile, contact, booking, note, call outcome, email summary, or follow-up change commits successfully.
2. The same transaction inserts or refreshes an outbox request for the affected profile.
3. Repeated requests for the same profile are coalesced during a short debounce window.
4. The worker builds the current summary snapshots.
5. The path resolver selects the profile folder.
6. The Drive client updates the stable summary file IDs or creates them once.
7. The export mapping and job status commit.

### Incremental document change

1. A canonical business document is created, updated, classified, or relinked.
2. The transaction creates or refreshes a document export request.
3. The worker verifies canonical bytes, classification, year, and profile link.
4. Ambiguous placement routes to `Needs Filing`.
5. The worker uploads or updates the stable Drive file.
6. The mapping and checksum commit.

### Deletion or archival

The exporter never automatically deletes a Drive file.

- Archived profiles are marked archived in the next profile summary.
- Deleted/removed follow-ups disappear from the current open section and may be represented in recent history when the app preserves an audit event.
- Deleted canonical documents retain their last successful Drive backup. The admin UI marks the export mapping as source removed.
- A future explicit purge workflow is outside this release.

## Duplicate and loop prevention

The system uses stable app identities, not filenames, as authority.

Unique mappings cover:

- profile ID plus summary kind;
- document ID plus exported source version.

Checksums prevent unchanged uploads. Stored Drive file IDs allow rename/move/update behavior without creating a second file.

If a user manually renames or moves an app-owned backup file within the backup root, the exporter may restore the deterministic name/path on the next change or reconciliation pass. If a file is manually deleted from Drive, the next job recreates it and updates the stored Drive ID.

Google-ingested source identity and exported backup identity remain separate fields. An export never becomes a new intake record solely because it appears in Drive.

## Reliability and error handling

Jobs have explicit states: `queued`, `processing`, `succeeded`, `retry`, `blocked`, and `failed`.

- Transient Google errors, timeouts, and rate limits retry with capped exponential backoff.
- A Render restart leaves queued/retry jobs durable and reclaimable.
- Lost authorization marks jobs `blocked`, preserves them, and displays `Reconnect Google Drive`.
- One bad profile or document does not stop the queue.
- Permanent failures expose allow-listed error codes and actionable admin guidance.
- Logs never contain document bytes, full email bodies, signed URLs, authorization tokens, or sensitive identifiers.
- Successful reruns are idempotent.
- Backfill and incremental work share the same job mechanism; current incremental changes receive priority over old backfill work.

## Administration experience

The Admin Tools backup page shows:

- connected Google account;
- configured backup root and Drive link;
- permission/reconnect state;
- last successful export;
- queued, blocked, retrying, and failed counts;
- initial backfill progress;
- preview and pilot summaries;
- `Retry failed`, `Resume backfill`, and `Pause backfill` controls.

A profile may show a small backup status/link for administrators, but normal booking work must not depend on Drive availability.

No success toast claims a backup occurred until Drive confirms the file write and the mapping commits.

## Initial backfill and rollout

The release uses the same cautious gates as the business-document importer.

1. Deploy schema, configuration, renderer, worker, and admin UI with exporting disabled.
2. Connect the intended Google account and grant the narrow write scope.
3. Create/adopt `Adventure Zone Command Center Backup`.
4. Run a dry-run inventory showing planned profile/document counts and folder distribution without Drive writes.
5. Run a pilot of no more than 25 representative exports.
6. Verify:
   - profile folders contain at most the expected summary PDFs;
   - documents are under the correct year/type/profile path;
   - links open;
   - rerunning the pilot creates no duplicates;
   - Amy's folders are unchanged.
7. Reconcile pilot counts before enabling more work.
8. Start the paced historical backfill newest/active-first.
9. Allow incremental jobs to run ahead of older backfill jobs.
10. Enable normal automatic export only after reconciliation passes.
11. Retain pause/retry/reconnect controls permanently.

Backfill is restart-safe and may be paused without losing progress.

## Testing

### Unit tests

- folder-name sanitization and stable path generation;
- state/year/type fallback rules;
- profile and follow-up snapshot contents;
- full email body exclusion;
- 12-month completed/dismissed follow-up window;
- checksum and no-op decisions;
- export coalescing;
- retry classification;
- containment checks that reject paths outside the configured root.

### Integration tests

- transactional outbox creation with profile/document changes;
- PDF generation;
- create then update using the same Drive file ID;
- document version update;
- profile rename/move without duplication;
- unknown classification routing;
- lost authorization and reconnect recovery;
- interrupted job reclaim;
- manually missing Drive file recreation;
- backfill pause/resume;
- Google-ingested document export without re-ingestion loops;
- server-side role restrictions.

### Pilot acceptance

- planned count equals succeeded plus no-op plus review/blocked plus failed;
- second identical run creates zero new logical backup files;
- each sampled profile has no more than two summary PDFs;
- sampled documents match canonical checksums;
- Amy's existing folders have no writes, moves, or deletions;
- errors contain only safe codes and counts;
- queued work survives a deployment restart.

## Security and privacy

- OAuth credentials remain encrypted using the existing Google connection patterns.
- The exporter uses the least-privileged Drive scope available.
- Root containment is checked server-side for every write.
- PDF summaries include only data already authorized for the owner/admin CRM views.
- Full email bodies are excluded.
- Sensitive file content and tokens are excluded from logs and error reports.
- Drive links are shown only to roles already authorized to access the corresponding app content.

## Non-goals

This release does not:

- synchronize human edits from backup PDFs into the Command Center;
- write into Amy's existing folder hierarchy;
- export full Gmail bodies or create one file per communication;
- delete Drive backups automatically;
- make Drive required for normal CRM use;
- replace the Command Center's canonical Google Cloud document storage;
- export leg-manager-inaccessible data to a broadly shared folder;
- provide disaster-recovery import from the backup tree.

A future restore/import workflow may be designed separately after the exporter is stable and its backup format has proven useful.

## Success criteria

The feature is successful when:

- all eligible existing app profiles and documents complete a reconciled backfill;
- subsequent relevant app changes reach Drive automatically;
- each profile folder stays compact, normally two current PDFs;
- documents are discoverable by year, type, and profile;
- reruns and retries do not create duplicates;
- authorization failures preserve work and recover after reconnect;
- Amy's existing Drive structure is never modified;
- the app remains usable when Drive is unavailable.
