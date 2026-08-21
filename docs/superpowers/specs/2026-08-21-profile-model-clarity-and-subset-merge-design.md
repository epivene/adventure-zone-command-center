# Profile Model Clarity and Subset Merge Design

## Goal
Make the profile/family workflow understandable in user-facing language, allow true duplicate profiles to merge even when they are part of a larger related-event/location candidate group, and keep already-resolved relationships out of duplicate review.

## User-facing model
The UI should expose only these concepts:

- **Profile**: one working CRM record with its own contacts, notes, calls, bookings, follow-ups, history, and core identity.
- **Locations**: venue/address records that belong inside one Profile when they are truly the same working relationship.
- **Event Family**: separate Profiles that are related (for example the same event brand in different cities) but must keep their own contacts/history/bookings.
- **Duplicate Profiles**: accidental copies of the same Profile that should merge into one surviving Profile.

The internal `organizations` database/domain name remains unchanged. Database renames are explicitly out of scope.

## Duplicate-review behavior
A broad candidate group may contain both true duplicates and separate related locations. Selecting a subset must cause the action to be evaluated against the selected subset, not automatically blocked because the selected records participate in a larger family candidate.

Example:
- Family Fun Day — Idaho Falls, ID
- Family Fun Day — Fishtail, MT (copy A)
- Family Fun Day — Fishtail, MT (copy B)

Selecting only the two Fishtail records and choosing Merge should be allowed when the selected records are compatible as duplicates. Idaho Falls remains untouched and may later be grouped with the surviving Fishtail Profile in an Event Family.

A merge remains blocked when the selected records themselves carry evidence that they are distinct locations/related records rather than duplicates.

## Resolved relationships leave duplicate review
The duplicate screen is an unresolved-cleanup queue. Records should not keep resurfacing after the user has intentionally resolved their relationship.

Exclude from duplicate review:
- profiles already retired/merged into another Profile;
- profiles already grouped in an Event Family;
- profiles already placed under another Profile through an intentional Profile Location/parent relationship;
- explicitly reviewed relationship groups that were resolved as not related.

If a discovered candidate group contains a profile that is already intentionally resolved, hide that stale group. This is deliberately conservative: discovery can generate a fresh unresolved group later, but the cleanup screen never mixes already-resolved records back into a pending decision.

## Merge safety
The selected subset is validated against current locked profile data before the merge starts. A broader relationship proposal is not, by itself, proof that the selected subset cannot be merged.

The selected subset is considered safe to merge when no selected pair has conflicting complete location identity. In practical terms:
- same normalized city + state/region is compatible;
- missing city/state on one copy is not treated as proof of a different location;
- two different complete city/state pairs remain a family/location conflict;
- retired/consolidated profiles remain non-mergeable.

Before a safe subset merge, stale broader proposed relationship rows intersecting those selected profiles are cleared. The repository's existing merge transaction then runs normally. If an unresolved relationship still exists after the merge, normal duplicate discovery can create a fresh proposal for the surviving profiles. Unselected members are never merged.

## UI language cleanup
In the duplicate/family workflow, replace user-facing `organization` terminology with `profile` terminology. Examples:
- `Organization Locations` -> `Combine as Profile Locations`
- `Organization names match...` -> `Profile names match...`
- `ACT records connect these organizations` -> `ACT records connect these profiles`
- `selected organizations marked as not related` -> `selected profiles marked as not related`

Internal API paths such as `/organizations/merge`, TypeScript type names, table names, and repository class names stay unchanged.

## Duplicate action guidance
The duplicate review card should explain the choices in plain language:
- **Merge selected duplicates**: same Profile accidentally entered more than once.
- **Combine as Profile Locations**: one Profile/relationship that genuinely has multiple venue/address locations.
- **Group as Event Family**: related but separate Profiles that should keep their own history.
- **Not related**: the match is wrong.

## Non-goals
- Renaming database tables or API routes.
- Automatically merging based only on similar names.
- Automatically deciding Event Family membership after a duplicate merge.
- Changing the existing event-family database model.