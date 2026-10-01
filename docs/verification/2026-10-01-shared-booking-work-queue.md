# Shared booking work verification — 2026-10-01

Implemented against main commit `f6aa6c7a27bc26509c816f9863637c4d86aad196`.
The local source snapshot matches that main; the unrelated foam banner binary is
preserved from remote main when publishing. No live CRM records, automations,
communications or deployments were changed.

## Verification

Commands below run from the named application directory. Direct binaries use the
existing installed dependencies; pnpm 11 tried to reinstall symlinked dependencies.
Runtime was Node 24.19, while the project declares Node 22. CI remains necessary.

| Check | Result |
| --- | --- |
| API: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 src/features/chatgpt-connection src/features/booking-work src/routes/booking-work.test.ts src/db/required-schema-startup.test.ts` | 103 passed, 1 skipped before final review fixes |
| API after review: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 src/features/booking-work src/routes/booking-work.test.ts` | 13 passed, including wrong-year link regression |
| UI after review: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts src/features/booking-work` | 10 passed, including reconciliation with/without refresh and exact record review |
| API: `node build.mjs` | Passed after review fixes |
| UI: `node node_modules/vite/bin/vite.js build --config vite.config.ts` | Passed after review fixes |
| Web package typecheck | 131 errors on both versions; final diagnostics exactly match unchanged baseline after normalizing line/column numbers |
| API package typecheck | Could not finish: initial processes were killed; bounded 1536 MB attempts exhausted the heap on both baseline and modified code |
| Full API and UI test runs, 2 workers | Both exceeded the 90-second bound with failures; neither is claimed green |
| Browser/mobile visual check | Not performed; responsive classes, labels and interactions were checked through code and component tests |

The broad API run showed ACT schema/apply, outreach, organization merge import,
AI suggestion, location and route-map failures. Baseline reruns of ACT schema/apply,
locations and route-map reproduced all 30 observed assertions in those four files
(78 passed, 6 skipped). The broad UI run showed website, assistant, call queue,
profile imports, document/settings, navigation and other existing feature failures.
Baseline profile-page/import and navigation reruns reproduced the two import failures
and six navigation assertions (four passed). Other broad-suite failures were not
individually classified. An unrestricted worker run also hit five worker exits;
the bounded connector/queue run above then passed.

Database tests use PGlite; they exercise unique constraints, retries, revisions,
ownership, release/reclaim and merge preservation. They are not evidence of real
multi-session PostgreSQL contention or production startup behavior.

## Independent final review

A fresh read-only reviewer examined the implementation, specification and plan.
No Critical findings. All three Important findings were fixed with failing-then-
passing regression tests:

1. Refresh after a conflict destroyed the local draft. Refresh now preserves active
   editors; the latest record is shown for explicit reconciliation. Saving uses
   the reconciled revision and only changed fields, preserving unrelated Com edits.
2. Same-profile links could reference the wrong year. Explicit draft years and
   booking associations on draft/document/follow-up links are now checked.
   Records without a stored year or booking remain valid profile-level links.
3. Document and follow-up links ignored their record IDs. They now open a dedicated
   profile review panel that selects the exact record and reports missing records.
   Document access uses the existing protected file endpoint.

Two Minor findings are deferred:

- On a database where the connector schema has never existed, the actor selector
  endpoint can fail. Owner creation and editing still work, but UI handoff options
  are unavailable until that schema exists. The production connector is already
  in use; a connector-disabled fresh-install guard needs a separate small fix.
- MCP revision-conflict errors return the conflict code without the current record.
  Com must call `read_booking_work` before reconciliation (`crm:read`). Owner app
  conflicts include the current record. The serializer improvement is deferred.

No second independent review was run. The reviewer could not establish production
PostgreSQL concurrency, startup, visual mobile quality or a clean global typecheck.

## Execution decisions and consequences

These are the complete implementation rulings recorded during execution:

1. Preserve remote main's unrelated binary asset instead of publishing the older
   local snapshot's binary. Any source divergence would require reconciliation.
2. Use the existing owner Tasks area and event profile; office/boss authorization
   remains unchanged. Additional role access would require a separate design.
3. Invoke installed test/build binaries directly due to the pnpm symlink limitation.
   Node 22 CI must confirm the Node 24 local results.
4. Initialize the additive work schema in its own required startup step even if
   the connector is disabled. Base organizations/bookings tables must already exist.
5. Reuse existing merge snapshot/reference extension points. Connector previews
   explain collisions; legacy merge paths can fail through foreign-key protection.
6. Keep the draft PR deliverable despite unrelated/baseline failures, as explicitly
   specified by the approved delivery plan. This is not merge/deploy readiness or
   a claim that the whole repository is green.
7. Resolve all Important final-review findings once; document the two Minor findings
   and unverified areas above instead of extending scope or repeating review.

## Rollout

Normal review and CI precede deployment. After deployment, refresh connector tools
and instruct Com to claim work before starting and record its next action/progress.
No queue status starts Com or creates a scheduled task. See
[`../shared-booking-work-queue.md`](../shared-booking-work-queue.md) for the workflow.
