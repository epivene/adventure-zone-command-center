# ACT Note Ownership Repair V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair missing and misassigned ACT Notes/History using exact archived ACT relationships, surface ACT Notes in the normal profile Notes collection, and route ambiguous ownership to the existing ACT recovery review queue.

**Architecture:** Extend the existing ACT archive recovery path rather than building another importer. `ActTimelineRecovery` remains the canonical ownership reconciler, `ActRecoveryReviewService` remains the ambiguity queue, and profile projections distinguish ACT `note` from ACT `history` when building Notes/History views.

**Tech Stack:** TypeScript, PostgreSQL/Drizzle, PGlite tests, Express API, React/Vite frontend, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-act-note-ownership-repair-v2-design.md`

## Global Constraints

- Automatic ownership changes require exact archived ACT relationship evidence or an explicit stored `assign_parent` decision.
- Never fuzzy-match timeline ownership by text, event name, city, or AI.
- Never delete ACT archive/source records.
- Preserve `source_record_id`, `source_version_id`, `source_type`, and ACT record identity.
- Ambiguous ownership becomes `needs_review`.
- ACT Notes appear in normal Notes; ACT History remains History.
- Repair must be idempotent.

---

### Task 1: Lock the ownership repair behavior with PGlite tests

**Files:**
- Modify: `artifacts/api-server/src/features/act-recovery/act-note-profile-repair.pglite.test.ts`
- Modify if needed: `artifacts/api-server/src/features/act-recovery/timeline-recovery.pglite.test.ts`

**Interfaces:**
- Consumes: `ActTimelineRecovery.recoverTimeline(candidate)`.
- Produces: regression coverage for missing-record recovery, stale-association cleanup, Adventure Zone wrong-owner cleanup, unresolved ownership, and idempotency.

- [ ] **Step 1: Add a failing test for missing ACT Note recovery**

Create a fixture with one archived `note` source, one `note_company` relationship, a local `act_external_links` mapping for the company, and no local activity. Assert `recoverTimeline()` returns `recovered`, inserts one activity with `source_type = 'note'`, and creates exactly one organization association to the correct profile.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:
```bash
pnpm --filter @workspace/api-server test -- src/features/act-recovery/act-note-profile-repair.pglite.test.ts
```
Expected: the new assertion fails if current behavior does not fully satisfy the fixture.

- [ ] **Step 3: Add failing wrong-owner cleanup tests**

Add one generic wrong-profile case and one case whose wrong profile is named/represented as Adventure Zone. Assert legacy direct parent columns are null after repair, stale association rows are removed, and only the exact canonical organization association remains.

- [ ] **Step 4: Add failing unresolved ownership test**

Create an archived note with no resolvable exact parent. Assert state `needs_review` and assert the repair does not add any guessed organization association.

- [ ] **Step 5: Add failing idempotency test**

Run the same exact-owned note twice and assert one local activity and one canonical association remain.

- [ ] **Step 6: Commit the tests**

```bash
git add artifacts/api-server/src/features/act-recovery/act-note-profile-repair.pglite.test.ts artifacts/api-server/src/features/act-recovery/timeline-recovery.pglite.test.ts
git commit -m "test: define ACT note ownership repair v2"
```

---

### Task 2: Strengthen timeline ownership reconciliation

**Files:**
- Modify: `artifacts/api-server/src/features/act-recovery/timeline-recovery.ts`
- Test: `artifacts/api-server/src/features/act-recovery/act-note-profile-repair.pglite.test.ts`

**Interfaces:**
- Consumes: exact parents from archived relationship records, inline ACT relationship IDs, and explicit `assign_parent` decisions.
- Produces: idempotent recovered activity with only canonical exact associations.

- [ ] **Step 1: Run Task 1 tests against current implementation**

Use the focused command from Task 1 and record which assertions fail.

- [ ] **Step 2: Implement only the minimal reconciliation changes needed**

Keep `resolveParents`, `resolveManualParent`, `ensureAssociation`, and `reconcileOwnership` as the ownership boundary. Do not add fuzzy fallback. Ensure missing records receive provenance before association, and existing records with stale direct/association ownership are reconciled to the exact parent set.

- [ ] **Step 3: Ensure unresolved parent sets return `needs_review` before any ownership mutation**

The code path must return:
```ts
{
  state: "needs_review",
  targetSummary: { reason: "timeline_parent_unresolved", sourceType },
}
```
without modifying existing associations.

- [ ] **Step 4: Run focused recovery tests**

```bash
pnpm --filter @workspace/api-server test -- src/features/act-recovery/act-note-profile-repair.pglite.test.ts src/features/act-recovery/timeline-recovery.pglite.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/act-recovery/timeline-recovery.ts artifacts/api-server/src/features/act-recovery/act-note-profile-repair.pglite.test.ts artifacts/api-server/src/features/act-recovery/timeline-recovery.pglite.test.ts
git commit -m "fix: repair exact ACT timeline ownership"
```

---

### Task 3: Create and identify the V2 timeline-only repair run

**Files:**
- Modify: `artifacts/api-server/src/features/act-replacement/runtime.ts`
- Modify: `artifacts/api-server/src/features/act-recovery/act-note-profile-repair.pglite.test.ts`
- Modify if needed: `artifacts/api-server/src/features/act-recovery/recovery-repository.ts`

**Interfaces:**
- Produces: request key `act-note-profile-repair-v2` with stream types `note`, `history`, `activity` only.

- [ ] **Step 1: Change the startup contract test to expect V2**

Assert runtime source contains:
```ts
requestKey: "act-note-profile-repair-v2"
streamTypes: ["note", "history", "activity"]
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/act-recovery/act-note-profile-repair.pglite.test.ts
```
Expected: FAIL while runtime still schedules V1.

- [ ] **Step 3: Update archive runtime scheduling to V2**

In `createProductionArchiveRuntime()`, call `createRunsForAllSources` with the V2 request key and the three timeline streams only.

- [ ] **Step 4: Run focused test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/act-replacement/runtime.ts artifacts/api-server/src/features/act-recovery/act-note-profile-repair.pglite.test.ts
git commit -m "fix: schedule ACT note ownership repair v2"
```

---

### Task 4: Surface ACT Notes in the normal profile Notes collection

**Files:**
- Inspect/Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Inspect/Modify: profile repository/service used by that route
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx` only if frontend filtering is currently responsible
- Test: add focused API/repository test beside the profile projection code

**Interfaces:**
- Produces: profile response where imported ACT source type `note` is included in the normal Notes collection/count; source type `history` remains history.

- [ ] **Step 1: Trace the current profile Notes projection**

Identify where `data.notes`, note counts, and history activities are selected. Record whether imported ACT notes are stored only as activities or are already represented in a notes projection.

- [ ] **Step 2: Write a failing projection test**

Fixture:
- one activity with `source_type = 'note'` associated to the organization;
- one activity with `source_type = 'history'` associated to the organization.

Assert the profile Notes projection contains the ACT note and excludes the ACT history. Assert the history projection contains the ACT history.

- [ ] **Step 3: Run the focused projection test and confirm RED**

Use the existing test command for the selected repository/route file.

- [ ] **Step 4: Implement the minimal projection change**

Use provenance to classify imported timeline records. Do not convert history into notes and do not create duplicate rows. Preserve an `importedFromAct`/source indicator in the returned note view so the UI can label/simplify it consistently.

- [ ] **Step 5: Run focused API/repository tests**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit only the profile projection and its tests.

---

### Task 5: Make V2 repair status/review understandable in the existing ACT Recovery UI

**Files:**
- Inspect/Modify: existing ACT recovery route(s)
- Inspect/Modify: `artifacts/adventure-zone/src/pages/ActRecoveryPage.tsx`
- Test: existing ACT recovery page/route tests

**Interfaces:**
- Consumes: `ActRecoveryReviewService.status()` and `reviewPage()`.
- Produces: visible V2 repair summary with candidate, recovered, already present, needs review, dropped, and retryable-failed counts.

- [ ] **Step 1: Add a failing source/UI contract test for the V2 label and outcome counts**

The page must identify the latest V2 run as a note/history ownership repair rather than a generic import.

- [ ] **Step 2: Run focused frontend test and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActRecoveryPage*
```

- [ ] **Step 3: Add minimal V2 status copy**

Use existing status fields. Do not create a new queue. Keep existing assign/retry/drop controls.

- [ ] **Step 4: Run focused frontend and API recovery tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit the ACT recovery status/review presentation only.

---

### Task 6: Full regression verification and deployment handoff

**Files:**
- No production changes unless a failing test identifies a defect.

**Interfaces:**
- Verifies the complete repair path.

- [ ] **Step 1: Run ACT recovery tests**

```bash
pnpm --filter @workspace/api-server test -- src/features/act-recovery src/features/act-replacement
```

- [ ] **Step 2: Run relevant profile/API tests**

Run the focused event-profile and activity/note projection test suites identified in Task 4.

- [ ] **Step 3: Run frontend tests for ACT Recovery and Event Profile**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActRecoveryPage* src/pages/EventProfilePage*
```

- [ ] **Step 4: Run typechecks and builds**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 5: Review diff against `main`**

Confirm there are no fuzzy ownership rules, no ACT archive deletions, and no unrelated profile/navigation changes.

- [ ] **Step 6: Open a draft PR**

PR body must document:
- ACT Notes → normal Notes
- ACT History → History
- exact-only automatic ownership repair
- Adventure Zone stale-association cleanup as a regression case
- ambiguous records remain in existing review queue
- repair outcome counts
- executable verification results or any runner limitation
