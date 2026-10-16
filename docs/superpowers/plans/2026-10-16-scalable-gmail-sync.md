# Scalable Gmail Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make draft-aware synchronization reliable for 4,000 customer profiles before building the Gmail panel.

**Architecture:** One persisted mailbox history reader feeds a deduplicated PostgreSQL queue. Bounded workers refresh changed threads and retain snapshots; cached APIs serve the UI. Bootstrap and recovery are paginated; an account-level cutover prevents overlapping legacy scanners.

**Tech Stack:** Existing Node 22, TypeScript, PostgreSQL/pg, Express, React, Vitest and PGlite; no new infrastructure in this phase.

**Spec:** `docs/superpowers/specs/2026-10-16-scalable-gmail-sync-design.md` (approved by owner October 16, 2026).

## Global Constraints

- No sends, scheduled sends, draft edits, Gmail label changes, history deletion, reminder-rule changes, or automatic follow-up completion.
- Do not overwrite owner-authored notes with inferred email summaries. No hosting migration required.
- Start with maximum two concurrent Gmail requests per connection and at most 25 thread jobs per worker turn; release control between turns.
- One mailbox-level history check every five minutes; initial discovery window 90 days, plus all current drafts and all existing mapped threads regardless of age.
- Retain pilot tables, mappings, archives, notes and follow-ups. Additive migrations only.
- Gmail calls occur outside database transactions. History IDs are strings.
- Test with 4,000 profiles and 12,000 mapped threads; use at most two test workers.
- Push notifications and the Gmail panel are subsequent work. Do not claim simulated load proves live throughput.

## Review Focus

- A page token expires during bootstrap: restart that phase idempotently without skipping the captured boundary (Task 3).
- The owner repairs a mapping while a worker fetches Gmail: revalidate identity under the save transaction; never overwrite the repair (Task 4).
- A sender display name contains our address but the actual sender differs: parse the address, do not use substring checks (Task 4).
- New work arrives after a job was claimed: completing that claim cannot erase the newer generation (Task 2).
- Rollback occurs while an old worker is in flight: account epoch fencing prevents stale completion and duplicate scanner ownership (Task 5).

## File map and test commands

Backend files below are under `artifacts/api-server/src/features/google-workspace/` unless a full path is specified. Keep the existing API client as transport; separate orchestration, persistence, matching and UI reads. Tests use corresponding `.test.ts` files, with `.pglite.test.ts` for SQL and `.scale.test.ts` for load fixtures.

Run each named backend test with `pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/<test-file> --maxWorkers=2`. Set a dummy local DATABASE_URL only for mocked/PGlite tests; never run tests against production. Use Node 22. Each task starts with a failing test, implements the minimum behavior, reruns the test, and commits only its related files.

## Task 1: Read-only Gmail change transport

Files: modify `google-api-types.ts`, `google-api-client.ts`; create `google-mailbox-sync-types.ts`, `google-mailbox-sync-client.test.ts`.

Interfaces: `MailboxSyncClient.getMailbox(): Promise<{email:string;historyId:string}>`; `listHistory(input:{startHistoryId:string;pageToken?:string}): Promise<{historyId:string;nextPageToken:string|null;changedThreads:string[]}>`; `listMessagesPage(input:{query:string;pageToken?:string}): Promise<GoogleMessagePage>`; `listDraftsPage(pageToken?:string): Promise<GoogleMessagePage>`; `getThread(threadId:string): Promise<GoogleThreadDetail>`. The adapter exposes only reads. `SyncFailure` carries `kind: 'expired_cursor'|'source_missing'|'retryable'|'auth'|'invalid'`, optional `retryAfterMs`, and sanitized code.

- [ ] Write transport contract tests: `expect(page.historyId).toBe('90071992547409931234')`; all message-added/deleted and label-added/removed thread IDs deduplicate; empty history preserves the response cursor; missing required cursor fails. Assert no mutating HTTP requests and no Profiles-only filter.
- [ ] Run the new test and record expected missing-interface/behavior failures.
- [ ] Implement adapters using existing authorized transport and refresh flow. Preserve Retry-After; distinguish history 404 from thread 404; propagate pagination instead of looping the entire mailbox. Bound each page to 100 records. Apply request timeouts and response-size limits to prevent an oversized thread exhausting memory; oversize becomes explicit review status.
- [ ] Test 401 retry then auth pause, rate-limited 403/429, 5xx, malformed data, missing thread and timeouts. Run new tests and existing thread-detail/draft contracts; expect pass.
- [ ] Commit transport changes.

## Task 2: Durable queue and atomic checkpoints

Files: create `lib/db/migrations/20261016_google_mailbox_sync.sql`, `google-mailbox-sync-repository.ts`, `google-mailbox-sync-repository.pglite.test.ts`.

Tables: account state keyed by connection, with mailbox identity, mode (`off`, `shadow`, `active`), cohort limit, epoch, phase, cursor/boundary/page checkpoint, retry and lease fields; thread jobs keyed by connection/thread with generation, processed generation, claim token/epoch, retry, availability and error; current snapshots; append-only snapshot revisions; separate archive jobs keyed by connection/thread/content fingerprint. Add due-job and profile-status indexes. No cascading business-record deletion. Migration defaults off and copies no history destructively.

Interfaces: `SyncRepository.claimAccount(connectionId:string): Promise<AccountClaim|null>`; `commitPage(claim:AccountClaim, input:PageCommit): Promise<boolean>` atomically enqueues IDs and updates checkpoint; `claimThreads(claim:AccountClaim, limit:number): Promise<ThreadClaim[]>`; `finishThread(claim:ThreadClaim, result:ThreadResult): Promise<boolean>`; `retryThread(claim:ThreadClaim, failure:SyncFailure): Promise<void>`. Claim types include epoch/token; thread claims include generation. Define types in Task 1's types file. PageCommit includes phase, expected checkpoint, next checkpoint and thread IDs.

- [ ] Write real migration/PGlite tests: replay a page and assert unique jobs; inject checkpoint failure and assert neither queue nor cursor commits; claim two workers and assert disjoint jobs; expire lease and assert stale token cannot save.
- [ ] Run tests and confirm failure before implementation.
- [ ] Implement short transactions and fenced updates, using `FOR UPDATE SKIP LOCKED` for claims. Generation increments on dirty enqueue; completion advances only claimed generation, leaving later work pending. Failed jobs have independent retry times. Current snapshot/history/mapping writes share one transaction. History fingerprints exclude transient download handles.
- [ ] Add `expect(newerJob.generation).toBeGreaterThan(newerJob.processedGeneration)` after old-claim completion. Assert wrong connection/epoch never saves. Verify both first migration and rerun preserve sentinel notes, mappings, archives and follow-ups. Expect all tests pass.
- [ ] Commit persistence changes.

## Task 3: Resumable bootstrap, history and recovery

Files: create `google-mailbox-sync-ingestor.ts`, `google-mailbox-sync-ingestor.test.ts`; extend repository pagination helpers.

Interface: `MailboxSyncIngestor.step(claim:AccountClaim): Promise<{phase:string;queued:number;hasMore:boolean}>`, consuming Tasks 1–2. One external page per step. Bootstrap phases: capture boundary, mapped-thread keyset pages, recent-mail pages, draft pages, history replay, ready. Capture fixed discovery time boundaries at run start. Full mailbox history IDs may be examined, but only matched/reviewable business conversations produce persisted content; unrelated mail is not archived.

- [ ] Write fake-client tests: mailbox changes between boundary capture and bootstrap completion are replayed; mapped thread older than 90 days remains queued; drafts outside recent window are discovered; all pages handled after restart.
- [ ] Run tests and confirm missing ingestor failures.
- [ ] Implement persisted phases with 100-item pages; no per-profile Gmail search. Advance committed history cursor only after last page is durably enqueued. Queue backlog may remain after cursor advancement. Empty final page must commit the returned history ID.
- [ ] Test expired history starts visible recovery with a new boundary and refreshes existing mappings before replay; invalid page token restarts its phase without losing boundary; a second cursor expiry restarts recovery safely. Auth pauses the account; transient errors preserve checkpoints and honor retry delay. Assert idle ready step performs zero thread-body reads.
- [ ] Run ingestor/repository tests; commit passing changes.

## Task 4: Changed-thread observations and safe matching

Files: create `google-mailbox-sync-processor.ts`, `google-mailbox-sync-matcher.ts`, corresponding tests and processor PGlite tests; modify `google-pilot-sync.ts` and its tests only for shared classifier correctness.

Interfaces: `SyncMatcher.resolve(connectionId:string, thread:GoogleThreadDetail): Promise<{kind:'matched';profileId:string}|{kind:'review'|'ignored';reason:string}>`; `MailboxSyncProcessor.process(claim:ThreadClaim): Promise<void>`. Matcher consumes existing contact/profile resolution and learned evidence without calling recent-validation's mutation pipeline. Processor uses Tasks 1–2, classifier, and matcher.

- [ ] Write classifier tests for exact parsed address vs misleading display name, aliases, trashed draft, draft replacement, newer reply, bounce, repeated observation, disappearance without SENT, and actual SENT. Assert owner decision/follow-up records unchanged.
- [ ] Run and confirm new edge-case failures.
- [ ] Implement normalized address comparison (parse actual mailbox, never infer all plus aliases equivalent), exclude trashed drafts, and reuse the classifier. Copy pilot baseline/snapshot evidence into the new model idempotently for the existing three customers, retaining original tables.
- [ ] Implement matching and processing. Prefer explicit mappings; conflicting targets enter review. Lock/revalidate relevant mapping ownership before save; do not use an upsert that overwrites a repaired target. Unknown/new threads may create review evidence, never new reminders or labels. Missing source retains cached content with availability status; oversized source shows review-required.
- [ ] Test mapping repair during fetch, account replacement, missing thread, two identical snapshots and changed draft IDs; assert old mappings/revisions remain. Spy on forbidden sends, labeling, outreach persistence and follow-up completion and assert zero calls. Rerun pilot regression suite and processor tests; commit.

## Task 5: One scheduled owner and bounded attachment work

Files: create `google-mailbox-sync-loop.ts`, `google-mailbox-sync-runtime.ts`, `google-mailbox-sync-archive-worker.ts`, corresponding tests; modify `google-sent-profile-link-sweep-loop.ts` and `artifacts/api-server/src/index.ts`.

Interfaces: `MailboxSyncLoop.start():void`, `close():Promise<void>`; `SyncRuntime.tick(connectionId:string):Promise<void>`; `SyncArchiveWorker.step(claim:AccountClaim):Promise<void>`. Runtime shares a two-request semaphore across ingestion, thread hydration and archive downloads for each connection. Limits also enforced through account lease across processes. No separate per-profile timers.

- [ ] Write scheduler tests: at most two requests in flight, 25 thread claims per turn, no overlaps during slow requests, shutdown stops new work, retry jitter respects server delay. Fake timers verify five-minute discovery interval and yielding between backlog turns.
- [ ] Run tests and confirm failure.
- [ ] Wire one runtime into existing server lifecycle. Shadow mode collects discovery evidence without business writes; active mode becomes sole scheduled owner for the account. Legacy worker must check ownership before each stage, and cutover waits for an existing legacy stage to drain. Epoch fences both ownership transitions and stale new-worker writes. Manual repair remains available.
- [ ] Implement archive queue only for newly missing artifacts from verified threads. Reuse archive storage/dedup mechanics with the already fetched snapshot where possible; do not invoke its broad rescanning path for every change. No archive work for drafts or unrelated mail. Persist retry state and verify archive completeness before marking its job successful.
- [ ] Test cutover/rollback during an in-flight stage, disconnected account, duplicate attachment jobs and transient attachment failure. Assert old archive references remain and unchanged threads cause zero repeated downloads. Run loop/processor/archive regressions; commit.

## Task 6: Cached status API and scalable UI

Files: create `google-mailbox-sync-read-model.ts` and tests; modify `artifacts/api-server/src/routes/email-thread-attention.ts`, its route tests, `artifacts/adventure-zone/src/components/google-workspace/google-pilot-sync-panel.tsx` and its tests.

Interfaces: `readSyncStatus(connectionId:string):Promise<SyncStatus>` (phase, last success, backlog, errors, cohort); `listSyncThreads(input:{connectionId:string;profileId?:string;cursor?:string;limit:number}):Promise<{items:ThreadSummary[];nextCursor:string|null}>`. Default 25, max 100, stable keyset pagination. Draft bodies fetched on authenticated detail read, not returned across thousands of list rows.

- [ ] Write route/UI tests: owner authentication, account isolation, strict request schema, cursor stability, cached reads make zero Gmail calls, stale status retains previous content, and no 4,000-card render.
- [ ] Run tests and confirm missing behavior.
- [ ] Add owner-only `/sync/status`, `/sync/threads`, `/sync/thread` GETs and `/sync/check` POST under attention router. Check enqueues/coalesces work and returns 202 without waiting for Gmail. Preserve pilot endpoints as compatibility adapters once active; otherwise original pilot remains available.
- [ ] Update panel to paginated customer states with distinct sync health and business status, manual refresh, profile links and lazy draft details. Keep owner notes/follow-ups visible without changing them. Run backend tests and `pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace/google-pilot-sync-panel.test.tsx --maxWorkers=2`; commit.

## Task 7: Scale, failure recovery and release

Files: create `google-mailbox-sync.scale.test.ts`, `docs/com/scalable-gmail-sync.md`, `scripts/google-sync-integrity-report.ts`. Report script is read-only, emits aggregate counts/reference violations, not customer content or credentials.

- [ ] Build 4,000-profile/12,000-thread synthetic fixture with notes, follow-ups, mappings and archive-reference sentinels. Add tests for idle, 20 changed threads, full bootstrap, burst enqueue, restart/replay and rate limiting. Assert no whole-dataset application-memory materialization; page/claim limits remain bounded.
- [ ] Run scale test: idle fetches zero thread bodies; 20 changes create 20 unique refresh jobs before retries; max concurrency <=2; no lost generations; all sentinel histories remain; cached list queries make zero Gmail calls. Capture wall time, memory, queue drain and request counts. Do not silently weaken assertions for performance.
- [ ] Run all changed tests and relevant Workspace regressions with maxWorkers=2; run API/frontend builds and typechecks separately. Record pre-existing unrelated failures distinctly. Review branch diff for accidental send/label/delete paths and log/body leakage; repair findings and rerun affected checks.
- [ ] Create and attach reviewable PR with test evidence and rollback instructions. After review, verify a current recoverable backup and record pre-migration aggregate/reference checks before any live migration; if unavailable, stop rollout and identify the concrete missing backup evidence.
- [ ] Deploy additive migration with sync off. Verify post-migration integrity, then shadow discovery and three-customer active checks. Validate Laramie owner decision, Strawberry unsent draft and Preston bounce against current Gmail; do not manufacture test emails.
- [ ] Advance 50, 500 and all verified mappings only after each cohort drains without unexplained conflicts/history changes or increased profile-page latency. Record real request counts, queue age, retry/error counts and cached API timings. Flag ambiguity explicitly; do not autoassign to reach 4,000.
- [ ] Document actual enrolled profile/thread counts, blocked records, last successful history checkpoint and rollback switch. Claim all-customer readiness only after live checks and integrity comparison pass. Commit runbook/evidence. Then start the separately scoped Gmail panel work.

## Plan self-review

Spec requirements map to Tasks 1–7: history/transport (1,3), durability (2), safe state/matching (4), budgets/cutover/archive (5), cached UI (6), preservation/scale/live rollout (7). All five review-focus cases have owning tests. Interfaces share types from Task 1 and claim contracts from Task 2. No production activation or Gmail-panel work is included before the specified verification gates.
