# Manager Travel Planning & Routes UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers collaborate on travel planning for their own leg, preview that manager experience from admin Routes, and simplify `Managers & travel legs` into collapsed cards without removing functionality.

**Architecture:** Keep the existing manager-authenticated leg boundary as the source of truth. Add append-only fuel-price observations and approval-gated route suggestions on the server, expose them through manager/admin endpoints, extend the shared manager-scoped map UI for Planning vs. On the Road, and add an admin-only manager preview that reuses the same manager map payload builder. Refactor the travel-leg editor presentation only; existing save/archive/password/reorder behaviors remain intact.

**Tech Stack:** React 19, TypeScript, Leaflet 1.9.4, Express, Drizzle/PostgreSQL, Vitest, existing manager auth/session middleware, existing manager finance/mileage routes, existing manager-scoped map components.

## Global Constraints

- A manager never selects which leg they are viewing; the authenticated manager session determines the leg automatically.
- Managers can directly save operational facts for their own leg, but official itinerary mutations require admin approval.
- Managers cannot inspect another leg's route, events, stops, or general map context.
- Manager Preview exists only in admin Routes and may select a leg because admin has broader authorization.
- Planning and On the Road are labeled under **Travel mode**, not `Manager Map Mode`.
- Fuel-price observations are append-only history; do not overwrite the previous observation.
- No paid map, routing, or public gasoline API is introduced.
- The admin all-legs Routes view remains available.
- `Managers & travel legs` loses no existing capabilities; only presentation changes.
- Do not create a second app or database.

---

## File Structure

### Server/data

- Create `artifacts/api-server/src/features/leg-manager/fuel-price-repository.ts`
  - idempotent schema creation, append-only writes, manager-leg reads, newest observation lookup.
- Create `artifacts/api-server/src/features/leg-manager/fuel-price-repository.test.ts`
  - validation/history/leg-scope tests.
- Create `artifacts/api-server/src/features/leg-manager/route-suggestion-repository.ts`
  - persistence/status/stale metadata for manager route suggestions.
- Create `artifacts/api-server/src/features/leg-manager/route-suggestion-service.ts`
  - submit, list, approve, reject; approval delegates to existing route/booking/handoff mutation services.
- Create `artifacts/api-server/src/features/leg-manager/route-suggestion-service.test.ts`
  - pending/approve/reject/stale/authorization tests.
- Modify `artifacts/api-server/src/routes/leg-manager.ts`
  - manager fuel-price + route-suggestion endpoints; derive leg from `req.legManager.legId`.
- Create `artifacts/api-server/src/routes/manager-travel-admin.ts`
  - admin preview payload + review queue/approve/reject endpoints.
- Modify `artifacts/api-server/src/routes/index.ts`
  - mount admin travel-review routes.
- Modify `artifacts/api-server/src/features/leg-manager/manager-map-data.ts`
  - add optional fuel-price/planning context to the shared manager payload if needed by both manager portal and admin preview.

### Manager client

- Modify `artifacts/adventure-zone/src/components/manager/manager-scoped-map.tsx`
  - rename copy to Travel mode and expose Planning/On-the-Road content slots.
- Create `artifacts/adventure-zone/src/components/manager/manager-travel-planning-panel.tsx`
  - fuel-price form, travel notes/status, Suggest change entry point.
- Create `artifacts/adventure-zone/src/components/manager/manager-travel-planning-panel.test.tsx`
  - direct-save and suggestion-submission tests.
- Create `artifacts/adventure-zone/src/components/manager/route-suggestion-form.tsx`
  - structured suggestion target/kind/proposed value/reason form.
- Create `artifacts/adventure-zone/src/components/manager/route-suggestion-history.tsx`
  - pending/approved/rejected list with Awaiting approval state.
- Modify `artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx`
  - Planning panel + On the Road simplified layout.
- Modify `artifacts/adventure-zone/src/pages/ManagerOperationsPage.test.tsx`
  - Travel mode, no leg selector, Planning vs. On-the-Road visibility.

### Admin Routes

- Create `artifacts/adventure-zone/src/components/routes/admin-map-view-toggle.tsx`
  - `Admin view` / `Manager preview` selector.
- Create `artifacts/adventure-zone/src/components/routes/manager-preview-map.tsx`
  - admin-only selected-leg preview using manager-scoped payload.
- Create `artifacts/adventure-zone/src/components/routes/manager-preview-map.test.tsx`
  - selected manager only, Travel mode preview, no all-leg controls.
- Create `artifacts/adventure-zone/src/components/routes/manager-route-review-queue.tsx`
  - pending suggestions with approve/reject actions.
- Modify `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
  - top-level map view state, manager selector only in Manager preview, hide organization-wide filters there, add route-suggestion review queue.

### Travel-leg editor

- Modify `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
  - collapsed cards by default, summary row, expanded full controls, dedicated reorder mode.
- Modify `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx`
  - collapsed summary, expansion, unchanged save/access/archive/add/reorder behavior.

---

### Task 1: Add append-only manager fuel-price observations

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/fuel-price-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/fuel-price-repository.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`

**Interfaces:**
- Produces:

```ts
export type FuelPriceObservation = {
  id: string;
  legId: string;
  tripId: string | null;
  pricePerGallon: number;
  locationLabel: string;
  observedAt: Date;
  note: string | null;
  createdByManagerId: string | null;
  createdAt: Date;
};

export class DrizzleFuelPriceRepository {
  create(input: Omit<FuelPriceObservation, "id" | "createdAt">): Promise<FuelPriceObservation>;
  listForLeg(legId: string, limit?: number): Promise<FuelPriceObservation[]>;
  latestForLeg(legId: string): Promise<FuelPriceObservation | null>;
}
```

- [ ] **Step 1: Write failing repository tests**

```ts
it("keeps fuel-price history instead of overwriting", async () => {
  await repo.create({ legId, tripId: null, pricePerGallon: 3.49, locationLabel: "Dickinson, ND", observedAt: new Date("2026-08-15T18:00:00Z"), note: null, createdByManagerId: managerId });
  await repo.create({ legId, tripId: null, pricePerGallon: 3.39, locationLabel: "Bismarck, ND", observedAt: new Date("2026-08-15T20:00:00Z"), note: "Cheaper east side", createdByManagerId: managerId });
  const rows = await repo.listForLeg(legId);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.pricePerGallon).toBe(3.39);
});
```

Add cases for latest observation and leg isolation.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/fuel-price-repository.test.ts
```

Expected: FAIL because repository/schema do not exist.

- [ ] **Step 3: Implement idempotent schema + repository**

Use the repo's existing `ensureSchema()` pattern and create one append-only table:

```sql
create table if not exists manager_fuel_price_observations (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  trip_id uuid references trips(id) on delete set null,
  price_per_gallon numeric(8,3) not null check (price_per_gallon > 0),
  location_label text not null check (length(trim(location_label)) > 0),
  observed_at timestamptz not null,
  note text,
  created_by_manager_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists manager_fuel_price_leg_observed_idx
  on manager_fuel_price_observations(leg_id, observed_at desc);
```

- [ ] **Step 4: Add manager endpoints with server-derived leg scope**

In `leg-manager.ts` add:

```ts
router.get("/manager/travel/fuel-prices", requireManager, async (req, res) => {
  res.json({ observations: await fuelPrices.listForLeg(req.legManager!.legId, 20) });
});

router.post("/manager/travel/fuel-prices", requireManager, async (req, res) => {
  const parsed = fuelPriceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid fuel price" });
  if (parsed.data.tripId && !(await finance.refsBelongToLeg(req.legManager!.legId, { tripId: parsed.data.tripId, bookingId: null, tripSegmentId: null }))) {
    return res.status(403).json({ error: "Trip is outside your leg" });
  }
  const observation = await fuelPrices.create({
    legId: req.legManager!.legId,
    tripId: parsed.data.tripId ?? null,
    pricePerGallon: parsed.data.pricePerGallon,
    locationLabel: parsed.data.locationLabel,
    observedAt: parsed.data.observedAt,
    note: parsed.data.note ?? null,
    createdByManagerId: req.legManager!.managerId ?? null,
  });
  res.status(201).json({ observation });
});
```

`fuelPriceSchema` requires positive price, nonblank location, optional note, optional own-leg trip, timestamp defaulting client-side to now.

- [ ] **Step 5: Run focused and existing manager API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/fuel-price-repository.test.ts src/routes/leg-manager-admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/fuel-price-repository.ts artifacts/api-server/src/features/leg-manager/fuel-price-repository.test.ts artifacts/api-server/src/routes/leg-manager.ts
git commit -m "feat: let managers record local fuel prices"
```

---

### Task 2: Add approval-gated manager route suggestions

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/route-suggestion-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/route-suggestion-service.ts`
- Create: `artifacts/api-server/src/features/leg-manager/route-suggestion-service.test.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Create: `artifacts/api-server/src/routes/manager-travel-admin.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**

```ts
export type ManagerRouteSuggestionStatus = "pending" | "approved" | "rejected";
export type ManagerRouteSuggestionTarget = "trip" | "trip_stop" | "booking" | "handoff";

export type ManagerRouteSuggestion = {
  id: string;
  legId: string;
  submittedByManagerId: string | null;
  targetType: ManagerRouteSuggestionTarget;
  targetId: string;
  kind: string;
  beforeJson: Record<string, unknown> | null;
  proposedJson: Record<string, unknown>;
  reason: string;
  status: ManagerRouteSuggestionStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  adminResponse: string | null;
  stale: boolean;
  createdAt: Date;
};
```

- [ ] **Step 1: Write failing service tests**

Cover these exact behaviors:

```ts
it("submitting a suggestion does not mutate the official route", async () => {
  const before = await trips.get(tripId);
  const suggestion = await service.submitManagerSuggestion({ managerLegId: legId, managerId, targetType: "trip_stop", targetId: stopId, kind: "reorder_stop", proposedJson: { sortOrder: 3 }, reason: "Construction makes this order easier" });
  expect(suggestion.status).toBe("pending");
  expect(await trips.get(tripId)).toEqual(before);
});

it("rejects a suggestion targeting another leg", async () => {
  await expect(service.submitManagerSuggestion({ managerLegId: legA, targetType: "trip_stop", targetId: legBStopId, kind: "reorder_stop", proposedJson: { sortOrder: 2 }, reason: "test" })).rejects.toThrow(/outside your leg/i);
});

it("admin rejection leaves official data unchanged", async () => {
  await service.rejectAdminSuggestion({ suggestionId, reviewedBy: "admin", adminResponse: "Keep official order" });
  expect((await repository.get(suggestionId))?.status).toBe("rejected");
});
```

Also test admin approval delegates to a supplied mutation adapter and stale-before-json detection blocks blind apply.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/route-suggestion-service.test.ts
```

- [ ] **Step 3: Implement idempotent suggestion storage**

Use one table with immutable proposal data and mutable review metadata. Add indexes on `(leg_id, created_at desc)` and `(status, created_at)`.

- [ ] **Step 4: Implement target ownership and stale checks**

`submitManagerSuggestion` must resolve the target and verify it belongs to `managerLegId` before insert.

`approveAdminSuggestion` must:
1. reload the current target;
2. compare the current official snapshot to `beforeJson` when supplied;
3. return `{ ok: false, code: "STALE" }` instead of applying if mismatched;
4. call the existing domain mutation adapter for the target type;
5. mark approved only after mutation succeeds.

Do not raw-update booking/trip/handoff tables inside the review service.

- [ ] **Step 5: Add manager submit/list endpoints**

```ts
router.get("/manager/travel/suggestions", requireManager, ...);
router.post("/manager/travel/suggestions", requireManager, ...);
```

The POST body never contains an authoritative `legId`.

- [ ] **Step 6: Add admin queue/review endpoints**

In `manager-travel-admin.ts`:

```ts
router.get("/manager-travel-admin/suggestions", requireAdmin, ...);
router.post("/manager-travel-admin/suggestions/:id/approve", requireAdmin, ...);
router.post("/manager-travel-admin/suggestions/:id/reject", requireAdmin, ...);
```

Return `409` with `{ error: "STALE" }` for stale approval attempts.

- [ ] **Step 7: Run API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/route-suggestion-service.test.ts src/routes/leg-manager-admin.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/route-suggestion-* artifacts/api-server/src/routes/leg-manager.ts artifacts/api-server/src/routes/manager-travel-admin.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: add admin-approved manager route suggestions"
```

---

### Task 3: Build manager Planning and On the Road travel workspace

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager/manager-travel-planning-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/manager-travel-planning-panel.test.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/route-suggestion-form.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/route-suggestion-history.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/manager-scoped-map.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerOperationsPage.test.tsx`

**Interfaces:**
- Uses existing `managerApi` and existing mileage/fuel purchase forms.
- Adds POST `/manager/travel/fuel-prices`, GET `/manager/travel/fuel-prices`, POST/GET `/manager/travel/suggestions`.

- [ ] **Step 1: Write failing Planning-mode UI tests**

```tsx
it("shows collaborative travel tools in Planning without a leg selector", async () => {
  render(<ManagerOperationsPage />);
  expect(await screen.findByText("Travel mode")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Planning" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Update local fuel price")).toBeInTheDocument();
  expect(screen.getByText("Suggest change")).toBeInTheDocument();
  expect(screen.queryByLabelText(/choose manager|choose leg/i)).not.toBeInTheDocument();
});
```

Add an On the Road case asserting planning explanation/review history is hidden while navigation, mileage/fuel logging, and quick fuel price remain.

- [ ] **Step 2: Run manager frontend test and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerOperationsPage.test.tsx src/components/manager/manager-travel-planning-panel.test.tsx
```

- [ ] **Step 3: Rename map copy to Travel mode**

Update `ManagerMapModeToggle` presentation or wrapper copy so the visible heading is `Travel mode`; keep the storage key stable to preserve existing manager preference unless a migration is explicitly needed.

- [ ] **Step 4: Implement `ManagerTravelPlanningPanel`**

The fuel-price form contains:

```ts
{
  pricePerGallon: string;
  locationLabel: string;
  observedAt: string; // datetime-local, initialized to current local time
  note: string;
}
```

Submit converts price to number and sends current trip ID if present. On success, clear price/note, keep location as convenience, and show `Fuel price saved.`.

- [ ] **Step 5: Implement `RouteSuggestionForm` and history**

Use a narrow first-release set of kinds tied to existing official entities:
- `reorder_stop`
- `change_event_time`
- `change_meetup_time_or_location`
- `remove_stop`
- `other_route_change`

Each submission requires target, proposed value payload, and nonblank reason. History renders status badges and uses `Awaiting approval` for pending.

- [ ] **Step 6: Integrate into `ManagerOperationsPage`**

Planning mode:
- own-leg map;
- planning panel;
- existing mileage/maintenance/fuel forms;
- suggestion history.

On the Road:
- own-leg map + next/full trip navigation;
- existing mileage/fuel logging;
- compact quick fuel-price form;
- critical note/report actions;
- no admin-like route editing controls.

- [ ] **Step 7: Run manager UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/manager-scoped-map.test.tsx src/components/manager/manager-travel-planning-panel.test.tsx src/pages/ManagerOperationsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/components/manager artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx artifacts/adventure-zone/src/pages/ManagerOperationsPage.test.tsx
git commit -m "feat: add manager travel planning workspace"
```

---

### Task 4: Add admin Manager Preview using the same manager map contract

**Files:**
- Modify: `artifacts/api-server/src/routes/manager-travel-admin.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/manager-map-data.ts`
- Create: `artifacts/adventure-zone/src/components/routes/admin-map-view-toggle.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/manager-preview-map.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/manager-preview-map.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`

**Interfaces:**

```ts
type AdminMapView = "admin" | "manager-preview";
```

Admin endpoint:

```http
GET /manager-travel-admin/preview/:legId
```

returns the same `ManagerScopedMapData` shape as manager `GET /manager/map`.

- [ ] **Step 1: Write failing preview API test**

Assert admin can request Kristy's leg and receives Kristy's events/route/meetups only, while a manager cannot access this admin route.

- [ ] **Step 2: Refactor shared payload builder if needed**

Keep `loadManagerScopedMapData(deps, legId, now)` as the reusable trusted builder. Actual manager route passes `req.legManager.legId`; admin preview passes validated `req.params.legId` after admin auth.

- [ ] **Step 3: Write failing admin Routes UI test**

```tsx
it("hides organization filters in Manager preview and shows selected manager only", async () => {
  render(<RoutesPage />);
  await user.click(screen.getByRole("button", { name: "Manager preview" }));
  await user.selectOptions(screen.getByLabelText("Preview manager"), kristyLegId);
  expect(screen.queryByText("Potential")).not.toBeInTheDocument();
  expect(screen.queryByText("Overlap")) .not.toBeInTheDocument();
  expect(await screen.findByLabelText("Manager preview map")).toBeInTheDocument();
});
```

- [ ] **Step 4: Implement `AdminMapViewToggle` and preview selector**

Admin view preserves current Routes content unchanged.

Manager preview shows:
- manager selector;
- Planning / On the Road preview toggle;
- `ManagerPreviewMap` using selected-leg manager payload;
- no all-leg/state/overlap/history controls in the preview block.

- [ ] **Step 5: Ensure preview cannot submit manager-originated writes**

The preview component receives `readOnly` and must not render manager fuel-price submit or Suggest change forms. It previews visual state/actions only.

- [ ] **Step 6: Run preview tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/manager-map-data.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/manager-preview-map.test.tsx src/components/routes/event-map.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/manager-travel-admin.ts artifacts/api-server/src/features/leg-manager/manager-map-data.ts artifacts/adventure-zone/src/components/routes/admin-map-view-toggle.tsx artifacts/adventure-zone/src/components/routes/manager-preview-map* artifacts/adventure-zone/src/pages/RoutesPage.tsx
git commit -m "feat: add admin manager route preview"
```

---

### Task 5: Simplify Managers & travel legs into collapsed cards

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx`

**Interfaces:**
- No API changes.
- Existing props and callbacks remain source-compatible.

- [ ] **Step 1: Write failing collapsed-card tests**

```tsx
it("renders legs collapsed by default with a compact summary", () => {
  renderEditor();
  expect(screen.getByText("Kristy")).toBeInTheDocument();
  expect(screen.getByText(/Manager enabled/)).toBeInTheDocument();
  expect(screen.getByText(/Box truck/)).toBeInTheDocument();
  expect(screen.getByText(/3 resources/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Manager / Leg name")).not.toBeInTheDocument();
});

it("expanding a leg reveals every existing edit and access control", async () => {
  renderEditor();
  await user.click(screen.getByRole("button", { name: /Manage Kristy/i }));
  expect(screen.getByLabelText("Manager / Leg name")).toBeInTheDocument();
  expect(screen.getByText("Manager portal")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Archive/i })).toBeInTheDocument();
});
```

Keep existing tests for save, archive, restore, password, sign-out, add >9 legs.

- [ ] **Step 2: Run test and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

- [ ] **Step 3: Add collapsed state and summary helper**

Use `expandedLegIds: Set<string>` initialized empty.

Collapsed summary contains:
- color dot;
- leg name;
- `Manager enabled` or `Portal not configured`;
- default vehicle if set;
- `${resources.length} resource(s)`;
- setup warning when base address/vehicle/MPG or portal access is incomplete.

- [ ] **Step 4: Move full controls inside expanded content**

Do not delete or rewrite the existing input/save/access/archive behaviors. Wrap them under expansion so their handlers remain the same.

- [ ] **Step 5: Add dedicated Reorder legs mode**

Section header gains `Reorder legs`. When active, show compact ordered rows with up/down buttons and one `Save order` action. Hide reorder arrows from normal collapsed/expanded cards.

- [ ] **Step 6: Keep archived legs behind Show archived**

No archived card renders until the existing explicit toggle is used; restored leg returns to active collapsed list.

- [ ] **Step 7: Run complete editor test suite**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS, including the existing `allows adding after nine active legs` regression.

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx
git commit -m "refactor: simplify travel leg management cards"
```

---

### Task 6: Add admin suggestion review UI and run full regression verification

**Files:**
- Create: `artifacts/adventure-zone/src/components/routes/manager-route-review-queue.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/manager-route-review-queue.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `.github/workflows/calendar-route-handoff-ci.yml`

**Interfaces:**
- GET `/manager-travel-admin/suggestions`
- POST `/manager-travel-admin/suggestions/:id/approve`
- POST `/manager-travel-admin/suggestions/:id/reject`

- [ ] **Step 1: Write failing review queue test**

```tsx
it("shows current vs proposed values and can approve or reject", async () => {
  render(<ManagerRouteReviewQueue />);
  expect(await screen.findByText("Kristy")).toBeInTheDocument();
  expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
  expect(screen.getByText(/Current/)).toBeInTheDocument();
  expect(screen.getByText(/Proposed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
});
```

Add stale-409 behavior: keep card pending and display `Official route changed; review again before approving.`

- [ ] **Step 2: Implement review queue in admin Routes**

Place it near travel planning controls, not inside the manager preview map itself. Refresh queue after approve/reject and refresh Routes data after successful approval.

- [ ] **Step 3: Add new focused tests to CI**

Extend the existing manager/route workflow commands with:
- API: `fuel-price-repository.test.ts`, `route-suggestion-service.test.ts`
- frontend: `manager-travel-planning-panel.test.tsx`, `manager-preview-map.test.tsx`, `manager-route-review-queue.test.tsx`

- [ ] **Step 4: Run all focused manager/route tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/manager-map-data.test.ts src/features/leg-manager/fuel-price-repository.test.ts src/features/leg-manager/route-suggestion-service.test.ts src/routes/leg-manager-admin.test.ts src/features/routes/location-resolver.test.ts src/routes/routes-map.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run src/components/manager/manager-scoped-map.test.tsx src/components/manager/manager-travel-planning-panel.test.tsx src/components/routes/manager-preview-map.test.tsx src/components/routes/manager-route-review-queue.test.tsx src/components/routes/travel-leg-editor.test.tsx src/pages/ManagerOperationsPage.test.tsx src/pages/ManagerRoutePage.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Run production builds and typecheck**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
pnpm run typecheck
```

Expected: exit 0 for both builds; typecheck must match the repository's current green baseline.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/manager-route-review-queue* artifacts/adventure-zone/src/pages/RoutesPage.tsx .github/workflows/calendar-route-handoff-ci.yml
git commit -m "feat: add manager route change review workflow"
```

---

## Final manual verification checklist

After CI is green, verify the deployed app with these exact scenarios:

1. Log in as Kristy manager. No manager/leg selector is visible anywhere in the manager portal.
2. Events & Route and Trip Operations show only Kristy's events/route plus Kristy's assigned meetups.
3. `Travel mode` shows Planning / On the Road and remembers the last mode.
4. Planning: save `$3.49` at `Dickinson, ND`; refresh and confirm it remains in fuel-price history.
5. Planning: submit a route-change suggestion; confirm official route remains unchanged and manager sees `Awaiting approval`.
6. Admin Routes: review the suggestion, reject it, and confirm official route remains unchanged and manager sees rejected status.
7. Submit another suggestion; approve it and confirm the intended existing domain mutation is applied once.
8. Admin Routes: switch `Admin view` → `Manager preview`, select Kristy, and confirm the map matches Kristy's private map with no other-leg route context.
9. In Manager preview, switch Planning / On the Road and confirm preview is read-only.
10. `Managers & travel legs` loads as compact collapsed cards. Expand Kristy and confirm every existing setting remains available.
11. Enter Reorder legs mode, move a leg, save, refresh, and confirm the order persists.
12. Add a travel leg when nine or more active legs already exist; confirm existing unlimited-leg behavior still works.
