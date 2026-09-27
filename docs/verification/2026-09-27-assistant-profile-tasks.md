# Assistant profile tasks — verification and rollout

Status: implementation in an isolated branch, feature OFF by default. Not deployed.

## Behavior

Tasks freeze profile IDs, objective, event year, requested fields, original user message and proposed authority. A proposed task does not execute until the owner confirms its card. Child runs use four profiles maximum, existing durable checkpoints and one active run per conversation. Scope cannot expand through task tools. Counts come from SQL item states, not model prose.

Pause/Cancel prevent subsequent work; provider results already in flight may still settle. Reservations for chat, research and document work share the owner allowance and task cap. Unknown usage stays reserved across resets. Budget/no-progress pauses need explicit Resume. Transient run failures allow three total attempts, then retain failed items. Uncertain writes require reconciliation rather than replay.

Routine authorized notes are constructed from durable, profile-bound source text. The owner explicitly chooses completion criteria on Start: full objective review (default), saved source notes only, or supported general profile fields. Automatic field updates require empty supported fields, no event-year scope, and literal support in saved source text. Existing values and unsupported changes require concrete review. Source notes do not verify event-specific organizer roles or source year. No contact-creation tool or model training was added.

## Evidence

- Backend task + worker/run/action/spending/history regression selection: 18 suites, 119 tests passed.
- Frontend assistant components + page regressions: 20 suites, 111 tests passed.
- SQL-backed integration: routes create/confirm a 120-profile task; worker processes 30 batches; 80 note writes occur once; 40 missing-evidence/deleted-profile outcomes remain visible. Simulated crash after a durable note commit reconciles its receipt without a duplicate write. Disabled flag hides endpoints without deleting the ledger.
- API production build: passed (`node build.mjs`). UI production build: passed (`vite build --config vite.config.ts`). Existing bundle-size warnings remain.
- Fresh baseline typecheck: API 94 / UI 135 diagnostics. Final head has the same API 94 / UI 135 diagnostics, with no added file/error-code counts; unrelated baseline diagnostics remain.
- PGlite tests execute real SQL, constraints and transactions. PGlite serializes requests; real multi-connection PostgreSQL contention is NOT verified. No local PostgreSQL server is installed.
- DOM tests cover readable diffs, four-approval maximum, pending-click suppression, stale revision selection invalidation, offline controls, reconnect refresh and multiple-task choice.
- Browser fixture prepared for 360px and 768px; local Chromium was missing and its download failed with a truncated archive. Pixel rendering and physical Galaxy Fold behavior are NOT verified. Keep the flag off until these release checks pass.
- Providers were mocked. No paid model calls, production mutations, emails or deployments were performed.

## Dependencies and activation

September 27 refresh: main `6b0c3232ef9033b07844b2bcdfdacf4ba884652d`; #958 `624d1056456fb3c519c24977e5da50acf6d507fe`; #959 `1c56e304672921ec6307db4e8be2baccb94d397b`. Both assistant PRs remain open; #959 is based on #958. Offline recovery #957 (`7fa2d39525a67388b05e520d082efc966715d8dc`) is separate and remains open.

This change is stacked on #959. Integrate #958, then #959, then this task change. Keep `ASSISTANT_PROFILE_TASKS_ENABLED` unset/false while additive startup tables are introduced. Disabling the flag preserves tasks and receipts. Review independent findings, run PostgreSQL contention and browser checks, then agree on a small scoped pilot and cost cap before enabling. Merging, deploying or enabling is not part of this implementation run.

## Implementation decisions

- Ruling: Use existing startup migration entry point alongside SQL migration registration — repository schema initialization is owned there; wrong integration could block rollout, covered by repeated migration tests.
- Ruling: Local base already includes tested #958/#959 files; main remains 6b0c323. Keep changes stacked, disabled by default, and compare remote dependency heads before publishing — incorrect base could create merge conflicts.
- Ruling: Invoke installed Vitest directly from each package because the environment's pnpm wrapper rejects symlinked dependency directories. Same Vitest config and tests; cost if wrong: version mismatch, recorded in test output.
- Task 1: Ruling: Migration lives alongside the existing assistant-workspace startup SQL, not unrelated ACT migration registry. Drizzle exports document new tables; SQL owns constraints.
- Task 2: Ruling: Live field values are required by grantTaskAction in addition to revision — revision alone cannot prove an empty field — cost if wrong: extra profile read.
- Task 2: Ruling: Deleted-target outcome and review receipt reconciliation are integrated with the runner in Tasks 3/4; current adapters already reject writes to deleted targets — shared item outcome boundary — cost if wrong: integration test must catch missing unresolved count.
- Task 3: Ruling: Atomic claim/enqueue and reconciliation live in ProfileTaskRunner, reusing RunStore lease fencing rather than exposing a second public claimBatch/settleBatch lease protocol — prevents two independent lease owners — cost if wrong: future callers use runner API.
- Task 3: Ruling: Local PGlite serializes concurrency; separate PostgreSQL connections are not available yet — concurrency tests cover SQL transactions/constraints, not network interleavings — cost if wrong: live PostgreSQL race testing remains a release gate.
- Task 4: Ruling: Existing CRM mutation tools cannot create or verify event-organizer contact roles. Those objectives retain needs_review even after sourced notes are saved; supported empty profile fields and note-only objectives can complete with evidence plus receipts — prevents invented contact verification — cost if wrong: more manual contact reviews until a dedicated contact tool is added.
- Task 4: Ruling: The plan named WorkspacePanel as the page container; it is a reusable dialog. Task cards will mount in AssistantWorkspacePage without altering the shared panel — cost if wrong: placement can be adjusted without changing modal behavior.

## Independent review and fix pass

The independent whole-branch reviewer assessed local base `0d88d449310c15bd3828de4ee5d2a8b33e794136` through `06e8f20`. All six findings were retained as Important and fixed in one pass. No Critical or Minor findings were reported; no second review was requested.

1. Generic approval could bypass task cancellation/version/flag: persisted action-to-task lookup now guards both the executor and transactional mutation boundary. Generic task writes require the task review route. `profile-task-safety.test.ts` reproduced the bypass and passed after the guard.
2. Revised proposals collided with prior action IDs: IDs include canonical arguments and revision as well as task/profile/kind. Exact replay is stable; revised proposals receive distinct IDs. Safety tests verify both and prepare a replacement after a stale review.
3. Stale revisions stranded items as uncertain: known local transaction rollbacks produce blocked/failed results, retain a named conflict, and provide Retry. Route-to-executor SQL tests failed before the change and passed afterward. A related two-note approval test reproduced premature item-state transition; pending concrete reviews now remain available until settled.
4. Incomplete or wrong-profile evidence could complete an item, and keyword matching missed organizer objectives: completion uses owner-selected structural criteria, exact profile-bound complete evidence and receipts. The model cannot select completion mode. Context/evidence tests reproduced the failures and passed after the fix.
5. Routine writes lacked source proof: new single-profile research persists original source text/year, proposals link durable evidence, and automatic grants recheck proof at the database mutation boundary. Notes use the saved source body, not generated assertions. Tests reject another profile's source, incomplete evidence, unsupported values, and unsupported notes.
6. Deleted names vanished: task membership now stores a profile-name snapshot. Deleted targets remain named unresolved items. The SQL-backed safety test reproduced the loss and passed after the fix.

RED logs were retained during execution (`task-review-red`, `task-review-safety-red`, `task-evidence-red`, `task-review-route-red`, `task-executor-red`, `task-completion-ui-red`, `task-multiple-review-red`); final backend/frontend suites cover the fixes together.

### Final rulings

- Ruling: Real PostgreSQL race behavior remains a release gate because local PGlite serializes requests and no server is available. Cost if wrong: lease/reservation interleavings may differ in production; keep the flag off until tested.
- Ruling: Browser pixel/Fold validation remains a release gate because Chromium installation failed. DOM behavior is tested; cost if wrong: layout or touch defects remain possible.
- Ruling: Live provider billing and research quality remain unverified because no paid calls were authorized for this run. Cost if wrong: real cost/evidence quality can differ; use an explicitly scoped capped pilot after release checks.
- Ruling: Existing unrelated type errors remain outside scope, with fresh base/head diagnostics compared by file and error code. Cost if wrong: repository-wide typechecking still cannot act as a clean gate.
- Ruling: Arbitrary organizer/contact goals remain unresolved until owner review; structural completion choices replace natural-language guessing. Cost if wrong: more manual reviews, rather than false completion.
- Ruling: Durable source snapshots and argument/revision-bound proof are required for automatic changes. Cost if wrong: some valid changes require review or repeat scoped research.
- Ruling: Publish only this task overlay onto remote #959. All 15 modified pre-existing files matched the remote base blob-for-blob. Cost if wrong: stack integration may still require rebase after dependency changes. Unrelated local booking documents are excluded.

No deferred minor findings. No production activation is included.
