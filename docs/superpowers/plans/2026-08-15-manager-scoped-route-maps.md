# Manager-Scoped Route Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show managers only their own leg's events/routes plus assigned equipment meetup points in both Manager Events & Route and Manager Operations, while supporting meetups with either another Adventure Zone leg or an outside runner.

**Architecture:** Keep the admin all-legs Routes view separate. Add a server-authorized manager map payload keyed from `req.legManager.legId`, a shared manager-only Leaflet renderer, and a participant-aware handoff model that supports leg or external participants without exposing another leg's path. Both manager pages consume the same scoped endpoint but render compact vs. full map variants.

**Tech Stack:** React 19, TypeScript, Leaflet 1.9.4, Express, Drizzle/PostgreSQL, Vitest, existing manager auth/session middleware, existing trip/handoff repositories.

## Global Constraints

- Managers see their authenticated leg's events, trip stops, route geometry, and relevant navigation information.
- Other legs' routes and event markers are never sent to or rendered in the manager client.
- The only cross-leg geography visible to a manager is an assigned meetup point involving that manager's leg.
- A cross-leg meetup may display the other leg's name, but not that leg's route, previous/next stops, booking details, or contact details.
- Equipment meetups must support either another Adventure Zone leg or an outside person / third-party runner.
- Outside-person meetups must not require a fake travel leg or a full CRM contact.
- At least one meetup participant must be an Adventure Zone leg.
- Manager map scope is derived from `req.legManager.legId`; manager clients must not be able to select an arbitrary leg ID as authorization.
- Both Manager Events & Route and Manager Operations use the same authorization/data model.
- No paid Google Maps API is introduced; Directions continue to use standard Google Maps URLs.
- Do not create a second app or database.
- Preserve the existing admin all-legs Routes view and existing automatic leg-to-leg handoff suggestion workflow.

---

## File Structure

### Server/data model

- Modify `artifacts/api-server/src/features/routes/handoff-repository.ts`
  - evolve `EquipmentHandoff` from two mandatory leg IDs into participant-aware endpoints while preserving existing leg-to-leg suggestions;
  - add manager-safe meetup listing by leg;
  - add manual handoff persistence for external participants.
- Modify `artifacts/api-server/src/features/routes/handoff-service.ts`
  - keep automatic suggestions leg-to-leg;
  - normalize participant output for approved/manual handoffs.
- Create `artifacts/api-server/src/features/routes/handoff-repository-participants.test.ts`
  - participant persistence and validation tests.
- Create `artifacts/api-server/src/features/leg-manager/manager-map-data.ts`
  - build the manager-scoped map payload from the authenticated leg only.
- Create `artifacts/api-server/src/features/leg-manager/manager-map-data.test.ts`
  - authorization/privacy tests for events, route geometry, and meetups.
- Modify `artifacts/api-server/src/routes/leg-manager.ts`
  - add `GET /manager/map` using `req.legManager.legId` only.
- Modify `artifacts/api-server/src/routes/handoffs.ts`
  - add admin manual handoff create/update support with participant validation.
- Create `artifacts/api-server/src/routes/handoffs-manual.test.ts`
  - manual handoff API validation tests.

### Shared manager client

- Create `artifacts/adventure-zone/src/features/manager/manager-map-types.ts`
  - shared `ManagerScopedMapData`, meetup participant, event, and route point types.
- Create `artifacts/adventure-zone/src/features/manager/use-manager-scoped-map.ts`
  - load `/manager/map` through `managerApi` and normalize dates.
- Create `artifacts/adventure-zone/src/components/manager/manager-scoped-map.tsx`
  - shared compact/full manager map wrapper.
- Create `artifacts/adventure-zone/src/components/manager/manager-scoped-map-layers.tsx`
  - render only own-leg event/route layers plus assigned meetup markers.
- Create `artifacts/adventure-zone/src/components/manager/manager-scoped-map.test.tsx`
  - privacy/rendering/navigation tests.
- Reuse `artifacts/adventure-zone/src/components/routes/manager-route-map-shell.tsx`
  - Leaflet shell only; do not reuse admin all-legs data orchestration.
- Reuse `artifacts/adventure-zone/src/features/routes/manager-map-navigation.ts`
  - Google Maps URL creation and Planning / On the Road persistence where applicable.

### Manager pages

- Modify `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
  - compact manager-scoped map above the scheduled event list;
  - event-list selection focuses own-leg marker.
- Create `artifacts/adventure-zone/src/pages/ManagerRoutePage.test.tsx`
  - compact map and own-leg-only behavior.
- Modify `artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx`
  - full operational manager map with own route, ordered stops, meetups, and Planning / On the Road actions.
- Modify `artifacts/adventure-zone/src/pages/ManagerOperationsPage.test.tsx`
  - full-map behavior and meetup rendering.

### Admin handoff UI

- Modify `artifacts/adventure-zone/src/components/routes/equipment-handoffs.tsx`
  - display participant labels instead of assuming `fromLegId -> toLegId`;
  - add manual handoff entry point.
- Create `artifacts/adventure-zone/src/components/routes/manual-handoff-form.tsx`
  - choose counterpart type: Adventure Zone leg or Outside person / runner.
- Create `artifacts/adventure-zone/src/components/routes/manual-handoff-form.test.tsx`
  - validation and payload tests.

---

### Task 1: Make equipment handoffs participant-aware without breaking automatic leg-to-leg suggestions

**Files:**
- Modify: `artifacts/api-server/src/features/routes/handoff-repository.ts`
- Modify: `artifacts/api-server/src/features/routes/handoff-service.ts`
- Create: `artifacts/api-server/src/features/routes/handoff-repository-participants.test.ts`

**Interfaces:**

```ts
export type MeetupParticipant =
  | { kind: "leg"; legId: string; legName: string }
  | {
      kind: "external_contact";
      externalContactId: string | null;
      displayName: string;
      phone: string | null;
      email: string | null;
    };

export type ManualHandoffInput = {
  fromParticipant:
    | { kind: "leg"; legId: string }
    | { kind: "external_contact"; externalContactId: string | null; displayName: string; phone: string | null; email: string | null };
  toParticipant:
    | { kind: "leg"; legId: string }
    | { kind: "external_contact"; externalContactId: string | null; displayName: string; phone: string | null; email: string | null };
  fromTripId: string | null;
  toTripId: string | null;
  resourceId: string;
  meetupLabel: string;
  meetupLatitude: number;
  meetupLongitude: number;
  windowStartsAt: Date;
  windowEndsAt: Date;
};
```

- [ ] **Step 1: Write the failing participant persistence tests**

```ts
it("reads an existing leg-to-leg handoff as two leg participants", async () => {
  const handoff = await repository.get(existingId);
  expect(handoff?.fromParticipant).toMatchObject({ kind: "leg", legId: legA.id, legName: "Kristy" });
  expect(handoff?.toParticipant).toMatchObject({ kind: "leg", legId: legB.id, legName: "Hulk" });
});

it("stores an outside-runner handoff without creating a fake leg", async () => {
  const saved = await repository.createManual({
    fromParticipant: { kind: "leg", legId: legA.id },
    toParticipant: { kind: "external_contact", externalContactId: null, displayName: "Jordan Smith", phone: "555-0100", email: null },
    fromTripId: tripA.id,
    toTripId: null,
    resourceId,
    meetupLabel: "Billings transfer",
    meetupLatitude: 45.7833,
    meetupLongitude: -108.5007,
    windowStartsAt,
    windowEndsAt,
  });
  expect(saved.toParticipant).toMatchObject({ kind: "external_contact", displayName: "Jordan Smith" });
});

it("rejects a meetup with no Adventure Zone leg participant", async () => {
  await expect(repository.createManual(externalToExternalInput)).rejects.toThrow(/Adventure Zone leg/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/handoff-repository-participants.test.ts
```

Expected: FAIL because participant-aware fields and `createManual` do not exist.

- [ ] **Step 3: Evolve `equipment_handoffs` idempotently inside `ensureSchema()`**

Use the existing repository schema-upgrade pattern; preserve existing rows.

```sql
alter table equipment_handoffs alter column from_leg_id drop not null;
alter table equipment_handoffs alter column to_leg_id drop not null;

alter table equipment_handoffs add column if not exists from_participant_kind text not null default 'leg';
alter table equipment_handoffs add column if not exists to_participant_kind text not null default 'leg';
alter table equipment_handoffs add column if not exists from_external_contact_id uuid;
alter table equipment_handoffs add column if not exists from_external_name text;
alter table equipment_handoffs add column if not exists from_external_phone text;
alter table equipment_handoffs add column if not exists from_external_email text;
alter table equipment_handoffs add column if not exists to_external_contact_id uuid;
alter table equipment_handoffs add column if not exists to_external_name text;
alter table equipment_handoffs add column if not exists to_external_phone text;
alter table equipment_handoffs add column if not exists to_external_email text;
```

Add idempotent checks so participant kinds are `leg` or `external_contact`, external participants have a nonblank display name, leg participants have a leg ID, at least one side is a leg, two leg participants cannot be the same leg, and the existing time-window check remains.

- [ ] **Step 4: Implement row normalization and manual persistence**

Add:

```ts
function participantFromRow(row: HandoffRow, side: "from" | "to"): MeetupParticipant;
async createManual(input: ManualHandoffInput): Promise<EquipmentHandoff>;
async updateParticipants(id: string, input: Pick<ManualHandoffInput, "fromParticipant" | "toParticipant">): Promise<EquipmentHandoff | null>;
async listForLeg(legId: string, options?: { approvedOnly?: boolean }): Promise<EquipmentHandoff[]>;
```

`listForLeg` must match the authenticated leg against either participant's leg ID; it must not infer visibility from trip IDs.

- [ ] **Step 5: Keep automatic suggestion generation leg-to-leg**

Automatic scoring continues to produce real `fromLegId`/`toLegId` suggestions. When persisted, write participant kind `leg` on both sides. Do not involve external runners in the automatic scoring engine.

- [ ] **Step 6: Run the handoff suite and verify GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/routes/handoff-repository-participants.test.ts src/features/routes/handoff-scoring.test.ts src/features/trips/trip-service-handoff.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/routes/handoff-repository.ts artifacts/api-server/src/features/routes/handoff-service.ts artifacts/api-server/src/features/routes/handoff-repository-participants.test.ts
git commit -m "feat: support external equipment handoff participants"
```

---

### Task 2: Add a server-authorized manager-scoped map payload

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/manager-map-data.ts`
- Create: `artifacts/api-server/src/features/leg-manager/manager-map-data.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`

**Interfaces:**

```ts
export type ManagerScopedMapData = {
  leg: { id: string; name: string; color: string | null };
  route: null | {
    trip: {
      id: string;
      name: string;
      startLabel: string;
      startLatitude: number | null;
      startLongitude: number | null;
      endLabel: string;
      endLatitude: number | null;
      endLongitude: number | null;
    };
    stops: Array<{
      id: string;
      bookingId: string;
      bookingName: string;
      city: string;
      region: string;
      latitude: number | null;
      longitude: number | null;
      sortOrder: number;
      startsAt: Date | null;
      endsAt: Date | null;
    }>;
    segments: Array<{ id: string; fromLabel: string; toLabel: string; effectiveMiles: number | null; effectiveMinutes: number | null }>;
  };
  events: Array<{
    bookingId: string;
    bookingName: string;
    city: string;
    region: string;
    latitude: number | null;
    longitude: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    status: string;
  }>;
  meetups: Array<{
    id: string;
    status: HandoffStatus;
    resourceName: string | null;
    meetupLabel: string;
    meetupLatitude: number;
    meetupLongitude: number;
    windowStartsAt: Date;
    windowEndsAt: Date;
    counterpart: MeetupParticipant;
  }>;
};
```

- [ ] **Step 1: Write failing privacy tests**

```ts
it("returns only the authenticated leg's events and route geometry", async () => {
  const result = await loadManagerScopedMapData(deps, kristyLegId);
  expect(result.events.map((event) => event.bookingId)).toEqual([kristyBookingId]);
  expect(JSON.stringify(result)).not.toContain(hulkBookingId);
  expect(JSON.stringify(result)).not.toContain("Hulk private stop");
});

it("includes a shared meetup but only the counterpart leg identity", async () => {
  const result = await loadManagerScopedMapData(deps, kristyLegId);
  expect(result.meetups[0]?.counterpart).toEqual({ kind: "leg", legId: hulkLegId, legName: "Hulk" });
  expect(JSON.stringify(result.meetups[0])).not.toContain("Hulk private stop");
});

it("includes an assigned outside runner meetup", async () => {
  const result = await loadManagerScopedMapData(deps, kristyLegId);
  expect(result.meetups).toContainEqual(expect.objectContaining({ counterpart: expect.objectContaining({ kind: "external_contact", displayName: "Jordan Smith" }) }));
});

it("does not return an unrelated meetup", async () => {
  const result = await loadManagerScopedMapData(deps, kristyLegId);
  expect(result.meetups.map((meetup) => meetup.id)).not.toContain(unrelatedMeetupId);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/manager-map-data.test.ts
```

Expected: FAIL because `loadManagerScopedMapData` does not exist.

- [ ] **Step 3: Implement `loadManagerScopedMapData`**

Rules:
- accept `legId` as a server-side parameter only;
- reuse the existing manager dashboard/trip repository patterns to load that leg's current/upcoming trip, stops, events, and segments;
- call `handoffRepository.listForLeg(legId, { approvedOnly: true })`;
- compute each meetup `counterpart` by selecting the participant that is not the authenticated leg;
- never query or append another leg's event list or trip detail for context.

- [ ] **Step 4: Add `GET /manager/map`**

```ts
router.get("/manager/map", requireManager, async (req, res) => {
  const payload = await loadManagerScopedMapData(
    {
      tripRepository: new DrizzleTripRepository(db),
      handoffRepository: new HandoffRepository(db),
    },
    req.legManager!.legId,
  );
  res.json(payload);
});
```

Do not read `req.query.legId` or request-body leg IDs.

- [ ] **Step 5: Add route-level authorization regression**

Extend `artifacts/api-server/src/routes/leg-manager-admin.test.ts` so `GET /manager/map?legId=<other-leg-id>` still returns the authenticated leg's map data and never the requested other leg's data.

- [ ] **Step 6: Run API tests and verify GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/manager-map-data.test.ts src/routes/leg-manager-admin.test.ts src/routes/routes-map.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/manager-map-data.ts artifacts/api-server/src/features/leg-manager/manager-map-data.test.ts artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/leg-manager-admin.test.ts
git commit -m "feat: add manager-scoped map API"
```

---

### Task 3: Build the shared manager-only Leaflet map renderer

**Files:**
- Create: `artifacts/adventure-zone/src/features/manager/manager-map-types.ts`
- Create: `artifacts/adventure-zone/src/features/manager/use-manager-scoped-map.ts`
- Create: `artifacts/adventure-zone/src/components/manager/manager-scoped-map.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/manager-scoped-map-layers.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/manager-scoped-map.test.tsx`
- Reuse: `artifacts/adventure-zone/src/components/routes/manager-route-map-shell.tsx`
- Reuse: `artifacts/adventure-zone/src/features/routes/manager-map-navigation.ts`

**Interfaces:**

```ts
export type ManagerMapVariant = "events" | "operations";

export function ManagerScopedMap(props: {
  data: ManagerScopedMapData;
  variant: ManagerMapVariant;
  focusedBookingId?: string | null;
  onFocusBooking?: (bookingId: string) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write failing rendering/privacy tests**

```tsx
it("renders own-leg events and route but never another leg route", () => {
  render(<ManagerScopedMap data={scopedData} variant="operations" />);
  expect(markerCalls()).toContainEqual(expect.objectContaining({ title: "Eastern Montana Fair" }));
  expect(serializedLeafletCalls()).not.toContain("Hulk private stop");
});

it("renders a leg meetup with counterpart name but no counterpart path", () => {
  render(<ManagerScopedMap data={scopedDataWithLegMeetup} variant="operations" />);
  expect(popupHtml()).toContain("Meet Hulk");
  expect(serializedLeafletCalls()).not.toContain("Hulk route");
});

it("renders an outside runner meetup with permitted contact information", () => {
  render(<ManagerScopedMap data={scopedDataWithExternalMeetup} variant="events" />);
  expect(popupHtml()).toContain("Meet Jordan Smith");
  expect(popupHtml()).toContain("555-0100");
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/manager-scoped-map.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement `useManagerScopedMap()`**

Use `useManagerAuth().managerApi` and call only `/manager/map`.

```ts
return {
  data: ManagerScopedMapData | null,
  loading: boolean,
  error: string | null,
  reload: () => Promise<void>,
};
```

Normalize ISO date strings into `Date` objects where the renderer needs date methods.

- [ ] **Step 4: Implement manager-only layers**

Render exactly three groups:
1. own-leg events;
2. own-leg route/stops;
3. assigned meetups.

Do not accept `allEvents`, `travelLegs`, `focusedLegId`, or an arbitrary leg selector prop. The component API must make other-leg path rendering impossible.

Use:

```ts
const counterpartLabel = counterpart.kind === "leg"
  ? `Meet ${counterpart.legName}`
  : `Meet ${counterpart.displayName}`;
```

Popup includes resource, meetup time/location, and a Google Maps Directions URL.

- [ ] **Step 5: Implement compact/full variants**

`events` variant:
- compact height around 20rem;
- fit own mapped events plus assigned meetups;
- own event popup + Directions;
- no Planning/On the Road controls.

`operations` variant:
- full existing map height;
- fit own route/trip points plus assigned meetups;
- persisted Planning / On the Road toggle;
- route polyline + ordered stops;
- meetup Directions;
- trip navigation actions use own trip only.

With no mapped own-leg points, use the existing Utah/base fallback instead of a world view.

- [ ] **Step 6: Run manager-map + Leaflet regressions**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/manager-scoped-map.test.tsx src/components/routes/manager-route-map-shell.test.tsx src/features/routes/manager-map-navigation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/features/manager/manager-map-types.ts artifacts/adventure-zone/src/features/manager/use-manager-scoped-map.ts artifacts/adventure-zone/src/components/manager/manager-scoped-map.tsx artifacts/adventure-zone/src/components/manager/manager-scoped-map-layers.tsx artifacts/adventure-zone/src/components/manager/manager-scoped-map.test.tsx
git commit -m "feat: add shared manager-scoped route map"
```

---

### Task 4: Put the compact map on Manager Events & Route

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerRoutePage.test.tsx`

- [ ] **Step 1: Write failing page tests**

```tsx
it("shows the compact scoped map with the manager's scheduled events", async () => {
  render(<ManagerRoutePage />);
  expect(await screen.findByLabelText("Manager events map")).toBeInTheDocument();
  expect(screen.getByText("Eastern Montana Fair")).toBeInTheDocument();
});

it("does not expose another leg's event details", async () => {
  render(<ManagerRoutePage />);
  await screen.findByLabelText("Manager events map");
  expect(screen.queryByText("Hulk private event")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerRoutePage.test.tsx
```

Expected: FAIL because the page has no manager map.

- [ ] **Step 3: Add the compact map and typed focus state**

Keep the existing `Events & Route` schedule cards and `ReportScheduleIssue`. Add:

```tsx
<ManagerScopedMap
  data={mapData}
  variant="events"
  focusedBookingId={focusedBookingId}
  onFocusBooking={setFocusedBookingId}
/>
```

Event-card focus may set `focusedBookingId` only for an event already present in the authorized manager payload.

- [ ] **Step 4: Run page + routing regressions**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerRoutePage.test.tsx src/App.manager-routing.test.tsx src/pages/ManagerHomePage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx artifacts/adventure-zone/src/pages/ManagerRoutePage.test.tsx
git commit -m "feat: show scoped map on manager events route page"
```

---

### Task 5: Put the full operational map on Manager Operations

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerOperationsPage.test.tsx`

- [ ] **Step 1: Write failing operations-page tests**

```tsx
it("shows the full manager route map above trip operations", async () => {
  render(<ManagerOperationsPage />);
  expect(await screen.findByLabelText("Manager operations map")).toBeInTheDocument();
});

it("keeps the operations rollup after the map is added", async () => {
  render(<ManagerOperationsPage />);
  await screen.findByLabelText("Manager operations map");
  expect(screen.getByText(/Route miles:/)).toBeInTheDocument();
  expect(screen.getByText(/Recorded miles:/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerOperationsPage.test.tsx
```

Expected: FAIL because the map is not present.

- [ ] **Step 3: Add the full map without replacing operations tools**

Page order:
1. `Trip operations` heading;
2. `ManagerScopedMap variant="operations"`;
3. route-mile / recorded-mile / expense rollup;
4. no-current-trip notice when relevant;
5. `MileageForm`;
6. `MaintenanceForm`.

Map and rollup both use the manager's own trip only.

- [ ] **Step 4: Verify Planning / On the Road persistence**

Add a regression in `ManagerOperationsPage.test.tsx` or `manager-scoped-map.test.tsx` that switches modes, remounts, and verifies the existing manager-map local-storage key restores the prior mode.

- [ ] **Step 5: Run manager operations regressions**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerOperationsPage.test.tsx src/components/manager/manager-scoped-map.test.tsx src/lib/manager-auth-context.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx artifacts/adventure-zone/src/pages/ManagerOperationsPage.test.tsx
git commit -m "feat: add scoped map to manager operations"
```

---

### Task 6: Add admin manual meetup creation for another leg or outside runner

**Files:**
- Modify: `artifacts/api-server/src/routes/handoffs.ts`
- Create: `artifacts/api-server/src/routes/handoffs-manual.test.ts`
- Create: `artifacts/adventure-zone/src/components/routes/manual-handoff-form.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/manual-handoff-form.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/equipment-handoffs.tsx`

**Admin request:**

```ts
type ManualHandoffRequest = {
  fromParticipant:
    | { kind: "leg"; legId: string }
    | { kind: "external_contact"; externalContactId: string | null; displayName: string; phone: string | null; email: string | null };
  toParticipant:
    | { kind: "leg"; legId: string }
    | { kind: "external_contact"; externalContactId: string | null; displayName: string; phone: string | null; email: string | null };
  fromTripId: string | null;
  toTripId: string | null;
  resourceId: string;
  meetupLabel: string;
  meetupLatitude: number;
  meetupLongitude: number;
  windowStartsAt: string;
  windowEndsAt: string;
};
```

- [ ] **Step 1: Write failing API validation tests**

In `handoffs-manual.test.ts`, prove:
- leg-to-leg accepted;
- leg-to-external accepted;
- external-to-leg accepted;
- external-to-external rejected;
- external participant without display name rejected;
- same leg on both sides rejected;
- end time before start time rejected.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/handoffs-manual.test.ts
```

Expected: FAIL because `POST /handoffs/manual` does not exist.

- [ ] **Step 3: Implement `POST /handoffs/manual` in `handoffs.ts`**

Validate with Zod and call `HandoffRepository.createManual()`.

Because the owner/admin is explicitly scheduling the exchange, save manual handoffs as `approved` and set `approvedAt` immediately. Automatic suggestions keep their existing suggested/approve workflow.

- [ ] **Step 4: Write failing form tests**

```tsx
it("switches a participant to Outside person / runner", () => {
  render(<ManualHandoffForm travelLegs={legs} resources={resources} />);
  fireEvent.click(screen.getByLabelText("Outside person / runner"));
  expect(screen.getByLabelText("Runner name")).toBeInTheDocument();
});

it("submits an external participant without a fabricated leg id", async () => {
  // fill Kristy + Jordan + Paintball + meetup location/time
  // assert the POST payload contains kind: external_contact and no legId for Jordan
});
```

- [ ] **Step 5: Implement `ManualHandoffForm`**

Controls:
- participant type for each side;
- leg selector when `kind=leg`;
- runner name required when `kind=external_contact`;
- optional runner phone/email;
- equipment/resource selector;
- meetup label;
- latitude/longitude using existing admin location-entry conventions;
- start/end window;
- Save meetup.

The UI should keep at least one side as a leg where practical, while the server remains the final authority.

- [ ] **Step 6: Update `EquipmentHandoffs` display and entry point**

Replace `fromLegId -> toLegId` display assumptions with:

```ts
function participantLabel(participant: MeetupParticipant) {
  return participant.kind === "leg" ? participant.legName : participant.displayName;
}
```

Add the manual form above or beside the existing suggestion list. Keep recalculate, approve, adjust, dismiss, and route-impact preview behavior intact for automatic suggestions.

- [ ] **Step 7: Run admin UI/API tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/manual-handoff-form.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/routes/handoffs-manual.test.ts src/features/routes/handoff-repository-participants.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/routes/handoffs.ts artifacts/api-server/src/routes/handoffs-manual.test.ts artifacts/adventure-zone/src/components/routes/manual-handoff-form.tsx artifacts/adventure-zone/src/components/routes/manual-handoff-form.test.tsx artifacts/adventure-zone/src/components/routes/equipment-handoffs.tsx
git commit -m "feat: schedule equipment swaps with outside runners"
```

---

### Task 7: End-to-end privacy, build, and live-verification hardening

**Files:**
- Modify only the tests/CI files required by the checks below; no unrelated production refactors.
- Modify `.github/workflows/calendar-route-handoff-ci.yml` only if the new focused tests are not already exercised by PR path triggers.

- [ ] **Step 1: Add the cross-boundary privacy regression**

At API level, create two legs with separate events/routes plus one shared meetup. Assert the manager payload contains:
- manager A route/event coordinates;
- shared meetup coordinates;
- manager B leg name as counterpart;
- no manager B event coordinate;
- no manager B route-stop coordinate.

- [ ] **Step 2: Run the complete manager/map focused test set**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/manager/manager-scoped-map.test.tsx \
  src/pages/ManagerRoutePage.test.tsx \
  src/pages/ManagerOperationsPage.test.tsx \
  src/components/routes/manual-handoff-form.test.tsx \
  src/components/routes/manager-route-map-shell.test.tsx \
  src/features/routes/manager-map-navigation.test.ts \
  src/App.manager-routing.test.tsx \
  src/lib/manager-auth-context.test.tsx

pnpm --filter @workspace/api-server exec vitest run \
  src/features/leg-manager/manager-map-data.test.ts \
  src/features/routes/handoff-repository-participants.test.ts \
  src/features/routes/handoff-scoring.test.ts \
  src/features/trips/trip-service-handoff.test.ts \
  src/routes/handoffs-manual.test.ts \
  src/routes/leg-manager-admin.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run production builds**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
```

Expected: both exit 0.

- [ ] **Step 4: Run workspace typecheck**

```bash
pnpm run typecheck
```

No new manager-map/handoff type errors are acceptable. If unrelated pre-existing errors remain, list them separately in the PR.

- [ ] **Step 5: Verify the final diff is scoped**

```bash
git diff --stat main...HEAD
git diff main...HEAD -- \
  artifacts/api-server/src/features/leg-manager \
  artifacts/api-server/src/features/routes \
  artifacts/api-server/src/routes/leg-manager.ts \
  artifacts/api-server/src/routes/handoffs.ts \
  artifacts/adventure-zone/src/features/manager \
  artifacts/adventure-zone/src/components/manager \
  artifacts/adventure-zone/src/components/routes \
  artifacts/adventure-zone/src/pages/ManagerRoutePage.tsx \
  artifacts/adventure-zone/src/pages/ManagerRoutePage.test.tsx \
  artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx \
  artifacts/adventure-zone/src/pages/ManagerOperationsPage.test.tsx
```

Confirm no unrelated CRM/profile/importer work changed.

- [ ] **Step 6: Commit final privacy-test hardening if Step 1 introduced uncommitted test changes**

```bash
git add artifacts/api-server/src/features/leg-manager/manager-map-data.test.ts artifacts/adventure-zone/src/components/manager/manager-scoped-map.test.tsx
git commit -m "test: lock down manager route map privacy"
```

Skip this commit only if those files are already clean because their final privacy assertions were committed in earlier tasks.

- [ ] **Step 7: Open the PR with this live verification checklist**

1. Sign in as Kristy manager; Manager Events & Route shows Kristy's mapped events and no other-leg routes/events.
2. Manager Operations shows Kristy's route/trip stops and no other-leg geometry.
3. A Kristy ↔ Hulk approved meetup appears on both relevant manager maps as a meetup point labeled with Hulk's leg name.
4. Hulk's route remains invisible to Kristy before and after the meetup point.
5. An approved Kristy ↔ outside-runner meetup appears as `Meet <runner name> — <equipment>` with allowed phone/email and Directions.
6. An unrelated Hulk ↔ another-leg meetup is not returned or rendered for Kristy.
7. Planning / On the Road persists on Manager Operations.
8. Google Maps Directions for own events, own trip destinations, and assigned meetups open without API keys.
9. Existing admin all-legs Routes map still works independently.
10. Existing automatic handoff suggestions still calculate and approve leg-to-leg exchanges.
