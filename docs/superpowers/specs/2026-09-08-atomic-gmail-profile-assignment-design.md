# Atomic Gmail Profile Assignment Design

**Date:** 2026-09-08  
**Status:** Implemented  
**PR:** #758

## Goal

When Email Review assigns an email to a profile, the CRM decision and Gmail work must behave as one reliable operation:

- save the profile assignment;
- create or reuse exactly one Gmail label at `Z - AdventureZone/Profiles/<Profile Name>`;
- apply it to the entire Gmail thread;
- remove `INBOX` without removing `UNREAD`;
- never create duplicate profile labels or duplicate Gmail jobs;
- keep future inbound replies visible in Inbox and unread while adding the profile label;
- leave Gmail unchanged when the user chooses Ignore.

A Gmail authorization, API, or startup failure must not produce an ambiguous generic 500 after partially saving work. It must leave a durable retryable Gmail job.

## Problem

The current implementation initializes Gmail before saving the review decision. A Gmail bootstrap error therefore prevents the assignment from being saved and returns a generic 500.

The first draft repair reversed that order, but independent review identified three correctness gaps:

1. Its idempotency key included the decision timestamp, so repeating the same assignment could create another mutation.
2. The CRM decision and mutation insert were separate database operations, leaving a crash window where the assignment could exist without a Gmail job.
3. A projection-write failure after Gmail completed could incorrectly downgrade the completed mutation to retryable and replay the Gmail operation.

## Architecture

Introduce a focused persistence boundary for “assign profile and enqueue Gmail work.” It owns one database transaction and returns the committed assignment plus mutation.

The transaction will:

1. Resolve and lock the active company Google Workspace connection.
2. Validate that the target organization exists and is not consolidated.
3. Lock the review item.
4. Save the resolved review state.
5. Upsert the validation mapping.
6. Write the audit event when the assignment materially changes.
7. Supersede any still-pending mutation for a different organization on the same thread.
8. Insert or load the stable Gmail mutation.
9. Store the mutation ID and pending/current Gmail state on the review item.
10. Commit.

Only after commit will the service initialize Gmail and execute the queued mutation.

Each thread also has one durable, versioned intent row. Assigning a profile makes that mutation the current generation; Ignore makes an `ignore` generation current and clears the current mutation. Workers may claim assignment work only when its mutation ID and generation still match that row.

A dedicated PostgreSQL session advisory lock is held from worker claim through the Gmail API call and mutation completion. The session locks use a separate two-connection pool so concurrent Gmail work cannot reserve every application query connection. Assignment and Ignore transactions take the matching transaction advisory lock before changing intent. This serializes the external side effect with user decisions, prevents expired workers from applying stale labels, and guarantees that no queued assignment can change Gmail after Ignore returns.

The transaction repository will receive a checked-out database client. It will use `BEGIN`, `COMMIT`, and `ROLLBACK`; no transaction work will use pool-level queries that could switch connections.

## Stable Idempotency

The assignment mutation key will be based on stable business identity:

`assign-thread:<connectionId>:<threadId>:<organizationId>`

It will not include `updated_at`, request time, actor, or another value that changes on a retry.

Consequences:

- Repeating the same assignment returns the same mutation.
- Concurrent identical assignments converge through the unique idempotency constraint.
- Assigning the thread to a different profile creates a distinct mutation.
- Any older unfinished mutation for that thread is marked permanently superseded before the new mutation commits.
- A completed earlier assignment is safe: the later thread operation removes other managed profile labels before applying the new one.

## Gmail Execution

After the transaction commits:

- If the loaded mutation is already completed, return its completed state without calling Gmail.
- Otherwise claim it through the existing lease mechanism.
- Resolve the canonical profile label using the existing normalized duplicate detection.
- Reuse one matching label or create the canonical label when none exists.
- If multiple normalized matches exist, stop with a conflict and create no additional label.
- Apply the label to the whole thread and remove `INBOX` plus other managed profile labels.
- Never remove `UNREAD`.
- Mark the mutation completed.

For later inbound messages on a mapped thread, keep the existing message-level behavior: add the profile label and remove nothing, preserving Inbox and Unread. Versioned thread intent overrides stale historical mappings after reassignment or Ignore. Startup migration and Check emails also adopt interrupted legacy inbound jobs into the current generation after their processing lease expires.

## Failure Handling

Failure boundaries are separate:

- **Transaction failure:** roll back the assignment, mapping, audit, mutation, and review projection together. Return a staged safe error.
- **Gmail bootstrap or API failure:** keep the committed assignment and mutation, mark the mutation retryable when it is not already terminal, and return its mutation ID so the UI can show Retry Gmail.
- **Review projection failure after Gmail completion:** do not change the mutation. Completed is terminal. Return the completed Gmail result and repair the projection through reconciliation/logged follow-up.
- **Concurrent worker completion:** reload the mutation before applying a failure transition. If it is completed, return completed.
- **Reauthorization required:** keep the queued mutation and show the reconnect/retry instruction.

Mutation repository failure updates will be conditional and will never transition `completed` back to another state.

Logs will include safe stage names and PostgreSQL codes without tokens, Gmail content, or raw provider responses.

## Configuration

Set `GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED=true` in `render.yaml`. The existing OAuth scope check remains mandatory, so the company account must have `gmail.modify` before Gmail execution can complete.

## Tests

Add database-backed and service tests covering:

1. The same assignment submitted twice at different times creates one mutation and performs one Gmail execution.
2. Concurrent identical assignments converge on one mutation.
3. A forced mutation-insert failure rolls back the review decision, mapping, and audit.
4. Gmail bootstrap failure leaves the assignment committed with a retryable mutation ID.
5. A projection-write failure after Gmail succeeds does not downgrade a completed mutation.
6. A concurrent completion wins over a later failure transition.
7. Missing canonical label is created once.
8. Existing normalized canonical label is reused.
9. Multiple normalized labels produce conflict without another label.
10. Whole-thread assignment removes Inbox but not Unread.
11. Later inbound replies gain the profile label without losing Inbox or Unread.
12. Ignore makes no Gmail call.

Existing unrelated failing repository checks will be reported separately; the focused Google Workspace tests and affected builds must pass without new failures.

## Rollout

1. Deploy the database-safe implementation with the Gmail sync flag enabled.
2. Retry the currently failing review assignment.
3. Confirm the profile label is created or reused, the complete thread is labeled, and Inbox is removed.
4. Send a new reply to the thread and confirm the new message remains Inbox + Unread while receiving the profile label.
5. Use the existing Check emails action as the manual fallback for newly arrived messages.


## Verification Results

- Google Workspace backend: 79 files, 327 tests passed.
- Atomic transaction coverage includes rollback, stable identical retries, processing reassignment superseding, A → B → A generations, staged connection failure, session-lock lifetime and pool isolation, interrupted inbound-job recovery, and atomic Ignore cancellation.
- Office Coordinator workflow: API and frontend builds passed.
- Release Safety: no new type errors in the atomic transaction, review assignment service, validation repository, matched-corrections route, or route contract test. Remaining type errors are pre-existing Google Gmail client declaration issues.
- Google Workspace workflow remains red only in pre-existing frontend settings/navigation tests after its backend step passes.
