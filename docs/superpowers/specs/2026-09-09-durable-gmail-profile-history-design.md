# Durable Gmail Profile History Design

**Date:** 2026-09-09  
**Status:** Proposed — awaiting written-spec approval  
**Branch:** `feature/gmail-profile-email-archive`

## Goal

Keep a durable, app-owned history of every Gmail thread assigned to a CRM profile. Deleting a Gmail label, message, or thread must not delete the profile's saved email history. Gmail remains the working inbox and source for current changes while it is available.

## User-visible behavior

- Assigning a Gmail conversation to a profile saves the entire current thread in the app.
- The saved record includes subject, sender, recipients, sent time, message bodies, and attachment metadata.
- Attachments are copied into the existing private profile-file storage.
- The profile email panel uses live Gmail when available and transparently falls back to the saved copy when Gmail no longer has the thread.
- New inbound messages on an assigned thread remain in Gmail's Inbox so they are visible for review. The profile label may also be present.
- A later email check refreshes the saved thread with new messages without duplicating previously saved messages.
- Deleting Gmail content never cascades into the CRM archive.
- Existing approved mappings are backfilled incrementally by normal email checks instead of a single large deployment migration.

## Considered approaches

### 1. Normalized durable thread and message snapshots — selected

Store one durable thread row and one row per Gmail message. Upsert using the Gmail connection and message identity. This supports incremental replies, clear audit state, partial retry, and efficient profile reads.

### 2. One JSON snapshot per thread

This is simpler initially, but every new reply rewrites the whole payload, message-level uniqueness is weaker, and attachment/retry status becomes difficult to audit.

### 3. Periodic mirror of every labeled Gmail thread

This can eventually discover everything, but it adds broad recurring Gmail scans, higher latency and quota use, and unnecessary work for unchanged threads.

## Data model

Add app-owned persistence for archived profile email:

### `google_workspace_profile_email_threads`

- `id` UUID primary key
- `connection_id` UUID, retained even if the connection is later reauthorized
- `organization_id` UUID
- `gmail_thread_id` text
- `subject` text
- `first_message_at`, `last_message_at` timestamptz
- `message_count` integer
- `archive_state`: `complete`, `retry_required`, or `source_unavailable`
- `last_error_code` nullable text
- `last_synced_at`, `created_at`, `updated_at`
- unique `(connection_id, gmail_thread_id)`
- index `(organization_id, last_message_at desc)`

### `google_workspace_profile_email_messages`

- `id` UUID primary key
- `thread_archive_id` UUID
- `gmail_message_id` text
- `sender`, `to_recipients`, `cc_recipients`, `bcc_recipients`
- `sent_at` timestamptz
- `snippet`, `text_body`, `html_body`
- `headers` JSONB for the bounded display-safe header set
- `created_at`, `updated_at`
- unique `(thread_archive_id, gmail_message_id)`

Bodies are stored as received for audit. HTML remains sanitized at the rendering boundary. Raw OAuth tokens and unrestricted Gmail payloads are never stored.

The existing `google_workspace_profile_files` table and private object storage remain authoritative for copied attachment bytes. File rows continue to use message and attachment IDs for idempotency.

## Write path

Introduce `GoogleProfileEmailArchiveService` with a narrow port:

1. Verify that the organization owns an approved mapping for the Gmail thread.
2. Fetch current Gmail thread detail.
3. Upsert the thread and all messages transactionally.
4. Copy attachments through `GoogleProfileFileService`.
5. Mark the archive complete, or record a retryable/source-unavailable state.

The assignment transaction remains authoritative and is never rolled back because a network-dependent archive copy failed. After assignment commits, the assignment orchestration attempts the archive. Failure is visible and retryable but does not undo the CRM mapping or Gmail-label work.

Archive refresh is also called from:

- manual/recent `Check Emails` processing for approved threads;
- historical backfill processing;
- profile live-thread reads after a successful Gmail fetch.

These calls are idempotent. Message uniqueness prevents duplicate content.

## Read path

Profile email list and detail endpoints load approved mappings and archived threads first, then attempt live Gmail refresh:

- Live Gmail succeeds: return current data and persist the refreshed snapshot best-effort.
- Gmail thread is missing or deleted: return the complete archived copy and set source availability to unavailable.
- Gmail is temporarily unavailable: return the archived copy and a retryable source status.
- No archive exists yet and Gmail fails: preserve the current unavailable behavior, and leave the thread eligible for retry/backfill.

The response replaces the hardcoded `liveGmail: true` assumption with per-conversation source state such as `live`, `archived`, or `live_with_archive_retry`. The UI shows a small “Saved copy” indicator only when fallback is in use.

## New-message and Inbox behavior

Assigning a thread removes `INBOX` from the messages present at assignment, matching the current reviewed-email behavior.

A newly arriving inbound message on the same thread is:

- detected by normal Gmail ingestion/checks;
- given the existing profile label;
- added to the durable archive;
- left in `INBOX` until it is reviewed.

This keeps new mail visible instead of hiding it immediately under a profile label. Reviewing/assigning that new message can then remove `INBOX` for the current thread state according to the existing review action.

## Existing data backfill

No startup request scans the mailbox. Existing approved mappings without archives are processed in bounded batches by the existing manual/recent and historical check paths. Each run reports archived, already-current, unavailable, and failed counts. Retries use the existing bounded timeout/backoff conventions.

## Failure and deletion semantics

- Gmail label deletion: no archive change.
- Gmail message/thread deletion: no archive deletion; mark source unavailable on the next refresh.
- Gmail reconnect: archives remain tied to their original connection identity and profile. New live reads must still pass approved-mapping authorization.
- Profile reassignment: archive ownership follows the authoritative approved mapping in the same transaction or reconciliation step.
- Organization merge: the new archive tables are included in organization-reference migration.
- CRM profile deletion remains governed by existing organization deletion policy; Gmail never initiates it.

## Security and privacy

- Every list/detail/file read remains scoped to the authenticated profile organization.
- Attachment downloads continue through signed private-object URLs.
- Stored HTML is sanitized before display.
- Log fields contain IDs and error codes, not body content or attachment bytes.
- Database constraints and ownership checks prevent a thread snapshot from being served to an unrelated profile.

## Testing

Implementation is test-first and covers:

- schema creation and idempotent startup migration;
- message and attachment idempotency;
- assignment succeeds while archive failure becomes retryable;
- full thread snapshot on assignment;
- new reply appended without duplicating old messages;
- deleted Gmail thread served from archive;
- live Gmail data refreshes the archive;
- missing archive plus Gmail failure retains existing error behavior;
- new inbound reply remains in Inbox;
- profile and attachment authorization;
- organization reassignment/merge references;
- UI “Saved copy” fallback state;
- production API and frontend builds.

## Rollout

The tables are additive. Existing reads remain compatible while archive rows are absent. After deployment, bounded backfill fills older approved mappings through ordinary checks. No Gmail or CRM content is deleted by rollout.
