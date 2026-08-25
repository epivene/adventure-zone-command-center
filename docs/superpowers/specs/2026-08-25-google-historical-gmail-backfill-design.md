# Historical Gmail Backfill Design

## Goal
Build a controlled, resumable historical Gmail backfill that copies only CRM-relevant conversations into Adventure Zone profiles while keeping personal/irrelevant mail out of profile history.

## Rollout boundary
This phase processes historical Gmail in **250-message batches**. It does not enable uncontrolled continuous background sync. The **first historical batch requires explicit owner approval** before another batch may run.

## Matching authority
Each historical message uses the existing validated matching stack in this order:
1. Manual correction/ignore decisions.
2. Confirmed Gmail thread relationship.
3. Clear profile/event evidence in subject/snippet/body.
4. Uniquely learned external email relationship or existing CRM contact/domain evidence.
5. Bounded AI triage for the fuzzy middle.
6. Needs Review when ownership remains uncertain.

`TheAdventureZone12@gmail.com` and the connected mailbox identity are internal/neutral and never own a CRM profile.

A learned external email is supporting evidence, not authority over clear event evidence. If the same outside address has been confirmed for multiple profiles it is not learned as a unique profile relationship.

## Batch behavior
- Process newest to older using Gmail pagination.
- Default and maximum batch size: **250 messages**.
- Persist a Gmail page token/checkpoint only after the batch finishes writing its durable results.
- A Render restart may safely retry the current batch.
- Message/thread identity is idempotent; reruns must not duplicate archived conversations, mappings, review rows, ignored checkpoints, or attachment files.
- A batch returns counts for processed, attached, ignored, needs review, failed, duplicate/skipped, and remaining-page availability.

## First-batch approval gate
The first successful historical batch ends in `awaiting_approval` regardless of its result counts. The owner can:
- **Approve first batch**: allows later batches to run.
- **Keep reviewing**: leaves the cursor parked and does not advance historical work.

Approving the recent 100-message validation sample does not automatically approve the first historical batch.

## Durable archive behavior
For a confidently matched Gmail thread:
- store one profile-visible conversation record keyed by Gmail thread/message identity;
- retain enough metadata to list/open it from the profile Emails area;
- fetch the readable Gmail thread on demand and/or archive durable thread content according to the existing Google profile-email storage contract;
- copy attachments into the existing private Google Cloud Storage Files flow with checksum deduplication;
- never make Gmail write/mutation calls.

For ignored/personal mail:
- store only the minimum historical checkpoint/outcome metadata needed to avoid reconsidering it;
- do not store readable body text or attachments in the CRM.

For Needs Review:
- reuse the existing durable review queue and manual correction controls;
- unresolved messages do not become profile-visible;
- manual resolutions/ignores remain authoritative on retry.

## Failure handling
A failure on one message must not corrupt the whole checkpoint. The batch records failed message IDs with safe error codes and continues when safe. The cursor advances only after the batch record and per-message outcomes are durable.

Retrying failures is idempotent. Authentication/reauthorization failures stop the batch and do not advance the cursor.

## UI
Google Workspace settings gains a Historical Gmail Backfill card showing:
- state: not started / running / awaiting first-batch approval / ready / complete / paused / error;
- cumulative progress and latest batch counts;
- **Run first 250** before approval;
- **Approve first batch** or **Keep reviewing** after the first batch;
- **Continue next 250** after approval;
- **Retry failures** when failures exist;
- **Pause** for future automatic continuation support, though this phase remains owner-triggered.

Each learned match remains visibly labeled with its evidence source.

## Security and access
- Owner-only API/UI in this phase.
- No leg-manager or Office Coordinator historical Gmail access is added in this PR.
- Existing OAuth read-only Gmail scopes remain unchanged.
- No Gmail message is modified, moved, labeled, deleted, or sent.
- Historical bodies for ignored/personal mail are not persisted.

## Configuration
`GOOGLE_WORKSPACE_SYNC_ENABLED` remains a production gate. The new backfill endpoints must refuse to run unless the gate is enabled **and** the validation sample is approved. Enabling the gate does not itself start work; the owner still clicks Run first 250.

## Out of scope
- Continuous incremental/background Gmail sync after backfill.
- Historical Google Calendar backfill.
- Office Coordinator access to archived Gmail.
- Automatic creation/merging of CRM profiles.
- Gmail writes.

## Success criteria
1. First 250-message batch can be run manually and resumes safely after retry/restart.
2. First batch cannot silently continue into a second batch without owner approval.
3. Confirmed threads/unique learned contacts reduce repeated AI/review work.
4. Personal/irrelevant mail is checkpointed without body/file archival.
5. Matched conversations and attachments appear on the correct profiles without duplication.
6. Needs Review remains actionable with existing correction controls.
7. Full historical progress can continue in 250-message owner-triggered batches until Gmail history is exhausted.
