# Kristy Review Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Kristy’s five historical manager-review prompts, preserve her completed Miles City report and upcoming Meeteetse event, and remove the incorrectly assigned Don King Days new lead from her leg.

**Architecture:** Stop the startup task that continually re-dismisses the five reviews. Add an exact, assistant-token-protected correction endpoint backed by a transaction-safe repository that restores the five prompts and clears only the verified Don King Days leg assignment. Add a push-time workflow that invokes the correction after deployment and verifies the resulting live manager-review state.

**Tech Stack:** TypeScript, Express, PostgreSQL, Vitest, GitHub Actions, React manager portal.

**Spec:** User correction in the Adventure Zone project conversation on 2026-09-01.

## Global Constraints

- Preserve the completed Eastern Montana Fair / Miles City manager review.
- Preserve Meeteetse Annual Labor Day Celebration 2026 as Kristy’s upcoming event.
- Restore exactly Moorcroft Jubilee Days, Sublette County Fair, Uinta County Fair, Laramie County Fair, and Chouteau County Fair to the due-review queue.
- Do not delete any booking, profile, note, review, wrap-up, or historical record.
- Don King Days remains a live CRM lead but must not remain assigned to Kristy.
- Do not guess another leg for Don King Days; leave it unassigned unless live data has already moved it to another non-Kristy leg.
- Every live mutation must be exact-identity checked, transaction-safe, idempotent, and assistant-token protected.

---

### Task 1: Define correction behavior with failing tests

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/kristy-review-state-correction.test.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/manager-review-overview.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.test.ts`
- Modify: `.github/workflows/kristy-review-screen-ci.yml`

**Interfaces:**
- Consumes: current manager review overview and required startup behavior.
- Produces: failing expectations for `correctKristyReviewState()` and for confirmed-only upcoming review cards.

- [ ] **Step 1: Write the failing correction service tests**

Create tests that require one exact Kristy leg, restoration of the five exact dismissal rows, unassignment of the exact Don King Days new lead, persisted assignment cleanup, repeat safety, and fail-closed identity checks.

- [ ] **Step 2: Add the manager overview regression test**

Add a `new_lead` booking dated before a confirmed event and assert that the confirmed event is still selected as `nextUpcoming`.

- [ ] **Step 3: Update the startup-order test**

Remove the expectation that startup invokes `cleanupKristyReviewQueue`; the test must fail while production still calls it.

- [ ] **Step 4: Run targeted CI and verify RED**

Run the Kristy review screen CI. Expected: failure because the correction service does not exist, startup still invokes the old cleanup, and new leads are still eligible for `nextUpcoming`.

### Task 2: Implement exact correction service and stop re-dismissal

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/kristy-review-state-correction.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/manager-review-overview.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`
- Delete: `artifacts/api-server/src/features/leg-manager/kristy-review-queue-cleanup.ts`
- Delete: `artifacts/api-server/src/features/leg-manager/kristy-review-queue-cleanup.test.ts`

**Interfaces:**
- Produces: `correctKristyReviewState(repository?, now?)` returning `applied`, `already_current`, or `skipped` with a reason.
- Produces: `PostgresKristyReviewStateCorrectionRepository` for exact live mutation.

- [ ] **Step 1: Implement exact identity constants**

Use the verified booking UUIDs, names, locations, and dates for the five historical reviews and Don King Days.

- [ ] **Step 2: Implement fail-closed inspection**

Require one exact configured manager named Kristy. Verify all six booking identities. Allow Don King Days to be already unassigned or assigned to a non-Kristy leg without changing that non-Kristy assignment.

- [ ] **Step 3: Implement one transaction**

Delete the five Kristy dismissal rows, clear Don King Days `travel_leg_id` only when it still equals Kristy, delete the Don King Days persisted `booking_leg_assignments` row only when unassigning, and insert audit entries describing the owner correction.

- [ ] **Step 4: Remove startup re-dismissal**

Delete the old cleanup call and dependency from required startup so restarts cannot re-hide the five prompts.

- [ ] **Step 5: Restrict upcoming review cards**

Only confirmed bookings may be selected as `nextUpcoming` on the manager review page.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run the targeted API tests and confirm all pass.

### Task 3: Add protected live correction route and deployment verification

**Files:**
- Create: `artifacts/api-server/src/routes/assistant-kristy-review-correction.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Create: `.github/workflows/correct-live-kristy-review-state.yml`
- Modify: `.github/workflows/kristy-review-screen-ci.yml`

**Interfaces:**
- Produces: `POST /api/assistant-import/kristy-review-state-correction` protected by `ASSISTANT_IMPORT_TOKEN`.
- Consumes: existing `GET /api/assistant-import/manager-review-audit?manager=Kristy` for post-deploy verification.

- [ ] **Step 1: Add the protected route**

The route accepts no booking IDs from the caller. It invokes the exact correction service and returns the applied state.

- [ ] **Step 2: Mount before the restricted assistant-import router**

Mount the route in `app.ts` alongside the other protected assistant routes.

- [ ] **Step 3: Add the live correction workflow**

On push to main, wait for the deployed correction endpoint, POST once, then query the manager review audit. Require the five exact historical bookings to be due, Miles City to be completed with its existing review ID, Meeteetse to be upcoming, and Don King Days to be absent from Kristy’s leg audit.

- [ ] **Step 4: Upload a protected verification artifact**

Store the correction response and final audit for seven days.

- [ ] **Step 5: Run production builds and CI**

Require targeted API tests, manager page tests, protected-route guards, production API build, and production frontend build.

### Task 4: Merge, deploy, and verify live state

**Files:**
- No additional production files unless verification exposes a real mismatch.

**Interfaces:**
- Consumes: merged main deployment and live protected API.
- Produces: live proof of restored reviews and corrected leg assignment.

- [ ] **Step 1: Open the pull request and verify all checks**

Do not merge until the focused Kristy CI is green.

- [ ] **Step 2: Merge and wait for live correction workflow**

The workflow must complete successfully after the deployed endpoint is available.

- [ ] **Step 3: Inspect the live artifact**

Confirm totals of five due historical reviews, one completed Miles City report, one upcoming Meeteetse event, zero dismissals for those five, and no Don King Days booking on Kristy’s leg.

- [ ] **Step 4: Report the exact correction**

Tell the user that the five reviews are intentionally restored, Miles City remains completed, Meeteetse remains upcoming, and Don King Days is retained as an unassigned CRM lead rather than assigned to another leg by guesswork.
