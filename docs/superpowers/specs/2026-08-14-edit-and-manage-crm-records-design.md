# Edit and Manage CRM Records Design

Date: 2026-08-14  
Status: Approved for implementation planning

## Goal

Let a user correct saved call notes and outcomes, edit or permanently delete follow-ups, and consistently edit or archive larger CRM records without accidentally rewriting unrelated business history.

## Scope

### Saved calls

A saved call history card will display its recorded outcome when the activity is linked to a call session.

“Edit call” will edit the note and outcome together. Saving changes only the activity note and the linked call session disposition. It must not undo or recreate booking status changes, contact changes, do-not-call changes, follow-ups, or other effects produced when the call was originally completed.

Edits will be audited. The visible history item updates immediately after a successful save. Imported or manually created call activities without a linked call session may still edit their note, but the interface will not invent or expose an outcome field for them.

Existing history deletion behavior remains unchanged.

### Follow-ups

A follow-up can be edited to change:

- due date;
- follow-up type;
- completion status; and
- outcome.

“Delete follow-up” requires confirmation and permanently deletes only the selected follow-up. Before deletion, references to it from call sessions, previous follow-ups, and other nullable links must be safely cleared. The deletion must not delete a call, contact, organization/profile, booking, or another follow-up.

A minimal deletion audit entry may retain the record identifier, deletion action, and timestamp, but not the deleted follow-up’s note or private content.

Edits and deletions must update Today, profile/contact views, booking views, and any other follow-up list on the next data refresh. The initiating screen updates immediately after success.

### Contacts, profiles, and bookings

Each record detail page will expose a clear Edit action and a recoverable Archive action. Existing editors will be reused rather than duplicated.

Archived records:

- are hidden from normal lists and searches;
- are excluded from caller matching and Today work queues;
- remain available in an Archived records area;
- can be restored;
- retain their linked history; and
- do not automatically archive related contacts, profiles, bookings, or history.

The interface warns when archiving a record may affect linked information. Restore returns the record to normal queries without reconstructing or duplicating related data.

### Existing activity notes

Regular activity notes keep their existing edit, revision-history, and delete controls. This work will align labels and behavior with the new call and follow-up controls where practical, without changing their existing deletion policy.

## User Experience

Actions use direct labels:

- Edit call
- Edit follow-up
- Delete follow-up
- Edit contact
- Edit profile
- Edit booking
- Archive
- Restore

Forms must be usable on the current Android/mobile web layout as well as desktop. Destructive actions require confirmation. While a request is running, its action is disabled to prevent duplicate submissions.

Errors appear next to the affected form or action. A failed edit, delete, archive, or restore leaves the original record visible and unchanged.

## Architecture and Data Flow

Record-specific APIs and services will enforce each record’s rules. There will be no generic unrestricted update or delete endpoint.

Call editing resolves the call session through its note activity identifier and updates the activity body and call disposition in one database transaction. Audit entries capture the before and after states. Historical call side effects are intentionally outside the edit transaction.

Follow-up editing and deletion use follow-up-specific service methods. Permanent deletion locks the target, clears allowed inbound references, records the minimal audit event, and deletes the target in one transaction.

Contacts, profiles, and bookings use explicit archive timestamps and archive/restore service methods. Normal repository queries add an active-only condition; archived-record queries select archived rows. Caller-finder and Today queries must explicitly exclude archived records.

API responses return the updated record state needed for immediate UI replacement. Failed transactions roll back completely.

## Data Safety Rules

- A call outcome edit never changes a booking, contact, DNC setting, or follow-up.
- A follow-up delete never cascades into another business record.
- Larger CRM records are archived, not hard-deleted.
- Archiving one record never silently archives connected records.
- Imported activities without call-session metadata remain editable as notes.
- All mutations require the existing authenticated application session.
- Concurrent edits use the repository’s transaction and locking patterns so a stale request cannot partially overwrite or delete a record.

## Testing

Test-first coverage will include:

- a call history item displays its stored outcome;
- a linked call note and outcome update atomically;
- changing a call outcome leaves booking, contact, DNC, and follow-up state unchanged;
- a call activity without a session edits only its note;
- follow-up fields edit successfully;
- follow-up deletion clears inbound nullable references and deletes only the target;
- follow-up deletion rolls back when unlinking or audit recording fails;
- archived contacts, profiles, and bookings disappear from active queries, Today, and caller matching;
- restore returns archived records without duplicating relationships;
- mobile controls and confirmation/error states are accessible;
- authorization and invalid-input cases return safe errors.

Focused API and web tests, workspace typechecks, and production builds must pass before merge.

## Rollout

The work will be implemented in record-specific increments on one feature branch:

1. saved call note/outcome editing;
2. follow-up editing and permanent deletion;
3. contact/profile/booking archive and restore;
4. consistency pass across affected screens and queries.

No feature will be enabled in production until its migrations, affected tests, typechecks, and builds pass. Deployment remains the normal Render deployment from the merged main branch.
