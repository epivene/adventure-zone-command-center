# Task 7 Report — Incoming Caller UI and Duplicate-Safe Quick Create

## Status

Implemented on `agent/assisted-calling-workspace` from required head `a38b4798`.

## Implemented

- Added a 250 ms debounced, unified **Find caller** input backed by
  `GET /calls/caller-finder`.
- Auto-opens only the API's single exact-phone result. Ambiguous exact results,
  area-code/location matches, and all other suggestions require an explicit
  click.
- Shows match reasons plus organization/event, city/state, booking status,
  route leg, and last-contacted date. No carrier lookup was added.
- Keeps **Create contact** available only when the API says creation is safe,
  and switches `/quick-add` explicitly from finder mode to create mode.
- Added duplicate cards to quick creation with **Open profile**. Exact phone or
  email conflicts never show a bypass. Likely candidates require an explicit
  **Create separate contact** click that resubmits the same request key with
  `continueCreating: true`. No merge behavior was added.
- Replaced the legacy quick-add redirect with the incoming finder/create flow
  and routes selected contacts to Task 6's `/calls/new?contactId=...` workspace.

## Task 5 plan-gap resolution

Task 5 implemented the Zod-validated duplicate-safe quick-caller service and
result variant, but `a38b4798` did not expose that service over HTTP. Task 7 was
narrowly expanded to add the single authenticated endpoint
`POST /calls/quick-caller` beside the caller-finder route. It reuses Task 5's
service and repository; candidate responses stay successful JSON responses so
the UI can review them. Validation errors return 400, creations return 201, and
unexpected failures return a bounded 500 response. No second create path was
invented.

## TDD evidence

- RED: finder test failed because `./caller-finder` did not exist.
- GREEN: finder and quick-create component suite passed 7/7.
- RED: create-mode route assertion failed because **Create contact** linked back
  to finder mode.
- GREEN: explicit `create=1` transition passed.
- RED: a safe create CTA remained visible while a changed query was waiting for
  its debounce/API result.
- GREEN: changing the finder input now clears stale certainty immediately.
- RED: a rejected API validation message was replaced by a generic create error.
- GREEN: quick create now preserves the actionable API validation message.
- RED: quick-caller route suite failed 4/4 with `404 Not Found`.
- GREEN: exact conflict, likely-candidate review, explicit continue, and replayed
  request-key route tests passed 4/4.

## Fresh verification

- `pnpm --filter @workspace/adventure-zone exec vitest run src/components/calls/caller-finder.test.tsx src/components/contacts/quick-add-caller.test.tsx`
  — PASS, 2 files and 9 tests.
- `pnpm --filter @workspace/adventure-zone typecheck`
  — PASS in the local compatibility checkout after importing the unchanged
  `a38b4798` contact type contracts.
- `pnpm --filter @workspace/api-server exec vitest run src/routes/calls-quick-caller.test.ts`
  — PASS, 1 file and 4 tests.

## CI concern and cleanup

A branch-only Task 7 workflow matching the prior Task 6 push/branch pattern was
committed and followed by multiple trigger and implementation pushes. The GitHub
connector returned no workflow runs for every checked commit, so no remote RED
or GREEN execution was available to inspect. Local RED/GREEN evidence above was
observed directly. The temporary workflow and trigger file were removed from the
branch after verification.

The known six-error web baseline at the required remote head was not changed by
this task. The connector-only checkout prevented rerunning that exact branch
locally; the task's new web files typecheck cleanly in the available compatibility
checkout.
