# Reliable Follow-ups Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A deterministic follow-up service and prominent four-bucket Today board, followed by shared action hooks, COM drafts, and retirement of internal AI execution.

**Architecture:** Extend existing follow_ups; retain legacy API compatibility. All new workflow mutations lock the source record, compare its exact database revision, and save the action plus timeline note in one transaction. The board reads all buckets from the same query and never hides unscheduled active work.

**Tech Stack:** React, Vite, Express, PostgreSQL, Drizzle, Vitest, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-24-reliable-follow-ups-design.md`, approved in conversation with the owner.

## Global Constraints

- Preserve authentication, Gmail send reconciliation, CRM data, and existing connector scopes.
- No internal agent loops or background drafting.
- New queue dates use America/Denver; do not silently alter existing app-wide Chicago business-date behavior.
- Explicit no-further-action reason is required when resolving without a successor.
- Preserve unrelated reminders and imported history.

## Review Focus

- Two clients change a reminder concurrently: one receives a stale-revision conflict.
- Failure while writing a note or successor rolls back completion.
- Pagination must not make missing-next-step totals disappear.
- Contact-only reminders and profiles with multiple event years retain the correct relationships.
- A send succeeds but bookkeeping fails: retry bookkeeping without resending.

### Task 1: Follow-up workflow service

**Files:** Create features/follow-ups/workflow-{types,service,repository}.ts and workflow.pglite.test.ts under artifacts/api-server/src.
**Interfaces:** snooze({id,expectedRevision,dueAt}); resolve({id,expectedRevision,outcome,nextAction|null,noFurtherActionReason?}); plan({source,id,expectedRevision,nextAction}); list({bucket,days,offset,limit}). Revisions are database timestamp text, not JavaScript-rounded dates.

- [x] Write failing PGlite tests for stale snooze/resolve, explicit final decision, preserving unrelated reminders, atomic successor + note, rollback, and source relationship checks.
- [x] Run Vitest and confirm missing behavior fails.
- [x] Implement with parameterized SQL and injected transactions, using existing tables and no destructive migration.
- [x] Run the focused tests and existing service validation tests.
- [x] Commit.

### Task 2: Work queue API and Today board

**Files:** Create routes/follow-up-workflow.ts, features/follow-ups/work-queue.ts, and components/today/follow-up-board.tsx; modify routes/index.ts and pages/TodayPage.tsx.
**Interfaces:** GET /work-queue; POST /follow-ups/:id/snooze; POST /follow-ups/:id/resolve; POST /work-queue/plan. Existing complete endpoint remains compatible while the new UI uses resolve.

- [x] Write failing tests for Mountain midnight/DST, bucket counts, missing-step prominence, stale mutation refresh, and completion requiring a decision.
- [x] Implement four buckets and per-bucket pagination, outcome/successor form, snooze controls and profile context link.
- [x] Mount under existing owner authentication; preserve existing Today tools behind a details section.
- [x] Run API and UI tests and typecheck available modules.
- [x] Commit.

### Task 3: Meaningful action hooks

- [x] Trace confirmed-send, call-log and terminal status paths; add transactional notes and next-step decisions at shared services.
- [x] Test quote/availability 4 days, normal 7 days, post-event 21 days, explicit date override, holds, and retry without duplicate notes/sends.

### Task 4: COM drafting and cleanup

- [x] Reuse scoped external connector writes; bounded context includes last notes, email subject/snippet, booking status and approved HTML.
- [x] Retain the existing app-draft and shared booking-work APIs for resumable external drafting; add deterministic template rendering without an internal agent.
- [x] Feature-flag internal AI execution and freeze Act! migration mutations while preserving read history and shared dependencies.
- [x] Verify auth, send and connector regression coverage; publish a reviewable feature branch and PR without merging or deploying.

## Verification and review record

Independent review found four important issues: unrelated reminder adoption, template-category mismatch, linked-opportunity final decisions, and missing event-year context. Each was addressed with regression coverage. The legacy booking-completion terminal-decision bypass and owner opportunity status dropdown were also covered. A stale preexisting email-recipient test assertion was changed to check the existing error code; the no-Gmail-call guarantee remains tested.

Local verification uses the source snapshot and pinned Zod/Drizzle versions. Broader workspace typecheck and application builds run in the added GitHub CI workflow. No merge or deployment is part of this branch.
