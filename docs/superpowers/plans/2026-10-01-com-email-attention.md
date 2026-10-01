# Com Email Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Com and Desiree file a conversation under its profile while keeping ongoing work visible in Gmail and Today.

**Architecture:** Reuse the app's assignment transaction, Gmail mutation queue and email archiver. Add authoritative per-thread attention state and revision-bound previews, then project that state into Gmail labels and Today. Connector and owner UI invoke the same service.

**Tech Stack:** TypeScript, PostgreSQL, Express, Zod, React, Vitest/PGlite; existing Gmail client. Node 22 as declared by the repository.

**Spec:** ../specs/2026-10-01-com-email-attention-design.md

## Global Constraints
- Never send email without a separate explicit instruction.
- States: needs_your_reply, waiting_for_their_reply, resolved.
- Apply the profile label, apply Needs Attention while work remains, and remove Inbox only after those labels are successfully applied.
- Gmail labels are a projection, not the authority.
- Unknown year is allowed and displayed as unconfirmed.
- Existing CRM grants do not silently gain Gmail write authority.
- Keep existing boss/office permissions unchanged.
- No live email relabeling is part of development testing.
- A later inbound must be reviewed before an earlier resolution may be applied again.
- No new model calls, dependencies, bulk relabeling or automatic reminder creation.

## Review Focus
- Gmail label creation races: reuse the winning exact user label; do not generate duplicates (Task 4).
- A new inbound arrives between Gmail reads and label writes: recheck source immediately before sync; a mismatch keeps Inbox and marks review required; document provider race limits (Tasks 3–4).
- One conversation covers multiple years: null/unconfirmed year stays valid; no calendar-year guess (Tasks 1, 5).
- A thread has several outstanding app work items: resolving thread attention never completes or hides unrelated work (Tasks 3, 5).
- Partial Gmail/history sync followed by retry or revoked access: retry only unfinished authorized effects and show partial results (Tasks 3–4, 6).

## Execution preparation
- [ ] Read the spec and this plan; use the git-worktrees skill to create an isolated checkout from current remote main. Bring only these approved design/plan documents.
- [ ] Read applicable AGENTS.md; compare the current versions of each target file before editing. Preserve changes merged since PR984.
- [ ] Run targeted baseline tests and record runtime/dependency limitations. Follow each task's red → green cycle; commit each deliverable.
- [ ] Use no production customer records in tests.

## File map
All server paths below are relative to artifacts/api-server/src.
- New db/email-thread-attention-schema.ts: additive tables, indexes and migration function.
- New features/google-workspace/email-thread-attention-types.ts and email-thread-attention-repository.ts: shared types, persistence, revisions and audit.
- New features/google-workspace/email-thread-attention-service.ts: verified preview, commit and read orchestration.
- New features/chatgpt-connection/email-attention-tools.ts: connector definitions/consent integration.
- Modify features/google-workspace/google-profile-assignment-transaction.ts: pinned-transaction composition and conflict checks.
- Modify features/google-workspace/google-review-profile-assignment-service.ts: reusable post-commit label/history synchronization.
- Modify features/google-workspace/google-profile-label-sync-service.ts and google-gmail-mutation-repository.ts: durable attention intent and ordered label application.
- Modify features/today/master-work-queue.ts and master-work-queue-repository.ts: thread candidates and identity-based deduplication.
- New routes/email-thread-attention.ts: owner-only preview/apply/read.
- Modify artifacts/adventure-zone/src/pages/EmailReviewPage.tsx and components/today/needs-attention-section.tsx: review controls and attention state presentation.

## Task 1: Durable thread state and preview storage
**Files:** New schema/types/repository above; modify db/required-schema-startup.ts; add adjacent *.pglite.test.ts and startup tests.
**Interfaces:**
- AttentionState = "needs_your_reply" | "waiting_for_their_reply" | "resolved".
- AttentionRecord = { id, gmailConnectionId, threadId, profileId, eventYear: number|null, state: AttentionState, reason, dueAt: string|null, followupId: string|null, reviewedMessageId, revision, actorId, createdAt, updatedAt } (all unspecified scalar fields are strings).
- AttentionPreview = { id, ownerId, connectorId: string|null, gmailConnectionId, threadId, latestMessageId, profileId, eventYear: number|null, state, reason, dueAt: string|null, followupId: string|null, expectedRevision: string|null, sourceFingerprint, expiresAt }.
- ensureEmailThreadAttentionSchema(sql): Promise<void>; repository read(gmailConnectionId,threadId): Promise<AttentionRecord|null>. Repository commit(tx,preview,actorId) returns AttentionRecord and audit entry, rejecting stale revisions.
- Separate preview/audit tables; unique current record by (gmail_connection_id,thread_id). Store preview payload as validated JSON, bind ownership explicitly. Revision UUID changes on every decision.
- [ ] Write tests: migration twice succeeds; same account/thread cannot duplicate; different accounts can share a thread ID; null year round-trips; stale revision rolls back state and audit.
- [ ] Run: node node_modules/vitest/vitest.mjs run src/features/google-workspace/email-thread-attention-repository.pglite.test.ts (from API directory). Expect new behavior failures.
- [ ] Implement additive schema and repository. Run startup unconditionally before listen, even if connector is off.
- [ ] Run repository and required-schema-startup tests; expect all new tests green.
- [ ] Commit: "Add durable email thread attention state".

## Task 2: Explicit connector authorization
**Files:** features/chatgpt-connection/contracts.ts, consent-page.ts, tool-registry.ts; existing authorization and scope-request modules located via rg; new email-attention-tools.ts; adjacent consent/discovery tests.
**Interfaces:** Add ConnectionScope "email:organize"; request_email_organize_access retains current scopes and opens normal owner consent. Never grants consent itself.
- [ ] Write tests asserting ordinary crm:update cannot apply email assignment, read-only discovery does not expose writes, existing grants remain unchanged, and consent describes profile filing, history import, Gmail labels and archiving with no send access.
- [ ] Run focused authorization/discovery tests and observe the new assertions fail.
- [ ] Implement scope and request flow using existing owner consent services. Wire read tools to crm:read and apply to email:organize; service still verifies active connection.
- [ ] Run focused tests; expect pass and no widening of request_write_access or request_edit_access.
- [ ] Commit: "Add explicit email organization consent".

## Task 3: Shared preview/apply service
**Files:** New email-thread-attention-service.ts; assignment transaction/service above; new email-thread-attention-service.pglite.test.ts.
**Interfaces:**
- preview(actor, {messageId,profileId,eventYear,state,reason,dueAt?,followupId?}): Promise<AttentionPreview>.
- apply(actor, {previewId,expectedRevision: string|null,requestKey}): Promise<AttentionResult>.
- read(actor,{gmailConnectionId,threadId}): Promise<AttentionResult|null>.
- Actor = { ownerId, connectorId: string|null }; connector writes additionally enforce principal scope/revocation.
- AttentionResult = { operationId, record: AttentionRecord, assignment: "committed", gmailSync: {state,errorCode}, archiveSync: {state,conversationId,errorCode} }.
- [ ] Write tests for verified source metadata, exactly 15-minute expiry, wrong owner/connector/account denial, missing profile, changed message fingerprint, changed assignment, replay equality and altered payload rejection. Assert mismatched follow-up references fail and resolution never closes other work.
- [ ] Run service tests; confirm failures before implementation.
- [ ] Implement server-read Gmail evidence and profile validation. Reject a different current profile assignment with an owner-review error; first release does not silently reassign. Validate thread's existing mapping and latest message at preview and apply.
- [ ] Compose CRM assignment, attention transition, durable Gmail intent and replay receipt in one pinned transaction. Refactor the existing assignment transaction to accept that transaction; do not hold it during Gmail calls.
- [ ] Use a stable request key for the decision; after commit run existing sync/archive paths. Return current sync state on replay. Preview resolution requires an explicit reason and rejects known linked open follow-ups; no inferred completion.
- [ ] Run tests, including concurrent apply and rollback; expect pass.
- [ ] Commit: "Add verified email assignment previews and commits".

## Task 4: Gmail and history synchronization
**Files:** Existing label sync/mutation/assignment service files; their unit/PGlite tests.
**Interfaces:** Extend durable mutation metadata with attentionRecordId, attentionRevision and expectedLatestMessageId. Existing mutation identity/retry behavior remains authoritative. syncAttention(mutationId) returns existing Gmail sync result.
- [ ] Write tests asserting the profile and exact Needs Attention label are added before Inbox removal; either label failure leaves Inbox; resolved removes only Needs Attention; unrelated labels and unread state survive.
- [ ] Add tests for concurrent label creation, superseded mutations, changed Gmail account, new inbound before sync, revoked connector retry, partial archive retry and duplicate-free history.
- [ ] Run affected Gmail sync/assignment tests and observe new failures.
- [ ] Implement exact label reuse/creation, durable intent checks and two-stage label mutation. Recheck latest message before Inbox removal. A changed source blocks removal and records review required. Acknowledge Gmail has no atomic compare-and-set across read and modify: do not claim that race is eliminated.
- [ ] Persist source-bound reconciliation evidence and make later detected inbound invalidate a prior resolved state. Hook the existing inbound processing path without changing Com's hosted trigger. Newly detected inbound becomes needs_your_reply and queues attention-label restoration.
- [ ] Use the existing profile archive service and return its independent status. Never retry a successful external effect just to manufacture a complete receipt.
- [ ] Run tests; expect pass, including existing assignment behavior outside the new attention flow.
- [ ] Commit: "Keep ongoing filed conversations visible in Gmail".

## Task 5: Today and owner controls
**Files:** New owner route; existing route registration and owner middleware; master queue files; frontend files in map; features/today/master-work-types.ts; corresponding tests.
**Interfaces:** Add nullable gmailConnectionId/threadId and attentionState to relevant queue projections. Source type email_thread_attention uses the attention record ID. Owner routes POST /email-thread-attention/preview, POST /email-thread-attention/apply, GET /email-thread-attention with account/thread identifiers; reuse Task 3.
- [ ] Write tests: both ongoing states appear in Needs Attention; needs_your_reply precedes waiting_for_their_reply; null year displays "Year unconfirmed"; waiting is overdue only with a past verified due date.
- [ ] Test deduplication only for the same account/thread, two independent threads for one profile, and resolution preserving other reminders/work.
- [ ] Test owner route access, preview details, stale apply errors and partial sync rendering; office/boss denied unless already permitted by an existing equivalent route.
- [ ] Run relevant queue/UI tests; observe expected failures.
- [ ] Implement queue projection and identity propagation, exact conversation/profile links, state badges and owner review controls. Keep global opportunity priority and booking-work ownership unchanged.
- [ ] Run tests; inspect narrow/mobile layout with long subjects. Expect readable state and separate sync results.
- [ ] Commit: "Show conversation attention in Today and owner email review".

## Task 6: Connector integration and release
**Files:** email-attention-tools.ts, tool-registry.ts, existing connection-flow.integration.test.ts and mcp-server.test.ts; new docs/com-email-attention.md.
**Interfaces:** Tools preview_email_profile_assignment, apply_email_profile_assignment, read_email_profile_assignment match Task 3, strict Zod schemas and read/write annotations.
- [ ] Write real MCP integration covering preview → apply → read, retry after partial sync, wrong scope, revoked token and stale preview with app AI disabled and provider model imports blocked.
- [ ] Run integration/discovery tests; observe missing tool failures.
- [ ] Wire tools to shared services; document owner consent, labels, unknown year, retry status, race limitation and how Com should stop for ambiguous matches.
- [ ] Run focused tests from Tasks 1–6 and node build.mjs. Run frontend validation with repository scripts; record baseline failures separately. No whole-suite success claim without a completed run.
- [ ] Review diff for sends, permission bypasses, broad label removal, missing startup migration and unrelated changes. Verify no live records were changed.
- [ ] Commit; publish a draft PR against freshly checked main, preserving unrelated remote changes.
- [ ] After user merge/deploy/refresh, verify discovery and owner consent before any separately authorized real filing. Never approve owner consent on their behalf.

## Handoff
Recommend Native execution: these tasks share transaction and synchronization interfaces and can be implemented sequentially in this session, with one independent whole-branch review at completion. Subagent-driven execution offers an independent review after each task at higher context cost. User must review this plan and choose the method before product code is changed.
