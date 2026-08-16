# ACT Archive Full Recovery Design

**Status:** Approved design

**Date:** 2026-08-16

## Goal

Recover as much useful CRM data as possible from the permanent ACT! archive into the existing Adventure Zone Command Center without re-running a broad live ACT import, overwriting current local work, creating duplicates, or silently discarding records that cannot be placed safely.

The archive is the source of truth for this recovery. The job must exhaust the archived data so every usable archived record ends in a visible, auditable terminal state: already present, recovered, needs review, or dropped as unusable.

## User decisions

- Use an **archive-first full recovery** approach.
- Do not create a second app or database.
- Preserve recovered ACT historical records as **read-only originals**.
- Local corrections are added as new local notes rather than rewriting imported history.
- Include documents/attachments when the actual file is already durably available to the application.
- Drop attachment/document metadata when the file itself cannot be opened or recovered.
- Do not depend on a fresh broad ACT API pull for this recovery.
- Recover as much as can be safely proven from archived ACT identities and relationships.

## Existing archive capabilities

The permanent ACT replacement archive already stores root records for:

- companies
- contacts
- opportunities
- groups
- activities
- notes
- history

It also stores relationship records for ACT parent/target pairs, including:

- contact ↔ company
- opportunity ↔ company
- opportunity ↔ contact
- group ↔ contact
- activity ↔ contact/company/opportunity
- note ↔ contact/company/opportunity
- history ↔ contact/company/opportunity

The relationship archive preserves the parent ACT record ID, target kind, and target ACT record ID. Recovery therefore uses exact source identity and relationship evidence rather than fuzzy name matching for timeline ownership.

The current archive schema does **not** define a dedicated document/attachment stream. Attachment recovery is therefore opportunistic: only durable file bytes or application-owned file references that were already captured elsewhere may be imported. A metadata-only attachment, dead ACT URL, or file that cannot actually be opened is dropped and is not represented by a placeholder.

## Scope

### Recoverable entity data

The recovery job covers:

1. Organizations/companies.
2. Contacts.
3. Organization-contact relationships.
4. Opportunities/bookings.
5. Booking-contact relationships.
6. Groups/calling-list membership where the source can still be represented safely.
7. Notes.
8. ACT history.
9. Email-history entries represented by ACT history records.
10. Activities and calendar-capable ACT activity records.
11. Missing timeline-to-organization/contact/booking associations.
12. Downloadable documents/attachments already durably available to the application.

### Out of scope

- Replacing current nonblank local CRM fields with differing ACT values.
- A broad new live ACT extraction/import run.
- Guessing record ownership from similar names when exact source relationships are absent.
- Creating dead document placeholders.
- Deleting or rewriting newer local notes, calls, bookings, contacts, or profile edits.

## Architecture

Recovery is a separate, restartable post-migration pipeline operating inside the existing API server and database.

The pipeline reads from the permanent archive tables, resolves source records to existing local entities using ACT source identity and archived relationships, then applies only additive or fill-missing changes. It writes recovered timeline records into the existing `activities` model and uses `activity_associations` for all resolved parents so one ACT record may remain associated with multiple valid local entities.

Existing source/provenance structures remain authoritative:

- `act_source_records` identifies each archived ACT source record.
- `act_source_record_versions` provides the latest archived raw snapshot.
- relationship stream records provide exact ACT parent/target evidence.
- `act_external_links` maps ACT company/contact/opportunity/group identities to local organization/contact/booking/calling-list entities.
- `activities.source_record_id` identifies imported timeline records and provides idempotency/provenance.
- `activity_associations` preserves organization/contact/booking visibility for imported timeline records.

Dedicated recovery-run state is added within the existing database so progress and classification survive Render restarts. Recovery does not rely on in-memory counters as its source of truth.

## Durable recovery states

Every source considered by the recovery run must reach exactly one of these terminal classifications:

### `already_present`

The source is already represented locally by its ACT source identity. Existing local data is not duplicated.

### `recovered`

The source was safely added or a missing relationship/blank field was filled.

### `needs_review`

The source contains meaningful data, but placing it automatically would require a guess. The original ACT content and available candidate destinations remain visible in the Recovery Review UI.

### `dropped_unusable`

The archived item has no useful user-visible content or an attachment has no recoverable file. Examples include a truly blank timeline record or dead metadata-only attachment.

### `retryable_failed`

A temporary database/storage failure prevented classification or application. This is not a terminal success state; the worker retries it until it reaches one of the four terminal classifications above or the run is explicitly stopped with a visible failure.

There is no hidden `unlinked` terminal bucket.

## Recovery ordering

Recovery runs in dependency order so timeline ownership can be resolved against the best available local graph:

1. Company/organization identities.
2. Contact identities.
3. Organization-contact relationships.
4. Opportunity/booking identities.
5. Booking-contact and organization-booking context.
6. Group/calling-list relationships.
7. Notes, history, email history, and activities.
8. Timeline associations.
9. Recoverable attachments/documents.
10. Final reconciliation and report.

## Entity recovery policy

### Existing linked entities

If an archived ACT identity already has an `act_external_links` mapping, the recovery uses that local entity.

For organization/contact/booking fields:

- a nonblank local value always wins;
- an ACT value may fill a local null/blank field;
- recovery never overwrites a populated local value merely because ACT differs;
- every fill-missing write is auditable as ACT recovery.

### Missing source identities

If a source has no local mapping, recovery reuses the existing deterministic archive match/review rules rather than inventing a second matcher.

- Exact deterministic match: link to the existing local entity.
- No match and enough required source data to create a valid local entity: create it and add provenance.
- Ambiguous or conflicting match: `needs_review`.
- Source too malformed to form a useful entity: `dropped_unusable`.

This permits recovery of genuinely missing companies, contacts, and opportunities while protecting against duplicate profiles.

## Relationship recovery policy

Exact ACT relationship evidence is preferred over display text.

For a relationship record, recovery resolves both sides by source identity. If the relationship is valid and missing locally, it inserts the corresponding local relationship without moving or deleting unrelated local relationships.

A source may legitimately have multiple parents. Recovery preserves all valid associations instead of forcing a single parent.

Conflicting identity mappings or relationships that cannot resolve both sides without guessing are sent to `needs_review`.

## Timeline recovery policy

Timeline source types are `note`, `history`, and `activity`.

### Content normalization

Recovery reuses the existing timeline normalizer so ACT field variations are handled consistently, including:

- note body / note text;
- history details;
- history `regarding` when long-form details are empty;
- activity subject/details;
- ACT dates such as display date, create date, start time, schedule date, or archived capture time as the explicit fallback.

A meaningful subject may serve as the body when ACT supplies no long-form details. A record is only dropped as unusable when it has no meaningful user-visible content after normalization.

### Parent resolution

For each archived note/history/activity:

1. Find its archived relationship records by the exact ACT parent record ID.
2. Resolve each related ACT company/contact/opportunity identity to the local organization/contact/booking via source provenance.
3. If at least one local parent resolves safely, import one local activity row for the source and create all valid `activity_associations`.
4. If the activity row already exists by source identity, create only any missing associations.
5. If meaningful content exists but no parent can be safely resolved, classify it as `needs_review` rather than dropping it.

### Idempotency

One archived ACT source record corresponds to at most one local timeline activity row. Re-running recovery must create zero duplicate activity rows. Missing associations may still be added on a later run.

## Read-only imported history

Recovered ACT timeline records are historical source records and are read-only.

Server-side activity mutation rules must enforce this, not just the UI:

- an activity with ACT source provenance cannot be edited;
- an activity with ACT source provenance cannot be deleted;
- users may add a new local note/correction alongside it;
- imported records display an `Imported from ACT` marker and their source type (`Note`, `History`, `Email history`, or `Activity`).

Existing locally created notes and call outcomes retain their current edit/delete behavior.

## Email history

ACT email-history rows are preserved as history timeline entries. Recovery does not attempt to recreate them as Gmail messages or send email.

When the archived record clearly represents an email history item, the timeline displays the email-history type, original ACT date, subject/details available in the source, and `Imported from ACT` provenance.

## Calendar activities

Archived ACT activities that normalize as calendar-capable retain their source occurrence/start date and end date when available. They are recovered into the existing activity/calendar representation without overwriting current bookings or calendar entries.

If an ACT activity would duplicate an already imported source identity, it is `already_present` rather than recreated.

## Documents and attachments

Attachment recovery is strictly file-backed.

A document/attachment is imported only when the application already possesses usable bytes or a durable application-owned file reference that can be opened during recovery. The file is copied/registered into the Command Center's own storage and linked to the resolved profile/contact/booking context.

If only metadata, a dead external ACT link, or an inaccessible file reference exists, the item is `dropped_unusable`. No placeholder is shown.

Because the current permanent archive has no dedicated attachment stream, archive-first recovery does not make broad live ACT requests to manufacture missing attachment data.

## Recovery worker

The worker processes bounded batches and persists a cursor/classification for each source record.

Requirements:

- restart-safe after process or Render restarts;
- idempotent on repeated execution;
- bounded batch size;
- lease/claim semantics so two workers cannot apply the same item concurrently;
- retry temporary database/storage failures;
- never mark a run complete while retryable work remains;
- expose current counts by source type and classification;
- safe to run again after later profile merges or relationship fixes.

The worker does not hold one transaction for the entire archive. Each item or small batch is an independent recovery boundary.

## Recovery Review UI

Add an **ACT Recovery** admin screen using the existing Command Center shell.

The summary shows:

- archived candidates;
- checked;
- already present;
- recovered;
- needs review;
- dropped unusable;
- retryable failures;
- breakdown by source type.

The review list shows the original ACT content, source type/date, exact archived relationship evidence, and candidate local destinations.

For review items the user can:

- assign the source to an organization, contact, or booking when valid for that source type;
- keep a meaningful timeline source unassigned only when explicitly chosen;
- ignore/drop an unusable source;
- retry after fixing profile/source relationships.

A review decision is durable and auditable.

## Profile presentation

Recovered timeline items appear in the normal profile history/timeline so the profile becomes operationally complete.

The profile should not require the user to know whether an item came through the original migration, archive recovery, or a later association repair. Provenance remains visible on each imported row, but ACT history belongs in the same chronological history experience as local notes and calls.

The temporary/legacy `migrationHistory.notes` display remains useful for old merged-profile data, but archive-recovered source records should become proper timeline items rather than a second permanent history system.

## Safety rules

1. Never overwrite a populated local CRM field automatically.
2. Never duplicate a source record already represented locally.
3. Never fuzzy-attach timeline history when exact archived relationships do not resolve.
4. Never silently discard meaningful unplaceable content.
5. Never edit/delete imported ACT historical records.
6. Never create a dead attachment placeholder.
7. Never require a second database.
8. Never require a broad fresh ACT import to complete archive recovery.
9. Every source classification and applied mutation must be auditable.

## 16th Street Fair regression case

`16th Street Fair (Denver) CO` is the primary real-world regression fixture for this project.

Observed behavior before recovery:

- ACT! shows `Histories: 7` for the company/profile.
- The Command Center profile contains the organization and contact but shows no timeline history.
- The ACT rows include email-history entries plus older relationship/contact history.

Acceptance behavior:

1. The recovery job finds every one of those seven records that exists in the permanent archive.
2. Each archived record is classified explicitly.
3. Every meaningful archived row whose exact ACT relationship resolves to the profile/contact is visible on the Command Center profile after recovery.
4. No row is duplicated on a second recovery run.
5. If the permanent archive contains fewer than the seven records currently visible in ACT, the recovery report explicitly shows the archive gap instead of implying all seven were recovered.
6. No local note, call outcome, contact edit, or booking value is overwritten to achieve the recovery.

The end-to-end fixture should use archived test data shaped like the real 16th Street Fair case rather than depending on live ACT access during CI.

## Reconciliation report

A completed run produces durable totals for the whole archive and per source type.

Example shape:

```text
Archived candidates: 4,812
Already present:    3,900
Recovered:            740
Needs review:           22
Dropped unusable:      150
Retryable failed:        0
```

The exact numbers are data-dependent. Completion requires the arithmetic to reconcile to the candidate population and requires zero unclassified records.

For known ACT-vs-archive spot checks such as 16th Street Fair, the report additionally records the archive count so a missing extraction can be distinguished from a failed recovery.

## Testing strategy

### Unit tests

Cover:

- source classification;
- timeline normalization for note/history/email/activity variants;
- exact relationship resolution;
- deduplication by source identity;
- fill-missing versus overwrite protection;
- attachment file-backed/drop behavior;
- review classification for meaningful unplaceable sources.

### Database integration tests

Prove:

- recovery writes one activity per source record;
- multiple valid parent associations are preserved;
- a second run creates no duplicate rows;
- a second run can add a previously missing association;
- local nonblank fields are never overwritten;
- imported ACT activities cannot be edited or deleted;
- restart/reclaim behavior does not double-apply a batch;
- recovery totals reconcile exactly.

### API/UI tests

Prove:

- ACT Recovery status and review counts are visible;
- review decisions are durable;
- imported source type/provenance appears on the profile;
- local notes remain editable;
- imported ACT history is read-only;
- the 16th Street Fair fixture surfaces its archived recoverable history.

### Build/CI gates

Before merge:

- targeted API tests pass;
- targeted frontend tests pass;
- API build passes;
- frontend production build passes;
- the recovery schema migration is exercised against a clean test database;
- the idempotency regression suite passes twice against the same seeded archive.

## Completion criteria

Archive recovery is complete when:

- every eligible archived root record has a durable recovery classification;
- every meaningful safely resolvable archived timeline record is represented in the local CRM;
- every meaningful unresolved record is visible in Recovery Review;
- there is no hidden `unlinked` pile;
- rerunning the full recovery produces no duplicates or unwanted overwrites;
- imported ACT history is read-only;
- all run totals reconcile;
- 16th Street Fair and additional representative fixtures pass end to end;
- any attachment without an actual usable file is absent rather than represented by a dead placeholder.
