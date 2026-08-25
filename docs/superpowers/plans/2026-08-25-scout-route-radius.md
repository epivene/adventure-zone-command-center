# Scout Route Radius Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lead Scout a visible Booking Assistant mode and add radius-based event scouting around an existing event/booking or manually entered location while preserving existing Lead Scout review/save behavior.

**Architecture:** Keep the existing Assistant Drawer and Lead Scout run/candidate workflow, but add an explicit `assistant | scout` UI mode and a dedicated Scout launch form. Add a geographic request path to the existing Lead Scout backend that resolves an anchor, applies radius/date/category/history filters, records objective search accounting, and feeds normalized candidates through the existing CRM matching and candidate pipeline.

**Tech Stack:** React + TypeScript + Vite, Express + TypeScript, Zod, Vitest, existing Lead Scout services/repositories, existing CRM/profile search infrastructure.

**Spec:** `docs/superpowers/specs/2026-08-25-scout-route-radius-design.md`

## Global Constraints

- Scout must be visible without requiring a trigger phrase.
- General Assistant keeps its current profile/event-family/general-search behavior under **Ask Assistant**.
- Contextual bookings/events expose **Scout Around This Event**.
- Supported radii are exactly `25 | 50 | 100 | 150 | 200 | 300` miles.
- Radius Scout requires an explicit start and end date before submission.
- Existing Lead Scout candidate review, research, dismissal, save-to-CRM, duplicate handling, and permissions remain the source of truth.
- Saved prospects remain in the existing CRM; do not create a separate Scout persistence model.
- Do not display fabricated percentage coverage. Only persist/display accounting values known from actual search execution.
- Route-corridor scouting between two anchors is out of scope for this implementation; detect it and return a clear not-yet-available Scout response instead of silently falling back to ordinary CRM search.
- Third-party credentials must remain server-side.

---

## File Structure

### Frontend

- Create `artifacts/adventure-zone/src/components/assistant/scout-launch-form.tsx` — owns anchor/radius/date/category/history fields and validation.
- Modify `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx` — owns Ask Assistant vs Scout Events mode, contextual Scout entry, and switching natural-language Scout responses into Scout results.
- Modify `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx` — adds search accounting and candidate re-scout chaining hook.
- Modify `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.tsx` — adds candidate-level **Scout Around This Event** when coordinates/location are usable.
- Modify `artifacts/adventure-zone/src/features/assistant/lead-scout-api.ts` — sends explicit radius Scout requests.
- Modify `artifacts/adventure-zone/src/features/assistant/assistant-types.ts` and/or existing Lead Scout type files — shared frontend request/view types.
- Add focused component tests beside the affected assistant components using existing Vitest/Testing Library conventions.

### Backend

- Modify `artifacts/api-server/src/features/assistant/general-assistant.ts` — broaden geographic Scout intent recognition and route corridor wording to Scout/not-yet-available behavior.
- Modify `artifacts/api-server/src/routes/assistant.ts` — preserve natural-language Scout entry and explicit route-mode messaging.
- Modify `artifacts/api-server/src/routes/assistant-lead-scout.ts` — add explicit radius Scout endpoint and schema handling.
- Modify `artifacts/api-server/src/features/assistant/lead-scout-service.ts` — orchestrate radius Scout runs through the existing Lead Scout lifecycle.
- Modify `artifacts/api-server/src/features/assistant/lead-scout-types.ts` — persist explicit Scout scope/accounting in the run model.
- Create `artifacts/api-server/src/features/assistant/scout-geography.ts` — anchor normalization, haversine distance, radius filtering, and subdivision/search-area abstraction.
- Create `artifacts/api-server/src/features/assistant/scout-source.ts` — event-source adapter interface and normalized source result contract; first implementation may wrap the existing web Scout mechanism rather than introduce a new vendor dependency.
- Modify existing Lead Scout repository/storage files only as required to persist scope/accounting alongside a run.
- Add route/service/unit tests beside existing Lead Scout tests.

---

### Task 1: Make Scout a first-class Assistant mode

**Files:**
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/scout-launch-form.tsx`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`
- Test: `artifacts/adventure-zone/src/components/assistant/scout-launch-form.test.tsx`

**Interfaces:**
- Produces: `type AssistantDrawerMode = "assistant" | "scout"`
- Produces: `ScoutLaunchFormProps` with `initialAnchor`, `initialDateStart`, `initialDateEnd`, `onSubmit`, and `disabled`.
- Consumes later: `RadiusScoutSubmission` from the frontend Lead Scout API task.

- [ ] **Step 1: Write failing tests for visible mode switching**

Cover these behaviors:

```ts
it("shows Ask Assistant and Scout Events in general mode", () => {
  renderAssistantDrawer({ activeContext: null });
  expect(screen.getByRole("button", { name: /ask assistant/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /scout events/i })).toBeInTheDocument();
});

it("opens the Scout form without requiring typed trigger wording", async () => {
  renderAssistantDrawer({ activeContext: null });
  await user.click(screen.getByRole("button", { name: /scout events/i }));
  expect(screen.getByRole("button", { name: /scout area/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused frontend tests and verify failure**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/assistant-drawer.test.tsx src/components/assistant/scout-launch-form.test.tsx
```

Expected: FAIL because explicit Scout mode/form do not exist yet.

- [ ] **Step 3: Implement the minimal explicit mode shell**

In `assistant-drawer.tsx`, add local mode state for general mode only:

```ts
type AssistantDrawerMode = "assistant" | "scout";
const [drawerMode, setDrawerMode] = useState<AssistantDrawerMode>("assistant");
```

Reset to `assistant` when a new non-general context is selected. Render two visible buttons/tabs at the top of General Command Terminal. Keep the existing profile/general assistant content under `assistant`; mount `ScoutLaunchForm` under `scout`.

- [ ] **Step 4: Implement the Scout form UI and local validation**

The form must include:

```ts
type ScoutEventCategory =
  | "fair"
  | "festival"
  | "rodeo"
  | "powwow"
  | "community_celebration"
  | "car_show"
  | "expo_show"
  | "parade"
  | "other_family_community";

type ScoutHistoryFilter = "all" | "hide_booked" | "hide_booked_and_dismissed";
```

Fields:
- Anchor label/manual location input
- Radius select limited to 25/50/100/150/200/300
- Date start/end
- Category checkboxes
- History filter select
- Submit button labeled `Scout Area`

Validation rules:
- anchor required
- start/end required
- `dateEnd >= dateStart`
- at least one category required

- [ ] **Step 5: Re-run focused frontend tests**

Expected: PASS.

- [ ] **Step 6: Run frontend typecheck**

```bash
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx artifacts/adventure-zone/src/components/assistant/scout-launch-form.tsx artifacts/adventure-zone/src/components/assistant/*.test.tsx
git commit -m "feat: expose Scout Events assistant mode"
```

---

### Task 2: Add contextual “Scout Around This Event” entry

**Files:**
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`

**Interfaces:**
- Produces: `ScoutContextPrefill` with `{ label, recordId?, kind, city?, region?, address?, dateStart?, dateEnd? }`.
- Consumes: currently loaded `activeContext`, `contextBundle`, and `brief` data.

- [ ] **Step 1: Write failing contextual-launch tests**

Cover:

```ts
it("shows Scout Around This Event for a booking context", () => {
  renderAssistantDrawer({ activeContext: bookingContextWithLocation });
  expect(screen.getByRole("button", { name: /scout around this event/i })).toBeInTheDocument();
});

it("prefills seven days before and after the contextual event dates", async () => {
  // event Aug 31-Sep 5 => defaults Aug 24-Sep 12
});

it("opens Scout with an empty anchor explanation when context has no location", async () => {
  // dates remain prefilled when available
});
```

- [ ] **Step 2: Run the test and confirm failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/assistant-drawer.test.tsx
```

- [ ] **Step 3: Add a contextual Scout action to non-general assistant content**

Place the button above/near the Booking Brief. Clicking it switches the drawer to a Scout launch state while retaining the current context as prefill. Do not require the user to clear selected context manually.

- [ ] **Step 4: Add deterministic date-window helper behavior**

For a contextual event range:
- start default = event start minus 7 calendar days
- end default = event end plus 7 calendar days

For a single event date, use ±7 calendar days.

Use date-only arithmetic that does not shift across time zones.

- [ ] **Step 5: Re-run test and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/assistant-drawer.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx artifacts/adventure-zone/src/features/assistant/assistant-types.ts artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx
git commit -m "feat: launch Scout from booking context"
```

---

### Task 3: Define radius Scout request, persisted scope, and validation

**Files:**
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-types.ts`
- Modify: `artifacts/api-server/src/routes/assistant-lead-scout.ts`
- Modify: Lead Scout repository/storage file that currently persists run metadata
- Modify: `artifacts/adventure-zone/src/features/assistant/lead-scout-api.ts`
- Modify: corresponding frontend Lead Scout types
- Test: `artifacts/api-server/src/routes/assistant-lead-scout-radius.test.ts`

**Interfaces:**
- Produces backend/frontend equivalent of:

```ts
interface ScoutAnchorInput {
  kind: "booking" | "event_family" | "manual" | "candidate";
  recordId?: string;
  label: string;
  city?: string;
  region?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

interface RadiusScoutRequest {
  anchor: ScoutAnchorInput;
  radiusMiles: 25 | 50 | 100 | 150 | 200 | 300;
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: "all" | "hide_booked" | "hide_booked_and_dismissed";
}
```

- Produces API client function:

```ts
startRadiusLeadScout(input: RadiusScoutRequest): Promise<LeadScoutRunView>
```

- [ ] **Step 1: Write failing route-schema tests**

Cover:
- accepts radius 200
- rejects radius 75
- rejects end date before start date
- rejects no categories
- accepts contextual record anchor without coordinates for server resolution
- rejects manual anchor with no resolvable location fields

- [ ] **Step 2: Run failing backend test**

```bash
pnpm --filter @workspace/api-server test -- src/routes/assistant-lead-scout-radius.test.ts
```

Expected: FAIL because radius endpoint/schema do not exist.

- [ ] **Step 3: Add explicit radius request endpoint**

Add a route such as:

```ts
router.post("/assistant/lead-scout/radius", async (req, res) => { ... });
```

Use Zod enum/literal validation for supported radii and category/history values. Return `400` with a useful error for invalid requests.

- [ ] **Step 4: Extend Lead Scout run metadata persistence**

Persist a scope object on the existing run record/JSON metadata rather than creating a new table/entity:

```ts
scope: {
  mode: "radius";
  anchor: {
    kind: ScoutAnchorInput["kind"];
    recordId?: string;
    label: string;
    latitude: number;
    longitude: number;
  };
  radiusMiles: number;
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: ScoutHistoryFilter;
}
```

If the current schema uses a JSON metadata column, extend that contract. If it uses dedicated columns, add only the minimum migration needed and keep Route Scout extensibility under a `mode` discriminator.

- [ ] **Step 5: Add frontend API client method**

Use the same authenticated request helper as existing Lead Scout endpoints. Do not duplicate auth/header logic.

- [ ] **Step 6: Re-run route test, backend typecheck, frontend typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/routes/assistant-lead-scout-radius.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/assistant/lead-scout-types.ts artifacts/api-server/src/routes/assistant-lead-scout.ts artifacts/adventure-zone/src/features/assistant/lead-scout-api.ts artifacts/api-server/src/routes/assistant-lead-scout-radius.test.ts
git commit -m "feat: add radius Scout request model"
```

---

### Task 4: Add anchor normalization and radius filtering

**Files:**
- Create: `artifacts/api-server/src/features/assistant/scout-geography.ts`
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-service.ts`
- Modify: existing booking/event/profile repositories only where required to resolve an anchor record
- Test: `artifacts/api-server/src/features/assistant/scout-geography.test.ts`
- Test: `artifacts/api-server/src/features/assistant/lead-scout-radius-service.test.ts`

**Interfaces:**
- Produces:

```ts
interface ResolvedScoutAnchor {
  kind: ScoutAnchorInput["kind"];
  recordId?: string;
  label: string;
  city?: string;
  region?: string;
  address?: string;
  latitude: number;
  longitude: number;
}

resolveScoutAnchor(input: ScoutAnchorInput): Promise<ResolvedScoutAnchor>
distanceMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number
withinRadius(anchor: ResolvedScoutAnchor, candidate: { latitude: number; longitude: number }, radiusMiles: number): boolean
```

- [ ] **Step 1: Write pure geography failing tests**

Test known coordinate pairs with a tolerance, plus boundary behavior:

```ts
expect(distanceMiles(milesCity, nearbyPoint)).toBeCloseTo(expectedMiles, 0);
expect(withinRadius(anchor, inside, 200)).toBe(true);
expect(withinRadius(anchor, outside, 200)).toBe(false);
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/scout-geography.test.ts
```

- [ ] **Step 3: Implement haversine distance as a dependency-free pure helper**

Do not add a mapping/geography library merely for straight-line distance.

- [ ] **Step 4: Implement anchor resolution priority**

Resolution order:
1. use supplied latitude/longitude if both valid
2. for `booking` / `event_family`, load the existing record and use stored coordinates if available
3. otherwise derive a geocodable location string from stored/manual address or city+region and call the server-side location/geocoding capability already used by the app, if present
4. if no existing geocoder is present, introduce a narrow `ScoutGeocoder` interface with a configuration-backed server implementation; never geocode in the browser
5. throw a typed `SCOUT_ANCHOR_UNRESOLVABLE` failure if no valid coordinates can be produced

- [ ] **Step 5: Write service test proving outside-radius candidates are excluded**

Inject a fake source returning one inside and one outside candidate. Assert only the inside candidate reaches candidate normalization/CRM matching.

- [ ] **Step 6: Implement the minimal service path**

The Lead Scout service should:
1. resolve anchor
2. invoke source search with date/category/search-area input
3. compute distance for every candidate with coordinates
4. discard candidates over radius
5. continue through existing normalization/CRM match/ranking flow

Candidates without resolvable coordinates must not be silently presented as inside the radius; count them as incomplete/skipped in accounting.

- [ ] **Step 7: Re-run focused tests and backend typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/scout-geography.test.ts src/features/assistant/lead-scout-radius-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/assistant/scout-geography.ts artifacts/api-server/src/features/assistant/lead-scout-service.ts artifacts/api-server/src/features/assistant/*radius*.test.ts
git commit -m "feat: filter Scout candidates by radius"
```

---

### Task 5: Add hybrid geographic source expansion and concrete accounting

**Files:**
- Create: `artifacts/api-server/src/features/assistant/scout-source.ts`
- Modify: existing Lead Scout web/source implementation to conform to the adapter
- Modify: `artifacts/api-server/src/features/assistant/lead-scout-service.ts`
- Modify: Lead Scout run type/repository for accounting metadata
- Modify: `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx`
- Test: `artifacts/api-server/src/features/assistant/lead-scout-radius-service.test.ts`
- Test: `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.test.tsx`

**Interfaces:**
- Produces:

```ts
interface ScoutSearchArea {
  label: string;
  city?: string;
  county?: string;
  region: string;
}

interface ScoutSourceRequest {
  anchor: ResolvedScoutAnchor;
  radiusMiles: number;
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  areas: ScoutSearchArea[];
}

interface ScoutSearchAccounting {
  areasConsidered?: number;
  candidatesReviewed: number;
  resultsSurfaced: number;
  incompleteChecks: number;
}
```

- [ ] **Step 1: Write failing partial-failure/accounting backend tests**

Set up two fake areas/sources where one succeeds and one throws. Assert:
- successful candidates remain
- run completes instead of returning API 500
- `incompleteChecks === 1`
- surfaced count matches final candidates

- [ ] **Step 2: Define a narrow Scout source adapter**

```ts
interface ScoutEventSource {
  search(request: ScoutSourceRequest): Promise<NormalizedScoutSourceResult>;
}
```

Wrap existing Lead Scout web discovery behind this interface first. Do not add multiple third-party event providers in this task unless one is already configured in the project.

- [ ] **Step 3: Add geographic-area enumeration abstraction**

Create a function/service that returns municipalities/counties intersecting or plausibly contained by the radius using a real geographic dataset/service. Keep it behind an interface so the source can be swapped later. Do not hard-code hand-maintained city lists.

- [ ] **Step 4: Implement fan-out with bounded concurrency and partial failure**

Search area/source combinations with a small concurrency cap. Collect fulfilled results and increment incomplete accounting for rejected checks. A complete top-level infrastructure failure should still fail the run; individual source/area failures should not.

- [ ] **Step 5: Write failing frontend accounting test**

Verify the UI renders only known values, e.g.:

```ts
expect(screen.getByText(/38 cities\/counties considered/i)).toBeInTheDocument();
expect(screen.queryByText(/%/)).not.toBeInTheDocument();
```

If a field is `undefined`, assert that row is omitted.

- [ ] **Step 6: Render concrete accounting in Lead Discovery results**

Use concise copy such as:
- `38 cities/counties considered`
- `63 event candidates reviewed`
- `11 results surfaced`
- `4 checks incomplete`

Never derive a percentage.

- [ ] **Step 7: Run focused tests and typechecks**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/lead-scout-radius-service.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-discovery-results.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/assistant/scout-source.ts artifacts/api-server/src/features/assistant/lead-scout-service.ts artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx
git commit -m "feat: expand Scout searches geographically"
```

---

### Task 6: Broaden natural-language Scout routing without breaking CRM search

**Files:**
- Modify: `artifacts/api-server/src/features/assistant/general-assistant.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`
- Test: `artifacts/api-server/src/features/assistant/general-assistant.test.ts`
- Test: existing Assistant route tests if present

**Interfaces:**
- Produces a Scout intent classification that distinguishes:
  - new geographic event discovery
  - ordinary existing CRM/profile lookup
  - future route/corridor Scout request

- [ ] **Step 1: Write failing intent tests**

Must classify as Scout:

```txt
Find events around Miles City
Find fairs within 200 miles of Miles City around Labor Day
Scout around the Miles City event
Look for festivals near this booking
```

Must remain ordinary CRM/profile lookup:

```txt
Find the Miles City event
Find Water Lantern Festival
Show me the profile for Twin Falls County Fair
```

Must classify as future route mode:

```txt
Find events between Miles City and Twin Falls
Scout the corridor from Miles City to Twin Falls
```

- [ ] **Step 2: Run focused backend test and verify failure**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/general-assistant.test.ts
```

- [ ] **Step 3: Replace the current overly strict lead-discovery boolean with explicit intent parsing**

Prefer a function shaped like:

```ts
type GeneralAssistantIntent =
  | { kind: "radius_scout"; question: string }
  | { kind: "route_scout"; question: string }
  | { kind: "profile_search"; request: ProfileSearchRequest }
  | { kind: "needs_context" };
```

Use geographic/discovery wording (`around`, `near`, `within N miles`, `scout`, new event opportunity language) as strong Scout signals. Preserve explicit profile/customer/event-family lookup as profile-search signals.

- [ ] **Step 4: Add future route-mode response**

When route/corridor intent is detected, return a Scout-facing response like:

`Route Scout between two anchors is not available yet. Use Scout Events to search around either endpoint for now.`

Do not silently search the CRM and do not pretend route scouting ran.

- [ ] **Step 5: Ensure natural-language radius Scout switches frontend into Scout results/form**

If the backend can infer all required parameters, start a run. If radius/date are missing, return a Scout response that switches the drawer to Scout mode with prefilled anchor/defaults for user editing rather than rejecting the request.

- [ ] **Step 6: Run general assistant and Lead Scout regressions**

```bash
pnpm --filter @workspace/api-server test -- src/features/assistant/general-assistant.test.ts src/routes/assistant-lead-scout-controls.test.ts src/routes/assistant-lead-scout-deepen.test.ts src/routes/assistant-lead-scout-dismiss.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/assistant/general-assistant.ts artifacts/api-server/src/routes/assistant.ts artifacts/api-server/src/features/assistant/general-assistant.test.ts
git commit -m "fix: route nearby event discovery to Scout"
```

---

### Task 7: Wire the Scout form to Radius Scout and preserve entered state on failure

**Files:**
- Modify: `artifacts/adventure-zone/src/components/assistant/scout-launch-form.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify: `artifacts/adventure-zone/src/features/assistant/lead-scout-api.ts`
- Test: `artifacts/adventure-zone/src/components/assistant/scout-launch-form.test.tsx`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`

**Interfaces:**
- Consumes: `startRadiusLeadScout(input)` from Task 3.
- Produces: successful run displayed through existing `LeadDiscoveryResults`.

- [ ] **Step 1: Write failing submit behavior tests**

Cover:
- valid form calls radius API with exact values
- successful response displays Lead Scout results
- backend anchor validation error keeps all form values populated
- zero-candidate completed run renders a useful empty summary, not a red error

- [ ] **Step 2: Run failing frontend tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/scout-launch-form.test.tsx src/components/assistant/assistant-drawer.test.tsx
```

- [ ] **Step 3: Wire submit to `startRadiusLeadScout`**

Keep form state owned by the Scout form/drawer until a successful run replaces the launch form with results. On failure, surface the existing error treatment without clearing inputs.

- [ ] **Step 4: Add clear zero-results state**

Render language like:

`Scout finished this area and did not find matching event opportunities for these dates and filters.`

Keep **Edit Search** available.

- [ ] **Step 5: Run tests and frontend typecheck/build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/scout-launch-form.test.tsx src/components/assistant/assistant-drawer.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/assistant/scout-launch-form.tsx artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx artifacts/adventure-zone/src/features/assistant/lead-scout-api.ts
git commit -m "feat: run radius Scout from assistant"
```

---

### Task 8: Add candidate chaining: “Scout Around This Event”

**Files:**
- Modify: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify: Lead Scout candidate view type if coordinates/location are not currently exposed
- Test: `artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.test.tsx`
- Test: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx`

**Interfaces:**
- Produces callback:

```ts
onScoutAroundCandidate(candidate: LeadScoutCandidateView): void
```

- [ ] **Step 1: Write failing candidate action tests**

Assert:
- candidate with usable coordinates/location shows action
- candidate lacking resolvable location does not show action
- clicking action reopens Scout form with candidate anchor
- prior run remains available through a Back to previous results action in drawer-local history

- [ ] **Step 2: Run failing tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-candidate-card.test.tsx src/components/assistant/assistant-drawer.test.tsx
```

- [ ] **Step 3: Expose candidate location data required for re-scouting**

Use already-normalized candidate coordinates/address if available. Do not make the browser re-geocode a candidate.

- [ ] **Step 4: Add drawer-local Scout history stack**

Store prior run/form state only for the current drawer session:

```ts
interface ScoutViewState {
  run: LeadScoutRunView | null;
  form: RadiusScoutSubmission;
}
```

Push current state before changing anchor to a candidate. Provide `Back to previous results` when stack is non-empty. Do not create persistent navigation history for this stage.

- [ ] **Step 5: Re-run tests/typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant/lead-scout-candidate-card.test.tsx src/components/assistant/assistant-drawer.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/assistant/lead-scout-candidate-card.tsx artifacts/adventure-zone/src/components/assistant/lead-discovery-results.tsx artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx
git commit -m "feat: scout around discovered events"
```

---

### Task 9: Full regression, build verification, and Scout-focused CI

**Files:**
- Create or modify: `.github/workflows/scout-route-radius-ci.yml`
- Modify tests only if a test reveals an implementation defect; do not weaken assertions to get green.

**Interfaces:**
- Produces: repeatable CI validation for backend Scout tests plus frontend typecheck/build and focused UI tests.

- [ ] **Step 1: Run the complete API test suite**

```bash
pnpm --filter @workspace/api-server test
```

Expected: PASS.

- [ ] **Step 2: Run API typecheck and build**

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
```

Expected: PASS.

- [ ] **Step 3: Run frontend focused tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/assistant
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 4: Add a Scout-specific GitHub Actions workflow following existing repository CI conventions**

The workflow must run on relevant assistant/Lead Scout/frontend path changes and execute:
- backend focused Scout/general-assistant tests
- backend typecheck
- frontend assistant component tests
- frontend typecheck
- frontend build

Reuse the repository's existing pnpm/setup/cache pattern from nearby workflows rather than inventing a new CI bootstrap.

- [ ] **Step 5: Run the workflow-equivalent commands locally one final time**

Expected: all PASS with no skipped Scout radius tests.

- [ ] **Step 6: Manual acceptance check against the original failure mode**

Verify these flows:
1. Open General Booking Assistant → Scout Events is visibly available.
2. Search manually around `Miles City, MT` with 200-mile radius and valid dates.
3. Open a booking/event → `Scout Around This Event` is visible and prefills dates/location when available.
4. Type `Find events around Miles City` → enters Scout behavior rather than ordinary CRM profile search.
5. Candidate outside 200 miles cannot surface merely because a source returned it.
6. Existing Lead Scout `Research deeper`, `Not a fit`, and `Save as lead` still work.
7. No UI shows a fabricated coverage percentage.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/scout-route-radius-ci.yml
git commit -m "ci: verify Scout radius workflow"
```

---

## Plan Self-Review

### Spec coverage

- Explicit Scout mode: Tasks 1 and 7.
- Contextual Scout entry: Task 2.
- Radius/date/category/history fields: Tasks 1 and 3.
- Geographic anchor/radius enforcement: Task 4.
- Hybrid subdivision/source searching: Task 5.
- Existing CRM matching/save workflow preserved: Tasks 4, 5, and regression Task 9.
- Natural-language Scout routing: Task 6.
- Candidate chaining: Task 8.
- Concrete, non-fabricated accounting: Task 5.
- Partial failure and zero-result handling: Tasks 5 and 7.
- Route Scout kept out of scope but explicitly recognized: Task 6.

### Placeholder scan

No `TBD`, `TODO`, or unspecified implementation placeholders remain. External geographic/source integration is intentionally abstracted behind named interfaces so implementation can reuse the project's existing configured provider without coupling the feature to a new vendor.

### Type consistency

The plan consistently uses `ScoutAnchorInput`, `ResolvedScoutAnchor`, `RadiusScoutRequest`, `ScoutEventCategory`, `ScoutHistoryFilter`, `ScoutSearchArea`, and `ScoutSearchAccounting` across backend and frontend responsibilities.
