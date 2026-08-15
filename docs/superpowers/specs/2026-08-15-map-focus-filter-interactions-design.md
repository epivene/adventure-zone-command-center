# Map Focus and Filter Interactions Design

Date: 2026-08-15
Status: Approved interaction design; pending written-spec review

## Goal

Make the Routes map behave like an active planning tool instead of a passive background. The map should automatically focus on the currently emphasized route/event set, make filters visibly meaningful, and preserve nearby-leg context for equipment and handoff planning.

## Current behavior to correct

The map can now render its basemap and mapped events, but the camera may remain at continent-level zoom even when only one mapped event is relevant. Filters can update state without producing an obvious viewport change, making them appear ineffective. Selecting a leg should focus that leg without removing useful nearby context.

## Focus model

Leg focus uses contextual emphasis, not strict hiding.

- Selecting a leg such as **Kristy** makes that leg the primary focus.
- Events and route lines belonging to other legs remain visible when they are otherwise in scope, but they are dimmed.
- The viewport fits the primary/focused leg's mapped events and route geometry rather than fitting all dimmed context.
- Nearby dimmed legs remain useful for seeing handoff and shared-equipment opportunities.

## View-mode behavior

The existing **Full / Confirmed / Potential / History** modes continue to control emphasis, but each mode change also recalculates the viewport target.

- **Full:** fit the active primary planning set.
- **Confirmed:** fit confirmed primary events; potential/context events may remain dimmed where appropriate.
- **Potential:** fit potential primary events; confirmed/context events may remain dimmed where appropriate.
- **History:** fit the matching historical season/year events.

The camera follows the emphasized set, not every dimmed contextual marker.

## Filter behavior

State and date filters are real planning filters and must visibly affect both the event result set and the map viewport.

- **State:** filters the primary planning set to the selected state.
- **Overlaps after / before:** use the existing interval-overlap semantics for multi-day events.
- Applying or changing a filter immediately recomputes the primary map set and refits the viewport.
- Resetting filters restores the broader primary set and refits again.
- If a filter does not reduce the current one-event dataset, the selection summary still makes the active filter explicit so the user can tell it is applied.

## Selection summary

Show a concise current-scope summary near the map, for example:

**Showing Kristy · Confirmed · 2026 · MT**

Only active dimensions need to be shown. Include a clear reset action that restores the default route scope.

## Event-card interaction

Mapped event cards become map navigation controls in addition to links to booking details.

- Clicking/tapping a dedicated **Focus on map** affordance on an event card centers the map on that event at useful city/event zoom.
- The booking title remains available for opening the booking detail page.
- Focusing an event does not mutate filters or booking data.

## Trip/route interaction

When actual trips exist:

- Selecting/opening a trip from the Routes planning area should fit the trip's full route geometry/stops.
- Trip focus has higher viewport priority than the generic event-set fit while that trip is selected.
- Clearing trip focus returns the camera to the current leg/view/filter scope.

No synthetic route line is created when only one event exists. A single mapped event should instead center at useful city-level zoom.

## Viewport priority

Use a deterministic viewport priority so camera updates do not fight each other:

1. Explicit event focus.
2. Explicit trip focus.
3. Focused leg + current view/filter primary set.
4. Current view/filter primary set with All Legs.
5. If exactly one mapped primary event remains, center on it at city/event zoom.
6. If multiple mapped primary events remain, fit their bounds with reasonable padding and a maximum zoom.
7. If no mapped primary events remain, do not leave a misleading continental view; show a clear no-results state.

Dimmed context markers do not expand the fit bounds unless they are part of the primary set.

## Zero-result and unmapped states

- If filters produce zero matching route events, show **No matching route events** near/in the map area.
- Preserve the current **Location needs mapping** section for events that match the planning scope but lack usable coordinates.
- A zero mapped-result state should explain whether there are no matching events versus matching events that still need mapping.

## Map data flow

Keep one canonical event/filter pipeline:

1. Start with route events from the existing Routes API.
2. Apply state/date filters.
3. Apply season and route-view classification.
4. Calculate primary versus dimmed contextual emphasis.
5. Build GeoJSON from mapped events.
6. Derive a separate viewport target from the **primary** mapped events/trip/event focus.
7. Update map source data and refit/center after relevant state changes.

Viewport calculation must not depend on basemap loading after the route overlay sources are installed.

## Testing

Add focused regression coverage for:

- one Miles City event produces a city-level center target;
- selecting Kristy fits Kristy's primary event set while other legs remain dimmed;
- Confirmed/Potential/History changes alter the primary viewport set correctly;
- state/date filters change the viewport target and displayed result count;
- reset returns the broader viewport set;
- event-card focus centers on the chosen event;
- zero matching events produce the explicit no-results state;
- dimmed contextual legs do not widen primary fit bounds;
- existing multi-day overlap filtering remains correct.

## Out of scope

- Automatically creating trips from a single booking.
- Hiding all non-focused legs when a leg is selected.
- Route optimization changes.
- Changing booking status, leg assignment, or handoff approval logic.
- Receipt workflow changes; receipt improvements will be handled separately.

## Success criteria

The Routes map is successful when selecting a leg, view mode, state, or date filter produces an immediate and understandable change in the map focus; a single Miles City event automatically appears at useful local zoom; nearby other-leg context remains dimmed but visible; and the user can deliberately focus an event or trip without losing the broader planning context.