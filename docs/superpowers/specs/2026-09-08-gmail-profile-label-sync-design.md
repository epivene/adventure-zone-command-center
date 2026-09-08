# Gmail Profile Label Sync Design

**Status:** Approved in chat  
**Date:** 2026-09-08

## Goal

Make Email Review decisions update the real Adventure Zone Gmail mailbox without creating duplicate profile labels.

When the owner assigns a reviewed email to a CRM profile, the Command Center labels the existing Gmail conversation under the established `Z - AdventureZone/Profiles` hierarchy and removes `INBOX` from that existing thread. Ignoring an email changes only the CRM review state. A later incoming reply remains visible in Gmail's Inbox, retains its unread state, and is associated with the same CRM profile.

## Product decisions

- Gmail mutation is limited to profile-label management and archiving explicitly assigned review threads.
- Assignment acts on the entire existing Gmail thread.
- Assignment removes `INBOX` from the existing thread after the profile label is applied.
- Ignore never changes Gmail labels, Inbox state, archive state, or read/unread state.
- Later inbound messages in an assigned thread inherit the CRM profile association and receive the profile label, but keep `INBOX` and `UNREAD`.
- The Gmail hierarchy remains `Z - AdventureZone/Profiles/<Profile Name>`; the application must not create a second Profiles hierarchy.
- Gmail label IDs, not display names, are the durable identity.
- A CRM profile has at most one Gmail profile label per Google Workspace connection.
- A Gmail profile label belongs to at most one active CRM profile mapping.
- Existing compatible Gmail labels are reused before a label is created.
- Ambiguous or conflicting existing labels stop the mutation and surface a repairable error; the application never guesses or creates another label.
- Reassigning a thread removes any other managed profile label from the thread before applying the target label.
- Profile renames retain the stored Gmail label ID. A rename may update that label's display name only after collision checks; it never creates a replacement label.
- Gmail read/unread state is never changed by this feature.
- All Gmail mutations are auditable, idempotent, and retryable.

## Authorization boundary

The current Google Workspace integration deliberately requires `gmail.readonly`. This feature changes that boundary.

The OAuth connection will request:

```text
openid
email
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.readonly
```

`gmail.modify` replaces `gmail.readonly` as the required Gmail scope. Existing production credentials must enter `reauthorization_required` until an administrator reconnects and grants the new scope. No Gmail mutation is attempted with the old credential.

The integration still cannot permanently delete Gmail messages. Owner authorization remains required for Email Review actions and Google Workspace settings.

## Data model

Add a durable profile-label mapping table:

```text
google_workspace_profile_labels
- id
- connection_id
- organization_id
- gmail_label_id
- gmail_label_name
- state: active | conflict | unavailable
- last_error_code
- created_at
- updated_at
```

Required uniqueness:

- unique `(connection_id, organization_id)`
- unique `(connection_id, gmail_label_id)`

Consolidated profiles may not receive new mappings. If profiles are merged, label ownership follows the surviving organization through an explicit reconciliation path; it is not silently duplicated.

Add durable Gmail mutation state, either as a focused outbox table or fields on the existing review decision plus a mutation-attempt table. Each operation records its connection, message/thread, target organization, intended label ID, operation type, state, attempts, last error, actor, and timestamps. The idempotency key covers the connection, Gmail target, operation, target profile, and decision revision.

The existing validation mapping remains the authority for which CRM profile owns the conversation. The new table is only the authority for the CRM-profile-to-Gmail-label identity.

## Label resolution

For a target organization:

1. Load the saved mapping by `connection_id + organization_id`.
2. If present, verify that Gmail still exposes the stored label ID. Reuse it regardless of a harmless display-name difference.
3. If no mapping exists, list Gmail labels and search within the exact established root `Z - AdventureZone/Profiles`.
4. Prefer one exact canonical path match for the current profile name.
5. Also compare a normalized form (Unicode normalization, trimmed segments, collapsed whitespace, and case-insensitive comparison) only to detect conflicts—not to guess between candidates.
6. If exactly one compatible label exists, save and reuse its Gmail label ID.
7. If multiple compatible/conflicting labels exist, save a conflict state and stop. Show the label names/IDs needed for manual reconciliation.
8. If none exists, create the canonical label once, then persist its returned Gmail label ID under both uniqueness constraints.
9. If a concurrent request creates or maps the label first, reload and reuse the winning mapping rather than creating another.

The service must never derive ownership from label text after a stable mapping exists.

## Explicit assignment flow

When the owner selects a profile in Email Review:

1. Validate the active Google connection, owner permission, message/thread identity, and unconsolidated target profile.
2. Persist the CRM review decision and validation mapping with Gmail mutation state `pending`.
3. Resolve or create the target profile label using the rules above.
4. Load managed profile labels currently present on the thread.
5. Call Gmail `threads.modify` once to:
   - add the target Gmail label ID;
   - remove other managed profile label IDs;
   - remove `INBOX`.
6. Do not add or remove `UNREAD`.
7. Mark the mutation complete and write an audit event with the Gmail thread ID, profile ID, label ID, removed managed label IDs, and actor.
8. Refresh Email Review. Completed assignments leave the pending list; retryable failures remain visible with a clear retry action/status.

Gmail calls and database writes cannot share one transaction. Therefore, retries must be safe after any partial failure. Reapplying the same add/remove label sets is the normal recovery path.

Creating a new profile from Email Review uses the same flow after the profile transaction succeeds.

## Ignore flow

Ignore updates the review item to `ignored`, removes any CRM validation mapping for that reviewed message as it does today, and records the existing audit event.

It performs no Gmail API mutation. In particular, it leaves `INBOX`, `UNREAD`, and all user labels unchanged.

## Later inbound replies

A new Gmail message may arrive with the same `threadId` after the older thread was assigned and archived.

During incremental Gmail ingestion:

1. Detect the existing thread-to-profile mapping before sender/address inference.
2. Map the new message to that same organization unless stronger explicit event evidence routes it to manual review under the existing matching safety rules.
3. Apply the saved profile label to the new message idempotently when needed.
4. Do not remove `INBOX`.
5. Do not remove `UNREAD` or mark the message read.
6. Include the message in normal unread counts and profile email presentation.

For later replies, use message-level label modification for the new message. This preserves the explicit one-time archive decision for the old thread without auto-archiving the newly arrived work.

No sender-based Gmail filters are created.

## Profile rename and reassignment

A profile rename keeps the same mapping row and Gmail label ID. A background or on-demand reconciliation may rename the Gmail label to the new canonical path only if no other label or profile mapping conflicts. On collision, retain the existing label and surface a conflict; do not create a new one.

When an email is reassigned, the validation mapping changes to the new profile. The Gmail mutation applies the target label and removes other labels known through `google_workspace_profile_labels`. Unmanaged/user-created labels remain untouched. The thread is archived again because reassignment is another explicit owner action.

## UI behavior

Email Review shows:

- assignment progress while the CRM decision and Gmail mutation run;
- `Assigned and archived in Gmail` after completion;
- a retryable Gmail-sync error without losing the selected profile;
- a duplicate/conflict message that names the conflicting Gmail label paths;
- Ignore confirmation that the email was left unchanged in Gmail.

Google Workspace settings shows the new Gmail permission status and tells the administrator when reconnecting is required. It also exposes a small profile-label conflict/retry area; it does not provide bulk destructive cleanup.

## Error handling and recovery

Classify failures as:

- `reauthorization_required`: stop and direct the administrator to reconnect;
- `label_conflict`: stop without creating or deleting labels;
- `label_missing`: re-resolve by stable mapping rules, then retry;
- `gmail_rate_limited` or transient 5xx/network failure: exponential retry;
- invalid/deleted/consolidated profile: permanent failure requiring a new review choice;
- Gmail thread/message missing: preserve the CRM audit history and show a non-retryable source-missing state.

Never delete a Gmail label automatically. Duplicate cleanup is a separately reviewed administrative action.

## Testing

Automated tests must not call real Gmail.

Cover:

- existing mapped label ID is reused after a CRM profile rename;
- an existing exact hierarchy label is adopted instead of recreated;
- normalized ambiguous labels produce a conflict and no create call;
- concurrent first assignment produces one mapping/label;
- assignment modifies the whole thread, adds the target label, removes managed competing labels and `INBOX`, and preserves `UNREAD`;
- Ignore makes zero Gmail mutation calls;
- later inbound reply inherits the profile mapping, receives the profile label, keeps `INBOX` and `UNREAD`, and appears in unread counts;
- retry after Gmail-success/database-failure is idempotent;
- reauthorization is required when `gmail.modify` is absent;
- creating a profile from review uses the same label-resolution path;
- reassignment removes only managed profile labels;
- owner authorization remains enforced.

Run focused API tests, Gmail adapter tests, migration/schema tests, frontend review tests, TypeScript validation, and the normal production build.

## Rollout

1. Deploy schema and code with Gmail mutation disabled by a feature switch.
2. Confirm existing Gmail label inventory can be read and reconciled without creating labels.
3. Reconnect the administrator Google account with `gmail.modify`.
4. Run a dry conflict report for the established profile-label hierarchy.
5. Resolve any pre-existing ambiguous duplicates manually.
6. Enable mutations for one controlled review assignment and verify the thread is labeled and archived.
7. Send or receive a test reply in that thread and verify it returns to Inbox, remains unread, syncs to the profile, and is not auto-archived.
8. Enable the feature for normal Email Review use.
9. Retain audit and retry monitoring during rollout.

## Out of scope

- Sender-based Gmail filters.
- Automatic archiving of future replies.
- Bulk deletion or merging of existing Gmail labels.
- Sending email.
- Trash or permanent-delete operations.
- Changing Gmail read/unread state.
- Labeling unrelated historical mail outside normal review and incremental-sync flows.
