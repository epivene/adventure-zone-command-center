# Task 4 report: Places and Contacts navigation

## Completed changes

- Replaced the combined primary navigation item with separate `Places` (`/organizations`) and `Contacts` (`/contacts`) links in both desktop and mobile navigation.
- Updated the Places and Contacts page headings and nearby user-facing copy while retaining the existing route URLs.
- Updated Places list copy to consistently call linked people `contacts`.
- Added a `returnTo` parameter to place-detail links. It serializes the current supported Places list filters (`q`, `lastResort`, `leg`, `page`, and `pageSize`).
- Added guarded detail-page handling: only `/organizations` list contexts are accepted; missing or unsafe contexts, including `/contacts`, return to `/organizations`.
- Preserved the return context when paging contacts or bookings inside a place detail.

## Tests added

`tests/unit/places-contacts-navigation.test.tsx` covers:

1. Separate Places and Contacts links in both navigation variants.
2. Preservation of active Places filters in a detail link.
3. Detail-page return to a supplied safe Places list context.
4. Fallback from an unsafe Contacts return path to `/organizations`.

## Verification

- `npm test -- tests/unit/places-contacts-navigation.test.tsx` — passed (4 tests).
- `npm run typecheck` — passed.
- `git diff --check` — passed.

## Concerns

None. Existing `/organizations` and `/contacts` routes remain unchanged.
