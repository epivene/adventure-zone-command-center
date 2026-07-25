# Task 5 Report — Booking Workflow

## Status

Implemented and committed. Unit/integration tests, lint, typecheck, and the
production build pass. The Playwright flow is present and configured, but could
not execute in this workspace because the dev server hit the process file-limit
before Playwright launched; this environment also has no usable Chromium binary,
Clerk auth state, or live PostgreSQL configuration.

## Commit

- `650e561 feat: add booking workflow`

## Files

- Added authenticated list, create, detail, and edit routes under
  `app/(private)/bookings/`, with server actions for create, edit, and follow-up
  completion.
- Added `BookingForm`, responsive/filterable `BookingList`, `StatusBadge`, and
  keyboard-accessible `FollowUpCompletionDialog`.
- Added shared Zod boundaries for booking and follow-up completion input.
- Extended `DrizzleBookingRepository` with list/detail queries and audited core
  booking edits.
- Added component/unit coverage and the create-plus-first-call Playwright flow.
- Added Playwright base URL/web-server/auth-state configuration and excluded E2E
  specs from Vitest collection.
- Added shared responsive form/button styles and the user-event test dependency.

## Commands and Results

- `npm test -- tests/unit/booking-form.test.tsx`
  - RED: failed because `BookingForm` did not exist.
  - GREEN: passed the initial validation behavior.
- `npm test -- tests/unit/booking-form.test.tsx`
  - RED: failed because list/dialog components did not exist.
  - GREEN: 4/4 passed after list filtering, overdue presentation, and domain-error
    dialog behavior were implemented.
- `npm test -- tests/unit/booking-form.test.tsx`
  - RED: 2 failures for missing edit mode and dialog focus/Escape behavior.
  - GREEN: 6/6 passed after edit wiring and focus management were implemented.
- `npm test -- tests/unit/booking-form.test.tsx`
  - RED: failed because the server-side follow-up completion schema did not exist.
  - GREEN: 7/7 passed after the runtime validation boundary was added.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm test` — PASS, 29 tests in 7 files.
- `npm run build` — PASS; list, create, detail, and edit routes compiled as
  dynamic authenticated routes.
- `npm run test:e2e -- tests/e2e/booking-flow.spec.ts` — BLOCKED:
  the final attempt stopped at `EMFILE: too many open files` while Next.js was
  starting. Earlier direct Playwright execution also reported a missing Chromium
  binary; `npx playwright install chromium` received a zero-byte/truncated
  archive from the available network path. A real run additionally requires
  `PLAYWRIGHT_AUTH_STATE`, matching Clerk owner configuration, and a migrated
  PostgreSQL database.

## TDD Evidence

Production UI behavior was added only after the corresponding failing component
test. The red cycles covered required create validation, list/filter/overdue
behavior, retention of the completion dialog on `NEXT_ACTION_REQUIRED`, edit
submission without changing the follow-up plan, modal focus/Escape restoration,
and server-boundary rejection of an empty outcome.

The Playwright spec was written before the booking routes. It now creates a lead,
opens its detail, completes the first call with a dated next action, and confirms
the lead remains visible.

## Self-review

The review found four important gaps:

1. No concrete edit route — fixed with an authenticated edit route, audited
   repository update, and edit-mode form.
2. Client-only follow-up validation — fixed with a server-side Zod schema before
   calling `BookingService.completeFollowUp`.
3. Incomplete modal keyboard behavior — fixed with initial focus, focus trapping,
   Escape close, and trigger focus restoration.
4. E2E did not complete the first call or describe authenticated setup — fixed by
   extending the flow and accepting an external `PLAYWRIGHT_AUTH_STATE`.

The UI imports Task 4's `isActiveStatus` and calls Task 4's `BookingService`
instead of reimplementing follow-up policy. Private pages and all mutations
retain explicit `requireOwner` protection.

## Concerns

- E2E remains an environment blocker, not a passing verification claim.
- The existing Clerk middleware emits a deprecation warning for
  `createRouteMatcher`; Task 5 keeps page/action owner checks in place and does
  not alter that pre-existing middleware.

## Fix Round 1

Commit:

- `2a4a914 test: strengthen booking follow-up flow`

Changes:

- The E2E event name now includes `Date.now()` and the Playwright worker index,
  preventing ambiguous locators when the database retains earlier test records.
- Follow-up dates are generated at seven and eight UTC days from execution, so
  they continue to satisfy the domain's future-date policy.
- Completion is now proven by four distinct observations: the dialog closes,
  the original call displays its `call again` outcome and `Completed` state, the
  newly dated follow-up displays `Open`, and the unique lead remains linked on
  `/bookings`.

Exact verification commands and output:

- `git diff --check`
  - Exit `0`; no output.
- `npm run lint`
  - Exit `0`; ESLint reported no findings.
- `npm run typecheck`
  - Exit `0`; `tsc --noEmit` reported no errors.
- `npm test`
  - Exit `0`; `Test Files 7 passed (7)`, `Tests 29 passed (29)`.
- `npm run build`
  - Exit `0`; Next.js compiled successfully, finished TypeScript, generated all
    static pages, and listed dynamic booking routes for list, detail, edit, and
    new booking.
- `npm run test:e2e -- --list tests/e2e/booking-flow.spec.ts`
  - Exit `0`; listed
    `booking-flow.spec.ts:21:1 › new lead remains visible after its first call`;
    `Total: 1 test in 1 file`.

The full browser execution remains subject to the environment blockers recorded
above. This fix round intentionally changed only E2E test/support assertions and
data generation; production authentication and application code were unchanged.
