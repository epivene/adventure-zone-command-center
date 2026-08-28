# Booking Duplicate Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely retire exact duplicate booking records into one canonical event record while preserving all history and enforcing one active follow-up per event.

**Architecture:** Add non-destructive consolidation metadata to bookings, centralize exact-event identity/canonical selection in a booking-consolidation module, and make active lists ignore retired bookings. Canonical booking detail aggregates follow-ups/timeline history from retired sibling records. A transactional consolidation routine retires duplicates and normalizes active follow-ups without rewriting every historical foreign key.

**Tech Stack:** TypeScript, Express, Drizzle ORM, PostgreSQL/PGlite, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-booking-duplicate-consolidation-design.md`

## Global Constraints

- Event identity is normalized name + city + region + start business-date + end business-date.
- Travel leg and booking status do not define event identity.
- Duplicate rows are retired, not deleted.
- Preserve historical foreign-key relationships and ACT/import provenance.
- Exactly one active follow-up per consolidation group.
- Active booking/calendar/Today reads exclude retired bookings.
- Canonical profile/detail includes retired siblings' follow-up and timeline history.
- Per-group consolidation is transactional and idempotent.

---

### Task 1: Booking consolidation metadata and identity helpers

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/src/features/bookings/booking-consolidation.ts`
- Create: `artifacts/api-server/src/features/bookings/booking-consolidation.test.ts`

**Interfaces:**
- Produces `bookingEventIdentity(record)`, `chooseCanonicalBooking(records)`, and booking fields `consolidatedIntoId`, `consolidatedAt`.

- [ ] Write tests showing different travel legs/statuses still share identity and different dates do not.
- [ ] Verify tests fail because helper is missing.
- [ ] Implement identity normalization and deterministic canonical priority.
- [ ] Add self-referencing booking consolidation fields and index.
- [ ] Run focused tests and verify green.

### Task 2: Transactional exact-duplicate consolidation

**Files:**
- Modify: `artifacts/api-server/src/features/bookings/booking-repository.ts`
- Create: `artifacts/api-server/src/features/bookings/booking-consolidation.pglite.test.ts`

**Interfaces:**
- Produces `consolidateExactDuplicateBookings(now): Promise<{groups:number; retired:number}>` on `DrizzleBookingRepository`.

- [ ] Write PGlite test with two same-event bookings, multiple open follow-ups, and historical completed rows.
- [ ] Verify red: duplicate remains active and both follow-ups remain open.
- [ ] Implement per-group transaction: lock candidate rows, select canonical, move best active follow-up to canonical if needed, complete extra open follow-ups with `Merged into canonical booking`, set duplicate `consolidatedIntoId/consolidatedAt`, and write audit entry.
- [ ] Add idempotence test and rollback-on-failure test.
- [ ] Run focused tests and verify green.

### Task 3: Exclude retired bookings from active lists and calendar/map

**Files:**
- Modify: `artifacts/api-server/src/features/bookings/booking-repository.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Modify: `artifacts/api-server/src/features/routes/map-query.ts`
- Test: existing booking/today/map tests plus focused consolidation tests.

**Interfaces:**
- Active reads add `isNull(bookings.consolidatedIntoId)`.

- [ ] Write failing tests proving retired bookings disappear from Bookings, Today and calendar/map sources.
- [ ] Implement the active-booking predicate consistently.
- [ ] Run focused tests and verify green.

### Task 4: Aggregate retired sibling history into canonical detail

**Files:**
- Modify: `artifacts/api-server/src/features/bookings/booking-repository.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-service.ts`
- Modify: `artifacts/api-server/src/routes/bookings.ts`
- Tests: booking detail and activity repository/service tests.

**Interfaces:**
- Booking detail exposes `consolidatedBookingIds: string[]`.
- Timeline query accepts multiple booking ids for canonical detail only.

- [ ] Write failing test showing canonical detail lacks retired sibling follow-up/activity history.
- [ ] Load direct retired siblings where `consolidatedIntoId = canonicalId`; aggregate follow-ups/audits across `[canonicalId,...retiredIds]`.
- [ ] Extend timeline query with `bookingIds?: string[]` while preserving existing single-booking behavior.
- [ ] Use the combined ids in the booking detail route.
- [ ] Run focused tests and verify green.

### Task 5: Safe maintenance endpoint and deploy-time/manual execution path

**Files:**
- Modify: `artifacts/api-server/src/routes/bookings.ts`
- Create/modify route tests.

**Interfaces:**
- Owner-authenticated `POST /api/bookings/consolidate-exact-duplicates` returns `{ok:true, groups, retired}`.

- [ ] Write failing route test for consolidation endpoint.
- [ ] Add strict empty-body endpoint calling repository consolidation routine.
- [ ] Verify endpoint is not exposed without normal owner auth middleware.
- [ ] Run route tests and verify green.

### Task 6: Regression verification

**Files:** none expected.

- [ ] Run booking consolidation tests.
- [ ] Run follow-up/Today tests.
- [ ] Run calendar/map tests.
- [ ] Run booking detail/activity tests.
- [ ] Run TypeScript/build verification.
- [ ] Report exact failures if CI/runtime execution is unavailable rather than claiming success.
