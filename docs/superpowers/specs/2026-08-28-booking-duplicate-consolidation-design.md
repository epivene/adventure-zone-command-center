# Booking Duplicate Consolidation Design

## Goal
Treat one event profile/booking as the canonical source of truth while safely retiring exact duplicate booking records without losing historical data.

## Canonical event identity
Two booking records are consolidation candidates when they match on normalized event name, city, region, start business-date, and end business-date. Travel leg and booking status are not part of identity because they are bookkeeping state, not event identity.

## Canonical record selection
Within an exact-duplicate group, prefer the record with the strongest booking status, then the most recently updated record, then the stable lowest id as a deterministic tiebreaker. Status priority follows the existing calendar dedupe priority with confirmed/contract states above contacted/research/new-lead states.

## Non-destructive retirement
Add `consolidatedIntoId` and `consolidatedAt` to bookings. Duplicate rows are not physically deleted. They are retired into the canonical booking so every original foreign-key relationship remains valid and historical ACT/import provenance is preserved.

## Active follow-up rule
A consolidation group may have only one active follow-up. The best active follow-up is moved to the canonical booking when necessary; all other open follow-ups in retired duplicates are completed with outcome `Merged into canonical booking` and retained as history.

## Reads after consolidation
Bookings, calendar/map queries, Today queues, and other active-booking lists exclude retired bookings. Opening the canonical booking/profile includes follow-ups and timeline activity from the canonical booking plus bookings retired into it, so historical calls/notes remain visible in one place.

## Automatic cleanup
A safe idempotent consolidation routine scans only exact duplicate groups using the identity above. It never merges different dates or different cities/regions. The routine runs transactionally per group and records an audit entry on the retired booking identifying the canonical booking.

## Error handling
If any group cannot be consolidated safely, that group rolls back and remains unchanged. Other groups may continue. No partial retirement is allowed within a group.

## Testing
Tests cover identity grouping across differing travel legs/statuses, canonical selection, one active follow-up after consolidation, retired-booking exclusion from lists/calendar, and canonical detail aggregation of retired history.
