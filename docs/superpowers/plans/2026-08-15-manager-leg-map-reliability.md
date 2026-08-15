# Unified Manager/Leg Setup and Route Map Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge travel-leg and manager-portal setup into one manager/leg card, and make leg-assigned bookings with city/state locations reliably visible on Routes even when geocoding fails.

**Architecture:** Keep `travel_legs.name` as the canonical manager/leg identity and keep manager password/session records as a separate security concern. Extend route-location resolution to return an explicit mapping state and retry behavior, then render unresolved bookings beside the map instead of silently omitting them.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, Express, Drizzle ORM/PostgreSQL, MapLibre GL, Nominatim geocoding, existing Adventure Zone API/auth helpers.

## Global Constraints

- A travel leg and its manager are the same operational unit; one canonical travel-leg name controls both identities.
- Do not introduce a second editable manager-name source of truth.
- Existing portal passwords and session-version security must remain intact.
- A leg rename must not require the user to re-enter or reset the portal password.
- Existing travel-leg IDs remain unchanged so bookings, trips, equipment, finance, receipts, and handoffs keep their links.
- Location priority remains: valid saved coordinates → full booking/venue address → city + state/region → city alone.
- `Miles City, MT` must be geocoded automatically when a leg-assigned booking lacks coordinates.
- A failed geocode must never silently remove a leg-assigned booking from the Routes experience.
- Geocoder provider outages must not be cached as permanent failures.
- Retry must bypass failed location-cache state.
- Do not remove or regress current Leg Manager finance/receipt/trip/handoff functionality.

---

## File Structure

**Manager/leg identity and UI**
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-admin.test.ts`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx`
- Delete: `artifacts/adventure-zone/src/components/routes/leg-manager-access.tsx`
- Delete: `artifacts/adventure-zone/src/components/routes/leg-manager-access.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`

**Route location reliability**
- Modify: `artifacts/api-server/src/features/routes/location-resolver.ts`
- Modify: `artifacts/api-server/src/features/routes/location-resolver.test.ts`
- Modify: `artifacts/api-server/src/features/routes/map-data.ts`
- Modify: `artifacts/api-server/src/features/routes/travel-leg-repository.ts`
- Modify: `artifacts/api-server/src/routes/routes-map.ts`
- Create: `artifacts/api-server/src/routes/routes-map.test.ts`
- Modify: `artifacts/adventure-zone/src/features/routes/map-data.ts`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

---

### Task 1: Make Travel-Leg Name the Only Manager Identity

**Files:**
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-admin.test.ts`

**Interfaces:**
- Consumes: `travel_legs.id`, `travel_legs.name`, `leg_manager_access.password_hash`, `password_salt`, `session_version`.
- Produces: admin status `{ legId, legName, archivedAt, enabled, sessionVersion }`.
- Produces: `setPassword({ legId, passwordHash, passwordSalt })` with no caller-controlled manager name.

- [ ] **Step 1: Write the failing manager-admin route test**

Create `artifacts/api-server/src/routes/leg-manager-admin.test.ts` with a mocked repository so the test does not depend on production data:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAdminStatuses: vi.fn(),
  setPassword: vi.fn(),
  incrementSessionVersion: vi.fn(),
}));

vi.mock("@/features/leg-manager/leg-manager-repository", () => ({
  DrizzleLegManagerRepository: class {
    listAdminStatuses = mocks.listAdminStatuses;
    setPassword = mocks.setPassword;
    incrementSessionVersion = mocks.incrementSessionVersion;
  },
}));

vi.mock("@/features/leg-manager/leg-manager-auth", () => ({
  hashLegManagerPassword: vi.fn(async () => ({ hash: "hash", salt: "salt" })),
}));

import router from "./leg-manager-admin";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

beforeEach(() => vi.clearAllMocks());

describe("manager admin access identity", () => {
  it("returns the travel-leg name and accepts password changes without managerName", async () => {
    mocks.setPassword.mockResolvedValue({
      legId: "leg-kristy",
      legName: "Kristy",
      passwordHash: "hash",
      passwordSalt: "salt",
      sessionVersion: 4,
    });

    const response = await request(app())
      .put("/manager-admin/legs/leg-kristy/access")
      .send({ password: "new-secret" });

    expect(response.status).toBe(200);
    expect(mocks.setPassword).toHaveBeenCalledWith({
      legId: "leg-kristy",
      passwordHash: "hash",
      passwordSalt: "salt",
    });
    expect(response.body.access).toMatchObject({
      legId: "leg-kristy",
      legName: "Kristy",
      enabled: true,
      sessionVersion: 4,
    });
    expect(response.body.access).not.toHaveProperty("managerName");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/leg-manager-admin.test.ts
```

Expected: FAIL because the current schema/repository still accepts and returns `managerName`.

- [ ] **Step 3: Remove the independent manager-name field from application-facing repository types**

Change the repository types to:

```ts
export type LegManagerAccessRecord = {
  legId: string;
  legName: string;
  passwordHash: string;
  passwordSalt: string;
  sessionVersion: number;
};

export type LegManagerAdminStatus = {
  legId: string;
  legName: string;
  archivedAt: Date | null;
  enabled: boolean;
  sessionVersion: number | null;
};
```

Update `getActiveAccess()` and `listAdminStatuses()` to select `travelLegs.name` as `legName` and omit `managerName` from returned application types.

Change:

```ts
async setPassword(input: {
  legId: string;
  passwordHash: string;
  passwordSalt: string;
}): Promise<LegManagerAccessRecord | null>
```

When writing the legacy `leg_manager_access.manager_name` column, set it internally from the current travel-leg name or leave the existing compatible value untouched; do not accept it from the HTTP caller. Password hash/salt and session-version behavior stay unchanged.

- [ ] **Step 4: Remove `managerName` from the manager-admin request schema and response**

Use:

```ts
const access = z.object({
  password: z.string().min(1),
});
```

Call:

```ts
repo.setPassword({
  legId: req.params.legId,
  passwordHash: hash,
  passwordSalt: salt,
});
```

Return only `legId`, `legName`, `enabled`, and `sessionVersion` in the access summary.

- [ ] **Step 5: Run the focused test**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/leg-manager-admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/leg-manager-admin.test.ts
git commit -m "refactor: unify manager and travel leg identity"
```

---

### Task 2: Merge Manager Portal Controls Into Each Travel-Leg Card

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx`
- Delete: `artifacts/adventure-zone/src/components/routes/leg-manager-access.tsx`
- Delete: `artifacts/adventure-zone/src/components/routes/leg-manager-access.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`

**Interfaces:**
- Consumes: `/manager-admin/legs/access` statuses.
- Produces: one unified active-leg card with identity, travel settings, resources, portal status/password, sign-out, and archive controls.
- Security writes remain `PUT /manager-admin/legs/:legId/access` and `POST /manager-admin/legs/:legId/sign-out-all`.

- [ ] **Step 1: Add failing unified-card tests to the existing editor test file**

Extend the existing `leg()` fixture so callers can override the name:

```ts
function leg(id: string, sortOrder: number, archivedAt: Date | null = null, name = `Leg ${sortOrder}`): TravelLeg {
  return {
    id,
    name,
    color: "#6B7280",
    sortOrder,
    archivedAt,
    baseAddress: null,
    defaultVehicleName: null,
    defaultMpg: null,
  };
}
```

Add:

```tsx
it("shows manager access inside the matching travel-leg card", () => {
  render(
    <TravelLegEditor
      legs={[leg("leg-kristy", 1, null, "Kristy")]}
      managerAccess={[{
        legId: "leg-kristy",
        legName: "Kristy",
        archivedAt: null,
        enabled: true,
        sessionVersion: 3,
      }]}
      onSaveLeg={vi.fn()}
      onSaveOrder={vi.fn()}
      onSetManagerPassword={vi.fn(async () => undefined)}
      onSignOutManagerDevices={vi.fn(async () => undefined)}
    />,
  );

  expect(screen.getByLabelText("Manager / Leg name")).toHaveValue("Kristy");
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign Out All Devices" })).toBeInTheDocument();
});
```

Add a rename test proving `onSaveLeg` is called without requiring password entry, and move the existing write-only password and sign-out confirmation assertions from `leg-manager-access.test.tsx` into this file.

- [ ] **Step 2: Run the editor test and verify it fails**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: FAIL because `TravelLegEditor` does not yet accept manager access props.

- [ ] **Step 3: Add manager-access props and local password state to `TravelLegEditor`**

Add:

```ts
export type LegManagerAccessStatus = {
  legId: string;
  legName: string;
  archivedAt: string | Date | null;
  enabled: boolean;
  sessionVersion: number | null;
};
```

Add props:

```ts
managerAccess?: LegManagerAccessStatus[];
onSetManagerPassword?: (legId: string, password: string) => Promise<void>;
onSignOutManagerDevices?: (legId: string) => Promise<void>;
```

Add local write-only password state keyed by leg ID:

```ts
const [passwords, setPasswords] = useState<Record<string, string>>({});
```

Rename the existing `Name` label to `Manager / Leg name`; this remains the same `leg.name` value and the same normal leg save action.

Inside each active leg fieldset, render portal status, password input, Change password/Enable portal, and Sign Out All Devices. Clear the local password field after a successful password update. Keep archive, resource summary, vehicle, MPG, color, and base address controls in the same card.

- [ ] **Step 4: Update `RoutesPage` to load manager access and pass security actions into the editor**

Import `apiFetch` and `apiPut` in addition to `apiGet`.

Load both datasets in `loadData()`:

```ts
const [routes, access] = await Promise.all([
  apiGet<any>("/routes"),
  apiGet<{ legs: LegManagerAccessStatus[] }>("/manager-admin/legs/access"),
]);
```

Store `managerAccess: access.legs` in `data`.

Implement:

```ts
async function handleSetManagerPassword(legId: string, password: string) {
  await apiPut(`/manager-admin/legs/${legId}/access`, { password });
  await loadData();
}

async function handleSignOutManagerDevices(legId: string) {
  const response = await apiFetch(`/manager-admin/legs/${legId}/sign-out-all`, {
    method: "POST",
    body: "{}",
  });
  if (!response.ok) throw new Error("Could not sign out manager devices");
  await loadData();
}
```

Pass these props to `TravelLegEditor` and remove the separate `<LegManagerAccess />` render/import. Preserve the existing `View all leg finances` link, trips, handoffs, and map.

- [ ] **Step 5: Delete the obsolete separate manager-access component and test**

```bash
git rm artifacts/adventure-zone/src/components/routes/leg-manager-access.tsx artifacts/adventure-zone/src/components/routes/leg-manager-access.test.tsx
```

- [ ] **Step 6: Run the editor test**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx artifacts/adventure-zone/src/pages/RoutesPage.tsx
git commit -m "feat: combine manager access with travel leg setup"
```

---

### Task 3: Return Explicit Per-Booking Mapping State

**Files:**
- Modify: `artifacts/api-server/src/features/routes/location-resolver.ts`
- Modify: `artifacts/api-server/src/features/routes/location-resolver.test.ts`
- Modify: `artifacts/api-server/src/features/routes/map-data.ts`
- Modify: `artifacts/api-server/src/features/routes/travel-leg-repository.ts`

**Interfaces:**
- Produces:

```ts
export type RouteMappingState =
  | "mapped_coordinates"
  | "mapped_address"
  | "mapped_city"
  | "needs_mapping_no_results"
  | "needs_mapping_provider_unavailable"
  | "needs_mapping_missing_location";
```

- Produces `mappingState` on every route-map event.
- Produces `invalidateRouteLocationCache(label: string)` for one-query retry.

- [ ] **Step 1: Add failing resolver tests for success and failure states**

Extend the existing `Miles City, MT` test:

```ts
expect(result).toMatchObject({
  latitude: 46.4083,
  longitude: -105.8406,
  label: "Miles City, MT",
  quality: "city",
  mappingState: "mapped_city",
});
```

Add:

```ts
it("returns an explicit no-results state", async () => {
  const geocoder = new FakeGeocodingProvider({});
  const result = await resolveMapLocation(base, geocoder);
  expect(result).toMatchObject({
    latitude: null,
    longitude: null,
    label: "Miles City, MT",
    mappingState: "needs_mapping_no_results",
  });
});

it("does not cache provider outages permanently", async () => {
  const unavailable = new FakeGeocodingProvider({}, false);
  expect((await resolveMapLocation(base, unavailable)).mappingState)
    .toBe("needs_mapping_provider_unavailable");

  const available = new FakeGeocodingProvider({
    "miles city, mt": [{ latitude: 46.4083, longitude: -105.8406, displayName: "Miles City" }],
  });
  expect((await resolveMapLocation(base, available)).mappingState)
    .toBe("mapped_city");
});
```

Also add tests for saved coordinates → `mapped_coordinates`, full-address quality → `mapped_address`, and no usable text → `needs_mapping_missing_location`.

- [ ] **Step 2: Run the resolver tests and verify they fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/location-resolver.test.ts
```

Expected: FAIL because the current resolver collapses failures into `quality: "missing"`.

- [ ] **Step 3: Add explicit mapping state to resolver and map event types**

Update `ResolvedMapLocation`:

```ts
export type ResolvedMapLocation = {
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  quality: LocationQuality;
  mappingState: RouteMappingState;
};
```

Rules:
- valid saved coordinates → `mapped_coordinates`
- geocoded `locationQuality === "address"` → `mapped_address`
- other successful text geocode → `mapped_city`
- no text → `needs_mapping_missing_location`
- `GeocodingUnavailableError("no_results")` → `needs_mapping_no_results`
- provider error/timeout → `needs_mapping_provider_unavailable`

Add `mappingState` to backend `MapEvent`/`MapEventRecord` shapes and ensure `resolveRouteMapEvents()` copies it onto every event.

- [ ] **Step 4: Make failed caching retry-safe**

Change the cache to distinguish success from no-results:

```ts
type CachedLocation =
  | { kind: "success"; latitude: number; longitude: number; displayName: string }
  | { kind: "no_results" };
```

Never cache provider outages.

Add:

```ts
export function invalidateRouteLocationCache(label: string) {
  locationCache.delete(label.trim().toLowerCase());
}
```

Keep `clearRouteLocationCacheForTests()` for tests.

- [ ] **Step 5: Add and pass the changed-location test**

```ts
it("performs a fresh lookup when location text changes", async () => {
  const geocoder = new FakeGeocodingProvider({
    "miles city, mt": [{ latitude: 46.4, longitude: -105.8, displayName: "Miles City" }],
    "billings, mt": [{ latitude: 45.78, longitude: -108.5, displayName: "Billings" }],
  });
  await resolveMapLocation(base, geocoder);
  await resolveMapLocation({ ...base, city: "Billings" }, geocoder);
  expect(geocoder.calls).toBe(2);
});
```

- [ ] **Step 6: Run resolver tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/location-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add artifacts/api-server/src/features/routes/location-resolver.ts artifacts/api-server/src/features/routes/location-resolver.test.ts artifacts/api-server/src/features/routes/map-data.ts artifacts/api-server/src/features/routes/travel-leg-repository.ts
git commit -m "feat: expose route mapping status per booking"
```

---

### Task 4: Add One-Booking Location Retry

**Files:**
- Modify: `artifacts/api-server/src/routes/routes-map.ts`
- Create: `artifacts/api-server/src/routes/routes-map.test.ts`

**Interfaces:**
- Consumes: `invalidateRouteLocationCache()` and `resolveRouteMapEvents()` from Task 3.
- Produces: `POST /routes/events/:bookingId/retry-location` returning `{ event }`.
- `/routes` remains HTTP 200 when individual events cannot be geocoded.

- [ ] **Step 1: Create a failing retry route test with mocked repository/resolver**

Create `routes-map.test.ts` using module mocks for `DrizzleTravelLegRepository` and `resolveRouteMapEvents`. The deterministic test should set the repository to return one event:

```ts
const milesCityEvent = {
  id: "booking-1",
  name: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  locationLabel: "Miles City, MT",
  travelLegId: "leg-kristy",
  travelLegName: "Kristy",
  latitude: null,
  longitude: null,
};
```

Mock `resolveRouteMapEvents([milesCityEvent], ...)` to return the same event with coordinates and `mappingState: "mapped_city"`.

Assert:

```ts
const response = await request(app())
  .post("/routes/events/booking-1/retry-location")
  .send({});

expect(response.status).toBe(200);
expect(response.body.event).toMatchObject({
  id: "booking-1",
  latitude: 46.4083,
  longitude: -105.8406,
  mappingState: "mapped_city",
});
expect(invalidateRouteLocationCache).toHaveBeenCalledWith("Miles City, MT");
```

- [ ] **Step 2: Run the route test and verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/routes-map.test.ts
```

Expected: FAIL with 404 because the retry route does not exist.

- [ ] **Step 3: Implement the retry endpoint**

Use the existing repository:

```ts
router.post("/routes/events/:bookingId/retry-location", async (req, res): Promise<void> => {
  const repo = new DrizzleTravelLegRepository(db);
  const event = (await repo.listMapEvents()).find((row) => row.id === req.params.bookingId);
  if (!event) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (event.locationLabel) invalidateRouteLocationCache(event.locationLabel);
  const refreshed = (await resolveRouteMapEvents([event], routeGeocoder))[0]!;
  res.json({ event: refreshed });
});
```

Do not turn `needs_mapping_no_results` or `needs_mapping_provider_unavailable` into HTTP 500; return the refreshed unresolved event normally.

- [ ] **Step 4: Add a route test proving a failed geocode remains part of `/routes`**

Mock `resolveRouteMapEvents()` to return an event with `mappingState: "needs_mapping_provider_unavailable"` and null coordinates, then assert `GET /routes` returns HTTP 200 and includes that event.

- [ ] **Step 5: Run route and resolver tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/location-resolver.test.ts src/routes/routes-map.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add artifacts/api-server/src/routes/routes-map.ts artifacts/api-server/src/routes/routes-map.test.ts
git commit -m "feat: retry unresolved route locations"
```

---

### Task 5: Show `Location Needs Mapping` and Retry in the Route UI

**Files:**
- Modify: `artifacts/adventure-zone/src/features/routes/map-data.ts`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- Consumes: `mappingState` from Tasks 3–4.
- Consumes: `POST /routes/events/:bookingId/retry-location`.
- Produces: unresolved booking rows governed by the same Full/Confirmed/Potential/History and focused-leg emphasis logic as mapped events.

- [ ] **Step 1: Mirror the mapping-state type on the frontend**

```ts
export type RouteMappingState =
  | "mapped_coordinates"
  | "mapped_address"
  | "mapped_city"
  | "needs_mapping_no_results"
  | "needs_mapping_provider_unavailable"
  | "needs_mapping_missing_location";
```

Add `mappingState: RouteMappingState` to frontend `MapEvent`.

- [ ] **Step 2: Create a failing UI test for unresolved Miles City**

In `event-map.test.tsx`, mock `maplibre-gl`/WebGL as the existing frontend test conventions require and render an unresolved event with:

```ts
{
  id: "booking-1",
  name: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  travelLegId: "leg-kristy",
  travelLegName: "Kristy",
  latitude: null,
  longitude: null,
  mappingState: "needs_mapping_provider_unavailable",
}
```

Assert:

```tsx
expect(screen.getByText("Location needs mapping")).toBeInTheDocument();
expect(screen.getByText("Eastern Montana Fair")).toBeInTheDocument();
expect(screen.getByText(/Miles City, MT/)).toBeInTheDocument();
expect(screen.getByText(/Kristy/)).toBeInTheDocument();
expect(screen.getByText("Map lookup is temporarily unavailable.")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Retry location" })).toBeInTheDocument();
```

- [ ] **Step 3: Run the UI test and verify it fails**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: FAIL because the current unmapped list has generic copy and no retry action.

- [ ] **Step 4: Add explicit reason copy**

```ts
function mappingReason(state: RouteMappingState) {
  switch (state) {
    case "needs_mapping_no_results":
      return "No map result found for this location.";
    case "needs_mapping_provider_unavailable":
      return "Map lookup is temporarily unavailable.";
    case "needs_mapping_missing_location":
      return "Add a city/state or event address.";
    default:
      return null;
  }
}
```

Rename the unresolved section heading to `Location needs mapping`. Keep booking link, leg name, and attempted `locationLabel` visible.

Only show Retry for `needs_mapping_no_results` and `needs_mapping_provider_unavailable`; missing-location rows direct the user to the booking link instead.

- [ ] **Step 5: Add retry state and immediate event override**

Import `apiPost`. Add:

```ts
const [retryingId, setRetryingId] = useState<string | null>(null);
const [eventOverrides, setEventOverrides] = useState<Record<string, MapEvent>>({});

async function retryLocation(event: MapEvent) {
  setRetryingId(event.id);
  try {
    const response = await apiPost<{ event: MapEvent }>(
      `/routes/events/${event.id}/retry-location`,
      {},
    );
    setEventOverrides((current) => ({ ...current, [event.id]: response.event }));
  } finally {
    setRetryingId(null);
  }
}
```

Before the existing filter pipeline:

```ts
const effectiveEvents = events.map((event) => eventOverrides[event.id] ?? event);
```

Use `effectiveEvents` for region, season, filtering, planning events, mapped/unmapped split, and route lines. This guarantees a successful retry immediately moves the booking into the mapped dataset.

- [ ] **Step 6: Add the successful retry test**

Mock `apiPost` to return a mapped Miles City event and assert the retry endpoint is called. After the promise resolves, assert the provider-unavailable reason disappears from the unresolved section.

- [ ] **Step 7: Run frontend route tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add artifacts/adventure-zone/src/features/routes/map-data.ts artifacts/adventure-zone/src/components/routes/event-map.tsx artifacts/adventure-zone/src/components/routes/event-map.test.tsx
git commit -m "feat: surface unresolved route locations"
```

---

### Task 6: Regression Verification and Delivery

**Files:**
- No planned production-file changes. Only fix files from Tasks 1–5 if verification exposes a regression caused by this feature.

**Interfaces:**
- Consumes all prior tasks.
- Produces a merge-ready branch with no manager-finance/receipt/trip/handoff regressions.

- [ ] **Step 1: Run all feature-focused tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/leg-manager-admin.test.ts src/features/routes/location-resolver.test.ts src/routes/routes-map.test.ts src/features/routes/handoff-scoring.test.ts src/features/trips/trip-service-handoff.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx src/components/routes/event-map.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Build both production apps**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
```

Expected: both exit `0`.

- [ ] **Step 3: Run workspace typecheck as an informational regression check**

```bash
pnpm run typecheck
```

Expected: no new errors in files touched by this plan. Pre-existing unrelated errors may remain and must be reported separately rather than fixed as scope creep.

- [ ] **Step 4: Compare the implementation branch against current `main`**

Use GitHub compare and confirm the diff contains only the manager/leg unification, map-reliability changes, their tests, and the approved docs. Specifically verify that `ManagerFinanceAdminPage`, money/receipt pages, trip code, handoff code, and existing manager routes are not deleted except where explicitly modified by this plan.

- [ ] **Step 5: Open a PR targeting `main`**

The PR body must state:
- one Manager / Leg name controls both identities;
- portal passwords and session security are preserved;
- Miles City/state fallback mapping is tested;
- failed lookups remain visible under `Location needs mapping` with Retry;
- current manager finance/receipt/trip/handoff functionality is preserved.
