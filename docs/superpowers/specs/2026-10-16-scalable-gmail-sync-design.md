# Scalable, draft-aware customer email synchronization

Status: proposed design for owner review; not implemented or deployed.

## Outcome and boundaries

Support 3,000–4,000 customer profiles in the existing business mailbox without checking every customer on every cycle. Show current drafts, replies, bounces, and waiting states while retaining existing customer history. Gmail remains authoritative for actual mail and drafts; COM remains authoritative for notes, owner decisions, mappings, and follow-ups. The Gmail customer panel and quick-note buttons follow this project, using its cached status API.

No sends, scheduled sends, draft edits, Gmail label changes, history deletion, reminder-rule changes, or automatic follow-up completion. Do not overwrite owner-authored notes with inferred email summaries. No hosting migration required.

## Inspected baseline

The deployed pilot scans three exact threads in GoogleSentProfileLinkSweepLoop. That loop also runs recent validation (100 messages) hourly and a 90-day sent catch-up daily; the catch-up checkpoint is in memory. GoogleRecentValidationService additionally invokes outreach persistence, archive work, and labeling. These side effects must not be casually reused as a read-only sync processor. The API client has paginated draft/message operations but no mailbox history cursor implementation. The pilot preserves snapshot revisions and uses leases, but reads all enrolled rows and is deliberately not a bulk implementation.

## Approach and alternatives

Recommended: database-backed mailbox cursor and durable thread queue, initially driven by one mailbox-level history check every five minutes. Polling is independent of customer count. Later, authenticated Gmail push notifications can wake this same queue, retaining periodic catch-up. This avoids introducing Cloud Pub/Sub setup as a release dependency.

Push-first uses the same core design but adds topic/subscription permissions, webhook authentication, watch renewal, and notification monitoring before the first release. Expanding the existing per-profile polling is rejected because unchanged profiles cause repeated reads and overlap existing sweeps.

## Ownership and data flow

1. Persist a Gmail history cursor as a string per connection, with bootstrap/recovery phase, pagination checkpoint, lease, last success, retry time, and error state. Never convert history IDs to JavaScript numbers.
2. Obtain an initial mailbox history boundary before paginated bootstrap. Queue existing unambiguous mapped threads and discover recent business conversations (initial discovery window 90 days) plus current drafts. Preserve all older records; this window limits discovery, not retention. Existing mapped older threads remain eligible. Ambiguous matches enter review rather than being assigned from the shared Profiles label.
3. Replay mailbox history from the boundary after bootstrap so changes occurring during bootstrap are not missed. Bootstrap and recovery are resumable and budgeted, not one long request.
4. Read history pages without filtering solely by Profiles: unlabeled replies and drafts still matter. Atomically persist each page's deduplicated dirty-thread work and continuation checkpoint. Advance the completed history cursor only when all pages are durably queued. Queue durability permits processing to finish later without losing changes.
5. Queue keys are connection plus thread. Maintain a generation counter so a change arriving during processing cannot be cleared by an older worker. Workers claim small batches with expiring leases and fencing tokens, fetch Gmail outside transactions, and commit snapshots/mappings/history in short transactions. One failed thread must not block unrelated threads or history ingestion.
6. Refresh changed threads only. Preserve exact message/thread profile links. New conversations use existing deterministic matching evidence, isolated from labeling/outreach mutation; conflicts require review. Repeated reads must not duplicate mappings, notes, reminders, or snapshot revisions.
7. Draft edits/replacement IDs preserve earlier evidence. A missing draft is not proof of sending; only actual SENT evidence permits that observation. New replies and bounces remain visible ahead of older drafts. Use parsed exact mailbox addresses and aliases for direction, not substring matching. Trashed drafts are not current actionable drafts.
8. Deleted or unavailable Gmail messages mark source availability while retaining COM history. Keep the last successful snapshot with a clear stale/error indicator. Oversized threads must use bounded message hydration or explicit review status, never silent truncation presented as complete.
9. Pages and the later Gmail panel read indexed, paginated cached status, never trigger a mailbox scan. Check now enqueues/coalesces work and returns status. Show last success, pending count, bootstrap/recovery progress, and blocked items separately from customer next actions.

## Load limits and recovery

Start with maximum two concurrent Gmail requests per connection and at most 25 thread jobs per worker turn; release control between turns. Tune from measured results, not customer count alone. Use provider Retry-After where present, exponential backoff with jitter for transient errors, account-level pause for authorization failures, and per-thread retry isolation. Network timeouts and shutdown must return leases safely through expiration/fencing. Bound queued payloads to IDs; do not store mailbox-wide bodies in memory.

Expired history cursors trigger a visible staged resync using a newly captured boundary, mapped-thread refresh, recent discovery and draft enumeration, followed by history replay. Never reset the cursor and silently skip the gap. Reconnection must verify account identity; data must not migrate to a different mailbox merely because it became the active connection.

## Cutover and data protection

Add tables/indexes; retain pilot tables and all business records. Verify a current recoverable database backup before live migration. Record before/after counts and integrity checks for profiles, notes, follow-ups, mappings, and archive references; no destructive migrations.

Start with the existing three customers and read-only mailbox discovery. Compare cached results against actual Gmail. Expand processing in cohorts (50, 500, then all verified mappings) after each cohort meets checks. At account cutover, disable overlapping scheduled pilot/recent/sent scans for that account; the new pipeline must retain their needed discovery and mapping coverage. Keep explicit manual repair tools available. Do not run two automatic owners for the same work. Attachment archiving uses a separately bounded queue for missing artifacts, never downloads all attachments on every update.

Rollback stops new workers and restores the prior scheduled owner through configuration. Retain all new tables, snapshots, mappings, and cursors for investigation. A schema rollback must not delete data.

## Verification and release gates

Automated fixtures: at least 4,000 profiles and 12,000 mapped threads; idle mailbox, changes affecting 20 threads, burst changes, pagination, duplicate history pages, restart between enqueue and checkpoint, concurrent workers, generation races, rate limits, revoked access, expired history, account replacement, conflicting mappings, missing/edited/trashed drafts, real SENT evidence, incoming replies, bounces, and oversized threads.

Assert that an idle cycle fetches no thread bodies; a 20-thread change set queues at most 20 unique refresh jobs before retry considerations; concurrency stays within two; cached list reads make no Gmail calls; restart/replay loses no queued work; old business records and history remain present; and the sync dependency surface cannot invoke send, draft mutation, or labeling operations. Measure query latency, memory, queue drain time, and API request counts with bounded test workers. Mocked scale tests validate architecture, not production throughput: collect live cohort metrics before claiming all-customer readiness.

No rollout to all customers until migrations, focused regressions, builds, scale/recovery tests, three-customer live verification, and cohort integrity checks pass. Existing unrelated failing repository tests must be reported separately. The next project is the Gmail panel with quick-note actions; it must consume this cache and use explicit idempotent note/follow-up writes.

## References

- https://developers.google.com/workspace/gmail/api/guides/sync
- https://developers.google.com/workspace/gmail/api/guides/push
