# Task 1 report: unified event-profile read model and workspace

## Delivered

- Added a typed `EventProfile` read model which loads the place, every active associated contact, bookings, activity notes/call outcomes, follow-ups, calling-list memberships, and Act source provenance.
- Kept ordering deterministic and honored a valid requested `contactId`, otherwise selecting the primary contact first.
- Added the `/event-profiles/[profileId]` authenticated route and a single workspace that shows event, contacts, call outcome entry point, notes, follow-ups, bookings, groups, and source records together.
- Redirected legacy `/organizations/[organizationId]` detail URLs to the unified profile route.

## Verification

- `npm test -- tests/unit/event-profile-repository.test.ts tests/unit/event-profile-workspace.test.tsx tests/unit/places-contacts-navigation.test.tsx` — 3 files, 6 tests passed.
- `npm run typecheck` — passed.
- `git diff --check` — passed.

## Scope note

The workspace is intentionally read-focused in this task. Its call-outcome control deep-links into the existing call workflow; later tasks will route Today actions and creation flows into the profile context.
