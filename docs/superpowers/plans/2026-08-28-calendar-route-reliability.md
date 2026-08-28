# Calendar and Route Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the main schedule focused on real operating commitments, prevent duplicate-looking lead records from cluttering the calendar, and ensure every active travel leg such as Kristy and Hulk remains selectable and visible on Routes even when it has no mapped event pins.

**Architecture:** Separate operational schedule visibility from CRM opportunity visibility. The schedule defaults to confirmed bookings plus explicit route/calendar placeholders, while other opportunities remain opt-in. Route leg selectors come from canonical active travel-leg data rather than inferred map-event presence, and unresolved leg-assigned events remain visible as mapping issues rather than disappearing.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, Express, Drizzle ORM/PostgreSQL, existing Adventure Zone route/calendar APIs.

**Spec:** User-reported production behavior on 2026-08-28 plus `docs/superpowers/plans/2026-08-15-manager-leg-map-reliability.md`.

## Global Constraints

- Confirmed bookings and intentional placeholders are the default operating schedule.
- New leads, contacted opportunities, pending opportunities, and declined opportunities do not clutter the default schedule.
- Potential opportunities remain available through an explicit opt-in control.
- A real event must not render multiple times merely because duplicate opportunity records exist.
- Every active travel leg is shown in route controls even when it currently has zero mapped events.
- A leg-assigned booking with a mapping failure remains visible as needing mapping instead of silently disappearing.
- Existing travel-leg IDs and manager/leg identity behavior remain unchanged.

---

### Task 1: Lock down default schedule visibility

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/CalendarPage.tsx`
- Modify/Create test: `artifacts/adventure-zone/src/pages/CalendarPage.test.tsx` or the nearest existing calendar-content test

**Interfaces:**
- Consumes booking `status` and any existing explicit placeholder marker/status supported by the API.
- Produces `filteredEvents` for `EventCalendar`.

- [ ] Write a failing test proving non-confirmed CRM opportunities are hidden by default while confirmed bookings remain visible.
- [ ] Add coverage proving the explicit “Show potential” control reveals those opportunities without changing the default.
- [ ] Implement the smallest visibility predicate that makes those tests pass.
- [ ] Run the focused calendar tests.

---

### Task 2: Prevent duplicate event cards in calendar planning mode

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/CalendarPage.tsx` or add a focused helper under `artifacts/adventure-zone/src/features/calendar/`
- Modify/Create focused unit test beside that helper/page

**Interfaces:**
- Consumes calendar booking records.
- Produces a stable set of display records where repeated records for the same real event/date do not create duplicate cards.

- [ ] Write a failing test with repeated same-event/date opportunity records.
- [ ] Define a conservative display identity using existing stable relationship fields where available; do not merge clearly distinct bookings.
- [ ] Implement deduplication only for display, leaving CRM records untouched.
- [ ] Run focused tests.

---

### Task 3: Keep all active legs visible in Routes

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: relevant route selector/component test

**Interfaces:**
- Consumes canonical active travel legs from `/routes` travel-leg data.
- Produces route selector options independent of the currently mapped event set.

- [ ] Write a failing test where Kristy has a mapped event and Hulk has none, and assert both legs appear.
- [ ] Implement selector population from active travel-leg records, not map-event-derived legs.
- [ ] Keep archived legs excluded by the existing archive rules.
- [ ] Run focused route-page/component tests.

---

### Task 4: Preserve unresolved leg-assigned events

**Files:**
- Verify/modify: `artifacts/api-server/src/features/routes/travel-leg-repository.ts`
- Verify/modify: `artifacts/api-server/src/routes/routes-map.ts`
- Verify/modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Tests: existing route-map/location resolver tests

**Interfaces:**
- Consumes `mappingState`, `travelLegId`, location fields.
- Produces mapped features plus unresolved-event UI for the selected leg.

- [ ] Add or confirm a failing regression test proving a leg-assigned booking with no coordinates is returned as an unresolved event for that leg.
- [ ] Make the smallest server/client correction needed if current behavior drops it.
- [ ] Run focused API and client route-map tests.

---

### Task 5: Verification

- [ ] Run calendar focused tests.
- [ ] Run route/map focused tests.
- [ ] Run relevant workspace typecheck/build checks available in the repository.
- [ ] Review the diff for accidental changes to CRM data semantics, archived legs, or manager access.
