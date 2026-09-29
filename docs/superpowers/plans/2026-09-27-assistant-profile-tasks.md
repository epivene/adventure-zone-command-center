# Persistent Assistant Profile Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete authorized multi-profile work through durable small batches with exact progress, review controls and bounded spending.

**Architecture:** Add a task ledger around the existing assistant run worker and action executor. Persist scope, authority, per-profile outcomes and receipts separately from chat history. Reuse existing research, lifecycle, grants and spending systems.

**Tech Stack:** TypeScript, PostgreSQL/pg/Drizzle, Express, React, Vitest; existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-09-27-assistant-profile-task-design.md` (approved September 27, 2026).

## Global Constraints

- Process at most four profiles per batch, one active child run per task.
- Bound transient retries to two automatic attempts per item, then expose Retry.
- A budget pause requires explicit Resume after allowance is available; rollover must not silently restart the job.
- The model cannot increase limits or change models to bypass them.
- No model training or production code-editing capability is included.
- Preserve all existing records, conversations, pending actions and receipts. Use mocked providers in tests; no production migrations during implementation.
- Refresh main and PRs #957/#958/#959 before execution. Integrate #959 before enabling automatic paid work; preserve #958 lifecycle and research UI behavior.
- Feature flag `ASSISTANT_PROFILE_TASKS_ENABLED` defaults false; enforce on server as well as client capability display.

## Review Focus

- Deleted or inaccessible profiles mid-task: stop writes, retain a named unresolved item and accurate total (Task 2).
- Two tabs issue Resume with stale versions: only one transition and one dispatch succeeds (Tasks 1/3).
- Provider finishes after Pause: retain its cost and receipt but start no further calls (Task 3).
- General-office contact mistaken for event organizer: preserve evidence role and leave stricter objectives unresolved (Task 4).
- Approved changes become stale before application: show conflict; do not overwrite newer edits (Tasks 2/5).

## File map and shared types

Backend prefix B = `artifacts/api-server/src/features/assistant-workspace/`.
Frontend prefix F = `artifacts/adventure-zone/src/`.
Paths below using B/F expand exactly to these prefixes.

- Create B`profile-task-contracts.ts`: Task, TaskItem, TaskCounts, TaskScope, TaskAuthority, TaskCommand, TaskOutcome and schemas. Task states and item states are exactly those in the spec. `Task` includes id, actorId, conversationId, sourceMessageId, scope, authority, state, version, pauseReason and counts. `TaskScope` includes frozen profileIds, nullable eventYear, objective, requestedFields and nullable taskCapUsd. Authority includes sourceMessageId, actionKinds, allowedFields and profileIds. TaskCommand is pause/resume/cancel/retry/skip; skip retains an item as needs_review with reason user_skipped.
- Create B`profile-task-store.ts`: persistence, counters, version checks and atomic scheduling.
- Create B`profile-task-policy.ts`: scope validation, authority compilation and compatible per-action grants.
- Create B`profile-task-runner.ts`: child-run scheduling and outcome reconciliation.
- Create B`profile-task-context.ts`: compact context and evidence-aware completion.
- Create `artifacts/api-server/src/routes/assistant-workspace-tasks.ts`: owner-scoped endpoints.
- Create F`components/assistant-workspace/ProfileTaskCard.tsx` and `ProfileTaskReview.tsx`: progress and concrete approvals.
- Modify B`run-store.ts`, `worker.ts`, `contracts.ts`, `action-executor.ts`, `spending-store.ts`, `spending-provider.ts`, `orchestrator.ts`, `tool-registry.ts`, and `runtime.ts` only at task integration points.
- Modify `lib/db/src/assistant-workspace-schema.ts`, `lib/db/src/migrations.ts`, `artifacts/api-server/src/routes/assistant-workspace.ts`, F`features/assistant-workspace/api.ts`, `types.ts`, and F`components/assistant-workspace/WorkspacePanel.tsx` for persistence, routes and UI wiring.

## Task 1: Persist tasks and exact progress

**Files:** shared contracts/store and schema/migration files above; create B`profile-task-store.test.ts`.
**Interfaces:** `ProfileTaskStore.create(actorId:string, conversationId:string, requestKey:string, scope:TaskScope, authority:TaskAuthority):Promise<Task>`; `get(actorId:string, taskId:string):Promise<Task|null>`; `list(actorId:string, conversationId:string):Promise<Task[]>`; `command(actorId:string, taskId:string, expectedVersion:number, command:TaskCommand, itemIds?:string[]):Promise<Task>`; `countTaskItems(items:TaskItem[]):TaskCounts`.

- [ ] Write failing migration/store tests with real SQL through existing PGlite harness: `expect(counts).toEqual({total:120,completed:80,needsReview:10,failed:5,remaining:25})`; `expect(new Set(items.map(i=>i.profileId)).size).toBe(120)`; duplicate create request returns the same task; foreign actor returns null; a stale command rejects with `ASSISTANT_TASK_CONFLICT`. Reapplying migrations preserves old conversation fixtures.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/assistant-workspace/profile-task-store.test.ts`; expect failures from missing task implementation.
- [ ] Add task, item and task-run tables with actor/conversation ownership, unique membership and request keys, version checks and run foreign keys. Derive counts from persisted item states. Use a transaction and row lock for commands. Completed requires verified outcome; task completion with unresolved items preserves the distinction in summary data.
- [ ] Rerun that command; require all tests passing. Commit only Task 1 files with `feat: persist assistant profile task progress`.

## Task 2: Scoped authority and review APIs

**Files:** policy and tasks route above; modify action-executor, contracts, runtime and parent route; create B`profile-task-policy.test.ts` and `artifacts/api-server/src/routes/assistant-workspace-tasks.test.ts`.
**Interfaces:** `compileTaskAuthority(request:{actorId:string;sourceMessageId:string;scope:TaskScope;explicitActions:string[]}):TaskAuthority`; `grantTaskAction(task:Task,item:TaskItem,intent:ActionIntent,currentRevision:string|null):Grant|null`. Both use existing ActionIntent/Grant types. Add POST `/tasks`, GET `/tasks?conversationId=...`, GET `/tasks/:id`, POST `/tasks/:id/commands` and POST `/tasks/:id/approvals` under the assistant-workspace router. Mutations require requestKey and expectedVersion; approvals include actionIds and expected revisions.

- [ ] Write failing tests: research-only creates no write authority (`expect(authority.actionKinds).toEqual([])`); an authorized additive note obtains a correctly bound grant; overwriting a populated contact returns no grant; foreign profile and changed year are rejected; stale revisions return 409; disabled flag rejects task mutation without paid calls. Deleted/inaccessible targets retain needs_review and the original total. Approval batches return per-action receipts/conflicts and enforce a maximum of four items.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/assistant-workspace/profile-task-policy.test.ts src/routes/assistant-workspace-tasks.test.ts`; confirm failures.
- [ ] Resolve targets from server records and freeze IDs; persist exact original authorization. Proposed/ambiguous scopes need explicit task-card confirmation. Model tool output may propose authority but cannot approve it. Recheck access, active conversation, task state, action kind, fields and revision immediately before execution; preserve existing executor validation. Scope expansion is a separate authorized task/version, never implicit in Continue. Return named diffs and evidence for reviews.
- [ ] Rerun tests to pass; commit `feat: authorize scoped assistant task updates`.

## Task 3: Durable batches and spending stops

**Files:** runner, worker, run-store, spending-store/provider; create B`profile-task-runner.test.ts` and B`profile-task-spending.test.ts`.
**Interfaces:** add `claimBatch(workerId:string):Promise<{task:Task;items:TaskItem[];leaseToken:number}|null>` and `settleBatch(taskId:string,leaseToken:number,outcomes:TaskOutcome[]):Promise<void>` to store. Runner `dispatchNextTaskBatch(workerId:string):Promise<boolean>` and `reconcileTaskRun(runId:string):Promise<void>` consume existing runs/actions/spending dependencies through constructor injection. TaskOutcome carries itemId, state, evidence IDs, verified receipt IDs and reason. Extend RunInput with optional taskId/itemIds; old inputs remain valid.

- [ ] Write failing tests: 120 profiles produce 30 batches of four; concurrent dispatches produce one active child run; expired leases resume checkpoints; two additional transient retries then failed; no-progress batch pauses. Assert `expect(new Set(writeKeys).size).toBe(writeKeys.length)`. Pause mid-call records the final receipt/cost but `expect(nextPaidCalls).toBe(0)`. Archived conversation, revoked actor and Cancel block subsequent writes.
- [ ] Add spending tests for task cap shared by research/chat/document paths, two concurrent reservations, unresolved holds, day/month rollover and explicit resume. Assert `expect(dispatchedAfterRollover).toBe(0)` and reservations never exceed the lesser remaining cap/owner allowance.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/assistant-workspace/profile-task-runner.test.ts src/features/assistant-workspace/profile-task-spending.test.ts`; confirm failures.
- [ ] Claim and enqueue child runs atomically with unique task/batch keys; use the existing worker lease fencing. Store outcomes before dispatch; reconcile uncertain actions before any retry. Apply task cap in the same reservation transaction/lock as owner limits, not a separate precheck. Enforce cancellation at paid-call/write boundaries; settle already-started activity. Map run step exhaustion to saved task continuation, budget exhaustion to paused, and required review to waiting_review. One blocked item does not stop unrelated eligible items.
- [ ] Rerun to pass; commit `feat: run resumable profile batches within spending limits`.

## Task 4: Task discovery, Continue and bounded evidence

**Files:** context, orchestrator, registry, worker; create B`profile-task-context.test.ts` and B`profile-task-continuation.test.ts`.
**Interfaces:** `buildProfileTaskContext(task:Task,items:TaskItem[],evidence:TaskEvidence[]):TaskBatchContext`; TaskEvidence has id, profileId, eventYear, retrievedAt, sourceUrl, contactRole and excerpt. TaskBatchContext has taskId, objective, counts, items and evidence. `resolveContinuation(tasks:Task[]):{kind:'resume';taskId:string}|{kind:'choose';taskIds:string[]}|{kind:'none'}`. Expose propose_profile_task/get_profile_task tools; mutations use Task 2 authority paths.

- [ ] Write failing tests: one resumable task is selected; multiple tasks return chooser; no task preserves ordinary chat. A task request discovered in chat yields frozen server-validated scope. Context contains at most four profiles, 1,200-character evidence excerpts, 24,000 characters total task context, and no unrelated profile history. General-office evidence cannot complete a named-organizer objective; prior-year source cannot verify future dates; note receipt alone cannot complete missing-contact objective.
- [ ] Run `pnpm --filter @workspace/api-server test src/features/assistant-workspace/profile-task-context.test.ts src/features/assistant-workspace/profile-task-continuation.test.ts`; confirm failures.
- [ ] Build compact context from ledger plus current scoped reads; use existing research index/cache rules and original provenance. Enforce context caps by truncating excerpts with explicit flags and on-demand retrieval, never by hiding unresolved status. Completion combines current-field validation with matching receipts. Reuse successful evidence rather than repeating searches on Continue.
- [ ] Rerun to pass; commit `feat: resume profile tasks from saved evidence`.

## Task 5: Progress and actionable review on Fold

**Files:** task card/review, WorkspacePanel, frontend api/types; create F`components/assistant-workspace/ProfileTaskCard.test.tsx` and `ProfileTaskReview.test.tsx`.
**Interfaces:** `ProfileTaskCard({task,onCommand,onReview})` and `ProfileTaskReview({taskId,changes,onApprove,onSkip})`; callbacks return Promise<void>. API functions mirror Task 2 endpoints and typed conflicts. Review changes contain profile name, field, old/new values, sources and revision; no raw IDs as primary labels.

- [ ] Write failing tests asserting visible completed/needs-review/failed/remaining counts, Pause/Resume/Cancel, multiple-task chooser and readable profile diffs. Duplicate clicks disable while pending; 409 refreshes and preserves review selections only when still valid. Offline shows last-known state and disables mutations; reconnect fetches server state. Finished with unresolved items displays `Finished with items needing review`.
- [ ] Run `pnpm --filter @workspace/adventure-zone test src/components/assistant-workspace/ProfileTaskCard.test.tsx src/components/assistant-workspace/ProfileTaskReview.test.tsx`; confirm failures.
- [ ] Integrate task polling into active conversation state, using existing auth and lifecycle controls. UI supports four selected approvals, explicit confirmation of proposed task authority, and estimated cost uncertainty. Reuse #958 research dialog. Use a single-column card on folded screens and wrapping controls on unfolded screens; avoid fixed widths and per-profile chat messages. Do not queue offline mutation commands.
- [ ] Rerun to pass; commit `feat: show assistant task progress and review controls`.

## Task 6: Integrated recovery and rollout evidence

**Files:** create B`profile-task-flow.integration.test.ts`, F`components/assistant-workspace/ProfileTaskFlow.test.tsx`, and `docs/verification/2026-09-27-assistant-profile-tasks.md`.

- [ ] Write an end-to-end fixture through task routes, scheduler, mocked research and real local SQL: 120 profiles, missing evidence, duplicate Continue, crash after successful note write but before task checkpoint, then resumed worker. Assert final disjoint counts total 120; successful writes occur once; unresolved items remain visible. Assert task flag off leaves existing chat flows unchanged and schema remains readable after disabling the feature.
- [ ] Run the focused backend/frontend task suites and existing worker/action/spending/history regressions; expect all passing. Use actual multi-connection PostgreSQL for lease/reservation races if a disposable database is available; otherwise explicitly record that limitation rather than claiming concurrency was verified.
- [ ] Run `pnpm --filter @workspace/api-server build` and `pnpm --filter @workspace/adventure-zone build`; require success. Compare typecheck diagnostics against a freshly captured base, not only historical totals. Inspect UI at 360px and 768px widths including reload and offline/reconnect; record physical Fold testing separately.
- [ ] Record test results, current base/head commits, remaining limitations and disabled-flag deployment sequence. Commit `test: verify assistant profile task recovery` and obtain an independent whole-branch review. Publish a draft PR with exact dependency order; do not claim deployed. Enabling production or performing a paid pilot needs concrete review of the built change and the task scope/cost first.

## Execution handoff

Recommended: Native execution in this session, then independent whole-branch review. These six tasks share contracts and existing worker behavior, so retaining one implementation context reduces handoff overhead. Subagent-driven execution adds fresh implementation/review contexts per task if preferred. Await user review and execution-method selection before product code changes.
