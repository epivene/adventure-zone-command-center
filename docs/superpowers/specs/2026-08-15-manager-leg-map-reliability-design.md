# Unified Manager/Leg Setup and Route Map Reliability

**Date:** 2026-08-15

## Goal

Make Routes match how Adventure Zone actually operates:

1. A travel leg and its manager are the same operational unit, so one name should control both.
2. A booking with a leg and a usable city/state, such as `Miles City, MT`, must not silently disappear from the route map when coordinates are missing or geocoding fails.

This change should simplify setup without creating a second source of truth for managers or locations.

## Current Problems

### Duplicate leg/manager configuration

Routes currently renders `Configure travel legs` and `Leg Manager Portal Access` as separate sections. Travel-leg names and manager names can therefore diverge even though legs are named for their managers.

### Silent map failures

The route backend already attempts to resolve locations in this order:

1. Saved coordinates.
2. Full booking address / venue address.
3. City and state.

However, if the geocoder returns no result or is unavailable, the resolver returns null coordinates. The event then has no map point, and the UI does not clearly tell the user why it was omitted.

## Design

## 1. One Manager/Leg Identity

Each travel leg has one canonical `name` field. That same value is used as:

- Travel leg name.
- Manager display name.
- Manager portal identity/label.
- Route legend and map label.
- Finance/receipt grouping label.
- Equipment assignment label.
- Trip and handoff leg label.

There is no separately editable manager-name field in the Routes setup UI.

Existing manager access records may continue to store a legacy `managerName` column for compatibility, but the application should derive/synchronize it from the travel-leg name. A leg rename must update the manager-facing name automatically so the two cannot drift apart.

## 2. Unified Manager/Leg Card

Replace the two separate Routes sections with one card per active leg/manager.

Each card contains:

- Manager / Leg name.
- Route color.
- Base address.
- Default vehicle.
- Default MPG.
- Assigned equipment/resources summary.
- Manager portal status: enabled / not configured.
- Password control: set password or change password.
- Sign out all manager devices.
- Archive action.

The page keeps shared controls for:

- Reordering legs.
- Adding a leg.
- Viewing/restoring archived legs.

Archived legs keep historical bookings and remain unavailable for manager portal access until restored.

### Save behavior

The travel-leg configuration remains the master record for name/color/base/vehicle/MPG.

Portal password changes remain a separate security mutation because passwords are write-only and should not be mixed into normal leg-detail persistence.

The UI can present these in one card while performing the correct underlying mutations independently.

A leg rename should not require the user to re-enter the portal password.

## 3. Route Map Location Resolution

A booking participates in route mapping when it has:

- A travel leg assignment; and
- At least one usable location source.

Location priority remains:

1. Valid saved latitude/longitude.
2. Full booking/venue address.
3. City + state/region.
4. City alone if state is unavailable.

Example: a Kristy booking with `Miles City` + `MT` and no coordinates should attempt to resolve `Miles City, MT` automatically.

## 4. Never Silently Lose a Booking

Every leg-assigned booking that has location text must appear in the Routes experience even if it cannot currently be plotted.

Map-capable events appear as normal markers.

Unresolved events appear in a visible `Location needs mapping` list directly associated with the map. Each row shows:

- Booking name.
- Manager/leg name.
- Location text that was attempted.
- Reason category: no result, geocoder unavailable, or missing usable location.
- `Retry location` action when retry is meaningful.
- Link to the booking so the address/city can be corrected.

The user should never have to infer that an event is missing because a third-party geocoder failed.

## 5. Retry and Cache Behavior

Successful geocodes may remain cached for efficiency.

Provider outages must not be cached as permanent failures.

A `no results` outcome may be cached temporarily, but the explicit Retry action must bypass or invalidate that failed cache entry so a corrected booking or improved query can be tried immediately.

If a booking location changes, its previous location resolution must be treated as stale and recalculated.

## 6. Map View Behavior

The existing Full / Confirmed / Potential / History and leg-focus behavior remains unchanged.

Unresolved bookings should respect the same route-view and leg-focus rules as mapped bookings:

- If the selected view hides the booking category, it is not shown in the unresolved list.
- If another leg is merely dimmed, its unresolved booking remains visible but visually subdued.

This keeps the map and the fallback list describing the same planning dataset.

## 7. Error Handling

The `/routes` endpoint should not fail the whole Routes page just because one location cannot be geocoded.

Each event returns its own mapping state.

Suggested mapping states:

- `mapped_coordinates`
- `mapped_address`
- `mapped_city`
- `needs_mapping_no_results`
- `needs_mapping_provider_unavailable`
- `needs_mapping_missing_location`

The frontend may display simpler user-facing labels while retaining specific states for diagnostics and retry behavior.

## 8. Data Flow

### Manager/leg

1. User edits `Manager / Leg name` on the unified card.
2. Travel-leg record is saved.
3. Manager access display identity is synchronized from that leg name.
4. Routes, finance, manager portal, trips, and resource labels all read the same canonical leg name.

### Location

1. Routes loads bookings from the booking table.
2. Saved coordinates are accepted immediately when valid.
3. Otherwise the backend builds the best available location query.
4. Geocoder attempts resolution.
5. Success returns coordinates plus quality.
6. Failure returns the booking with an explicit unresolved mapping state rather than removing it from the planning experience.
7. Retry requests a fresh lookup.

## 9. Compatibility

Do not rewrite booking data just to plot a city. Geocoded coordinates used for Routes may remain derived/cached unless the application already has an established safe mechanism for persisting verified coordinates.

Do not remove existing manager login/password/session-version security behavior.

Do not change the meaning of travel-leg IDs. Existing bookings, trips, equipment, finance records, and handoffs continue linking by leg ID.

## 10. Testing

At minimum, automated tests cover:

### Unified manager/leg setup

- Only one editable manager/leg name is presented per active leg.
- Renaming a leg changes the manager-facing display identity.
- Renaming a leg does not require or reset the existing password.
- Password set/change still works.
- Sign-out-all still invalidates manager sessions.
- Archived legs cannot use manager portal access until restored.
- Existing finance/equipment/trip references continue using the same leg ID after rename.

### Route mapping

- Valid saved coordinates map without geocoding.
- Full address is preferred over city/state.
- `Miles City` + `MT` generates a `Miles City, MT` geocode request and produces a marker on success.
- City-only location can still be attempted.
- No geocoder result returns an explicit unresolved event instead of silently dropping it.
- Provider outage returns an explicit retryable unresolved state and is not cached permanently.
- Retry bypasses a failed lookup cache.
- Editing location causes a fresh lookup.
- A failed lookup for one booking does not fail the whole `/routes` request.
- Unresolved bookings obey Full / Confirmed / Potential / History and selected-leg emphasis behavior.

## Acceptance Criteria

The change is complete when:

- Routes no longer shows separate `Configure travel legs` and `Leg Manager Portal Access` sections.
- A manager/leg has one editable name that controls both identities everywhere.
- Existing portal passwords and session security continue working.
- A leg-assigned booking with `Miles City, MT` can be plotted without manually entering coordinates when the geocoder succeeds.
- If that lookup fails, the booking remains visibly represented as `Location needs mapping` with a retry/correction path.
- No unrelated Leg Manager finance, receipt, trip, handoff, or booking functionality is removed.