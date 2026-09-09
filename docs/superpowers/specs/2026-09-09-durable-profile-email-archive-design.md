# Durable Profile Email Archive Design

**Date:** 2026-09-09  
**Status:** Awaiting user approval  
**Branch:** `feat/durable-profile-email-archive`

## Goal

Email should feel like part of the CRM:

1. Gmail sync finds inbound and outbound conversations.
2. The app links each conversation to the correct profile.
3. The app saves its own durable copy of every message and attachment.
4. Users can read and reply from the profile.
5. Deleting an email or thread in Gmail never deletes the app's saved history.

Gmail remains the transport and synchronization source. The app database and private object storage become the durable CRM record.

## Current gap

The app currently persists Gmail-to-profile mappings, but profile email routes call Gmail's `getThreadDetail` to load content. A Gmail deletion therefore leaves a mapping but can make the conversation unreadable. Attachment copying is also a separate manual action rather than part of email preservation.

## Data model

Add app-owned archive records under the existing Google Workspace schema:

- `google_workspace_profile_email_threads`
  - stable app conversation ID, connection ID, organization/profile ID, optional contact ID
  - primary/latest Gmail thread ID plus the set of provider thread IDs represented by its messages
  - subject, normalized participants, first/latest message dates
  - original Gmail URL, sync state, last successful sync, last Gmail error
  - never deleted merely because Gmail no longer returns the thread
- `google_workspace_profile_email_messages`
  - Gmail message ID and provider thread ID, linked to the stable app conversation ID
  - sender, recipients, CC, subject, sent/received date, direction
  - complete readable text body and safe HTML body when available
  - immutable provider IDs and timestamps
  - idempotent upsert by connection + Gmail message ID
- reuse/extend `google_workspace_profile_files` for attachments
  - attachment bytes copied to private object storage during archival
  - message/thread/profile associations retained
  - content hashes deduplicate repeated files

The archive excludes OAuth tokens, raw authorization headers, and unnecessary provider payloads.

## Sync and assignment flow

When **Check Emails**, historical backfill, or a manual assignment matches a Gmail thread to a profile:

1. Fetch the complete Gmail thread.
2. In one coordinated archive operation, upsert the thread and all messages.
3. Copy available attachments into private object storage.
4. Commit the profile mapping/archive association.
5. Apply the Gmail profile label and Inbox behavior already implemented.

A failure to archive content must be visible and retryable; the UI must not claim the email is safely saved until the archive operation succeeds. Re-running is idempotent.

Future Gmail replies add new messages to the same app thread. Existing saved messages are updated only for safe metadata corrections and are never removed because they disappeared from Gmail.

## Reading profile email

Profile email list and detail endpoints read the app archive first.

- If Gmail is available, a bounded refresh may add newer messages before returning.
- If Gmail reports 404/not found, the app returns the saved thread and marks it `Saved in app; no longer in Gmail`.
- If Gmail is temporarily unavailable, the app returns the saved thread and marks it `Showing saved copy`.
- A profile with no archived or mapped email still returns an empty list.
- Existing live-only mapped threads are lazily archived on first successful refresh, with a background/backfill path for the remainder.

No Gmail deletion event or missing-thread response may delete an archive record.

## Replying from the app

The profile thread view gets a reply composer using the existing authenticated Gmail connection.

- Normal case: send with Gmail thread headers and the saved thread/message identifiers.
- If Gmail no longer has the original thread: send a new Gmail message to the saved participants with the existing subject (adding `Re:` when needed), then associate the new provider thread/message IDs with the same stable app conversation. The app conversation—not Gmail's thread ID—is the identity shown on the profile.
- Save the outgoing message in the app immediately after Gmail confirms the send.
- If Gmail sending fails, preserve the draft and show a retryable error; do not fabricate a sent message.
- Replies never require opening Gmail.

## Attachments

Attachments are part of the durable copy, not optional:

- Copy during archival with bounded size/type handling.
- Store privately and serve through the existing authorized, expiring-file URL flow.
- If an attachment cannot be copied, retain its metadata and show `Attachment not backed up—retry`.
- Retrying must not duplicate stored objects.
- Deleting Gmail later does not remove successfully copied attachment bytes.

## Security and permissions

- Existing profile and Google Workspace permissions apply to archived email and replies.
- Every list/detail/file/reply request verifies the organization owns the archived thread.
- Email HTML is sanitized before rendering.
- Logs contain IDs, stage names, and safe error codes, never message bodies or attachment bytes.
- Audit events record assignment, archive completion/failure, reply send/failure, and fallback-to-saved-copy.

## Error handling

Archive state is explicit: `pending`, `complete`, `partial`, or `failed`.

- Message storage and profile association are transactional.
- Attachment failures can produce `partial` without discarding saved messages.
- Gmail 404 means the saved copy remains readable.
- Gmail auth/network failures do not blank the profile.
- Sync/reply retries are idempotent and preserve drafts.

## Migration and rollout

1. Add schema through the repository's required Google Workspace startup-schema path.
2. Deploy archive write/read paths without deleting current mappings.
3. Archive newly assigned and newly discovered threads automatically.
4. Backfill already-approved mapped threads in bounded batches.
5. Switch profile display to archive-first with live refresh.
6. Add reply composer and saved-copy status labels.
7. Keep mappings for compatibility until archive coverage is verified; no destructive cleanup is part of this change.

## Tests

Automated coverage must prove:

- assignment saves complete messages and attachment objects;
- repeated sync does not duplicate messages/files;
- a Gmail-deleted thread remains readable from the app;
- a temporary Gmail outage returns the saved copy;
- Gmail absence never deletes archived rows;
- a new inbound reply is added to the existing app conversation;
- reply sends in-thread when possible;
- reply after Gmail deletion sends a new Gmail message and remains in the same app conversation;
- failed sends preserve a retryable draft;
- cross-profile access is rejected;
- unsafe HTML is sanitized;
- partial attachment backup is visible and retryable;
- existing live-only mappings migrate without losing access.

Production API/frontend builds and focused server/UI tests must pass before the PR is ready.

## Out of scope

- Treating Gmail trash/deletion as a request to delete CRM history.
- Two-way deletion synchronization.
- Replacing Gmail as the outbound email provider.
- Bulk importing unrelated Gmail that has not been matched or approved to a CRM profile.
