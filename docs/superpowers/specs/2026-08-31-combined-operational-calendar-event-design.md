# Combined Operational Calendar Event Design

**Date:** 2026-08-31  
**Status:** Approved in chat  
**Scope:** Adventure Zone Command Center → Dave's connected Google operational calendar

## Problem

The operational calendar sync currently renders one Google Calendar event per package. A booking with Zone and Pirates therefore appears twice even though it is one physical event. On crowded mobile month views, those extra rows hide other bookings behind Google's overflow indicator and look like accidental duplicates.

The desired model is one booking, one Google Calendar event. Every assigned package must remain visible in both the title and the event details.

## User-visible behavior

A confirmed booking with multiple packages produces one all-day Google event covering the complete reserved operational window.

Example title:

```text
KRISTY Meeteetse Annual Labor Day Celebration 2026 - Meeteetse WY (Zone + Pirates)
```

The description retains the existing Dave-calendar format:

```text
CONTACT: ...
EVENT DATES: ...
EVENT ADDRESS/MAILING: ...
ATTRACTION LIST: Adventure Zone + Pirate's Rebellion
ADDITIONAL INFO: ...
PAYMENT INFO: ...
INVOICE SENT: ...
CONTRACT SIGNED: ...
DEPOSIT RECEIVED: ...
AMOUNT DUE UPON ARRIVAL: ...
```

Only fields with real values are included. The event is always written to the single Google calendar configured as Dave's operational calendar. The user is not asked to choose a destination calendar during each send.

Sending again updates the same combined event. Package additions or removals update its title and attraction list instead of creating or deleting package-specific rows.

## Package ordering and labels

Package keys use one stable display order:

1. Zone
2. Pirates
3. Warrior

The title uses the compact labels `Zone`, `Pirates`, and `Warrior`. The `ATTRACTION LIST` line continues to use the package template names already loaded by the booking projection, such as `Adventure Zone`, `Pirate's Rebellion`, and `Weekend Warriors`.

Duplicate package selections are collapsed before rendering.

## Data model

Add `combined` to the operational calendar link package-key domain and database check constraint. A combined link represents the one Google event owned by a booking, regardless of how many packages are currently assigned.

The existing unique constraint on connection, calendar, booking, and package key then guarantees at most one `combined` link per booking. Existing `zone`, `pirates`, and `warrior` link rows remain readable for backward compatibility and legacy conversion.

The combined link's `lastAppSnapshot` records the ordered package-key list alongside the rendered summary, description, and dates. This makes package changes visible to conflict and review logic without adding another table.

## Rendering

Replace the one-row-per-package renderer with a one-row-per-booking renderer.

The rendered result contains:

- link key: `combined`
- ordered package keys
- combined title
- existing description fields
- reserved start and end dates

A booking still requires at least one recognized package before it can sync.

## Sync behavior

For a confirmed booking:

1. Build one combined calendar input.
2. Look for an existing `combined` link for the booking.
3. If found, update that Google event.
4. If not found, inspect legacy links for the same booking.
5. If a usable legacy link exists, promote one deterministic link to `combined` and update its Google event in place.
6. If no link exists, search Dave's calendar for one exact combined title/date match and adopt it.
7. Only when no safe link or exact match exists, create one new Google event.

If multiple exact combined events already exist, create a review and do not create another event.

A deleted linked Google event continues through the existing missing-event review path. The sync does not silently recreate an event the user deliberately deleted.

## Legacy package rows

The first sync after deployment may encounter multiple legacy package links for one booking. The service promotes one link deterministically, preferring the oldest valid linked event, and stops using the other package-specific links for future writes.

The service does not automatically delete extra legacy Google events. Calendar deletion is destructive and the existing rows may contain manual edits. They remain available for the owner to remove after verifying the new combined row. No new package-specific rows are created after this change.

For Meeteetse, where the extra row was already removed manually, the remaining linked event is promoted and updated in place rather than creating another copy.

## Import and round-trip behavior

The Dave-calendar parser must recognize multiple package labels in a trailing title group, including separators such as `+`, `,`, `&`, and `and`.

Example:

```text
(Zone + Pirates + Warrior)
```

The parsed model exposes an ordered `packageKeys` array. Legacy single-package titles still produce a one-item array and remain supported.

When importing a combined calendar event, the import service:

- assigns every recognized package to the matched booking,
- saves or updates one `combined` link,
- preserves the existing event/profile matching and review safeguards,
- sends unknown or partly unrecognized package lists to review rather than guessing.

## UI feedback

The existing Send button remains a single action. Successful feedback says the booking was sent or updated as one calendar event and may include the package count. It must not imply that one event is created per package.

## Error handling and safety

- Missing confirmed status, dates, leg, or packages remains an incomplete-booking result.
- An unavailable Google connection remains a not-connected result.
- Exact-match adoption requires matching normalized title, reserved start, and reserved end.
- Ambiguous matches create a review and never create another copy.
- Conflicting ETags or manually changed linked events keep using the existing review flow.
- Legacy events are never deleted automatically.

## Testing

Automated coverage must prove:

1. Two or three packages render exactly one calendar row.
2. The combined title uses stable package ordering.
3. The attraction list retains all package template names.
4. A second send updates the same combined Google event.
5. A package change updates the existing event without creating another.
6. One exact unlinked combined event is adopted.
7. Multiple exact matches create review instead of another event.
8. A legacy package link is promoted to combined without creating a new Google event.
9. The parser reads combined and legacy single-package titles.
10. Import assigns all parsed packages to one booking.
11. Incomplete bookings and missing connections retain their current behavior.

The focused API tests, database migration tests, parser tests, renderer tests, and frontend Send-button tests must pass before merging.

## Out of scope

- Choosing a different destination Google calendar for each send
- Automatically deleting historical package-specific Google events
- Changing Google Calendar's mobile month-view overflow behavior
- Changing the booking's public dates or operational travel/setup window
