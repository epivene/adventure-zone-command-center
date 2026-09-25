# Assistant Campaign Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement inline, preserving the already selected execution method. Steps use checkbox syntax.

**Tech Stack:** TypeScript, Express, React, Drizzle/PostgreSQL, OpenAI Responses; Node 22.

## Global Constraints
- Owner-only access, additive mirrored migrations, no production activation or customer sends.
- Reuse canonical services and exact action grants; no provider fallback or bulk sending.
- Persist task progress and report incomplete evidence honestly.

**Goal:** Saved, resumable lead batches with current eligibility, sourced research, scoped drafts and actual-send follow-ups.
**Architecture:** A bounded batch store and research-call ledger extend workspace persistence. Typed tools use existing draft/send/follow-up services; the UI renders saved DTOs.
**Spec:** docs/superpowers/specs/2026-09-24-assistant-campaign-workflows.md

## Review Focus
- Repeated next-page calls after timeout return identical members and never skip a page (Task 1).
- A moved contact or new pending send blocks another draft, even after a prior eligibility snapshot (Task 2).
- A research response that loses usage or returns a private URL cannot claim verified safe evidence (Task 3).
- Duplicate actual-send follow-ups preserve manually scheduled reminders (Task 4).
- Saved selected-model/batch context survives conversation switching (Task 5).

### Task 1: Durable batches
Files: new features/assistant-workspace/campaign-store.ts and campaign-store.test.ts; modify db/assistant-workspace-startup-migration.ts, lib/db/migrations/20260924_assistant_workspace.sql, contracts.ts. Paths under artifacts/api-server/src unless fully qualified.
Interfaces: CampaignStore(db,read).create(context,sourceMessageId,input), get(actor,conversation,id), list(actor,conversation), next(context,sourceMessageId,{batchId,revision,size}); members freeze organizationId/contactId/bookingId. Pages return batch and member indices.
- [x] Write failing PGlite tests: `expect(retry.members.map(m=>m.organizationId)).toEqual(first.members.map(m=>m.organizationId)); expect(next.members).toHaveLength(1)` for a three-member list paged two at a time; other actors/conversations return not found.
- [x] Run `vitest run src/features/assistant-workspace/campaign-store.test.ts --maxWorkers=1 --hookTimeout=30000`; expected missing behavior failure.
- [x] Implement actor/conversation FKs, immutable bounded JSON membership and row-locked page requests keyed to an owned user message. Use a single transaction for page persistence and cursor advance, checking replay before revision.
- [x] Run the same test command; expected all pass. Commit `Add durable assistant campaign batches`.

### Task 2: Eligibility and member drafts
Files: campaign-eligibility.ts, campaign-eligibility.test.ts; modify campaign-store.ts, draft-store.ts, workspace-tools.ts.
Interfaces: reviewCampaignMember(db,query,context,batch,member,{ignoreDraftId?}) returns reasons/cautions/fingerprint/checkedAt; CampaignStore.prepareDraft creates a DraftStore(q) draft and member link atomically.
- [x] Test normalized duplicate emails, protected/declined records, missing event year, existing draft/scheduled/uncertain/sent work and changed contact membership. Assert `eligible===false` and exact blocked record IDs, with current-year scope.
- [x] Run focused eligibility/store tests; expected failures.
- [x] Reuse outreachDispatchProtection and bounded scoped SQL; retain open follow-ups. Bind selected batch membership in select_profiles and draft creation. Under a batch lock, refresh eligibility and recipient identity before inserting draft+link. Existing member draft returns its saved identity.
- [x] Run focused tests; expected pass. Commit `Add current campaign eligibility and scoped drafts`.

### Task 3: Bounded public research
Files: public-research.ts, public-research.test.ts; modify contracts.ts, orchestrator.ts and research migration.
Interfaces: researchPublicSources(config,selectedModel,query,signal,fetcher?) returns ToolResult with citations/consulted URLs/usage; ResearchCallStore.execute(context,callId,input,work) persists started/outcome and does not replay unknown work.
- [x] Test selected model and allowed model rejection using HTTP fixture; noncompleted response retains known usage; private URL removal; started-without-result returns uncertain/usageUnknown. Test orchestrator stops on unknown usage.
- [x] Run research/orchestrator tests; expected failures.
- [x] Use OpenAI Responses web_search only, max_tool_calls 3, max_output_tokens min(config,4000), store false, maxRetries 0, AbortSignal.any([caller,timeout]). Parse all output text annotations and consulted sources separately. Persist results by owned run/call ID before returning. No raw provider state in public DTO.
- [x] Run focused tests; expected pass. Commit `Add bounded sourced campaign research`.

### Task 4: Confirmed-send follow-ups
Files: campaign-actions.ts, campaign-actions.test.ts; modify runtime.ts.
Interfaces: campaignAdapters(database,read) exposes create_send_followup using exact draft revision and verified send receipt; arguments daysAfter/title/kind/profile/booking bind the immutable draft.
- [x] Test actual sentAt + 30 days using fixed UTC fixture, no creation for uncertain sends, duplicate replay and preservation of existing manual reminders.
- [x] Run focused tests; expected failures.
- [x] Under action/draft/profile locks read canonical successful send receipt, derive dueAt, call FollowUpService.create with preserveExisting/idempotencyId, then save action result in the same transaction. Never change an existing reminder.
- [x] Run tests; expected pass. Commit `Add reviewed follow-ups based on actual sends`.

### Task 5: Tools, UI and integration
Files: campaign-tools.ts, CampaignPanel.tsx and tests; modify runtime.ts, routes/assistant-workspace.ts, AssistantWorkspacePage.tsx, frontend workspace types/API, document-results.ts/DocumentResults.tsx.
Interfaces: registry validates schemas and owned run/source message. GET conversation includes safe batches/research DTOs. UI selects a batch or submits a next-page request through conversation messages; approval remains exact existing action flow.
- [x] Test restored page membership, source links, blocked members and no bulk-send control; test source projection strips provider state/private URLs.
- [x] Run focused API/UI tests; expected failures.
- [x] Wire registry and saved views. Research model comes from owned run input and the configured allowlist. Preserve existing draft and send review behavior.
- [x] Run all workspace tests plus affected service tests, API/UI builds and typecheck comparison; expected current baseline only. Independent fresh final review and update rollout notes before a new draft PR.

## Execution record
Completed inline in the existing managed worktree after merged PR #947. Implementation was consolidated in commit a24f0d7 so shared runtime, schema and action dependencies remain reviewable together; the task-level commit titles above describe milestones. Canonical follow-ups use `kind` (no separate title field); profile/contact/booking/year derive from the verified draft. Current eligibility and draft creation refresh inside the same transaction. Research output preserves incomplete evidence and unknown usage.

Final Node 22 verification: 42 backend files / 189 tests; React 4 files / 10 tests; both builds passed. Typecheck error counts remain the 94 API / 135 UI baseline, none in changed workspace files. Fresh whole-branch review plus focused re-review completed with no remaining blocking issue. Browser, native PostgreSQL and live Google/provider acceptance remain the previously documented activation gates. Publish as a new draft PR; keep the feature default off and this worktree intact.
