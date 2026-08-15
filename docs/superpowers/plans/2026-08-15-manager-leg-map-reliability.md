# Unified Manager/Leg Setup and Route Map Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge travel-leg and manager-portal setup into one manager/leg card, and make leg-assigned bookings with city/state locations reliably visible on Routes even when geocoding fails.

**Architecture:** Keep `travel_legs.name` as the canonical manager/leg identity and preserve manager password/session records as a separate security concern. Extend route-location resolution to return an explicit mapping state and retry behavior, then render unresolved bookings beside the map instead of silently omitting them.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, Express, Drizzle ORM/PostgreSQL, MapLibre GL, Nominatim geocoding, existing Adventure Zone API/auth helpers.

## Global Constraints

- A travel leg and its manager are the same operational unit; one canonical travel-leg name controls both identities.
- Do not introduce a second manager-name source of truth.
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
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx` — absorb manager portal status/password/sign-out controls into each travel-leg card.
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx` — verify unified card behavior.
- Delete: `artifacts/adventure-zone/src/components/routes/leg-manager-access.tsx` — remove the separate manager-access section after its behavior is absorbed.
- Delete/replace coverage: `artifacts/adventure-zone/src/components/routes/leg-manager-access.test.tsx` — move its password/sign-out assertions into the unified editor test.
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx` — stop rendering the separate `LegManagerAccess` section and pass manager-access data/actions into `TravelLegEditor`.
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts` — treat travel-leg name as the manager-facing identity and support name synchronization without touching password material.
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts` — remove editable `managerName` input from password changes and expose access state keyed by leg ID/name.
- Add/modify tests near manager repository/admin routes as needed to verify rename/password/session semantics.

**Route location reliability**
- Modify: `artifacts/api-server/src/features/routes/location-resolver.ts` — return explicit mapping states, failed-query metadata, and retry/cache invalidation support.
- Modify: `artifacts/api-server/src/features/routes/location-resolver.test.ts` — cover Miles City, address priority, no-results, provider outage, cache bypass, and location edits.
- Modify: `artifacts/api-server/src/features/routes/map-data.ts` — carry mapping-state metadata to the API response.
- Modify: `artifacts/api-server/src/features/routes/travel-leg-repository.ts` — continue building the preferred location query and expose location text for diagnostics.
- Modify: `artifacts/api-server/src/routes/routes-map.ts` — keep `/routes` resilient per event and add a retry endpoint for one booking location.
- Modify: `artifacts/adventure-zone/src/features/routes/map-data.ts` — mirror mapping-state types on the frontend.
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx` — render `Location needs mapping` with reason, Retry, and booking link while preserving existing Full/Confirmed/Potential/History and leg-emphasis behavior.
- Add/modify frontend tests for unresolved event rendering and retry behavior.

---

### Task 1: Make the Travel-Leg Name the Only Manager Identity

**Files:**
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Test: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.test.ts` or the nearest existing manager repository test file
- Test: `artifacts/api-server/src/routes/leg-manager-admin.test.ts` if route-level manager-admin coverage exists; otherwise create it

**Interfaces:**
- Consumes: `travel_legs.id`, `travel_legs.name`, `leg_manager_access.password_hash`, `password_salt`, `session_version`.
- Produces: admin access status shaped as `{ legId, legName, archivedAt, enabled, sessionVersion }` with no independently editable manager name.
- Produces: password update `setPassword({ legId, passwordHash, passwordSalt })` that preserves manager identity because display identity comes from `travel_legs.name`.

- [ ] **Step 1: Write a failing repository test proving a leg rename changes manager-facing identity without changing access credentials**

```ts
it("derives manager identity from the travel-leg name after a rename", async () => {
  const legId = await seedTravelLeg({ name: "Kristy" });
  await repo.setPassword({
    legId,
    passwordHash: "hash-a",
    passwordSalt: "salt-a",
  });

  await renameTravelLeg(legId, "Kris");

  const access = await repo.getActiveAccess(legId);
  expect(access).toMatchObject({ legId, legName: "Kris" });
  expect(access?.passwordHash).toBe("hash-a");
  expect(access?.passwordSalt).toBe("salt-a");
});
```

- [ ] **Step 2: Run the focused repository test and verify it fails**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-repository.test.ts
```

Expected: FAIL because current admin/access records still expose and update a separate `managerName` field.

- [ ] **Step 3: Update repository types and queries so `travelLegs.name` is the display identity**

Use shapes equivalent to:

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

Change `setPassword` to accept only security material:

```ts
async setPassword(input: {
  legId: string;
  passwordHash: string;
  passwordSalt: string;
}): Promise<LegManagerAccessRecord | null>
```

The write may leave the legacy `manager_name` column null or synchronize it internally to the current travel-leg name for compatibility, but callers must not control it.

- [ ] **Step 4: Write a failing route test proving password changes no longer accept or require a separate manager name**

```ts
it("changes a manager password using the travel-leg name as identity", async () => {
  const response = await request(app)
    .put(`/api/manager-admin/legs/${legId}/access`)
    .send({ password: "new-secret" });

  expect(response.status).toBe(200);
  expect(response.body.access).toMatchObject({
    legId,
    legName: "Kristy",
    enabled: true,
  });
  expect(response.body.access).not.toHaveProperty("managerName");
});
```

- [ ] **Step 5: Update the manager-admin access schema and response**

Replace:

```ts
const access = z.object({
  password: z.string().min(1),
  managerName: z.string().trim().max(100).optional().nullable(),
});
```

with:

```ts
const access = z.object({
  password: z.string().min(1),
});
```

Pass only `{ legId, passwordHash, passwordSalt }` to `repo.setPassword(...)` and return the canonical `legName`.

- [ ] **Step 6: Run manager repository/admin tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-repository.test.ts src/routes/leg-manager-admin.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts artifacts/api-server/src/features/leg-manager/leg-manager-repository.test.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/leg-manager-admin.test.ts
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
- Consumes: travel-leg records plus manager access statuses from `/manager-admin/legs/access`.
- Produces: one `TravelLegEditor` card per active leg with manager/leg details and portal controls.
- Security mutations remain `PUT /manager-admin/legs/:legId/access` and `POST /manager-admin/legs/:legId/sign-out-all`.

- [ ] **Step 1: Extend the travel-leg editor test fixture with access state and write the failing unified-card test**

```tsx
it("shows one Manager / Leg name and portal controls in the same card", async () => {
  renderEditor({
    legs: [leg({ id: "leg-a", name: "Kristy" })],
    access: [{
      legId: "leg-a",
      legName: "Kristy",
      archivedAt: null,
      enabled: true,
      sessionVersion: 3,
    }],
  });

  expect(screen.getByLabelText("Manager / Leg name")).toHaveValue("Kristy");
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign Out All Devices" })).toBeInTheDocument();
  expect(screen.queryByText("Leg Manager Portal Access")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused frontend test and verify it fails**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: FAIL because the editor currently has only travel-leg fields and Routes renders `LegManagerAccess` separately.

- [ ] **Step 3: Add access props and local write-only password state to `TravelLegEditor`**

Add types like:

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

Inside each active card:

```tsx
<label className="grid gap-1 text-sm font-semibold">
  Manager / Leg name
  <input
    aria-label="Manager / Leg name"
    value={leg.name}
    onChange={(event) => changeLeg(leg.id, "name", event.currentTarget.value)}
  />
</label>
```

Render status, write-only password, and Sign Out All Devices in the same fieldset. Do not load a saved password value.

- [ ] **Step 4: Write the failing test that renaming does not require a password**

```tsx
it("saves a manager/leg rename without requiring a portal password", async () => {
  renderEditor({ legs: [leg({ id: "leg-a", name: "Kristy" })] });

  fireEvent.change(screen.getByLabelText("Manager / Leg name"), {
    target: { value: "Kris" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save leg" }));

  await waitFor(() => expect(onSaveLeg).toHaveBeenCalledWith(
    "leg-a",
    expect.objectContaining({ name: "Kris" }),
  ));
  expect(onSetManagerPassword).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Write the password/sign-out tests moved from `leg-manager-access.test.tsx`**

```tsx
it("keeps portal passwords write-only", async () => {
  renderEditor({ access: [enabledAccess("leg-a", "Kristy")] });
  const input = screen.getByLabelText("New password") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "new-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  await waitFor(() => expect(onSetManagerPassword).toHaveBeenCalledWith("leg-a", "new-secret"));
  expect(input.value).toBe("");
});

it("requires confirmation before signing out all devices", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  renderEditor({ access: [enabledAccess("leg-a", "Kristy")] });
  fireEvent.click(screen.getByRole("button", { name: "Sign Out All Devices" }));
  expect(onSignOutManagerDevices).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Update `RoutesPage` to load access state and provide the security actions to the editor**

Load `/manager-admin/legs/access` alongside `/routes` or in a second request, then pass access state to the editor. Use existing auth helpers:

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

Remove:

```tsx
<LegManagerAccess />
```

Keep the current finance link, trips section, handoff section, and map section unchanged.

- [ ] **Step 7: Delete the obsolete separate access component and its standalone test**

```bash
git rm artifacts/adventure-zone/src/components/routes/leg-manager-access.tsx artifacts/adventure-zone/src/components/routes/leg-manager-access.test.tsx
```

- [ ] **Step 8: Run the frontend tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx artifacts/adventure-zone/src/pages/RoutesPage.tsx
git commit -m "feat: combine manager access with travel leg setup"
```

---

### Task 3: Return Explicit Per-Booking Mapping State From the Location Resolver

**Files:**
- Modify: `artifacts/api-server/src/features/routes/location-resolver.ts`
- Modify: `artifacts/api-server/src/features/routes/location-resolver.test.ts`
- Modify: `artifacts/api-server/src/features/routes/map-data.ts`
- Modify: `artifacts/api-server/src/features/routes/travel-leg-repository.ts`

**Interfaces:**
- Produces `RouteMappingState`:

```ts
export type RouteMappingState =
  | "mapped_coordinates"
  | "mapped_address"
  | "mapped_city"
  | "needs_mapping_no_results"
  | "needs_mapping_provider_unavailable"
  | "needs_mapping_missing_location";
```

- Produces resolved event metadata: `mappingState`, `locationLabel`, `latitude`, `longitude`.
- Produces cache invalidation helper for one location query.

- [ ] **Step 1: Expand the Miles City test to assert the explicit success state**

```ts
it("maps Miles City, MT and reports mapped_city", async () => {
  const geocoder = new FakeGeocodingProvider({
    "miles city, mt": [{
      latitude: 46.4083,
      longitude: -105.8406,
      displayName: "Miles City, Montana",
    }],
  });

  const result = await resolveMapLocation(base, geocoder);

  expect(result).toMatchObject({
    latitude: 46.4083,
    longitude: -105.8406,
    label: "Miles City, MT",
    quality: "city",
    mappingState: "mapped_city",
  });
});
```

- [ ] **Step 2: Add failing tests for no-results, provider outage, address priority, and missing text**

```ts
it("returns retryable no-results state without coordinates", async () => {
  const geocoder = new FakeGeocodingProvider({});
  const result = await resolveMapLocation(base, geocoder);
  expect(result).toMatchObject({
    latitude: null,
    longitude: null,
    label: "Miles City, MT",
    mappingState: "needs_mapping_no_results",
  });
});

it("does not permanently cache provider outages", async () => {
  const unavailable = new FakeGeocodingProvider({}, false);
  const first = await resolveMapLocation(base, unavailable);
  expect(first.mappingState).toBe("needs_mapping_provider_unavailable");

  const available = new FakeGeocodingProvider({
    "miles city, mt": [{ latitude: 46.4083, longitude: -105.8406, displayName: "Miles City" }],
  });
  const second = await resolveMapLocation(base, available);
  expect(second.mappingState).toBe("mapped_city");
});

it("prefers the full address query over city/state", async () => {
  const event = {
    ...base,
    locationLabel: "Eastern Montana Fair, 42 Garryowen Rd, Miles City, MT",
    locationQuality: "address" as const,
  };
  const geocoder = new FakeGeocodingProvider({
    "eastern montana fair, 42 garryowen rd, miles city, mt": [{
      latitude: 46.4,
      longitude: -105.8,
      displayName: "Eastern Montana Fair",
    }],
  });
  const result = await resolveMapLocation(event, geocoder);
  expect(result.mappingState).toBe("mapped_address");
});
```

- [ ] **Step 3: Run resolver tests and verify they fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/location-resolver.test.ts
```

Expected: FAIL because the current resolver only returns `quality` and collapses all failures into `missing`.

- [ ] **Step 4: Add `mappingState` to resolver and map-data types**

Implement:

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

```ts
if (validCoordinatePair(event)) mappingState = "mapped_coordinates";
else if (!label) mappingState = "needs_mapping_missing_location";
else if (geocode succeeds && event.locationQuality === "address") mappingState = "mapped_address";
else if (geocode succeeds) mappingState = "mapped_city";
else if (error.code === "no_results") mappingState = "needs_mapping_no_results";
else mappingState = "needs_mapping_provider_unavailable";
```

- [ ] **Step 5: Store enough failed-cache metadata to distinguish no-results from provider outages**

Use a cache shape like:

```ts
type CachedLocation =
  | { kind: "success"; latitude: number; longitude: number; displayName: string }
  | { kind: "no_results" };
```

Never cache `provider_error`.

Add:

```ts
export function invalidateRouteLocationCache(label: string) {
  locationCache.delete(label.trim().toLowerCase());
}
```

Keep `clearRouteLocationCacheForTests()` for whole-cache test setup.

- [ ] **Step 6: Ensure a changed booking location naturally uses a new cache key**

Add a test:

```ts
it("re-geocodes when the booking location text changes", async () => {
  const geocoder = new FakeGeocodingProvider({
    "miles city, mt": [{ latitude: 46.4, longitude: -105.8, displayName: "Miles City" }],
    "billings, mt": [{ latitude: 45.78, longitude: -108.5, displayName: "Billings" }],
  });
  await resolveMapLocation(base, geocoder);
  await resolveMapLocation({ ...base, city: "Billings" }, geocoder);
  expect(geocoder.calls).toBe(2);
});
```

- [ ] **Step 7: Run resolver tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/location-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add artifacts/api-server/src/features/routes/location-resolver.ts artifacts/api-server/src/features/routes/location-resolver.test.ts artifacts/api-server/src/features/routes/map-data.ts artifacts/api-server/src/features/routes/travel-leg-repository.ts
git commit -m "feat: expose route mapping status per booking"
```

---

### Task 4: Add One-Booking Location Retry Without Failing the Routes Page

**Files:**
- Modify: `artifacts/api-server/src/routes/routes-map.ts`
- Test: `artifacts/api-server/src/routes/routes-map.test.ts` or create focused route tests if absent

**Interfaces:**
- Consumes: `invalidateRouteLocationCache(label)` and `resolveMapLocation(...)` from Task 3.
- Produces: `POST /routes/events/:bookingId/retry-location` returning the refreshed event mapping state.
- `/routes` must continue returning all events even if individual geocodes fail.

- [ ] **Step 1: Write the failing endpoint test for Miles City retry**

```ts
it("retries one booking location and returns its refreshed mapping state", async () => {
  const response = await request(app)
    .post(`/api/routes/events/${bookingId}/retry-location`)
    .send({});

  expect(response.status).toBe(200);
  expect(response.body.event).toMatchObject({
    id: bookingId,
    locationLabel: "Miles City, MT",
  });
  expect([
    "mapped_city",
    "needs_mapping_no_results",
    "needs_mapping_provider_unavailable",
  ]).toContain(response.body.event.mappingState);
});
```

Use an injected/fake geocoder in the route test so the expected mapping state is deterministic.

- [ ] **Step 2: Write a failing test proving one bad geocode does not fail `/routes`**

```ts
it("returns routes data when one booking cannot be geocoded", async () => {
  const response = await request(app).get("/api/routes");
  expect(response.status).toBe(200);
  expect(response.body.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: failingBookingId,
      mappingState: "needs_mapping_provider_unavailable",
    }),
  ]));
});
```

- [ ] **Step 3: Run the route tests and verify they fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/routes-map.test.ts
```

Expected: FAIL because the retry endpoint does not exist and mapping failures are not explicit.

- [ ] **Step 4: Implement the retry endpoint**

Flow:

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

If repository support for one booking is easy and already patterned, prefer `getMapEventById(id)` instead of reading the full list; otherwise keep the smallest safe change and plan a repository optimization separately only if needed.

- [ ] **Step 5: Keep `/routes` per-event resilient**

Do not wrap all geocoding in a single failure path that turns one provider error into HTTP 500. `resolveRouteMapEvents` must return an unresolved state for the affected event and allow the endpoint to return `200` with the rest of the dataset.

- [ ] **Step 6: Run API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/location-resolver.test.ts src/routes/routes-map.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add artifacts/api-server/src/routes/routes-map.ts artifacts/api-server/src/routes/routes-map.test.ts
git commit -m "feat: retry unresolved route locations"
```

---

### Task 5: Show `Location Needs Mapping` With Retry in the Route UI

**Files:**
- Modify: `artifacts/adventure-zone/src/features/routes/map-data.ts`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Test: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx` or create it if absent

**Interfaces:**
- Consumes: event `mappingState` from Tasks 3–4.
- Consumes: `POST /routes/events/:bookingId/retry-location`.
- Produces: visible unresolved-booking rows with reason, booking link, leg identity, and Retry action.

- [ ] **Step 1: Add the frontend mapping-state type**

```ts
export type RouteMappingState =
  | "mapped_coordinates"
  | "mapped_address"
  | "mapped_city"
  | "needs_mapping_no_results"
  | "needs_mapping_provider_unavailable"
  | "needs_mapping_missing_location";
```

Add `mappingState: RouteMappingState` to `MapEvent`.

- [ ] **Step 2: Write the failing UI test for an unresolved Miles City booking**

```tsx
it("shows a leg-assigned unresolved booking instead of silently losing it", () => {
  render(
    <EventMap
      events={[event({
        id: "booking-1",
        name: "Eastern Montana Fair",
        city: "Miles City",
        region: "MT",
        travelLegId: "leg-kristy",
        travelLegName: "Kristy",
        latitude: null,
        longitude: null,
        mappingState: "needs_mapping_provider_unavailable",
      })]}
      travelLegs={[leg({ id: "leg-kristy", name: "Kristy" })]}
    />,
  );

  expect(screen.getByText("Location needs mapping")).toBeInTheDocument();
  expect(screen.getByText("Eastern Montana Fair")).toBeInTheDocument();
  expect(screen.getByText(/Miles City, MT/)).toBeInTheDocument();
  expect(screen.getByText(/Kristy/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry location" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Write failing reason-label tests**

Expected user-facing copy:

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

Test each unresolved state.

- [ ] **Step 4: Run the frontend map test and verify it fails**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: FAIL because current UI only says `Could not map ...` and has no explicit reason/retry action.

- [ ] **Step 5: Replace the generic unmapped copy with `Location needs mapping` rows**

Keep the current `planningEvents` filtering/emphasis pipeline. Build unresolved rows from the same filtered planning dataset so Full/Confirmed/Potential/History and focused-leg dimming apply identically.

Render:

```tsx
<h2 className="text-lg font-bold">Location needs mapping</h2>
```

For each unresolved booking include:

```tsx
<Link href={`/bookings/${event.id}`}>{event.name}</Link>
<p>{event.locationLabel ?? "No usable location"} · {event.travelLegName}</p>
<p>{mappingReason(event.mappingState)}</p>
```

For `needs_mapping_no_results` and `needs_mapping_provider_unavailable`, render `Retry location`. For `needs_mapping_missing_location`, omit Retry and direct the user to edit the booking.

- [ ] **Step 6: Implement retry state in `EventMap`**

Use `apiPost`:

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

Merge overrides before filtering:

```ts
const effectiveEvents = events.map((event) => eventOverrides[event.id] ?? event);
```

This makes a successful retry immediately move a booking from the unresolved list into the map dataset without a page reload.

- [ ] **Step 7: Add the retry success test**

```tsx
it("moves a booking out of Location needs mapping after a successful retry", async () => {
  mocks.post.mockResolvedValueOnce({
    event: mappedMilesCityEvent(),
  });

  renderMapWithUnresolvedMilesCity();
  fireEvent.click(screen.getByRole("button", { name: "Retry location" }));

  await waitFor(() => {
    expect(screen.queryByText(/Map lookup is temporarily unavailable/)).not.toBeInTheDocument();
  });
  expect(mocks.post).toHaveBeenCalledWith(
    "/routes/events/booking-1/retry-location",
    {},
  );
});
```

- [ ] **Step 8: Run frontend map tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add artifacts/adventure-zone/src/features/routes/map-data.ts artifacts/adventure-zone/src/components/routes/event-map.tsx artifacts/adventure-zone/src/components/routes/event-map.test.tsx
git commit -m "feat: surface unresolved route locations"
```

---

### Task 6: Regression Verification Across Routes and Leg Manager

**Files:**
- Modify only if verification reveals a feature-specific regression.
- Verify existing route/handoff/manager finance behavior without broad unrelated refactors.

**Interfaces:**
- Consumes all prior tasks.
- Produces a branch safe to merge without removing current manager finance, receipt, trip, handoff, or booking behavior.

- [ ] **Step 1: Run the focused manager/leg tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/leg-manager-repository.test.ts src/routes/leg-manager-admin.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the focused route-location tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/location-resolver.test.ts src/routes/routes-map.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Re-run existing handoff and trip route integration tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/handoff-scoring.test.ts src/features/trips/trip-service-handoff.test.ts
```

Expected: PASS.

- [ ] **Step 4: Build both production applications**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Run workspace typecheck as an informational regression check**

```bash
pnpm run typecheck
```

Expected: no new errors in files touched by this plan. Pre-existing unrelated repository errors may remain and must be called out separately instead of “fixed” as scope creep.

- [ ] **Step 6: Compare the implementation branch against current `main` before opening a PR**

Verify the diff contains only the unified manager/leg setup, route-location reliability changes, focused tests, and any necessary plan/spec docs. Specifically confirm that current manager finance/receipt pages and routes are not deleted.

- [ ] **Step 7: Commit any final feature-specific verification fix**

```bash
git add <only-files-fixed-by-verification>
git commit -m "fix: complete manager leg map reliability verification"
```

Skip this commit if no code changes were required.

- [ ] **Step 8: Open a PR targeting `main`**

PR summary must explicitly mention:
- one Manager / Leg name controls both identities;
- manager passwords/session security are preserved;
- Miles City/state fallback mapping;
- unresolved bookings remain visible with Retry;
- newer manager finance/receipt/trip/handoff functionality is preserved.
