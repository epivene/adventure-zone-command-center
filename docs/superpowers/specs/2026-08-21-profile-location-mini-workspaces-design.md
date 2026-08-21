# Profile Location Mini-Workspaces Design

## Goal
Make Profile Locations visibly preserve their own contacts, notes/history, bookings, and follow-ups while still rolling up under one Profile.

## Existing backend capability
The database already stores `organization_location_id` on contacts, bookings, follow-ups, activities, and call sessions. The location repository already exposes full location detail including contacts, bookings, follow-ups, and activities, and location-scoped notes have their own CRUD endpoints. No schema migration is required.

## User-facing behavior
A Profile with saved Locations gets a **Locations** section on the main Profile page.

- The section lists each saved location with city/state and compact status context.
- Opening a location loads its full location detail.
- Each expanded location behaves like a mini-profile and shows venue/address/contact details, Contacts, Notes, History, Bookings, and Follow-ups assigned to that location.
- The parent Profile remains the all-locations roll-up view.
- Copy explicitly explains that location-specific records remain attached to their location rather than being flattened together.

## Data safety
This is primarily a presentation of already-attributed records. It does not move or reassign existing contacts, notes, bookings, follow-ups, activities, or calls. Adding/editing/deleting a location note uses the existing scoped-note endpoints for that location.

## Event Family distinction
- **Profile Location** = one CRM relationship, multiple places, location-specific history.
- **Event Family** = related but separate Profiles with separate histories.

## Non-goals
- New database tables or migrations.
- Automatically assigning currently-unassigned records to a location.
- Merging Event Family member profiles into Profile Locations.
- Rebuilding the full parent Profile page around locations.
