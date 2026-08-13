# Contact ZIP-only caller-finder remediation report

## Root cause

`DrizzleContactRepository.findCallerCandidates()` already includes
`contacts.postal_code ILIKE pattern` in the typed query predicate. It did not,
however, project that match into `CallerFinderCandidate`. The only location
flag represented booking-location evidence, so `CallerFinderService` discarded
a contact matched solely by ZIP as having no real match.

## Change

- Added `matchedContactPostalCode` to the candidate contract.
- Projected it from the real contact query using
  `coalesce(contacts.postal_code ilike pattern, false)`.
- Reused the existing `Location` reason and 150-point score when that evidence
  is true.
- Left the SQL predicate, 64-row repository cap, sort rules, 8-suggestion cap,
  exact-phone metadata query, DNC/phone behavior, and default assisted-calling
  flag unchanged.

## TDD evidence

All commands used:

```text
export CI=true XDG_DATA_HOME=/tmp/remediation-xdg PNPM_HOME=/tmp/remediation-pnpm
```

### RED

Command (exit 1):

```text
pnpm --filter @workspace/api-server test src/routes/caller-finder-zip.integration.test.ts src/features/caller-finder/caller-finder-service.test.ts
```

Exact product mismatches:

```text
Repository: expected matchedContactPostalCode: true; received object without that field.
Service: expected Location/150 ZIP-only suggestion; received suggestions: [].
Route: expected Location/150 ZIP-only suggestion; received suggestions: [].
Unit contract test: expected a Location suggestion; received undefined.
```

### GREEN

Focused command (exit 0):

```text
pnpm --filter @workspace/api-server test src/routes/caller-finder-zip.integration.test.ts src/features/caller-finder/caller-finder-service.test.ts
```

Result: 2 files, 19 tests passed.

Final amended-test command (exit 0):

```text
pnpm --filter @workspace/api-server test src/routes/caller-finder-zip.integration.test.ts src/features/caller-finder/caller-finder-service.test.ts src/features/calls/assisted-calling.integration.test.ts
```

Result: 3 files, 20 tests passed.

Typecheck (exit 0):

```text
pnpm --filter @workspace/api-server typecheck
```

## Tests and files

The PGlite-backed integration fixture creates a ZIP-only target with no phone,
city, region, booking, or booking-location match. It also creates 65 unrelated
due-today contacts whose IDs sort ahead of the target, proving a nonempty ZIP
query narrows before the 64-row repository cap. It exercises the real
repository, the real service, and the actual caller-finder HTTP route; only
unrelated route dependencies are isolated.

Changed implementation files:

- `artifacts/api-server/src/features/caller-finder/caller-finder-types.ts`
- `artifacts/api-server/src/features/contacts/contact-repository.ts`
- `artifacts/api-server/src/features/caller-finder/caller-finder-service.ts`

Changed tests:

- `artifacts/api-server/src/routes/caller-finder-zip.integration.test.ts`
- `artifacts/api-server/src/features/caller-finder/caller-finder-service.test.ts`
- `artifacts/api-server/src/features/calls/assisted-calling.integration.test.ts`

## Commit

Implementation: `1bbf28f8f6977b2a41aff5532829f2fcd20202ce`
(`fix: score contact ZIP caller matches`).

## Self-review and concerns

The candidate evidence is derived by the database query and passed through the
repository; it is not a test stub or a synthesized `matchedLocation` value.
The service does not display ZIP data or auto-open a contact, so ZIP-only
matches remain click-only. No migration, deployment, remote write, feature-flag
enablement, or phone/DNC change was made.

The integration boundary uses the repository's supported PGlite test pattern
for an isolated local database. The route test mocks only unrelated route
modules because their import path currently depends on an unavailable Zod
helper; it leaves `calls.ts`, `DrizzleContactRepository`, and
`CallerFinderService` real.
