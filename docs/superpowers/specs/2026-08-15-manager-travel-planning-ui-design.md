# Manager Travel Planning & Routes UI Cleanup Design

## Goal

Make manager route participation useful without exposing other legs or allowing managers to silently alter the official itinerary, while simplifying the admin Routes screen so travel-leg management is easier to scan and less intimidating.

This design covers three related UX changes:

1. **Manager travel planning** — managers can actively maintain operational travel data for their own leg.
2. **Admin manager preview** — admin can preview exactly what a specific manager sees.
3. **Simplified travel-leg cards** — the existing `Managers & travel legs` editor becomes collapsed-by-default without removing features.

## Core product rules

### Manager scope

- A manager never selects which leg they are viewing.
- The authenticated manager session determines the leg automatically.
- A manager can never switch to or inspect another leg's route.
- The manager map contains only:
  - their own leg's events;
  - their own trip/route geometry and stops;
  - equipment meetups assigned to their leg;
  - the permitted counterpart identity at a meetup.
- Other legs' paths, stops, events, and general map context are not shown.

### Travel modes

The existing `Manager Map Mode` label is misleading. Planning vs. On the Road describes how the route is being used, not which manager is selected.

Rename/reframe it as **Travel mode** with two modes:

- **Planning** — collaborative travel preparation and operational updates.
- **On the Road** — simplified navigation and field logging.

The manager portal uses this automatically on the manager's own leg. There is no manager/leg selector in the manager portal.

### Official-route approval boundary

Managers may directly update operational facts for their own leg, but any change that modifies the official itinerary must be submitted for admin approval.

The official route remains unchanged until an admin approves the proposed change.

## Manager Planning mode

Planning mode is an active workspace, not view-only.

Managers can directly save operational data that does not change where or when they are officially scheduled to be.

### Direct-save operational updates

Examples include:

- current/local gasoline price;
- gas-price location and observation time;
- actual mileage or odometer readings;
- fuel purchases;
- manager-maintained vehicle information where permissions allow;
- MPG corrections for their current/default vehicle where permissions allow;
- road conditions;
- travel notes;
- notes that an estimated drive time or mileage appears wrong;
- other field observations that improve planning accuracy without changing the itinerary.

These updates should save immediately to the manager's leg/trip context and be visible to admin.

### Gas-price updates

Planning mode should include a lightweight **Update local fuel price** action.

Minimum fields:

- price per gallon;
- location/area label;
- observed timestamp, defaulting to the current time;
- optional note.

Store the observation with:

- manager leg ID;
- manager identity/session actor where available;
- trip ID when there is a current trip;
- price;
- location;
- observation timestamp;
- created timestamp.

The newest relevant observation may be used as planning context for fuel estimates. The system should preserve history instead of overwriting older observations.

The first release does not require crowdsourced/public gasoline APIs.

## Manager On the Road mode

On the Road mode is intentionally calmer and more task-focused.

Primary content:

- current/next destination;
- manager's own route map;
- next-stop navigation;
- full own-trip navigation where appropriate;
- assigned equipment meetup(s);
- Directions actions;
- actual mileage/odometer logging;
- fuel purchase logging;
- quick fuel-price update;
- critical travel/road notes.

Planning-only controls and explanatory content should be reduced or hidden so the mobile view remains easy to use while traveling.

## Route-change suggestions

Changes to the official route require admin approval.

### Changes that require approval

Examples include:

- reordering trip stops/events;
- adding or removing an event from the official trip route;
- changing the official route destination sequence;
- changing an event's official date/time from the manager travel workspace;
- changing a scheduled equipment meetup's location or time;
- moving a resource handoff to another stop;
- other changes that materially alter where or when the leg is expected to travel.

### Suggest-change flow

Managers use **Suggest change** rather than editing the official record directly.

Each suggestion records:

- manager leg ID;
- submitting manager/actor;
- target type and target ID;
- change kind;
- structured proposed before/after data where feasible;
- human-readable reason/note;
- submitted timestamp;
- status: `pending`, `approved`, or `rejected`;
- reviewing admin and review timestamp;
- optional admin response.

### Pending suggestion behavior

A pending suggestion must not be rendered as if it is already official.

The manager can see that a proposal is **Awaiting approval**.

Where useful, Planning mode may preview the proposed change visually using clearly distinct styling, but the official route remains the primary route until approval.

On the Road mode should favor the official route and avoid presenting an unapproved path as navigational truth.

### Admin review

Admin gets a review area for manager route suggestions with:

- manager/leg name;
- affected route/event/meetup;
- current official value;
- proposed value;
- manager reason;
- submitted time;
- **Approve** and **Reject** actions.

On approval:

1. validate that the target still exists and the change is still applicable;
2. apply the official route mutation using existing domain rules;
3. mark the suggestion approved with review metadata;
4. preserve the proposal in history/audit records.

On rejection:

- leave the official route unchanged;
- mark the proposal rejected;
- optionally store an admin response visible to the manager.

## Admin Routes map views

The admin Routes screen should distinguish **who the map represents** from **how a manager uses travel mode**.

### Map view control

Add a top-level map-view choice:

- **Admin view**
- **Manager preview**

#### Admin view

This retains the broad planning tools:

- all authorized legs;
- Full / Confirmed / Potential / History;
- season/year;
- leg focus;
- state and overlap filters;
- trip focus;
- equipment handoffs;
- planning context across the organization.

Travel mode controls do not need to masquerade as manager selection here.

#### Manager preview

Manager preview is an admin-only diagnostic/preview tool.

Admin selects a manager/travel leg, for example Kristy.

The preview must use the same visibility rules/data contract as the actual manager portal whenever practical, so admin sees what Kristy would see:

- Kristy's own events;
- Kristy's route/trip/stops;
- Kristy's assigned meetup points;
- permitted meetup counterpart identity;
- no other-leg routes/events.

When Manager preview is active, hide or collapse organization-wide filters that do not apply to the private manager view, such as:

- Full / Confirmed / Potential / History route-wide controls;
- all-leg focus controls;
- state/overlap controls intended for organization-wide route planning.

The manager selector exists **only for admin preview**. Managers themselves never see it.

### Travel mode in manager preview

Admin should be able to preview the manager experience in:

- Planning;
- On the Road.

This is a preview of presentation/actions, not permission to impersonate the manager or submit manager-originated changes silently.

## Manager portal map experience

### Events & Route

The existing compact manager map remains automatically scoped to the logged-in leg.

It shows:

- own assigned events;
- assigned meetup points;
- event focus from the schedule list.

No manager selector appears.

### Trip Operations / travel planning

The larger operational map is the home for **Travel mode**.

Planning mode adds collaborative planning tools and route-change suggestions.

On the Road mode prioritizes navigation/logging.

The manager's own route remains the only route rendered.

## Simplified `Managers & travel legs` UI

The existing editor exposes nearly every setting for every leg simultaneously, producing a dense admin screen.

Keep all current capabilities, but change presentation to **collapsed summary cards by default**.

### Collapsed card

Each active leg appears as a compact row/card with quick scan information, for example:

`Kristy`  
`Manager enabled · Box truck · 3 resources`

Recommended visible summary fields:

- leg/manager name;
- leg color indicator;
- manager portal enabled/not configured;
- default vehicle when set;
- assigned resource count;
- optional warning badge if setup is incomplete.

A chevron or **Manage** action expands the card.

### Expanded card

Expansion exposes the existing capabilities without removing them:

- manager / leg name;
- color;
- base address;
- default vehicle;
- MPG;
- assigned resource summary;
- manager portal password enable/change;
- sign out manager devices;
- save leg settings;
- reorder controls;
- archive control.

### Reordering

Reordering must remain available but should not dominate every collapsed card.

Recommended options:

- show up/down controls only when a card is expanded; or
- provide a small dedicated **Reorder legs** mode at the section header.

Prefer the dedicated reorder mode if it keeps the normal view cleaner without adding much complexity.

### Add/archive/restore

Keep:

- Add travel leg;
- archive;
- archived-leg restore.

Archived legs should remain behind the existing explicit show/hide archived control rather than cluttering the default view.

## Data and API boundaries

### Manager operational updates

Manager write endpoints must derive the manager's leg from the authenticated manager session.

Do not accept an arbitrary client-supplied leg ID as authority.

Any referenced trip/booking/segment must be verified as belonging to that manager leg before saving.

### Route suggestions

Suggestion submission likewise derives the manager leg from the session.

Admin review endpoints require admin authorization.

Applying an approved suggestion should call existing route/event/handoff mutation services rather than bypassing validation with raw database writes.

### Manager preview

Admin Manager preview may request a specific leg because admin has broader authorization.

Where possible, share the same payload builder used for actual manager map data, with an explicit trusted admin-only `legId` parameter at the server boundary.

This prevents the preview and real manager experience from drifting apart.

## Suggested data model additions

### Fuel price observations

Conceptual record:

```ts
type FuelPriceObservation = {
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
```

### Manager route change suggestion

Conceptual record:

```ts
type ManagerRouteSuggestion = {
  id: string;
  legId: string;
  submittedByManagerId: string | null;
  targetType: "trip" | "trip_stop" | "booking" | "handoff";
  targetId: string;
  kind: string;
  beforeJson: Record<string, unknown> | null;
  proposedJson: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: Date | null;
  adminResponse: string | null;
  createdAt: Date;
};
```

The implementation may use existing audit/change-request infrastructure if an appropriate reusable model already exists; do not duplicate a mature existing mechanism unnecessarily.

## UI status and error behavior

- Direct operational saves show a compact saved/failed state without disrupting the map.
- Fuel-price entries validate positive numeric price and a nonblank location label.
- Route suggestions validate all required proposed values before submission.
- If the underlying official route changes while a suggestion is pending, admin review should flag the proposal as potentially stale rather than blindly applying old before/after assumptions.
- Failed map tiles must not block operational forms, suggestion history, or navigation links.
- If there is no current trip, managers may still record leg-level fuel-price observations and travel notes where applicable.

## Testing

### Manager authorization tests

- manager cannot submit operational updates for another leg;
- manager cannot submit a route suggestion for another leg's trip/event/handoff;
- manager cannot request another leg's manager map;
- admin manager-preview endpoint can load a chosen leg;
- manager-visible data contains no unrelated leg geometry.

### Fuel-price tests

- manager can record a valid local gas price for their own leg;
- price, location, and timestamp persist;
- observation history is retained;
- invalid or non-positive prices are rejected;
- unrelated managers cannot alter/read protected leg-only fields beyond intended shared admin visibility.

### Route-suggestion tests

- manager proposal creates a pending request and does not alter the official route;
- manager can see their pending/rejected/approved requests;
- admin approval applies the validated official mutation;
- admin rejection leaves official route unchanged;
- stale proposal is detected/flagged;
- manager cannot approve their own official route suggestion.

### Manager UI tests

Planning:

- automatically scopes to authenticated leg;
- no manager/leg selector renders;
- Travel mode label replaces misleading Manager Map Mode copy;
- fuel-price update is available;
- direct operational updates can save;
- Suggest change produces pending state;
- pending suggestion is visually distinct from official route.

On the Road:

- own route only;
- navigation/next-stop actions remain prominent;
- quick mileage/fuel/fuel-price logging remains available;
- unapproved route suggestions are not treated as official navigation.

### Admin Routes tests

- Admin view retains full filters and all-leg planning capabilities;
- Manager preview requires selecting a manager/leg;
- preview renders only selected manager's allowed data;
- organization-wide filters are hidden/collapsed in preview;
- Planning / On the Road preview is available without changing manager permissions.

### Travel-leg editor tests

- cards are collapsed by default;
- collapsed summary shows name, access status, vehicle/resource summary;
- expand reveals every existing editable/access/archive feature;
- save behavior is unchanged;
- reorder remains available;
- archive/restore remains available;
- adding more than nine legs remains supported.

## Non-goals

This feature does not:

- allow managers to inspect another leg's route;
- allow managers to directly approve their own official route changes;
- introduce live GPS tracking;
- introduce a paid map/routing API;
- require a public gas-price data provider;
- remove any existing admin travel-leg capabilities;
- create a second manager app or database.

## Success criteria

A manager can open their portal and confidently participate in travel planning for **their own leg**: update real-world fuel/mileage/travel information, suggest itinerary changes, and use a simple On the Road view. They never need to select themselves and never gain visibility into another leg's route.

Admin can switch the Routes map between the full organization planning view and an accurate preview of an individual manager's private map experience.

The `Managers & travel legs` section is easy to scan by default, while every existing configuration feature remains accessible by expanding the relevant leg.