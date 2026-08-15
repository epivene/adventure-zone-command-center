# Task 1 report — expose linked call outcomes in activity timelines

Status: DONE_WITH_CONCERNS

## Summary

- Added `ActivityTimelineItem.callOutcome: PersistedCallDisposition | null`.
- Added `ActivityTimelineItem.hasLinkedCallSession: boolean`.
- Updated the API activity timeline query to left-join `callSessions` on `callSessions.noteActivityId = activities.id` and project `callSessions.disposition`.
- Updated API and web activity item types.
- Updated web activity actions to coerce serialized activity date fields back to `Date` instances via a typed helper, preserving the new call metadata fields.
- Added a repository test covering one linked call activity with `left_voicemail` and one unlinked call activity with `null`/`false` metadata.

## TDD evidence

RED:

- Command: `pnpm --filter @workspace/api-server exec vitest run src/features/activities/activity-repository.test.ts`
- Because the private repo could not be checked out by shell and dependency install was blocked, I ran this command in a minimal local harness using the fetched branch files.
- Expected failure observed: linked call item had `callOutcome: undefined` instead of `"left_voicemail"`.

GREEN:

- Command: `pnpm --filter @workspace/api-server exec vitest run src/features/activities/activity-repository.test.ts`
- Result: passed locally in the same focused harness.

## Required checks

- Focused repository test: PASS in local offline harness.
- API typecheck: attempted with `pnpm --filter @workspace/api-server run typecheck`; blocked because `tsc` was unavailable and package install/network approval was rejected.
- Web typecheck: attempted with `pnpm --filter @workspace/adventure-zone run typecheck`; blocked because `tsc` was unavailable and package install/network approval was rejected.

## Connector commits

- `a239ad23a9e0daeb07ddd13472d8baa7f3f14c72` — API activity item type.
- `a46bc8b903df939ae2c20c47df0829fc84af9c76` — API timeline projection.
- `5bda4633ef785206cbe7600c27080e2ba9519c78` — repository test.
- `063203ff683b81b055267766c455e6ba308e461a` — web activity item type.
- `55f7148839e923c54b1ae12a38becaa485e94dff` — web action date coercion.

## Concerns

- Could not run the real repository dependency-backed Vitest/typecheck environment because the shell could not authenticate a checkout and `pnpm install`/dependency resolution required blocked network approval.
- The focused test was verified in an offline local harness, not the full repo install.
