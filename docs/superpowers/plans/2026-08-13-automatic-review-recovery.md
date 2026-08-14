# Automatic Review Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish automatic ACT review without combining its protected decision pass and full manifest rebuild in one memory-heavy HTTP request, including recovery of the currently stranded production request.

**Architecture:** The command persists validated decisions and a lightweight durable request, then returns `processing`. A runtime recovery worker claims the durable request in a later event-loop turn, performs the single full organizer rebuild, and finalizes the request with fencing. The browser keeps one request key, polls the command until it returns `complete`, and then refreshes the workflow.

**Tech Stack:** TypeScript, Express, React, Drizzle/PostgreSQL, Vitest.

## Global Constraints

- Preserve owner scoping, manifest proof validation, decision idempotency, and token-fenced finalization.
- Never import uncertain records until the completed rebuilt manifest marks their operations ready.
- Recover pre-existing `pending` or abandoned `rebuilding` requests without inserting duplicate decisions.
- Do not call OpenAI; automatic review remains deterministic.

---

### Task 1: Durable asynchronous command boundary

**Files:**
- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Test: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`

**Interfaces:**
- Produces: `AutomaticReviewCommandResult`, a discriminated union with `{ status: "processing" }` and `{ status: "complete", result: AutomaticReviewDecisionResult }`.
- Produces: `recoverOneAutomaticReview(input: { workerId: string; now: Date })` for the runtime worker.

- [ ] Write a failing adapter test proving the first call saves decisions but does not invoke `rebuildAfterReviewChange`.
- [ ] Run the focused adapter test and verify the synchronous rebuild expectation fails.
- [ ] Change the transaction to persist `rebuild_state = 'pending'` with no lease and return `processing` after commit.
- [ ] Add a failing recovery test proving a later worker claim performs one rebuild and token-fenced finalization.
- [ ] Implement the bounded claim/finalize operation and make both tests pass.
- [ ] Add a regression proving a completed request replays its stored result and an active claim is not duplicated.

### Task 2: Restart-safe worker ownership

**Files:**
- Create: `lib/db/migrations/021_act_automatic_review_worker.sql`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/src/migrations.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/runtime.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/worker-loop.ts`
- Test: `artifacts/api-server/src/features/act-replacement/organize-schema-contract.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/worker-loop.test.ts`

**Interfaces:**
- Consumes: `recoverOneAutomaticReview` from Task 1.
- Produces: a worker loop that runs only one protected rebuild at a time and retries durable work after restart.

- [ ] Write failing schema assertions for durable rebuild worker ownership.
- [ ] Add a migration and Drizzle columns for `rebuild_worker_id`, preserving the existing rebuild-state constraint.
- [ ] Write a failing loop test for idle/progress scheduling and shutdown.
- [ ] Register one automatic-review recovery loop in `createActExtractionRuntime` and make the loop tests pass.
- [ ] Add recovery coverage for an abandoned request owned by a prior process and verify fencing prevents stale finalization.

### Task 3: HTTP and browser polling

**Files:**
- Modify: `artifacts/api-server/src/routes/act-replacement.ts`
- Test: `artifacts/api-server/src/routes/act-replacement.test.ts`
- Modify: `artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Test: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`

**Interfaces:**
- Consumes: `AutomaticReviewCommandResult` from Task 1.
- Produces: HTTP `202 { status: "processing" }` and HTTP `200 { status: "complete", ... }`.

- [ ] Write a failing route test that expects `202` without reading the review manifest while processing.
- [ ] Implement the processing response and preserve all digest-consistency checks for completed responses.
- [ ] Write a failing page test that keeps the same request key and polls through processing to completion.
- [ ] Implement bounded polling with visible progress and retry-safe page refresh behavior.
- [ ] Run focused API and frontend tests.

### Task 4: Production recovery and verification

**Files:**
- Modify: `.superpowers/sdd/2026-08-12-automatic-act-review-resolution/final-fix-report.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: deployable evidence and a recovery path for run `d5da751d-5651-4a58-abf4-aedb2ef02e98`.

- [ ] Run focused automatic-review, route, worker, schema, client, and page tests.
- [ ] Run full API and frontend test suites, builds, and typechecks; record established unrelated baselines separately.
- [ ] Inspect the final diff for unbounded payloads, owner leaks, stale-token writes, and logging of record data.
- [ ] Commit, publish, merge, and verify the Render deployment before asking the user to retry or refresh.
