# Simplified Today Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Booking Today page into a calmer daily starting point centered on one next action, compact work categories, a quiet schedule preview, and a collapsed Later area.

**Architecture:** Keep `/api/today` and all existing child components intact. Add a small pure presentation helper for deterministic Start Here selection, then reorganize `TodayPage.tsx` around the approved hierarchy while reusing `CallQueueWorkspace`, `FollowUpList`, next-step mutations, profile side sheet, trips, and renewals.

**Tech Stack:** React, TypeScript, Wouter, existing Adventure Zone UI/components, Vitest source/unit tests.

**Spec:** `docs/superpowers/specs/2026-08-22-simplified-today-workspace-design.md`

## Global Constraints
- Preserve all existing Today data and mutations.
- No backend/API changes.
- Zero-count ordinary categories do not render.
- Route warnings are exceptional; ordinary follow-up/contract counts are not duplicated in a separate attention section.
- Existing calling, profile-sheet, schedule, trip, renewal, theme, and auth behavior remains intact.

---

### Task 1: Deterministic Start Here priority

**Files:**
- Create: `artifacts/adventure-zone/src/features/today/today-focus.ts`
- Test: `artifacts/adventure-zone/src/features/today/today-focus.test.ts`

**Interfaces:**
- Produces: `deriveTodayFocus(input: TodayFocusInput): TodayFocus` where `TodayFocus.kind` is one of `overdue_followups | followups | contracts | decisions | schedule | caught_up`.

- [ ] **Step 1: Write failing tests** covering the exact priority order: overdue follow-ups > follow-ups > contracts > decisions > schedule > caught up.
- [ ] **Step 2: Run the focused Vitest test and confirm RED.**
- [ ] **Step 3: Implement the minimal pure helper** returning headline, supporting text, and primary href/action kind without touching APIs.
- [ ] **Step 4: Run focused tests and confirm GREEN.**
- [ ] **Step 5: Commit.**

### Task 2: Today page hierarchy regression contract

**Files:**
- Create: `artifacts/adventure-zone/src/pages/TodayPage.simplified-workspace.test.ts`

**Interfaces:**
- Consumes: source of `TodayPage.tsx`.
- Produces: regression coverage for required headings/labels and removal of the old dashboard hierarchy.

- [ ] **Step 1: Write a failing source regression test** requiring `Start here`, `My Work`, `Coming up`, and `Later`, and rejecting the old primary headings `Today's Queue` and general-purpose `Needs Attention` section.
- [ ] **Step 2: Run the focused test and confirm RED.**
- [ ] **Step 3: Do not alter production code in this task. Commit the RED test.**

### Task 3: Reorganize Today without changing data behavior

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Test: `artifacts/adventure-zone/src/pages/TodayPage.simplified-workspace.test.ts`
- Test: existing Today tests touched by the page structure only if necessary.

**Interfaces:**
- Consumes: `deriveTodayFocus` from Task 1.
- Reuses existing `CallQueueWorkspace`, `FollowUpList`, `RenewalsSection`, profile side sheet, next-step clear/snooze/reopen mutations, event-profile links, trip links, and schedule links.

- [ ] **Step 1: Add the Start Here card** using existing dashboard counts and the pure focus helper.
- [ ] **Step 2: Replace the old full Today queue hierarchy with `My Work` details** for calls/follow-ups, contracts when nonzero, and needs-a-decision when nonzero.
- [ ] **Step 3: Keep next-step management controls and undo behavior inside the decision category.**
- [ ] **Step 4: Render exceptional route warnings only when `visibleRouteWarningCount > 0`; do not repeat ordinary workload counts.**
- [ ] **Step 5: Add the quiet Coming Up preview** using the nearest upcoming event and `View schedule`.
- [ ] **Step 6: Move full upcoming events, today's trips, and renewals under a collapsed `Later` section.**
- [ ] **Step 7: Preserve transient Assistant/profile sheet rendering at page bottom.**
- [ ] **Step 8: Run the simplified workspace regression plus existing Today-focused tests and confirm GREEN.**
- [ ] **Step 9: Commit.**

### Task 4: Scope and verification

**Files:**
- No new production files unless a failing verification reveals a necessary correction.

- [ ] **Step 1: Compare branch against `main` and confirm the diff is limited to Today UX, helper/tests, and spec/plan docs.**
- [ ] **Step 2: Run available GitHub CI/status checks.**
- [ ] **Step 3: If the repository runner terminates before steps, keep the PR draft and state that no executable green evidence exists.**
- [ ] **Step 4: Open a draft PR summarizing preserved behavior and the reduced default visual hierarchy.**
