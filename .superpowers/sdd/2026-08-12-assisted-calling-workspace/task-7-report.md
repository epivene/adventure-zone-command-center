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

## Fix round 1 — authoritative continuation and partial-phone search

Review identified two safety gaps and one route-test weakness:

- The quick-add UI inferred an exact conflict from the bounded eight-candidate
  response. An exact match hidden after eight higher-ranked visible candidates
  could therefore expose a misleading bypass action. Candidate results now carry
  the service/repository's authoritative `canContinueCreating` decision. The UI
  never derives bypass permission from the visible DTO. Uncapped exact-conflict
  detection remains authoritative, including the transactional race-check result.
- Seven- through nine-digit phone fragments were sent as `phone=` but could not
  be normalized as full NANP numbers and were not searched as text. The finder
  now performs bounded normalized digit-fragment matching for those inputs. Such
  results use the `Phone number` reason and always remain click-only; only a
  unique full normalized-phone match can auto-open.
- The route suite now exercises the production auth-mounted router with a real
  issued token and the real `submitQuickCaller` service, mocking only repository
  and unrelated infrastructure boundaries. It covers unauthenticated access,
  invalid-body rejection, hidden exact conflicts beyond the visible eight,
  likely-candidate continuation, and explicit creation. The earlier mocked
  identical-response route assertion was removed; it was not evidence of actual
  request-key idempotency, which remains a service/repository responsibility.

### Fix-round TDD evidence

- RED: service tests failed because candidate results lacked the authoritative
  continuation flag; the hidden-exact UI regression still rendered **Create
  separate contact** when all eight visible candidates were merely likely.
- GREEN: service, repository result contract, page typing, and UI now propagate
  and consume the server decision; the hidden-exact regression passes.
- RED: a seven-digit phone fragment produced no suggestion.
- GREEN: table coverage for seven-, eight-, and nine-digit fragments returns
  bounded click-only `Phone number` suggestions with no exact result.
- GREEN: authenticated route coverage rejects missing auth and invalid input and
  preserves the authoritative hidden-exact and explicit-continue behavior.

### Fix-round fresh verification

Executed in the runnable compatibility checkout
`/workspace/scratch/2d7b4cca3992/repo-test` on 2026-08-12 after synchronizing
the remote branch's current Task 5/6/7 contracts:

```sh
pnpm --filter @workspace/api-server exec vitest run \
  src/features/caller-finder/caller-finder-service.test.ts \
  src/features/contacts/quick-caller-service.test.ts \
  src/routes/calls-quick-caller.test.ts \
&& pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/calls/caller-finder.test.tsx \
  src/components/contacts/quick-add-caller.test.tsx \
&& pnpm --filter @workspace/api-server typecheck \
&& pnpm --filter @workspace/adventure-zone typecheck
```

Result: PASS — API 3 files / 20 tests, web 2 files / 11 tests, API typecheck,
and web typecheck. The compatibility checkout contains manually synchronized
unchanged Task 5/6 contracts needed to run the connector-only branch artifacts;
those compatibility-only files were not added to the remote Task 7 diff.

The broader pre-existing `src/routes/calls.test.ts` does not initialize in this
checkout because its local Vitest dependency graph exposes a Zod v3/v4 API
mismatch (`z.uuid`). The focused production-router Task 7 route suite and both
package typechecks pass. GitHub Actions still did not schedule through the
connector, and fix round 1 did not recreate the removed temporary workflow.
