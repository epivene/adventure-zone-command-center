# Scalable Gmail synchronization

This release adds an opt-in mailbox change queue. It does not send or schedule mail, edit drafts, change Gmail labels, complete reminders, or rewrite notes. The Gmail add-on is a separate, deferred project.

## How it works

One account checkpoint discovers changes in pages of 100. Existing mapped conversations are bootstrapped with keyset pagination, followed by a fixed recent-mail window, drafts, and history replay. A turn refreshes at most 25 conversations, serially, yielding after 30 seconds. Idle history checks run every five minutes and do not reload conversation bodies. Queue generations, account epochs, leases and atomic checkpoint commits prevent duplicate or stale workers from losing work.

Explicit mappings take precedence. A new conversation may use one unambiguous, exact contact-to-profile relationship, revalidated under a short database lock before saving. Multiple targets remain in a separate review list. No labels are identity keys. This does not reproduce the legacy AI/body-text classifier: historical discovery remains available under the shared scheduler lock, and ambiguous new correspondence requires review. Matching parity must be assessed during the pilot before expanding.

Drafts remain drafts until Gmail provides actual SENT evidence. A missing source retains saved observations. Owner decisions and open follow-ups are read from their existing tables, not automatically resolved. Saved observations are append-only; current summaries are cached and paginated. The UI fetches draft text only when details are opened.

The new scheduler, legacy recent/sent sweep, historical backfill and document intake share a session advisory lock and a two-request transport budget (including response body consumption). Cutover waits for an existing owner. Historical discovery and document intake retain their work; they no longer overlap incremental sync. Their existing batch duration still affects how quickly a new sync turn can start and must be measured in the live pilot.

Each bounded thread hydration has a 25-second overall deadline, at most 20 requests, 200 messages, and an 8 MiB aggregate response budget. Oversized threads remain visible as sync issues. Archive work is separate, limited to one attachment attempt per turn. Stable message-part identities survive provider handle rotation; retries rotate through parts so one unavailable file cannot starve later files. Existing archive objects and references remain intact.

Google documents [history-based synchronization and expired-cursor recovery](https://developers.google.com/workspace/gmail/api/guides/sync) and [immutable MIME part IDs](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages). Recovery here preserves archived records and replays current business mappings rather than deleting records absent from Gmail.

## Validation recorded on October 16, 2026

- Synthetic PGlite fixture: 4,000 profiles, 12,000 mapped conversations, 4,000 note sentinels, 4,000 open follow-ups and 4,000 archive references.
- All 12,000 conversations were actually hydrated through the production processor and fenced queue. The test does not shortcut the backlog by marking jobs processed.
- Idle: zero body reads. Twenty changed threads: twenty body reads and twenty new observations, despite duplicate enqueue input. All preserved sentinels remained; original mappings remained and new draft IDs were added.
- Indexed run: 198.219 seconds total, 40 MiB reported JavaScript heap. This is local synthetic performance, not a Gmail latency, RSS, Render capacity or production-volume guarantee.
- Focused backend regression suite: 22 files, 69 tests passed with two workers and 20-second test timeout. Two COM panel tests passed. API and frontend builds passed.
- Repository-wide API/frontend type checks have unrelated schema/type errors; no diagnostics matched the changed sync files in the checked runs. The broad API run was stopped after failures outside this feature; it is not a clean release gate. GitHub jobs could not start because the account billing/spending limit blocked runner execution; native checks provide the recorded evidence.

## Preservation and rollout gates

1. Confirm a completed, recoverable Render export and point-in-time recovery window. The 3:09 PM America/Denver export completed and was downloaded locally (207,002,592 bytes). Archive listing succeeded with 353 entries and a PostgreSQL TOC; SHA-256 is saved in private evidence. A restore drill has not been performed. A read-only live baseline was captured at 21:17 UTC and saved privately outside the repository. A 10:10 AM export and three-day PITR window were visible before the request. Database backups do not by themselves verify external object storage.
2. Run `node scripts/google-sync-integrity-report.mjs` on the API host with its existing database environment. It uses a repeatable-read, read-only transaction and prints only table counts, aggregate fingerprints and reference violation counts. Save results privately before/after migration. Investigate every unexpected difference; normal live edits and newly archived mail can legitimately change fingerprints.
3. Deploy the additive migration with every account off (the default). No existing business table is cleared. The added mapping index and enqueue trigger require the normal short migration lock; do not force deployment past a lock timeout.
4. Use the owner-authenticated `POST /api/email-thread-attention/sync/configure` with `{"mode":"shadow","cohortLimit":3}`. Check cached status, retries and latency before active pilot. Shadow saves observations in the new tables but does not extend mappings or archive files.
5. Activate the three reviewed pilot customers. Verify their actual Gmail evidence: owner decision, unsent draft, and bounce/contact issue. Do not create or send test emails. Confirm note and follow-up state is unchanged.
6. Advance cohorts 50, 500, and finally 0 (all), waiting for each cohort's discovery and refresh backlog to drain. The pilot counts toward each limit. Shrinking a cohort replaces only enrollment configuration, never business history. Each expansion restarts bounded discovery so previously deferred mappings are revisited.
7. Record enrolled profile/thread totals, pending and blocked counts, archive backlog, history checkpoint, API latency and integrity comparison. Count uncertain links separately. Do not claim 4,000 live customers are verified from the synthetic fixture alone.

Status is available at `GET /api/email-thread-attention/sync/status`; cached summaries at `/sync/threads`, lazy details at `/sync/thread`, and uncertain links at `/sync/reviews`. `POST /sync/check` only makes incremental discovery due; the legacy pilot check queues its three threads when active.

## Rollback

Set mode to `off` using the same authenticated configure endpoint. The scheduler lock drains the current owner, then account epoch fencing rejects stale saves. The old sweep resumes, original pilot tables remain, and all new history/archive records remain. Do not roll back by deleting tables or restoring an old database over newer business records.

Live cohort rollout and preservation comparison are required before starting the Gmail add-on.
