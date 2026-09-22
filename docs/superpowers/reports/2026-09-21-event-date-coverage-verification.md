# Event Date Coverage Verification

Date: 2026-09-22

## Outcome

The feature-specific schema, migration, resolver, recurrence, research safety, repository, queue, owner API, admin UI, profile display, CSV, assistant context, and operational-isolation checks pass. Repository-wide checks remain blocked by known stale-checkout failures unrelated to event-date coverage; those failures are recorded below rather than hidden.

## Passing evidence

- DB schema and migration: 2 files, 6 tests. The migration ran twice against PGlite and preserved the seeded organization and booking.
- API coverage/research/read models: 18 files, 80 tests when the two tests that require a configured `DATABASE_URL` are included in their configured rerun.
- Frontend coverage/profile UI: 3 files, 8 tests.
- API typecheck passed after the Task 6 queue implementation; later checks show no event-date-coverage diagnostics.
- Frontend Vite production build passed and emitted `EventDateCoveragePage` as a lazy chunk.
- Operational isolation: 7 assertions verify researched facts are absent from calendar, operational calendar, map, route, and manager-map sources.
- Query-count protection: a 100-profile coverage page performs exactly three bulk reads.
- Booking preservation regression: applying a researched date leaves historical booking timestamps byte-for-byte unchanged.
- Post-review integrity suite: 5 files, 27 tests pass for lease ownership/cancellation, atomic fact application, internal evidence trust, and merge-safe event-date history. Three configured research/repository suites add 8 passing tests.

## Post-review integrity hardening

- Worker completion, failure, and lease renewal are compare-and-set operations constrained by item status, lease owner, and unexpired lease. Cancelled runs cannot be changed back to complete by an old worker.
- Internal fact application and item completion occur in one transaction while the coverage-item lease row is locked. Public research results lock and validate that same lease row before sources or suggestions are persisted, so expired, cancelled, or reclaimed workers cannot commit results.
- Dates parsed from free-form profile activity are unverified clues and create review records; they are never auto-promoted to confirmed dates.
- A newly inferred date locks and checks the active fact in the same transaction; a conflict creates a review record instead of silently superseding the active fact.
- Organization merges reparent event-date facts and coverage items before duplicate deletion. Conflicting active facts are retained as inactive review records; duplicate items in the same run have their operational history folded into the surviving item.

## Repository-wide checks

| Command | Result |
| --- | --- |
| `pnpm run typecheck` | Blocked before artifact typechecks by missing `artifacts/avz-crm/scripts/build-tokens.mjs` in the cached checkout. |
| `pnpm -r --if-present run test` | Failed in unrelated existing suites: Today renewals/call queue/copilot, profile email compose, manager year-end inspection, and unrelated slow PGlite migrations. Feature-targeted suites pass. |
| `pnpm -r --if-present run build` | Blocked by the same missing AVZ token-build script. |
| `pnpm --filter @workspace/adventure-zone build` | Passed. |

The runtime is Node 24 while the repository declares Node 22; every command recorded that engine warning.

## Migration safety

`event-date-coverage-migration.pglite.test.ts` seeds a historical booking, captures its dates and row counts, applies `20260921_event_date_coverage.sql` twice, and asserts the original organization and booking are unchanged. With a 20-second test timeout, the two migration files pass all six assertions.

## Operational boundary

Only `bookings` feed Schedule, calendar sync, maps, route planning, manager operations, booking counts, and booking exports. `event_date_facts` is referenced by informational profile, coverage, research, and assistant-context modules only. A researched expected date therefore cannot create a calendar event, map marker, route stop, or operational booking count. The automated guard is a source-boundary regression check; it is not a substitute for the remaining deployment-environment smoke test.

## Manual/browser status

Automated route and component tests cover Admin Tools navigation content, coverage totals and filters, booked/confirmed/expected/needs-review/missing labels, selection, default batch size 25, progress polling, retry, evidence links, and review actions. A live browser/database smoke test was not available in this isolated checkout and remains a deployment-environment check.
