# Per-Leg Travel Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each travel leg save its own details independently while keeping drag reordering as a separate save action.

**Architecture:** Add focused schemas and service methods for one-leg detail updates and active-leg reorder updates. Expose two API routes, wire matching frontend actions, and update the editor to track per-leg saved baselines separately from the saved order baseline.

**Tech Stack:** React, TypeScript, Express, Zod, Drizzle ORM, Vitest.

## Global Constraints

- Saving one leg must not submit or overwrite another leg's detail edits.
- Reordering must not persist unsaved detail edits.
- Archived legs remain non-editable and remain after active legs.
- Existing add/archive/restore/delete behavior stays unchanged.

---

### Task 1: Define focused travel-leg inputs

**Files:**
- Modify: `artifacts/adventure-zone/src/features/routes/travel-leg-input.ts`
- Modify: `artifacts/api-server/src/features/routes/travel-leg-input.ts`

**Interfaces:**
- Produces: `travelLegDetailsSchema`, `TravelLegDetails`, `travelLegOrderSchema`, `TravelLegOrder`.

- [ ] Add a details schema for `name`, `color`, `baseAddress`, `defaultVehicleName`, and `defaultMpg`, preserving blank-to-null behavior.
- [ ] Add an order schema containing `legs: { id, sortOrder }[]` with contiguous 1..N validation.
- [ ] Keep the existing bulk configuration schema for compatibility.

### Task 2: Add service behavior with regression tests

**Files:**
- Modify: `artifacts/api-server/src/features/routes/travel-leg-editor.test.ts`
- Modify: `artifacts/api-server/src/features/routes/travel-leg-editor.ts`

**Interfaces:**
- Produces: `updateLegDetails(id, input)` and `reorderActiveLegs(input)`.

- [ ] Add failing tests proving a detail update touches only the target active leg and leaves sort orders unchanged.
- [ ] Add a failing test proving an archived leg cannot be detail-edited.
- [ ] Add a failing test proving reorder changes only active sort order and preserves details.
- [ ] Implement the two service methods using the existing transaction/audit/reorder primitives.

### Task 3: Expose focused API routes and frontend actions

**Files:**
- Modify: `artifacts/api-server/src/routes/routes-map.ts`
- Modify: `artifacts/adventure-zone/src/actions/routes.ts`

**Interfaces:**
- Produces: `POST /routes/travel-legs/:id/configure` returning the saved leg.
- Produces: `POST /routes/travel-legs/reorder` returning the normalized leg list.
- Produces: `updateTravelLegAction(id, input)` and `reorderTravelLegsAction(input)`.

- [ ] Validate request bodies with the focused schemas.
- [ ] Return 404/409 style errors for missing/archived/conflicting legs.
- [ ] Keep the old bulk configure route intact.

### Task 4: Make the editor save each leg independently

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`

**Interfaces:**
- TravelLegEditor consumes `onSaveLeg(id, details)` and `onSaveOrder(order)`.

- [ ] Track an original saved detail snapshot for each active leg.
- [ ] Compute dirty state per leg without considering sort order.
- [ ] Add a per-card Save button that is disabled until that card changes.
- [ ] On success, update only that card's saved baseline and show `Saved`.
- [ ] Track original active id order separately and enable `Save order` only after drag changes it.
- [ ] Saving order updates only the order baseline.
- [ ] Update RoutesPage data in place after a save so maps/lists get fresh names/colors without remounting the editor or discarding other unsaved edits.

### Task 5: Verify

- [ ] Review the branch diff to confirm detail saves and order saves are isolated.
- [ ] Run available CI/tests if GitHub Actions are configured.
- [ ] Merge only after the PR is mergeable and the diff contains no unrelated changes.
