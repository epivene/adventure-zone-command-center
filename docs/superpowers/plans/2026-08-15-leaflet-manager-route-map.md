# Leaflet Manager Route Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile MapLibre route runtime with a free Leaflet-based U.S. operations map that defaults around the Utah base region, remembers Planning/On the Road mode, renders obvious leg-colored event pins and trip routes, and launches Google Maps navigation without a paid Google API.

**Architecture:** Keep `EventMap` as the route/filter orchestration layer and move map runtime responsibilities into focused Leaflet modules. `manager-route-map-shell` owns Leaflet lifecycle/tiles/viewport/bounds; `manager-route-map-layers` owns event, trip, and handoff overlays; `manager-map-mode` owns persisted Planning/On the Road state; small pure helpers own Google Maps URL generation and Utah/base viewport decisions. Existing booking/trip/leg/handoff APIs and mileage/fuel calculations stay authoritative.

**Tech Stack:** React, TypeScript, Leaflet 1.9.4, Vite, Vitest, Testing Library, existing Wouter/API helpers.

## Global Constraints

- Normal map use must not require a paid mapping subscription or Google Maps API key.
- Leaflet is the embedded map library; do not use MapLibre for the Routes event map after parity is established.
- Default no-focus/reset viewport is the configured base when usable, otherwise a stable Utah regional fallback.
- Normal interaction must not expose an irrelevant whole-world view.
- Planning/On the Road mode is explicit and persisted under `adventure-zone.manager-map-mode.v1`.
- Missing/invalid persisted mode falls back to `planning`.
- Existing Full / Confirmed / Potential / History, season, leg, state, overlap-date, scope-summary, zero-match, and mapping-retry behavior must remain intact.
- Selecting a focused leg keeps other in-scope legs visible but dimmed; contextual markers do not widen primary fit bounds.
- Event markers must be obvious, mobile-tappable, leg-colored pins and distinct from handoff markers.
- Existing routing, mileage, drive-time, fuel, booking, trip, leg, and handoff business logic remains authoritative.
- Google Maps is opened only through URL navigation actions; do not add Google Maps JavaScript/Places/Directions SDKs.
- Do not synthesize trips from standalone bookings.

---

## File Structure

**Create:**
- `artifacts/adventure-zone/src/components/routes/manager-route-map-shell.tsx` — Leaflet map lifecycle, tile layer, Utah/U.S. bounds, viewport application, resize and tile-error handling.
- `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx` — event pins, route stop pins/polylines, handoff markers, popups, selected/dimmed visuals.
- `artifacts/adventure-zone/src/components/routes/manager-map-mode.tsx` — Planning/On the Road toggle and local persistence.
- `artifacts/adventure-zone/src/features/routes/manager-map-navigation.ts` — Google Maps URL helpers, mode persistence helpers, base/Utah viewport helpers.
- Corresponding focused test files beside each new module.

**Modify:**
- `artifacts/adventure-zone/src/components/routes/event-map.tsx` — retain orchestration/filtering but delegate runtime and layers to the new Leaflet components.
- `artifacts/adventure-zone/src/features/routes/map-focus.ts` — extend viewport target with Utah/base fallback while preserving explicit event/trip/leg priority.
- `artifacts/adventure-zone/src/pages/RoutesPage.tsx` — continue trip-focus wiring; provide existing trip detail context needed by navigation actions.
- `artifacts/adventure-zone/package.json` — add `leaflet@1.9.4` and `@types/leaflet`; remove `maplibre-gl` after no remaining frontend references exist.
- `pnpm-lock.yaml` — dependency lock update.
- `artifacts/adventure-zone/src/index.css` or the existing application CSS entrypoint — import Leaflet CSS once and add marker/popup classes if needed.
- `.github/workflows/calendar-route-handoff-ci.yml` — ensure new Leaflet tests run in the route-focused frontend test group.

---

### Task 1: Add Leaflet dependency and pure map/navigation helpers

**Files:**
- Modify: `artifacts/adventure-zone/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/adventure-zone/src/features/routes/manager-map-navigation.ts`
- Create: `artifacts/adventure-zone/src/features/routes/manager-map-navigation.test.ts`
- Modify: `artifacts/adventure-zone/src/features/routes/map-focus.ts`
- Modify: `artifacts/adventure-zone/src/features/routes/map-focus.test.ts`

**Interfaces:**
- Produces `type ManagerMapMode = "planning" | "on-road"`.
- Produces `readManagerMapMode(storage: Pick<Storage, "getItem">): ManagerMapMode`.
- Produces `writeManagerMapMode(storage: Pick<Storage, "setItem">, mode: ManagerMapMode): void`.
- Produces `googleDirectionsUrl(input: { destination: [number, number] | string; waypoints?: Array<[number, number] | string> }): string`.
- Produces `UTAH_DEFAULT_VIEW = { center: [number, number], zoom: number }` with a regional Utah-level fallback, not a street-level guess.
- Extends viewport fallback behavior so `viewportTarget(...)` can return the Utah/base fallback when there are no mapped primary events and no explicit selection.

- [ ] **Step 1: Write failing helper tests**

Add tests covering:

```ts
expect(readManagerMapMode(fakeStorage("on-road"))).toBe("on-road");
expect(readManagerMapMode(fakeStorage("garbage"))).toBe("planning");
expect(readManagerMapMode(fakeStorage(null))).toBe("planning");

expect(googleDirectionsUrl({ destination: [-105.8406, 46.4083] }))
  .toContain("https://www.google.com/maps/dir/?api=1");
expect(googleDirectionsUrl({ destination: [-105.8406, 46.4083] }))
  .toContain("destination=46.4083%2C-105.8406");
expect(googleDirectionsUrl({ destination: [-105.8406, 46.4083] }))
  .not.toContain("key=");

expect(UTAH_DEFAULT_VIEW.zoom).toBeGreaterThan(4);
```

Extend `map-focus.test.ts` so no event/trip focus produces a base/Utah target instead of a world/none target, while explicit event and trip focus retain higher priority.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/features/routes/manager-map-navigation.test.ts \
  src/features/routes/map-focus.test.ts
```

Expected: FAIL because the new helper module/functions and fallback target do not exist.

- [ ] **Step 3: Add Leaflet 1.9.4 and helper implementation**

Install through pnpm so the workspace lockfile is updated:

```bash
pnpm --filter @workspace/adventure-zone add -D leaflet@1.9.4 @types/leaflet
```

Implement persistence with the exact storage key:

```ts
export const MANAGER_MAP_MODE_KEY = "adventure-zone.manager-map-mode.v1";
export type ManagerMapMode = "planning" | "on-road";

export function readManagerMapMode(storage: Pick<Storage, "getItem">): ManagerMapMode {
  return storage.getItem(MANAGER_MAP_MODE_KEY) === "on-road" ? "on-road" : "planning";
}
```

Build Google URLs using `URL`/`URLSearchParams`; do not manually concatenate unescaped addresses. Coordinate destinations must be serialized as `lat,lng` because the app stores coordinates as `[lng, lat]`.

Use a stable Utah regional fallback around central/northern Utah with regional zoom; do not encode a private street address.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/package.json pnpm-lock.yaml \
  artifacts/adventure-zone/src/features/routes/manager-map-navigation.ts \
  artifacts/adventure-zone/src/features/routes/manager-map-navigation.test.ts \
  artifacts/adventure-zone/src/features/routes/map-focus.ts \
  artifacts/adventure-zone/src/features/routes/map-focus.test.ts
git commit -m "feat: add free manager map navigation helpers"
```

---

### Task 2: Build the remembered Planning / On the Road toggle

**Files:**
- Create: `artifacts/adventure-zone/src/components/routes/manager-map-mode.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/manager-map-mode.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`

**Interfaces:**
- `ManagerMapModeToggle({ mode, onChange }: { mode: ManagerMapMode; onChange: (mode: ManagerMapMode) => void })`.
- `EventMap` owns `managerMode` state initialized via `readManagerMapMode(window.localStorage)` in a browser-safe initializer.
- Mode changes call `writeManagerMapMode`.

- [ ] **Step 1: Write failing component tests**

Cover:

```ts
render(<ManagerMapModeToggle mode="planning" onChange={onChange} />);
expect(screen.getByRole("button", { name: "Planning" })).toHaveAttribute("aria-pressed", "true");
fireEvent.click(screen.getByRole("button", { name: "On the Road" }));
expect(onChange).toHaveBeenCalledWith("on-road");
```

Add an `EventMap` test with mocked `localStorage` proving a remembered `on-road` value restores the toggle and invalid data restores Planning.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/routes/manager-map-mode.test.tsx \
  src/components/routes/event-map-focus.test.tsx
```

Expected: FAIL because the new toggle and persistence wiring are absent.

- [ ] **Step 3: Implement the mode toggle and persistence**

Use two accessible buttons with `aria-pressed`. Planning mode copy should identify route/budget work; On the Road should identify active travel/navigation. Do not hide existing route filters when changing mode.

- [ ] **Step 4: Verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/manager-map-mode.tsx \
  artifacts/adventure-zone/src/components/routes/manager-map-mode.test.tsx \
  artifacts/adventure-zone/src/components/routes/event-map.tsx
git commit -m "feat: remember manager route map mode"
```

---

### Task 3: Create the Leaflet map shell with Utah/U.S. bounds

**Files:**
- Create: `artifacts/adventure-zone/src/components/routes/manager-route-map-shell.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/manager-route-map-shell.test.tsx`
- Modify: application CSS entrypoint used by `artifacts/adventure-zone/src/main.tsx`

**Interfaces:**
- `ManagerRouteMapShell({ viewport, children, onTileError }: { viewport: MapViewportTarget; children?: ReactNode; onTileError?: () => void })`.
- Uses configurable `VITE_ROUTE_TILE_URL` and `VITE_ROUTE_TILE_ATTRIBUTION` values with a documented free default.
- Exposes a React context or imperative map accessor consumed only by `manager-route-map-layers`.

- [ ] **Step 1: Write failing shell tests with a mocked Leaflet module**

Assert map construction uses meaningful operational constraints:

```ts
expect(L.map).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
  minZoom: expect.any(Number),
  maxBoundsViscosity: 1,
}));
expect(L.tileLayer).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
  attribution: expect.any(String),
  noWrap: true,
}));
```

Test that:
- Utah fallback calls `setView` at regional zoom;
- one-event target calls `setView` at city zoom;
- multi-point target calls `fitBounds` with padding;
- no target ever calls `fitWorld`;
- tile error calls `onTileError` but does not unmount child controls.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/manager-route-map-shell.test.tsx
```

- [ ] **Step 3: Implement shell**

Create Leaflet map once in `useEffect`, add one configurable tile layer, and destroy the map on unmount. Use practical U.S.-wide `maxBounds` with enough margin for current operations and a `minZoom` that prevents whole-world framing. Do not make bounds a booking-data filter.

Import `leaflet/dist/leaflet.css` exactly once in the app CSS/runtime entrypoint.

Apply viewport changes in a separate effect so filters/selections do not recreate the Leaflet map.

- [ ] **Step 4: Verify GREEN**

Run Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/manager-route-map-shell.tsx \
  artifacts/adventure-zone/src/components/routes/manager-route-map-shell.test.tsx \
  artifacts/adventure-zone/src/index.css
git commit -m "feat: add Utah-centered Leaflet map shell"
```

---

### Task 4: Render obvious event pins and distinct handoff markers

**Files:**
- Create: `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: app CSS entrypoint for marker classes if needed

**Interfaces:**
- `ManagerRouteMapLayers` consumes mapped `PlanningEvent[]`, handoff feature data, focused event ID, manager mode, and callbacks.
- Produces no business data; it only creates/removes Leaflet layers.
- Event popup exposes booking link metadata and a Google Maps directions URL from `googleDirectionsUrl`.

- [ ] **Step 1: Write failing layer tests**

With mocked Leaflet APIs, verify:
- one Miles City event creates one marker at `[46.4083, -105.8406]`;
- marker HTML/class includes the leg color and a tap target larger than the old circle;
- focused marker receives a selected class/state;
- dimmed context marker receives a dimmed class/state;
- handoff marker uses a different marker factory/class from event pins;
- popup content includes event name, city/state, leg/status, booking-detail action, and `Directions to event` URL with no API key.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/manager-route-map-layers.test.tsx
```

- [ ] **Step 3: Implement marker/popup layer management**

Use Leaflet `divIcon` markers so leg color and selected/dimmed states do not depend on image assets. Create a dedicated pane/z-index for event pins above route lines. Keep handoffs visibly different through shape/icon/class and suggested/approved state.

Marker click must open a Leaflet popup and must not automatically launch Google Maps in Planning mode.

- [ ] **Step 4: Replace the MapLibre canvas inside `EventMap` with shell + layers**

Keep all existing filtering and `PlanningEvent` derivation in `EventMap`; replace only the current `MapCanvas` runtime block with:

```tsx
<ManagerRouteMapShell viewport={currentViewport} onTileError={() => setMapError("The map background could not be loaded.")}>
  <ManagerRouteMapLayers
    events={planningEvents}
    handoffs={handoffs}
    focusedEventId={focusedEventId}
    managerMode={managerMode}
    onFocusEvent={setFocusedEventId}
  />
</ManagerRouteMapShell>
```

Adapt exact prop names to the interfaces created in this task; keep them consistent across implementation/tests.

- [ ] **Step 5: Run new and existing EventMap tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/routes/manager-route-map-layers.test.tsx \
  src/components/routes/event-map.test.tsx \
  src/components/routes/event-map-focus.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx \
  artifacts/adventure-zone/src/components/routes/manager-route-map-layers.test.tsx \
  artifacts/adventure-zone/src/components/routes/event-map.tsx \
  artifacts/adventure-zone/src/index.css
git commit -m "feat: render route events with Leaflet pins"
```

---

### Task 5: Render actual trip routes and ordered stops

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/trips-section.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/trips-section.test.tsx`

**Interfaces:**
- `RoutesPage` owns a `FocusedTripMapData | null` containing trip ID/name and ordered mapped points from start -> stops -> end.
- `ManagerRouteMapLayers` receives `focusedTrip` and draws its polyline plus ordered stop markers.
- Existing `/trips/:id` detail endpoint remains the source for start/stops/end and existing mileage/fuel values.

- [ ] **Step 1: Write failing tests**

Trip list test: clicking `Focus route` still invokes the focus callback without navigating away.

Layer tests:

```ts
expect(L.polyline).toHaveBeenCalledWith([
  [startLat, startLng],
  [stop1Lat, stop1Lng],
  [stop2Lat, stop2Lng],
  [endLat, endLng],
], expect.any(Object));
```

Assert unmapped stops are omitted from rendering but do not reorder mapped stops.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/routes/trips-section.test.tsx \
  src/components/routes/manager-route-map-layers.test.tsx
```

- [ ] **Step 3: Implement trip map data and route layers**

Keep existing trip-detail fetch in `RoutesPage`; normalize coordinates once into an ordered structure. Pass trip geometry and stop labels to `EventMap`/`ManagerRouteMapLayers`. Draw a clear polyline and numbered stop markers. Do not call a new routing service from Leaflet.

- [ ] **Step 4: Verify GREEN and commit**

Run Step 2 command, then:

```bash
git add artifacts/adventure-zone/src/pages/RoutesPage.tsx \
  artifacts/adventure-zone/src/components/routes/trips-section.tsx \
  artifacts/adventure-zone/src/components/routes/trips-section.test.tsx \
  artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx \
  artifacts/adventure-zone/src/components/routes/manager-route-map-layers.test.tsx
git commit -m "feat: show ordered trip routes on manager map"
```

---

### Task 6: Add Planning vs On the Road navigation actions

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/manager-route-map-layers.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: `artifacts/adventure-zone/src/features/routes/manager-map-navigation.ts`
- Modify: `artifacts/adventure-zone/src/features/routes/manager-map-navigation.test.ts`

**Interfaces:**
- Planning popup primary action remains booking/route inspection; directions is secondary.
- On the Road popup exposes `Navigate to next stop` when a next stop exists.
- `googleDirectionsUrl` supports optional ordered waypoints for `Open full trip route` while leaving origin unspecified.

- [ ] **Step 1: Write failing mode-specific navigation tests**

Cover:
- Planning marker popup contains `Directions to event` but does not automatically navigate.
- On the Road with an active trip exposes `Navigate to next stop`.
- Full trip route URL includes destination + ordered waypoints and contains no API key.
- Standalone event in On the Road still offers `Directions to event`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/features/routes/manager-map-navigation.test.ts \
  src/components/routes/manager-route-map-layers.test.tsx
```

- [ ] **Step 3: Implement navigation action emphasis**

Use normal anchors with `target="_blank"` and `rel="noreferrer"` for Google Maps handoff. Do not call geolocation, track the manager, or infer physical arrival. Use trip ordering/context already in memory to identify the next destination.

- [ ] **Step 4: Verify GREEN and commit**

```bash
git add artifacts/adventure-zone/src/features/routes/manager-map-navigation.ts \
  artifacts/adventure-zone/src/features/routes/manager-map-navigation.test.ts \
  artifacts/adventure-zone/src/components/routes/manager-route-map-layers.tsx \
  artifacts/adventure-zone/src/components/routes/manager-route-map-layers.test.tsx \
  artifacts/adventure-zone/src/components/routes/event-map.tsx
git commit -m "feat: add manager road navigation actions"
```

---

### Task 7: Preserve filters, reset behavior, empty states, and tile failure fallback

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map-focus.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/manager-route-map-shell.test.tsx`

**Interfaces:**
- Existing `currentViewport` computation feeds Leaflet shell.
- `Reset map scope` restores route filters/focus and Utah/base viewport, but does not erase the persisted Planning/On the Road preference.

- [ ] **Step 1: Add failing regression tests**

Cover:
- state/date/mode/leg filters still alter the marker set and viewport target;
- selecting Kristy fits only Kristy's primary markers while context stays dimmed;
- `Reset map scope` returns to Utah/base fallback and clears event/trip/leg/filter focus;
- reset does not change stored manager mode;
- zero matches shows `No matching route events` and does not request world view;
- unmapped event keeps `Location needs mapping` and retry behavior;
- tile failure leaves event cards and Directions anchors rendered.

- [ ] **Step 2: Run and verify RED where behavior is missing**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/routes/event-map-focus.test.tsx \
  src/components/routes/event-map.test.tsx \
  src/components/routes/manager-route-map-shell.test.tsx
```

- [ ] **Step 3: Implement only missing parity/failure behavior**

Do not rewrite the existing filter functions. Keep `filterMapEvents`, season classification, `routeEmphasis`, mapping retry, and scope summary as the canonical pipeline.

- [ ] **Step 4: Verify GREEN and commit**

```bash
git add artifacts/adventure-zone/src/components/routes/event-map.tsx \
  artifacts/adventure-zone/src/components/routes/event-map-focus.test.tsx \
  artifacts/adventure-zone/src/components/routes/event-map.test.tsx \
  artifacts/adventure-zone/src/components/routes/manager-route-map-shell.test.tsx
git commit -m "test: preserve route map behavior through Leaflet migration"
```

---

### Task 8: Remove MapLibre runtime and verify production delivery

**Files:**
- Modify: `artifacts/adventure-zone/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/calendar-route-handoff-ci.yml`
- Delete MapLibre-only code from `artifacts/adventure-zone/src/components/routes/event-map.tsx` after the Leaflet implementation owns all runtime responsibilities.

**Interfaces:**
- No `maplibre-gl` imports remain in the Routes event-map path.
- Leaflet shell/layers are the only embedded runtime for this feature.

- [ ] **Step 1: Search for remaining MapLibre references**

Run:

```bash
rg "maplibre|MapLibre|DEFAULT_MAP_STYLE_URL|installMapOverlaysWhenStyleReady" artifacts/adventure-zone/src artifacts/adventure-zone/package.json
```

Classify each hit. Do not remove MapLibre if another unrelated app feature still legitimately uses it; remove the dependency only if no frontend runtime references remain.

- [ ] **Step 2: Remove obsolete route-map runtime/tests and dependency when safe**

If no unrelated references remain:

```bash
pnpm --filter @workspace/adventure-zone remove maplibre-gl
```

Delete only tests/functions specific to the retired MapLibre lifecycle (`styledata`, MapLibre source/layer installation, old camera lifecycle). Keep route-focus pure tests that remain library-independent.

- [ ] **Step 3: Update focused CI test list**

Ensure CI runs:

```text
manager-map-mode.test.tsx
manager-route-map-shell.test.tsx
manager-route-map-layers.test.tsx
manager-map-navigation.test.ts
map-focus.test.ts
event-map.test.tsx
event-map-focus.test.tsx
trips-section.test.tsx
```

plus the existing manager/API/handoff route tests.

- [ ] **Step 4: Run complete focused verification**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/features/routes/manager-map-navigation.test.ts \
  src/features/routes/map-focus.test.ts \
  src/components/routes/manager-map-mode.test.tsx \
  src/components/routes/manager-route-map-shell.test.tsx \
  src/components/routes/manager-route-map-layers.test.tsx \
  src/components/routes/event-map.test.tsx \
  src/components/routes/event-map-focus.test.tsx \
  src/components/routes/trips-section.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run existing route/API regressions**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/routes/handoff-scoring.test.ts \
  src/features/trips/trip-service-handoff.test.ts \
  src/routes/leg-manager-admin.test.ts \
  src/features/routes/location-resolver.test.ts \
  src/routes/routes-map.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build frontend and API**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
```

Expected: PASS.

- [ ] **Step 7: Diff audit**

Compare implementation branch to current `main` and confirm no database migration, booking-status mutation, route optimizer rewrite, receipt workflow change, continuous GPS tracking, or paid Google Maps API integration was introduced.

- [ ] **Step 8: Commit final CI/dependency cleanup**

```bash
git add .github/workflows/calendar-route-handoff-ci.yml artifacts/adventure-zone/package.json pnpm-lock.yaml artifacts/adventure-zone/src
git commit -m "chore: complete Leaflet route map migration"
```

- [ ] **Step 9: Open PR with live verification targets**

PR body must explicitly ask for live verification of:
- default/reset view opens around Utah/current base region, not the world;
- state borders, state/city labels, and roads are readable on the chosen free tile layer;
- Miles City displays a visible leg-colored event pin and local focus;
- selecting Kristy fits Kristy's primary markers while nearby other-leg context remains dimmed;
- Planning/On the Road preference survives refresh;
- On the Road navigation opens Google Maps directions without an API key;
- actual trips show ordered stops/polyline and next-stop navigation;
- filters, zero-match state, mapping retry, handoff markers, mileage/fuel information remain intact.
