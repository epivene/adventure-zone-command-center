# Profile Model Clarity and Subset Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow safe same-location subset duplicate merges inside broader related-profile groups and make the duplicate/family UI use Profile/Locations/Event Family language instead of organization jargon.

**Architecture:** Keep all database and API organization identifiers intact. Add a focused selected-subset merge-safety helper in the organization repository layer, use it during transactional revalidation, and update only user-facing copy/action labels in the duplicate review UI.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-profile-model-clarity-and-subset-merge-design.md`

## Global Constraints

- Do not rename database tables, API routes, repository classes, or TypeScript domain types solely for terminology.
- Do not auto-merge based on similar names alone.
- Never include an unselected broader-group member in a subset merge.
- Retired/consolidated profiles remain blocked.
- Different complete city/state pairs remain a merge conflict.

---

### Task 1: Selected-subset merge safety

**Files:**
- Modify: `artifacts/api-server/src/features/organizations/organization-repository.ts`
- Test: existing/new focused organization merge-safety test beside repository tests.

**Interfaces:**
- Produces a pure helper that determines whether selected live records have conflicting complete locations.
- `revalidateOrganizationsMergeable` uses that helper before treating a broader current family proposal as a merge conflict.

- [ ] Write a failing test with Fishtail A (Fishtail, MT), Fishtail B (missing location or Fishtail, MT), and Idaho Falls in a broader candidate; selecting only Fishtail A+B must be mergeable.
- [ ] Write a failing test selecting Fishtail + Idaho Falls; it must remain blocked.
- [ ] Implement the minimum selected-subset location compatibility helper.
- [ ] Update transactional revalidation so a current broader proposal blocks only when the selected subset itself has conflicting complete locations.
- [ ] Run focused tests.
- [ ] Commit.

### Task 2: Plain-language duplicate/family UI

**Files:**
- Modify: `artifacts/adventure-zone/src/components/organizations/duplicates-view.tsx`
- Test: focused duplicate-view copy/action test.

**Interfaces:**
- No API contract changes.
- Existing action handlers stay wired to the same backend endpoints.

- [ ] Write failing copy tests for `Combine as Profile Locations`, Profile terminology in evidence/toasts, and short action guidance.
- [ ] Replace visible organization jargon in the duplicate-review workflow.
- [ ] Add concise inline guidance explaining Merge vs Profile Locations vs Event Family vs Not related.
- [ ] Preserve existing action behavior and request payloads.
- [ ] Run focused tests.
- [ ] Commit.

### Task 3: Verification and PR

**Files:**
- No production changes unless verification reveals a defect.

- [ ] Review diff to ensure no database/API identifier renames slipped in.
- [ ] Confirm Fishtail subset example is covered and Idaho Falls remains excluded.
- [ ] Run/inspect available CI; report infrastructure failures separately from code failures.
- [ ] Open a draft PR with root cause, behavior, terminology model, and verification status.