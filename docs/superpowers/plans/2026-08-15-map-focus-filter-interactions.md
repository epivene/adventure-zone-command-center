# Map Focus and Filter Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Routes map automatically focus on the active planning scope, make filters visibly meaningful, preserve dimmed nearby-leg context, and support deliberate event/trip focus.

**Architecture:** Keep the existing canonical `EventMap` event/filter pipeline, but split viewport derivation from rendered-context GeoJSON. Primary events drive the camera; dimmed contextual events remain rendered without widening fit bounds. Add small pure helpers for scope summary and viewport targeting so filter, leg, mode, event, and trip behavior can be regression-tested independently of MapLibre.

**Tech Stack:** React, TypeScript, Wouter, MapLibre GL JS, Vitest, Testing Library.

## Global Constraints

- Focused leg remains primary while other in-scope legs stay dimmed and visible.
- Full / Confirmed / Potential / History refit the camera to the emphasized primary set.
- State/date filters use existing interval-overlap semantics and immediately recompute/refit.
- One mapped primary event centers at useful city/event zoom.
- Multiple mapped primary events fit bounds with padding and max zoom.
- Event focus overrides generic scope without mutating filters or booking data.
- Trip focus overrides generic scope until cleared.
- Zero matching events show `No matching route events` instead of a misleading continent view.
- Do not change booking status, leg assignment, route optimization, handoff approval logic, or receipt workflow.

---

### Task 1: Extract primary planning scope and viewport target helpers

**Files:**
- Create: `artifacts/adventure-zone/src/features/routes/map-focus.ts`
- Test: `artifacts/adventure-zone/src/features/routes/map-focus.test.ts`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`

**Interfaces:**
- Produces `primaryViewportEvents(events, mode, focusedLegId)` returning mapped primary events only.
- Produces `viewportTarget({ primaryEvents, explicitEventId, tripCoordinates })` returning `none | center | bounds`.
- Produces `routeScopeSummary({ mode, seasonYear, focusedLegName, region, dateFrom, dateTo })`.

- [ ] **Step 1: Write failing tests for primary-vs-context behavior**

Cover:
- Kristy selected -> Kristy events are primary; Hulk remains contextual/dimmed.
- Confirmed mode -> confirmed primary events drive viewport, potential context does not widen bounds.
- Potential and History modes choose the correct primary set.
- One Miles City primary event returns `{ kind: "center", center: [-105.8406, 46.4083], zoom: 10 }`.
- Multiple primary events return bounds.
- Zero primary mapped events returns `none`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/features/routes/map-focus.test.ts`
Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure focus helpers**

Use existing `classifyRouteBucket`, `routeEmphasis`, and valid mapped coordinates. Do not duplicate booking-status classification logic.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: derive primary route map focus`

---

### Task 2: Make filters and view-mode changes refit the map

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/map-filters.tsx`
- Test: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- Consumes Task 1 viewport helpers.
- Produces a single `refitToCurrentScope()` path used after source updates and scope changes.

- [ ] **Step 1: Add failing component tests**

Add tests proving:
- selecting state `MT` reduces the displayed primary result count when non-MT events exist;
- changing `Confirmed` / `Potential` changes the primary viewport event IDs;
- date filters preserve existing overlap semantics for multi-day bookings;
- reset restores the broader result set;
- dimmed other-leg events remain rendered but are excluded from fit coordinates.

- [ ] **Step 2: Run the EventMap test and verify failures**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx`

- [ ] **Step 3: Refactor EventMap state flow**

Inside `EventMap`:
1. apply state/date filters;
2. apply season + route mode;
3. compute each event's emphasis;
4. build rendered GeoJSON from primary + dimmed context;
5. derive camera coordinates from primary mapped events only.

Update `MapCanvas` so a `viewportTarget` prop is reapplied whenever mode, focused leg, state/date filters, event focus, or trip focus changes. Do not wait for another basemap/style event once sources exist.

- [ ] **Step 4: Make active filters visibly explicit**

Render a scope line above the map such as `Showing Kristy · Confirmed · 2026 · MT`. Only include active dimensions. Add a single reset action that restores mode `full`, all legs, current season, and clears extra filters/event/trip focus.

- [ ] **Step 5: Run tests and commit**

Expected: EventMap tests PASS.
Commit message: `feat: refit map when route filters change`

---

### Task 3: Add event-card focus-on-map behavior

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Test: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- Produces `focusedEventId: string | null` state.
- MapCanvas receives the explicit event viewport target at highest priority.

- [ ] **Step 1: Write failing test**

Render two mapped events and assert a dedicated `Focus on map` button exists on each mapped event card. Clicking Miles City's focus button must make the explicit viewport target Miles City's coordinates without changing state/date/mode/leg filters.

- [ ] **Step 2: Verify failure**

Run the EventMap test.

- [ ] **Step 3: Implement minimal event focus UI**

Keep booking title as the booking-detail link. Add a separate small button/action labeled `Focus on map`. When focused, show a clear `Clear focus` affordance.

- [ ] **Step 4: Verify pass and commit**

Commit message: `feat: focus route map from event cards`

---

### Task 4: Add trip focus wiring without changing trip creation

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/trips-section.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Test: `artifacts/adventure-zone/src/components/routes/trips-section.test.tsx`
- Test: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- `TripsSection` adds optional `onFocusTrip?: (tripId: string) => void`.
- `EventMap` adds optional `focusedTripCoordinates?: [number, number][] | null` and `onClearTripFocus?: () => void`.
- `RoutesPage` owns selected trip focus state.

- [ ] **Step 1: Write failing trip-focus tests**

Test that trip cards expose `Focus route` separately from the trip-detail link and call `onFocusTrip(trip.id)`.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/trips-section.test.tsx`

- [ ] **Step 3: Wire trip detail coordinates**

When `onFocusTrip` fires, `RoutesPage` fetches the existing trip detail endpoint and derives ordered mapped coordinates from trip start/stops/end. Pass those coordinates to `EventMap`. Do not create synthetic trips or mutate route data.

- [ ] **Step 4: Apply viewport priority**

In viewport derivation enforce:
1. explicit event focus;
2. explicit trip focus;
3. focused leg + current filtered primary set;
4. all-legs current filtered primary set.

- [ ] **Step 5: Verify tests and commit**

Commit message: `feat: focus map on selected trips`

---

### Task 5: Add explicit zero-result and mapping-state feedback

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Test: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- Distinguishes `zero matching events` from `matching events need mapping`.

- [ ] **Step 1: Write failing tests**

Cover:
- filters yield no matching events -> render `No matching route events`;
- matching events exist but all are unmapped -> preserve `Location needs mapping` and do not claim no events;
- zero-result state does not request a continent-level viewport reset.

- [ ] **Step 2: Verify failure**

Run EventMap tests.

- [ ] **Step 3: Implement explicit empty-state copy and camera behavior**

Leave the last meaningful user-controlled camera position in place or show the map empty state overlay; do not forcibly return to the North America default when a filter yields zero.

- [ ] **Step 4: Verify pass and commit**

Commit message: `feat: clarify empty route map results`

---

### Task 6: Regression verification and delivery

**Files:**
- Modify if needed: `.github/workflows/calendar-route-handoff-ci.yml`

- [ ] **Step 1: Run focused frontend tests**

Run:
`pnpm --filter @workspace/adventure-zone exec vitest run src/features/routes/map-focus.test.ts src/components/routes/event-map.test.tsx src/components/routes/trips-section.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run existing route overlap tests**

Run the existing map-data/calendar overlap tests to confirm multi-day interval filtering remains unchanged.

- [ ] **Step 3: Build frontend and API**

Run:
`pnpm --filter @workspace/adventure-zone run build`
`pnpm --filter @workspace/api-server run build`

Expected: PASS.

- [ ] **Step 4: Review branch diff against current main**

Confirm no booking, handoff approval, manager finance, receipt, or unrelated API behavior changed.

- [ ] **Step 5: Commit any CI-only adjustment and open PR**

PR summary must call out live verification targets:
- one Miles City event opens at local zoom;
- selecting Kristy fits Kristy's route/event scope while nearby legs stay dimmed;
- Confirmed/Potential/History and state/date filters visibly change scope/refit;
- event and trip focus override generic scope;
- zero-result filters show explicit feedback.
