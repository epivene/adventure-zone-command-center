# Place-Person relationship operations

## Invariants

- Every non-null Person primary Place pointer has an active Place-Person row.
- One Place-Person row exists per pair.
- A Place has at most one active primary Person.
- Every Booking primary Person has a primary Booking-Person row.
- Every Booking Person has an active relationship with the Booking Place.

## Legacy exceptions

Run the read-only relationship reconciliation before the Act! migration.
Bookings without a Place remain visible in `legacyBookingsWithoutPlace`.
Do not invent a Place, merge People, deactivate relationships, or delete
records automatically. Review each returned ID in the application before a
separately approved correction.

## Release gate

The relationship slice is ready only when the migration preservation test,
repository tests, reconciliation tests, the full unit suite, lint, typecheck,
and production build pass. In a production data rehearsal, every exception is
either corrected through reviewed application actions or recorded in a visible
review queue for the next slice.
