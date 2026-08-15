# Leaflet Manager Route Map Redesign

Date: 2026-08-15
Status: Approved product and architecture direction; pending written-spec review

## Goal

Replace the current embedded route map with a free, operationally useful map focused on Adventure Zone route planning and manager travel. The new map must be clear, U.S.-focused, marker-first, mobile-friendly, and able to launch Google Maps directions without requiring a paid Google Maps API integration.

## Core product decision

Use a free embedded map stack based on **Leaflet** with a configurable free tile source. Do not embed Google Maps or require a Google Maps JavaScript API key. Google Maps is used only through standard directions URLs when a manager explicitly chooses navigation.

The existing booking/trip/leg/handoff data and filtering logic remain the source of truth. This redesign replaces the map presentation/runtime, not the route-planning business rules.

## Default geographic scope

The app currently operates from the Utah area, so the map should not default to a world or continent view.

- With no explicit event, trip, or leg focus, open to a useful **Utah regional view** showing Utah and nearby surrounding states.
- Prefer a configured current base location when usable coordinates are available from the active travel-leg/base data.
- If no configured base coordinates are available, use a stable Utah regional fallback rather than guessing a street-level base location.
- `Reset view` returns to the current base/Utah regional view.
- Normal map interaction should be constrained so users cannot accidentally zoom far out to a whole-world view.
- Alaska/Hawaii do not need to be included in the default framing; the map may still navigate to them if future data requires it.

## Basemap requirements

The embedded map is for operational route planning, so readability is more important than decorative terrain.

The chosen tile presentation must clearly expose:

- U.S. state boundaries;
- state names;
- city/town labels;
- major roads and highways;
- enough local road detail when zoomed into an event;
- geographic context without heavy terrain styling obscuring route markers.

The tile provider must be configurable so the app is not permanently coupled to one public free endpoint. Proper attribution must remain visible. No paid provider may be required for normal map use.

## Manager mode toggle

Add an explicit two-state manager map toggle:

- **Planning**
- **On the Road**

The manager's last selected mode is remembered on that device/browser. A manager returning to the portal should resume their last mode rather than always being reset.

If no remembered value exists, default to **Planning**.

## Planning mode

Planning mode treats the map as a route/budget workspace.

It should emphasize:

- selected leg and route coverage;
- event sequence;
- trip stop order;
- total/segment distance and drive-time context already available in the trip system;
- fuel/gas estimates already supported by trip planning;
- nearby other-leg context for potential equipment handoffs;
- confirmed vs potential event state;
- filters for season, route view, state, and date.

Selecting a leg such as Kristy fits that leg's primary mapped events while other otherwise-in-scope legs remain visible but dimmed.

Planning actions should not unexpectedly launch external navigation.

## On the Road mode

On the Road mode treats the map as an active travel/navigation assistant.

It should:

- focus more tightly than Planning mode;
- make the active/current and next destination visually obvious where trip context exists;
- retain event and trip details;
- expose direct navigation actions prominently;
- avoid replacing the trip/booking data model with GPS state.

The app does not need to provide native turn-by-turn navigation. It hands navigation off to Google Maps.

## Event markers

Replace subtle circle markers with obvious event pins/markers.

Each mapped event marker should:

- use the travel leg's color;
- be visually distinct from equipment handoff markers;
- have a stronger selected/focused state;
- remain visible above route lines;
- be large enough to tap comfortably on mobile.

Clicking/tapping an event marker opens a compact event popup/card containing at minimum:

- event/booking name;
- city and state;
- event date/date range;
- travel leg;
- booking/route status;
- booking-detail action;
- directions action when location data is usable.

## Directions behavior

Directions use a normal Google Maps directions URL rather than an embedded Google API.

For a standalone event:

- show **Directions to event**;
- destination should use event coordinates when available, otherwise a usable event address/location string;
- leave origin unspecified so Google Maps can use the manager/device's current location.

For an event that belongs to an active trip:

- On the Road mode may make **Navigate to next stop** the primary navigation action;
- retain a normal **Directions to event** option when appropriate;
- provide **Open full trip route** when the existing ordered trip stops can be represented in the external directions URL.

Navigation links must open in the Google Maps app when the device/browser supports it, otherwise in Google Maps on the web.

No Google API key is required for these URL actions.

## Trip route rendering

Actual trip routes should be represented from the existing trip model.

- Use trip start, ordered mapped stops, and trip end.
- Draw a visible route polyline connecting the ordered route points for planning context.
- Do not synthesize a trip from a single booking.
- Selecting/focusing a trip fits the mapped route/stops.
- Stop markers should communicate route order where practical.
- Existing routing/drive-time/fuel estimation remains authoritative; Leaflet rendering does not replace route estimation services.

## Viewport priority

Use one deterministic priority for map framing:

1. explicitly focused event;
2. active/selected trip;
3. focused travel leg and current filters;
4. current filtered planning set across all legs;
5. configured current base location / Utah regional default.

Behavior by target size:

- one mapped event -> center at useful city/event zoom;
- multiple mapped events/stops -> fit bounds with mobile-friendly padding;
- no mapped matches -> retain meaningful regional position and show a clear empty/mapping state;
- do not fall back to a whole-world viewport.

## U.S. bounds and map interaction

The normal operational map should remain centered on U.S. route work.

- Configure practical maximum bounds around the United States with enough margin for normal panning.
- Prevent zoom levels that expose an irrelevant whole-world view.
- The bounds are a usability constraint, not a business-rule filter: if future route data legitimately lies outside the lower 48, the design can be expanded deliberately.

## Existing route filters

Preserve the recently added route-scope behavior:

- Full / Confirmed / Potential / History;
- season/year;
- leg focus;
- state;
- overlap-after / overlap-before dates;
- active scope summary;
- zero-match feedback;
- Location needs mapping feedback.

Changing filters must update both visible markers and the viewport target.

The map-library replacement must not regress these behaviors.

## Handoff markers

Equipment handoffs remain separate from events.

- Keep suggested and approved handoffs visually distinct from event pins.
- Handoffs must not look like bookings.
- In focused-leg planning, handoffs and nearby other-leg context may remain visible without unnecessarily widening the primary route fit.

## Component architecture

Split the current map responsibility into focused units rather than continuing to grow one large component.

### `manager-route-map-shell`

Responsible for:

- Leaflet map creation/destruction;
- tile layer;
- U.S./Utah bounds;
- viewport application;
- map resize/runtime concerns.

### `manager-route-map-layers`

Responsible for:

- event markers;
- trip polylines/stops;
- handoff markers;
- selected/dimmed visual states;
- popup content hooks.

### `manager-map-mode`

Responsible for:

- Planning / On the Road toggle;
- remembering the manager's last mode locally;
- mode-specific action emphasis.

### Existing `EventMap` orchestration

The existing route filtering/business pipeline may remain the orchestration layer initially, but should delegate Leaflet runtime/rendering to the new focused components. Avoid changing API contracts unnecessarily.

## Local persistence

Remember the manager map mode in browser storage using a versioned, namespaced key such as:

`adventure-zone.manager-map-mode.v1`

Accepted persisted values are only `planning` and `on-road`. Invalid/missing values fall back to `planning`.

Do not store booking/trip state in this preference.

## Free-operation constraint

Normal map use must not depend on a paid mapping subscription.

- Leaflet is the embedded map library.
- Tile URL/attribution is configurable.
- Use a free tile source that permits this usage and display required attribution.
- Google Maps is only opened through standard directions URLs.
- No Google Maps JavaScript API, Places API, Directions API, or billable Google Maps SDK is required for this release.

If usage eventually exceeds what a public free tile provider reasonably supports, the tile provider can be swapped/self-hosted without replacing Leaflet or route logic.

## Failure handling

- If a booking has no usable coordinates, preserve **Location needs mapping** and its retry flow.
- If map tiles fail to load, keep route/event cards and Google Maps directions actions usable.
- If only some trip stops are mapped, show available mapped stops and clearly preserve incomplete-route messaging from the trip system.
- A failed embedded map must not prevent managers from opening booking details or Google Maps directions.

## Testing

Add regression coverage for at least:

- no focus -> Utah/base regional viewport, not world view;
- reset -> Utah/base regional viewport;
- one Miles City event -> clear event marker and city-level focus;
- selecting Kristy -> Kristy primary markers fit while other legs remain dimmed;
- route filters alter marker set and viewport target;
- Planning/On the Road toggle works;
- selected mode persists and is restored from browser storage;
- invalid persisted mode falls back to Planning;
- event popup exposes booking details and Directions;
- Google Maps directions URL uses event coordinates/address and no API key;
- trip focus fits ordered mapped route points;
- On the Road trip context exposes Navigate to next stop;
- zero matching events does not zoom to the world;
- unmapped events preserve Location needs mapping;
- handoff markers remain distinct from event pins;
- existing date-overlap filtering remains unchanged.

## Migration approach

This is a presentation/runtime replacement, not a database migration.

- Remove MapLibre-specific runtime code from the Routes event map once Leaflet parity is established.
- Keep existing route API payloads where sufficient.
- Add trip detail fetching only where needed for route focus/navigation actions.
- Keep existing trip distance, routing, gas, and handoff calculations intact.
- Avoid changing booking/leg/trip persistence merely to support the new map.

## Out of scope

- Native turn-by-turn navigation inside Command Center.
- Continuous manager GPS tracking.
- Automatically determining that a manager has physically arrived at an event.
- Paid Google Maps APIs.
- Replacing existing route optimization, mileage, fuel, booking, or handoff business logic.
- Automatically constructing trips from unplanned bookings.

## Success criteria

The redesign is successful when the Routes experience opens around the Utah/base region by default, clearly shows state/road/city context, renders obvious leg-colored event pins, reliably focuses selected events/legs/trips, remembers Planning vs On the Road mode, and lets a manager open Google Maps directions or next-stop navigation without requiring a paid mapping API.
