# Assistant Operations Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement inline, preserving the already selected execution method. Steps use checkbox syntax.

**Tech Stack:** TypeScript, Express, React, Drizzle/PostgreSQL, OpenAI Responses; Node 22.

## Global Constraints
- Owner-only access, additive mirrored migrations, no production activation or customer sends.
- Reuse canonical services and exact action grants; no provider fallback or bulk sending.
- Persist task progress and report incomplete evidence honestly.

**Goal:** Source-backed operations answers and reviewed shared office tasks in the owner assistant.
**Architecture:** Sanitized adapters reuse travel-leg/resource/inspection/office services. Task mutations and receipts share existing Drizzle transactions.
**Spec:** docs/superpowers/specs/2026-09-24-assistant-operations-workflows.md

## Review Focus
- Suggested legs and overridden conflicts stay visibly uncertain (Task 1).
- Missing event/inspection year never becomes the current year (Task 1).
- Photos/account DTOs never disclose storage keys or credentials (Task 1).
- Disabled accounts and moved contacts block task approval at transaction time (Task 2).
- Partial task edits preserve manual due dates and coordinator notes (Task 2).

### Task 1: Operational evidence
Files: operations-reads.ts, operations-reads.test.ts.
Interfaces: createOperationsReads(database,read) returns handlers for list_legs, read_route_context, read_booking_operations, read_resource_inventory, read_inspection_context, read_staff_work.
- [x] Write tests for year separation, assigned/suggested distinctions, missing dates, owner scope and sanitized inspection/staff output. Assert returned warnings remain and no `storageKey`, `passwordHash` or signed URLs appear.
- [x] Run `vitest run src/features/assistant-workspace/operations-reads.test.ts`; expected missing behavior failure.
- [x] Reuse fresh booking operations provider, DrizzleTravelLegRepository, DrizzleResourceSettingsRepository, YearEndInspectionService and DrizzleOfficeTaskRepository. Explicitly select safe fields and enforce requested/selected scope before reading protected details. Report source revision/retrieval time and truncation.
- [x] Run tests and affected canonical operations regressions; expected pass. Commit `Add scoped assistant operations context`.

### Task 2: Reviewed office handoffs
Files: operations-actions.ts, operations-actions.integration.test.ts; modify runtime.ts and operations tool registry.
Interfaces: operationsAdapters exposes create_office_task/update_office_task; exact target is account for create, task for edit. Strict arguments expose current canonical task types, reviewed profile/contact, title/instructions and optional dueAt/status.
- [x] Write PGlite tests: duplicate approval yields one task, failed receipt/audit rolls back, stale revision/disabled account/moved contact rejects, unrelated edit retains due date and coordinator note.
- [x] Run integration tests; expected failures.
- [x] Lock action/account/task and profile relationship, enforce active coordinator and exact revision. Invoke existing task repository on transaction; audit and mutation receipt are atomic. Reconciliation reads saved receipts only.
- [x] Run tests; expected pass. Commit `Add reviewed office task handoffs`.

### Task 3: UI and branch verification
Files: operations-tools.ts; modify ActionResults/WorkspacePage preview mapping and workspace runtime/routes; update docs/assistant-workspace-rollout.md.
Interfaces: safe task preview identifies coordinator, profile/contact, exact fields and prior/current revision; standard action cards approve. Link owner to /office-coordinator.
- [x] Test readable task review, exact target/revision and stale preview blocking.
- [x] Run UI test; expected failure before wiring.
- [x] Register owner-only tools and action preview, preserving existing controls. No staff access to owner conversations or owner tool registry.
- [x] Run workspace/affected service suites, builds, typechecks, and one fresh whole-branch review of both completed stages. Record environmental release gates honestly, publish a draft PR against verified current main.

## Execution record
Completed inline in the existing managed worktree after merged PR #947. Implementation was consolidated in commit a24f0d7 so shared runtime, schema and action dependencies remain reviewable together; the task-level commit titles above describe milestones. Canonical follow-ups use `kind` (no separate title field); profile/contact/booking/year derive from the verified draft. Current eligibility and draft creation refresh inside the same transaction. Research output preserves incomplete evidence and unknown usage.

Final Node 22 verification: 42 backend files / 189 tests; React 4 files / 10 tests; both builds passed. Typecheck error counts remain the 94 API / 135 UI baseline, none in changed workspace files. Fresh whole-branch review plus focused re-review completed with no remaining blocking issue. Browser, native PostgreSQL and live Google/provider acceptance remain the previously documented activation gates. Publish as a new draft PR; keep the feature default off and this worktree intact.
