# Task 8 report — split Today call queue

## Result

Today now uses the assisted-calling configuration as its rollout gate. When
`/calls/config` explicitly enables assisted calling, the prioritized follow-up
queue and the shared compact call workspace render together. A failed config
request and an explicit disabled response both retain the prior
`FollowUpList` + `NextCallCard` layout.

The enabled layout keeps the queue mounted while workspace context loads or
fails. Desktop uses the specified two-column grid. The one-column mobile layout
places the selected workspace first and the queue second. Loading failures show
**Try again** and the existing standalone workspace link; the UI makes no Phone
Link readiness or call-delivery claim.

The Today DTO now includes the resolved contact and organization names, booking
status, route leg name/color, latest contacted date, and the existing
organization/contact/booking/follow-up IDs. Existing priority ordering and
pagination are unchanged. Last-contacted values are computed in the Today query
without per-row request-time repository calls, and route legs reuse the existing
batched booking-operations summaries.

On successful completion, the queue captures the caller that was originally
next, refetches `/today`, filters a stale completed result defensively, and
reselects that caller even if the refreshed result order changed. If that caller
is absent, it keeps the same bounded queue index. A failed refetch still removes
the successfully completed item locally.

## TDD evidence

- RED: the focused Vitest command initialized successfully and failed because
  `@/components/today/call-queue-workspace` did not exist.
- GREEN: the same focused suite passes 5/5 behaviors covering queue persistence
  during loading, mobile order/layout, visible context/count, retry + standalone
  fallback, and queue-position preservation across completion/refetch.

The runnable checkout is a synchronized compatibility checkout because the task
workspace exposes the target repository through the GitHub connector rather
than as a complete local clone. Compatibility-only stubs for already-existing
Task 6 and Today dependencies were used for local resolution and are excluded
from the authoritative remote diff.

## Verification

Fresh commands in the synchronized checkout:

```sh
artifacts/adventure-zone/node_modules/.bin/vitest run \
  src/components/today/call-queue-workspace.test.tsx

node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
# run from artifacts/api-server and artifacts/adventure-zone
```

Results: component suite 1 file / 5 tests passed; API typecheck passed; web
typecheck passed. GitHub Actions had not scheduled for the preceding
connector-authored Task 7 head, so Task 8 uses the exact local evidence permitted
by the brief rather than adding another temporary workflow that the connector
cannot dispatch.

## Fix round 1 — fallback route, activity composition, and stale totals

Review found that the error fallback linked to the JSON API endpoint rather than
the standalone workspace page, and that the inline composition omitted the
activity mutations/revision loader used by the standalone page. It also found a
remaining-count edge case when a refetch briefly returned the completed item.

The fallback now delegates to the existing `callWorkspaceHref`, producing
`/calls/new` with contact, booking, and follow-up IDs. The compact workspace now
receives `createActivityAction`, `editActivityAction`, and
`listActivityRevisionsAction`, exactly matching `CallWorkspacePage`. If a
refetched queue still contains the completed follow-up, the component filters it
and decrements the returned total before rendering the remaining badge.

### Fix-round TDD evidence

- RED: the exact-link regression received
  `/calls/workspace?followUpId=...` instead of the expected `/calls/new` URL and
  complete identifier query.
- RED: the real synchronized Task 6 composition did not expose **Add activity**
  or **Edit activity** from the compact history section because the actions were
  not passed.
- RED: a stale three-item refetch filtered the completed caller but continued to
  display **3 remaining**.
- GREEN: the focused suite passes 7/7 tests. The integration regression renders
  the real compact `CallWorkspace`, expands **Recent history**, and verifies
  activity creation/edit controls, existing history content, and the revision
  history control.

### Fix-round verification

Fresh verification in the synchronized runnable checkout:

```sh
artifacts/adventure-zone/node_modules/.bin/vitest run \
  src/components/today/call-queue-workspace.test.tsx

node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
# run from artifacts/adventure-zone and artifacts/api-server
```

Result: web component suite 1 file / 7 tests passed; web and API typechecks
passed. Compatibility-only synchronized Task 6 files and type shims were not
included in the remote fix diff.
