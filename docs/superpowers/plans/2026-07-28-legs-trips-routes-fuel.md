# Legs, Trips, Routes, and Fuel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed four-leg model with nine initial but unlimited configurable legs, build dated round trips with ordered stops, calculate real-road distance/time through a cached provider, and show per-segment and whole-trip fuel estimates.

**Architecture:** Travel-leg and trip services own configuration and snapshots. A provider-neutral routing service caches road estimates and calls a server-only Google Routes adapter only after an explicit user request; route ordering remains a local deterministic recommendation. Fuel calculations are pure and use the trip's saved MPG/fuel-price snapshots.

**Tech Stack:** Next.js 16 App Router and server actions, React 19, TypeScript 6, Drizzle ORM/PostgreSQL, Clerk owner authorization, Zod 4, MapLibre, Google Routes API v2 server adapter, Vitest/Testing Library, Playwright.

## Global Constraints

- Start with nine active legs named Leg 1 through Leg 9.
- Leg count is not capped; normal removal archives instead of deleting.
- Existing four leg IDs and booking references survive migration.
- Archived legs remain on history and are excluded from new assignment choices by default.
- Trips normally start/end at the leg base and snapshot vehicle, MPG, and fuel price.
- The user can change MPG and fuel price per trip without rewriting defaults/history.
- Real-road estimates are requested manually, cached, and labeled live/cached/manual.
- Straight-line distance is never presented as a road estimate.
- Suggested order never changes a confirmed route.
- Manual stop order and segment overrides persist and require reasons where specified.
- Fuel formula is `miles ÷ MPG × fuel price`.
- Google route calls use basic traffic-unaware fields, no automatic background refresh, and server-only credentials.
- Every mutation requires `requireOwner()` and an audit entry.
- This plan runs after CRM migration `0006` and package/resource migration `0007`; it owns migration `0008`.

---

## File Structure

- `features/routes/travel-leg-*` — configurable leg validation, persistence, and mutations.
- `features/trips/trip-types.ts` — trip, stop, segment, and snapshot models.
- `features/trips/trip-input.ts` — trip/stop/override validation.
- `features/trips/trip-repository.ts` — trip and ordered-stop persistence.
- `features/trips/trip-service.ts` — trip creation, suggestion, reorder, confirmation, and override rules.
- `features/routing/routing-types.ts` — provider/cache result contracts.
- `features/routing/routing-provider.ts` — provider interface.
- `features/routing/google-routes-provider.ts` — server-only Google adapter.
- `features/routing/route-cache-repository.ts` — cached road results.
- `features/routing/routing-service.ts` — live/cache/manual result policy.
- `features/routing/stop-order.ts` — deterministic suggestion heuristic.
- `features/fuel/fuel-estimate.ts` — pure segment/round-trip calculations.
- `components/routes/trip-planner.tsx` — trip editor and ordered stops.
- `components/routes/route-estimate-summary.tsx` — distance/time/fuel breakdown.

### Task 1: Migrate from four fixed legs to nine initial unlimited legs

**Files:**

- Modify: `db/schema.ts`
- Modify: `db/seed.ts`
- Create: `db/migrations/0008_legs_trips_routes.sql`
- Create: `db/migrations/meta/0008_snapshot.json`
- Modify: `db/migrations/meta/_journal.json`
- Modify: `tests/unit/schema-contract.test.ts`
- Modify: `tests/unit/seed-runner-contract.test.ts`
- Create: `tests/integration/routes-migration.test.ts`
- Create: `scripts/preflight-routes-migration.sh`
- Create: `docs/operations/routes-migration.md`

**Interfaces:**

- Produces:

```ts
export type TravelLeg = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: Date | null;
  archivedReason: string | null;
  baseAddress: PostalAddress | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  defaultVehicleId: string | null;
  defaultMpg: number | null;
};
```

- [ ] **Step 1: Write failing migration and seed tests**

Assert the current four leg IDs/bookings survive, positions 5–9 are inserted
only when absent, renamed/recolored existing legs are unchanged, active sort
orders are contiguous/unique, archived rows may retain historical values, and
invalid MPG/coordinate pairs are rejected.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts tests/unit/seed-runner-contract.test.ts tests/integration/routes-migration.test.ts
```

Expected: FAIL because the fixed-four constraint still exists.

- [ ] **Step 3: Implement migration and idempotent seed**

Drop `travel_legs_sort_order_between_1_and_4` and the global sort-order unique
constraint. Add archive/base/default vehicle/default MPG fields, positive MPG
and coordinate checks, and a partial unique index on active sort order.

Insert Legs 5–9 without overwriting existing Legs 1–4. Add trip, stop, segment,
cache, travel-settings, and `trip_resource_assignments` tables described in
Task 4 so migration `0008` owns all route schema once. The assignment table
references the existing `resources` table and uses a unique `(trip_id,
resource_id)` key.

- [ ] **Step 4: Add preflight and recovery documentation**

Preflight verifies current leg identities, booking references, resource vehicle
references, coordinate validity, and absence of conflicting active sort orders.
Document backup, disposable restore rehearsal, migration/seed, row-count
verification, and database restore recovery.

- [ ] **Step 5: Run migration, preflight, and type checks**

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts tests/unit/seed-runner-contract.test.ts tests/integration/routes-migration.test.ts
bash scripts/preflight-routes-migration.sh
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db scripts/preflight-routes-migration.sh docs/operations/routes-migration.md tests
git commit -m "feat: migrate to configurable travel legs"
```

### Task 2: Implement add, edit, reorder, archive, and restore leg services

**Files:**

- Modify: `features/routes/travel-leg-input.ts`
- Modify: `features/routes/travel-leg-repository.ts`
- Modify: `features/routes/travel-leg-editor.ts`
- Create: `tests/integration/travel-leg-repository.test.ts`
- Modify: `tests/unit/travel-leg-editor.test.tsx`

**Interfaces:**

- Produces:

```ts
export interface TravelLegRepository {
  listActiveTravelLegs(): Promise<TravelLeg[]>;
  listAllTravelLegs(): Promise<TravelLeg[]>;
  create(input: CreateTravelLegInput): Promise<TravelLeg>;
  update(input: UpdateTravelLegInput): Promise<TravelLeg | null>;
  reorder(orderedActiveIds: string[]): Promise<TravelLeg[]>;
  archive(input: { legId: string; reason: string }): Promise<TravelLeg | null>;
  restore(legId: string): Promise<TravelLeg | null>;
}

export class TravelLegService {
  create(input: CreateTravelLegInput): Promise<Result<TravelLeg, TravelLegError>>;
  update(input: UpdateTravelLegInput): Promise<Result<TravelLeg, TravelLegError>>;
  reorder(input: { orderedActiveIds: string[] }): Promise<Result<TravelLeg[], TravelLegError>>;
  archive(input: { legId: string; reason: string }): Promise<Result<TravelLeg, TravelLegError>>;
  restore(input: { legId: string }): Promise<Result<TravelLeg, TravelLegError>>;
}
```

- [ ] **Step 1: Replace fixed-four tests with failing configurable-leg tests**

Cover arbitrary active count, append, rename/recolor/base/vehicle/MPG update,
concurrent reorder rejection, archive reason, compacted order, restored row
appended, archived history retained, and audit writes.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/travel-leg-editor.test.tsx tests/integration/travel-leg-repository.test.ts
```

Expected: FAIL because the service enforces exactly four.

- [ ] **Step 3: Implement transactional leg operations**

Reorder under row locks using temporary positive positions before writing
contiguous `1..N`. Archive compacts active positions; restore appends at
`max(active sortOrder)+1`. Validate a default vehicle belongs to the resource
category `vehicle`. Audit locked before/after snapshots.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run tests/unit/travel-leg-editor.test.tsx tests/integration/travel-leg-repository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/routes tests/unit/travel-leg-editor.test.tsx tests/integration/travel-leg-repository.test.ts
git commit -m "feat: add configurable travel leg service"
```

### Task 3: Replace the fixed editor with configurable leg management

**Files:**

- Modify: `app/(private)/routes/actions.ts`
- Modify: `app/(private)/routes/page.tsx`
- Modify: `components/routes/travel-leg-editor.tsx`
- Modify: `components/routes/map-filters.tsx`
- Modify: `components/bookings/booking-form.tsx`
- Modify: `app/(private)/bookings/[bookingId]/edit/page.tsx`
- Modify: `tests/unit/calendar-routes-components.test.tsx`
- Create: `tests/unit/routes-actions.test.ts`
- Modify: `tests/e2e/routes-map.spec.ts`

**Interfaces:**

- Produces owner-protected actions:

```ts
createTravelLegAction(input: CreateTravelLegInput): Promise<ActionResult>
updateTravelLegAction(input: UpdateTravelLegInput): Promise<ActionResult>
reorderTravelLegsAction(input: { orderedActiveIds: string[] }): Promise<ActionResult>
archiveTravelLegAction(input: { legId: string; reason: string }): Promise<ActionResult>
restoreTravelLegAction(input: { legId: string }): Promise<ActionResult>
```

- [ ] **Step 1: Write failing component, action, and end-to-end tests**

Assert nine initial rows, add, rename, recolor, keyboard-accessible up/down
reorder controls, archive confirmation/reason, restore, active-only booking
choices, and archived historical labels.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/calendar-routes-components.test.tsx tests/unit/routes-actions.test.ts
```

Expected: FAIL because the UI still says fixed four.

- [ ] **Step 3: Implement the configurable editor**

Use explicit Move up/Move down controls in addition to drag behavior so
keyboard users can reorder. Keep archived legs in a collapsed section and
revalidate routes, bookings, calendar, Today, and package/resource settings.

- [ ] **Step 4: Run focused checks**

Run:

```bash
npx vitest run tests/unit/calendar-routes-components.test.tsx tests/unit/routes-actions.test.ts
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/'(private)'/routes components/routes components/bookings app/'(private)'/bookings tests
git commit -m "feat: add configurable travel leg UI"
```

### Task 4: Add trip, ordered-stop, segment, and snapshot services

**Files:**

- Create: `features/trips/trip-types.ts`
- Create: `features/trips/trip-input.ts`
- Create: `features/trips/trip-repository.ts`
- Create: `features/trips/trip-service.ts`
- Create: `tests/unit/trip-input.test.ts`
- Create: `tests/integration/trip-repository.test.ts`
- Create: `tests/integration/trip-service.test.ts`

**Interfaces:**

- Produces:

```ts
export type CreateTripInput = {
  travelLegId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  bookingIds: string[];
  startAddressOverride: PostalAddress | null;
  endAddressOverride: PostalAddress | null;
  vehicleId: string | null;
  vehicleName: string | null;
  mpg: number;
  fuelPricePerGallon: number;
  notes: string | null;
};

export class TripService {
  create(input: CreateTripInput): Promise<Result<TripDetail, TripError>>;
  suggestRoute(input: { tripId: string; refresh: boolean }): Promise<Result<TripDetail, TripError>>;
  reorderStops(input: { tripId: string; orderedStopIds: string[] }): Promise<Result<TripDetail, TripError>>;
  confirmRoute(input: { tripId: string }): Promise<Result<TripDetail, TripError>>;
  overrideSegment(input: SegmentOverrideInput): Promise<Result<TripDetail, TripError>>;
}
```

- [ ] **Step 1: Write failing trip validation and transaction tests**

Cover active-leg requirement, dated range, nonempty stop IDs, base snapshot,
vehicle/MPG/fuel snapshot, duplicate/foreign booking rejection, base→stops→base
segment order, reorder, confirmation, manual override reason, and confirmed
route immutability.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/trip-input.test.ts tests/integration/trip-repository.test.ts tests/integration/trip-service.test.ts
```

Expected: FAIL because trip files do not exist.

- [ ] **Step 3: Implement trip transactions**

Create trips with start/end base snapshots unless overridden. Store stop
address/operating/setup/teardown snapshots. Reorder with contiguous positions.
Refreshing estimates may replace segment estimates but may not reorder a
confirmed route.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run tests/unit/trip-input.test.ts tests/integration/trip-repository.test.ts tests/integration/trip-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/trips tests/unit/trip-input.test.ts tests/integration/trip-repository.test.ts tests/integration/trip-service.test.ts
git commit -m "feat: add trip and ordered stop services"
```

### Task 5: Add cached real-road routing and Google provider adapter

**Files:**

- Create: `features/routing/routing-types.ts`
- Create: `features/routing/routing-provider.ts`
- Create: `features/routing/google-routes-provider.ts`
- Create: `features/routing/route-cache-repository.ts`
- Create: `features/routing/routing-service.ts`
- Create: `features/routing/provider-factory.ts`
- Create: `features/routing/stop-order.ts`
- Modify: `lib/env.ts`
- Create: `tests/unit/google-routes-provider.test.ts`
- Create: `tests/unit/routing-service.test.ts`
- Create: `tests/unit/stop-order.test.ts`
- Create: `tests/integration/route-cache.test.ts`

**Interfaces:**

- Produces:

```ts
export interface RoutingProvider {
  readonly key: string;
  readonly version: string;
  estimateSegment(input: {
    origin: RouteLocation;
    destination: RouteLocation;
    assumptions: RoutingAssumptions;
  }): Promise<{ miles: number; driveSeconds: number }>;
}

export class RoutingService {
  estimateSegment(input: SegmentEstimateInput):
    Promise<Result<RouteEstimate, RoutingError>>;
  estimateRoundTrip(input: RoundTripEstimateInput):
    Promise<Result<RouteEstimate[], RoutingError>>;
}
```

- [ ] **Step 1: Write failing provider, cache, and ordering tests**

Cover field mask/headers/body, meters-to-miles, duration parsing, sanitized
401/429/5xx errors, cache miss/hit, explicit refresh, provider unavailable,
manual fallback, no straight-line fallback, and deterministic stop order with
original-order tie-breaking.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/google-routes-provider.test.ts tests/unit/routing-service.test.ts tests/unit/stop-order.test.ts tests/integration/route-cache.test.ts
```

Expected: FAIL because routing files do not exist.

- [ ] **Step 3: Implement provider-neutral cache/service**

Cache keys hash provider key/version, normalized origin/destination, and
assumptions. `refresh: true` bypasses reads but replaces a cache entry only
after a valid response. Provider failure returns a labeled unexpired cached
result when available; otherwise return `ROUTING_UNAVAILABLE`.

- [ ] **Step 4: Implement the server-only Google Routes adapter**

POST `https://routes.googleapis.com/directions/v2:computeRoutes` with:

```ts
{
  travelMode: "DRIVE",
  routingPreference: "TRAFFIC_UNAWARE",
  origin: googleWaypoint(origin),
  destination: googleWaypoint(destination),
}
```

Headers include `X-Goog-Api-Key` and
`X-Goog-FieldMask: routes.distanceMeters,routes.duration`. Never log the key or
full response. The adapter is selected only when `GOOGLE_ROUTES_API_KEY` is
configured; otherwise use an unavailable provider and expose manual miles/time.

Official references:

- <https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes>
- <https://developers.google.com/maps/documentation/routes/usage-and-billing>
- <https://developers.google.com/maps/billing-and-pricing/manage-costs>

- [ ] **Step 5: Run routing tests and typecheck**

Run:

```bash
npx vitest run tests/unit/google-routes-provider.test.ts tests/unit/routing-service.test.ts tests/unit/stop-order.test.ts tests/integration/route-cache.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/routing lib/env.ts tests/unit/google-routes-provider.test.ts tests/unit/routing-service.test.ts tests/unit/stop-order.test.ts tests/integration/route-cache.test.ts
git commit -m "feat: add cached road route estimates"
```

### Task 6: Implement deterministic fuel calculations

**Files:**

- Create: `features/fuel/fuel-estimate.ts`
- Create: `tests/unit/fuel-estimate.test.ts`

**Interfaces:**

- Produces:

```ts
export type FuelEstimate = {
  miles: number;
  gallons: number;
  cost: number;
};

export function calculateFuelEstimate(input: {
  miles: number;
  mpg: number;
  fuelPricePerGallon: number;
}): FuelEstimate;

export function calculateTripFuelBreakdown(input: {
  segments: Array<{ id: string; effectiveMiles: number }>;
  mpg: number;
  fuelPricePerGallon: number;
}): {
  segments: Array<{ segmentId: string; estimate: FuelEstimate }>;
  total: FuelEstimate;
};
```

- [ ] **Step 1: Write failing calculation and rounding tests**

Cover invalid/negative miles or price, MPG at/below zero, provider/manual
effective miles, one-decimal display miles, two-decimal gallons, cents, and
whole-trip calculation from unrounded summed miles rather than rounded segment
costs.

- [ ] **Step 2: Run the focused test**

Run:

```bash
npx vitest run tests/unit/fuel-estimate.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement pure calculations**

Keep exact internal values and round only returned display values. Manual miles
take precedence before calling these functions.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run tests/unit/fuel-estimate.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/fuel tests/unit/fuel-estimate.test.ts
git commit -m "feat: add trip fuel estimates"
```

### Task 7: Build the trip planner, route summary, and operational warnings

**Files:**

- Create: `app/(private)/routes/trips/actions.ts`
- Create: `app/(private)/routes/trips/new/page.tsx`
- Create: `app/(private)/routes/trips/[tripId]/page.tsx`
- Create: `components/routes/trip-planner.tsx`
- Create: `components/routes/route-estimate-summary.tsx`
- Modify: `app/(private)/routes/page.tsx`
- Modify: `features/resources/resource-conflicts.ts`
- Modify: `features/bookings/booking-operations-summary.ts`
- Modify: `features/calls/call-workspace-query.ts`
- Modify: `features/follow-ups/today-query.ts`
- Create: `tests/unit/trip-planner.test.tsx`
- Create: `tests/e2e/trip-route-planner.spec.ts`
- Create: `tests/e2e/fixtures/trip-route.ts`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/backup-and-restore.md`

**Interfaces:**

- Consumes: `TripService`, `RoutingService`, fuel functions, and
  `TransferTimeLookup`
- Produces explicit actions for create/suggest/reorder/confirm/refresh/override

- [ ] **Step 1: Write failing UI and end-to-end tests**

Cover trip creation, base→stops→base display, manual **Estimate route**, source
labels, suggested order, manual reorder, confirmation, refresh without confirmed
reorder, segment override, trip fuel/MPG/price edits, total breakdown,
paintball/resource warnings, reasoned override, responsive layout, and keyboard
reorder.

- [ ] **Step 2: Run focused component tests**

Run:

```bash
npx vitest run tests/unit/trip-planner.test.tsx
```

Expected: FAIL because the planner is missing.

- [ ] **Step 3: Implement owner-protected planner pages and actions**

Do not call Google when merely opening/editing a trip. **Estimate route** and
**Refresh estimates** are explicit billable actions. Show stale/cached/manual
labels and keep warnings visible after a reasoned override. Implement the
resource module's `TransferTimeLookup` with the routing cache/service, persist
trip resource assignments, and add route/fuel warnings to the existing booking
operations summary consumed by the Call Workspace and Today.

- [ ] **Step 4: Add cost-control operations guidance**

Document enabling Routes API, configuring `GOOGLE_ROUTES_API_KEY`, setting a
small daily Google Cloud quota, monitoring usage, and leaving the key unset to
use manual mileage. Document new table backup counts and replace fixed-four
language.

- [ ] **Step 5: Run complete route/fuel verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/routes-map.spec.ts tests/e2e/trip-route-planner.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/'(private)'/routes components/routes features/resources features/bookings/booking-operations-summary.ts features/calls/call-workspace-query.ts features/follow-ups/today-query.ts docs/operations tests
git commit -m "feat: add trip route and fuel planner"
```
