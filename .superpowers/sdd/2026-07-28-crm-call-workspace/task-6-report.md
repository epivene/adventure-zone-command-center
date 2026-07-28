# CRM Call Workspace — Task 6 Report

## Scope

Implemented the owner-facing Call Workspace at `/calls/new`, its atomic completion action, a compact activity timeline with deferred revision loading, and Call Workspace entry links on contact and booking detail pages.

## RED evidence

Before implementation, ran:

```bash
npx vitest run tests/unit/call-workspace.test.tsx tests/unit/activity-timeline.test.tsx
```

Result: both suites failed at import resolution because `components/calls/call-workspace` and `components/activities/activity-timeline` did not exist. This established the requested component behavior tests before production components were created.

## Files

- Added `app/(private)/calls/new/page.tsx`
- Added `app/(private)/calls/actions.ts`
- Added `components/calls/call-workspace.tsx`
- Added `components/activities/activity-timeline.tsx`
- Added `tests/unit/call-workspace.test.tsx`
- Added `tests/unit/activity-timeline.test.tsx`
- Updated `app/(private)/contacts/[contactId]/page.tsx`
- Updated `app/(private)/bookings/[bookingId]/page.tsx`

## Verification

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/call-workspace.test.tsx tests/unit/activity-timeline.test.tsx tests/unit/contact-components.test.tsx` | 3 files, 6 tests passed |
| `npx vitest run tests/unit/call-input.test.ts tests/unit/activity-input.test.ts tests/unit/call-workspace.test.tsx tests/unit/activity-timeline.test.tsx tests/unit/contact-components.test.tsx` | 5 files, 12 tests passed |
| `npm test` | 54 files passed, 2 skipped; 348 tests passed, 11 skipped |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run build` | passed; `/calls/new` generated as a dynamic route |
| `git diff --check` | passed |

## Security and data-flow review

- The new page and both server actions call `requireOwner()` before database or repository access.
- Completion validates at the action boundary, then delegates to `CallService.complete()` for the reviewed atomic write path.
- Successful completion revalidates Today, list/detail contact, booking, and organization paths.
- Revision bodies are not loaded by the page; the client requests them only after **View edit history**.
- The implementation adds no Act!, email, calendar, telephone, or fake call-control write path.

## Accessibility review

- The workspace uses semantic headings, labelled controls, a labelled recent-activity list, visible keyboard-focusable buttons/links, and `role="alert"` for warnings and submission errors.
- Revision disclosure uses a native button with `aria-expanded` and `aria-controls`.
- The layout uses responsive single-column-to-two-column grid classes.
- Focused tests use accessible role/label queries and cover the keyboard-operable history disclosure, readable error announcement, full-record links, and retained failed-submission values.

## Self-review

The disposition control exposes exactly the eight approved values. Call timing is instantiated only by the **Start call note** button. The loader derives the primary contact for a booking-only entry, and all persistence remains behind existing services/repositories.

## Commit

`feat: add focused Call Workspace`

## Concerns

No functional concerns found. The project does not include an automated browser accessibility scanner, so accessibility verification is component-level semantic and interaction coverage rather than an external audit.

## Round 1 follow-up

### Findings addressed

- Today due-call and next-call links now enter `/calls/new` with contact, booking, and follow-up IDs when available.
- A successful call submission replaces the form with an announced saved state and Today link, so the completed call cannot be submitted again from the same workspace.
- `loadCallWorkspaceContext` validates all query UUIDs before repository access, derives the authoritative related context, rejects conflicting relationship IDs, and supports an organization-only follow-up.
- Contextual activity history selects booking scope first, then contact, then organization; the database query retains revision counts, omits revision bodies, and applies `LIMIT 10`.
- Added action, context-loader, repository, Today URL, exact-disposition, and saved-state coverage.

### Round 1 RED evidence

The first focused run failed exactly at the new boundaries: the context loader module was missing, Today links still targeted bookings, successful call completion had no status/removal of the submit path, and the activity query did not call `limit(10)`. A final focused context test then demonstrated that an organization-only follow-up incorrectly accepted an added booking ID; the resolver was tightened to reject it before GREEN verification.

### Round 1 verification

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/call-workspace-actions.test.ts tests/unit/call-workspace-context.test.ts tests/unit/activity-timeline-repository.test.ts tests/unit/today-components.test.tsx tests/unit/call-workspace.test.tsx` | 5 files, 16 tests passed |
| Call/activity/Today focused regression set | 9 files, 28 tests passed |
| `npm test` | 57 files passed, 2 skipped; 359 tests passed, 11 skipped |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run build` | passed |
| `git diff --check` | passed |

### Round 1 self-review

The page retains owner-first authorization before importing the database. The loader rejects malformed IDs before invoking its repository, and action tests prove authorization precedes service construction and validation precedes service work. The saved-state status uses a semantic live status and removes the submit button, while the Today links remain ordinary keyboard-accessible links.
