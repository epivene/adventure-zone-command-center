# Manager-Scoped Route Maps Design

## Goal

Give leg managers useful route awareness in both **Manager Events** and **Manager Route / Operations** without exposing other legs' routes, bookings, or travel patterns.

The manager map is private-by-default: a manager sees their own leg's operational geography plus only the meetup points that are assigned to their leg.

## Approved product rules

1. The manager's authenticated leg is the automatic primary scope. Managers do not choose another leg from an admin-style selector.
2. The same manager-scoped mapping rules apply in both:
   - **Manager Events**: compact event-oriented map.
   - **Manager Route / Operations**: larger operational map with route/trip context.
3. A manager sees their own leg's events, trip stops, route geometry, and relevant navigation information normally.
4. Other legs' routes and event markers are **not shown at all**.
5. The only cross-leg geography a manager may see is an assigned meetup/handoff point involving their leg.
6. At a cross-leg meetup, the manager may see the other leg's name, e.g. `Meet Hulk — Paintball trailer`, but not the other leg's path before or after the meetup.
7. Equipment swaps can be assigned either to:
   - another Adventure Zone leg; or
   - an outside person / third-party runner.
8. Outside-person swaps must not require creating a fake travel leg.
9. A meetup involving an outside person can expose the person's name and the contact/navigation information needed to complete the handoff, but nothing unrelated.

## Privacy and authorization boundary

Privacy is enforced at the server/API layer, not by merely hiding data in the browser.

Manager-facing endpoints must not return other legs' booking coordinates, trip stops, route lines, or event metadata. The manager client receives only:

- the authenticated leg's events and trip/route data;
- meetups where the authenticated leg is a participant;
- minimal counterpart identity needed for the meetup:
  - other leg name for leg-to-leg swaps; or
  - outside runner identity/contact fields for external-participant swaps.

The browser therefore cannot reconstruct another leg's route from hidden payload fields.

## Shared manager map architecture

Use one shared manager-scoped map data model and rendering layer, with two presentation variants.

### `ManagerScopedMapData`

Conceptually contains:

- `leg`: authenticated manager leg identity and color;
- `events`: only events assigned to that leg;
- `trips`: only trips assigned to that leg;
- `meetups`: only meetups involving that leg;
- `counterparty`: minimal display metadata for each meetup.

### Events presentation

The Manager Events screen embeds a compact map near the event list.

Behavior:

- automatically fits the manager's relevant events;
- own-leg event pins are full-color and interactive;
- selecting an event from the list focuses its marker;
- marker popup can show event name/date/location and Directions;
- assigned meetups within the relevant time scope appear as emphasized meetup markers;
- no other-leg path, event pin, or generalized context geometry appears.

### Route / Operations presentation

The Manager Route / Operations screen uses the larger operational version.

Behavior:

- renders the manager's own route/trip geometry and ordered stops;
- supports the existing Planning / On the Road modes;
- preserves mileage, drive-time, fuel, trip-stop, and navigation context already available to the manager;
- assigned meetups are emphasized and included in operational navigation;
- other-leg geometry is never drawn.

## Meetup participant model

Meetups need an explicit participant abstraction so they can represent both leg-to-leg and leg-to-external swaps.

Recommended shape:

```ts
type MeetupParticipant =
  | {
      kind: "leg";
      legId: string;
      legName: string;
    }
  | {
      kind: "external_contact";
      externalContactId: string | null;
      displayName: string;
      phone: string | null;
      email: string | null;
    };
```

A meetup has two participants. At least one participant must be an Adventure Zone leg. For manager visibility, the authenticated manager's leg must be one of the two participants.

This avoids overloading `fromLegId` / `toLegId` with fake identifiers and leaves room for a family member, employee driving separately, contractor, tow service, or other runner.

## Meetup display behavior

### Leg-to-leg example

`Meet Hulk — Paintball trailer`

May show:

- other leg name;
- equipment/resource;
- meetup location;
- scheduled time window;
- status;
- Directions.

Must not show:

- the other leg's event list;
- the other leg's route line;
- previous/next stops for the other leg;
- unrelated booking/contact details.

### External-person example

`Meet Jordan Smith — Paintball trailer`

May show:

- runner name;
- phone/email when entered and operationally appropriate;
- equipment/resource;
- meetup location;
- scheduled time window;
- status;
- Directions.

No external person's unrelated profile/contact history is exposed through the map.

## Admin setup/editing

Admin route/handoff tooling must support choosing the counterpart type when creating or editing a swap:

1. **Adventure Zone leg** — choose another leg.
2. **Outside person / runner** — choose an existing contact where appropriate or enter a lightweight runner identity/contact record.

The design should not force admins to create a full CRM contact for a one-off runner unless they want to.

Validation:

- meetup must include the manager leg plus one counterpart;
- external participant requires a display name;
- location/time remain required according to existing handoff rules;
- counterpart can be changed between leg and external before completion;
- completed/audited handoffs retain the participant identity used at the time.

## Navigation

No paid Google Maps API is introduced.

Directions continue to use standard Google Maps URLs.

- Own event: Directions to event.
- Own trip: next-stop/full-route navigation according to the existing manager mode.
- Assigned meetup: Directions to meetup.

The manager never receives a Google Maps route built from another leg's stops.

## Data-flow changes

### Server

Add/adjust manager-scoped read endpoints so the server derives the authenticated `legId` from the manager session and queries only permitted data.

Do not accept an arbitrary `legId` from a manager client as authority for map scope.

Meetup reads should return only meetups where that authenticated leg participates, with a minimal normalized counterpart object.

### Client

Both manager screens consume the shared manager-scoped map payload. The reusable map rendering code receives already-authorized data and does not need to filter other legs out defensively.

Admin Routes remains a separate broader operational/admin view and may continue to show all legs according to admin permissions.

## Failure behavior

- If the manager leg has no mapped events, show the Utah/base-region fallback and a clear empty-state message instead of a world view.
- A manager event missing usable coordinates stays in the existing needs-mapping flow where manager permissions allow it, or is omitted from the map with an explanatory list state.
- A meetup missing coordinates should be labeled as needing location setup and must not reveal counterpart route data as a fallback.
- Tile-provider failure must not hide the event list, trip information, meetup details, or Directions actions.

## Testing

### Authorization tests

- manager A cannot retrieve manager B's event coordinates;
- manager A cannot retrieve manager B's trip stops/route geometry;
- manager A can retrieve a meetup shared with manager B;
- shared meetup exposes manager B's leg name but not manager B's path;
- manager can retrieve an assigned external-runner meetup;
- unrelated external/leg meetups are not returned.

### Data-model tests

- leg-to-leg participant pair validates;
- leg-to-external participant pair validates;
- external participant requires a display name;
- two external participants are rejected because an Adventure Zone leg must participate;
- completed meetup preserves participant identity in audit/history.

### UI tests

Manager Events:

- only own-leg event markers render;
- assigned meetup renders;
- no other-leg event/route geometry renders;
- event focus synchronizes list and map.

Manager Route / Operations:

- own route and ordered stops render;
- Planning / On the Road behavior remains intact;
- assigned leg meetup shows the other leg name but no other-leg route;
- assigned external meetup shows runner identity/contact details as allowed;
- Directions target the event/trip/meetup only.

## Non-goals

This feature does not:

- expose general other-leg context to managers;
- add live GPS tracking of another leg or outside runner;
- add a paid routing/map provider;
- replace the admin all-legs Routes view;
- create a separate manager database or app.

## Success criteria

A leg manager can open either Events or Route / Operations and immediately understand **their own route and obligations**. If an equipment exchange is scheduled, they see the exact meetup and who they are meeting—another named leg or an outside runner—without gaining visibility into anyone else's route.
