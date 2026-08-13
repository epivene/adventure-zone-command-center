# Task 10 verification and rollout report

Date: 2026-08-13  
Repository: `epivene/adventure-zone-command-center`  
Branch: `agent/assisted-calling-workspace`  
Starting commit: `209bce197266c4bf206d84e98e85e356355ea26f`

## Result

The automated Task 10 verification is green. The feature remains disabled by
default, no private launcher URL or phone number was committed, and no
deployment, migration, or enablement action was performed. Manual browser
verification is explicitly blocked in this environment and is not reported as
passed.

## Implementation evidence

- Added a stateful workflow integration test that composes the real Today
  query, workspace loader, call service, caller finder, and contact-phone
  repository. It creates an organization, contact, mobile and office phones,
  booking, route leg, and due call; completes the office call; verifies the
  immutable number/extension snapshot and next follow-up; exercises exact and
  area matching; marks only the mobile phone Do Not Call; and verifies the
  office number stays callable without setting Last Resort.
- Added `ASSISTED_CALLING_ENABLED=false` and an unset/synchronized-private
  `VOICEMAIL_LAUNCH_URL` entry to `render.yaml`.
- Documented both variables in `DEPLOY.md` and added the owner-only migration,
  smoke, wording, and non-destructive rollback gates in
  `docs/assisted-calling-runbook.md`.
- Corrected integrated contract drift exposed by the full suite: deterministic
  wrong-number scheduling, authoritative hidden-exact duplicate semantics,
  transactional fake phone IDs, isolated Do Not Call validation cases, the
  client caller-match reason union, compact activity revision callbacks,
  mobile draft discard restoration, nullable imported activity timestamps,
  required timeline sort timestamps, and duplicate reconciliation results.

## TDD and diagnostic record

### Workflow integration

The prescribed filtered command was first attempted before dependencies were
available and failed because pnpm tried to create `/root/.local/share/pnpm` in
the sandbox. Dependencies were then installed with the task-local XDG and pnpm
paths:

```text
CI=true XDG_DATA_HOME=/tmp/task10-xdg PNPM_HOME=/tmp/task10-pnpm \
  pnpm install --frozen-lockfile
Result: exit 0; 581 packages installed.
```

`pnpm --filter @workspace/api-server test -- <file>` forwards the literal `--`
through this package script and consequently runs the whole API suite. An
isolated valid run used the package-local Vitest executable. The first valid
workflow run failed while locating the newly created follow-up because the test
fixture used an incorrectly grouped ternary expression. After correcting the
test locator, the same test passed. No production behavior was changed to make
the workflow test pass, so this RED was a test-construction failure rather than
a behavior-valid product RED.

The full suite then exposed two stale baseline assertions. Investigation against
the approved design found production behavior correct:

- `wrong_number` scheduling used the real current clock in the test; fixing the
  clock to the fixture date made its future-business-date expectation stable.
- Quick-caller candidates omitted `canContinueCreating: false`, contradicting
  the approved hidden-exact duplicate safety contract; the expectation was
  updated.

Focused result at that point: 8/8 tests passed across the integration and two
drift files.

### Deferred contract cleanup

- A new transactional fake test produced a valid RED (`Set` size 1 instead of
  2) because `nextId` was not committed; persisting it produced GREEN (5/5).
- Do Not Call validation now has table cases that independently omit the
  confirmation and reason.
- Compact workspace integration now invokes and verifies create/edit/revision
  callbacks.
- Mobile discard assertions cover the fresh `startedAt` and wait for restored
  state, removing an effect-timing race. The web suite passed twice after this
  correction.

### Integrated schema and reconciliation contract

The first complete typecheck produced seven web errors: imported activities can
have a null source occurrence date, local activity inserts require
`timelineSortAt`, and the duplicate refresh callback requires returned groups.
The existing typecheck was the RED contract check for the activity schema. A
focused OrganizationsPage regression additionally failed by rendering
`unavailable` instead of the refreshed group `county fair`. The implementation
now falls back to `timelineSortAt`, writes that field for local activities, and
returns fresh groups or null. Focused verification passed 3/3 and the web
package typecheck exited 0.

## Fresh full automated verification

Command:

```text
CI=true XDG_DATA_HOME=/tmp/task10-xdg PNPM_HOME=/tmp/task10-pnpm \
  pnpm --filter @workspace/api-server test &&
CI=true XDG_DATA_HOME=/tmp/task10-xdg PNPM_HOME=/tmp/task10-pnpm \
  pnpm --filter @workspace/adventure-zone exec vitest run &&
CI=true XDG_DATA_HOME=/tmp/task10-xdg PNPM_HOME=/tmp/task10-pnpm \
  pnpm run typecheck &&
CI=true XDG_DATA_HOME=/tmp/task10-xdg PNPM_HOME=/tmp/task10-pnpm \
  pnpm run build
```

Fresh result before final review:

```text
API:      60 passed files, 3 skipped; 754 passed tests, 48 skipped (802 total)
Web:      19 passed files; 130 passed tests
Typecheck: lib build plus API, web, and scripts all exited 0
Build:    API and web production builds exited 0
Overall:  exit 0
```

The web build emitted existing source-map reporting messages and large-chunk
advisories, but transformed 1,913 modules and completed successfully. These are
non-failing build warnings, not hidden or excluded errors.

## Manual browser evidence (separate from automation)

The Vite server was successfully started directly:

```text
./node_modules/.bin/vite --config vite.config.ts --host 127.0.0.1 --port 4173
VITE v7.3.6 ready; Local: http://127.0.0.1:4173/
```

The available Cloud Browser then rejected the local address:

```text
Browser Use cannot open http://127.0.0.1:4173 in tab 1.
Browser reported: net::ERR_BLOCKED_BY_CLIENT
```

No local Chromium, Chrome, Playwright, or browser executable was available.
Therefore none of the following is claimed as manually passed:

| Manual acceptance item | Desktop | 390×844 | Evidence/status |
| --- | --- | --- | --- |
| Queue and active-caller layout | Blocked | Blocked | Browser cannot reach localhost |
| Booking, route leg, last-contacted rendering | Blocked | Blocked | Browser cannot reach localhost |
| Phone types, extension, Copy, DNC wording | Blocked | Blocked | Browser cannot reach localhost |
| Exact auto-open and suggestion click/reasons | Blocked | Blocked | Browser cannot reach localhost |
| Refresh, failed-save retention, successful clear | Blocked | Blocked | Browser cannot reach localhost |
| Keyboard focus, announced labels, 44×44 targets | Blocked | Blocked | Browser cannot reach localhost |
| Configured `tel:` handler and Copy fallback | Blocked | Blocked | No reachable browser or configured OS handler |
| Voicemail launcher does not imply an outcome | Blocked | Blocked | No private launcher configured; none committed |

Automated component and integration tests cover portions of these behaviors,
but they are not substituted for the required desktop/mobile manual pass. A
release owner must execute and record the runbook acceptance checks in a
reachable browser with configured handlers before enablement.

## Rollout-control verification

- `render.yaml` defaults `ASSISTED_CALLING_ENABLED` to the string `"false"`.
- `VOICEMAIL_LAUNCH_URL` is `sync: false`; its private value is absent.
- The runbook requires migrations 020 and 021 and includes a stop-on-results SQL
  query proving exactly one primary `contact_phones` row for each legacy
  nonblank phone.
- Enablement is owner-only and follows standard call, office-extension,
  explicitly saved voicemail, incoming lookup, and mobile smoke tests.
- The wording gate prohibits connection, delivery, or implied voicemail
  outcome claims.
- Rollback only disables the UI and retains additive migrations and recorded
  call data.

## Commits and review

- `fe1b71b5544630043b60cb5987638e85a7ee2e80` —
  `docs: add assisted calling rollout`
- `d0e0f1013e239d83977cc89742d925e2cc249bef` —
  `test: close assisted calling verification gaps`

Final independent review found no critical issues and assessed the change as
ready with fixes before enablement. The actionable code/document findings were
addressed: a real `CallWorkspace` regression now proves a suppressed mobile
number has no call/voicemail actions while the office-extension actions remain,
the backfill gate now requires the primary row's display and normalized values
to match the legacy contact columns, and the timing-dependent five-millisecond
mobile test delay was removed. The manual verification finding remains an
explicit release blocker rather than being misreported as fixed.

The first post-review full-suite run exposed a transient queue assertion that
observed the old workspace button between the total update and the next
workspace effect. The assertion now waits for that observable transition to
settle; the focused queue file then passed five consecutive runs (35/35 tests).

## Remaining release gate

Do not deploy or set `ASSISTED_CALLING_ENABLED=true` from this task. Manual
desktop/mobile, accessibility, configured handler, clipboard, and private
voicemail-launcher verification must be completed and recorded during the
approved owner release window.

## Fix round 1: canonical timeline ordering

Both activity repositories mapped an imported activity with a null
`occurredAt` to its non-null `timelineSortAt`, but selected the ten-row timeline
using `occurred_at DESC`. PostgreSQL places nulls first for that descending
order, so enough undated imported rows could exclude a newer dated call before
mapping occurred.

Strict TDD evidence:

1. Added the same focused repository regression in the API and web packages.
   Each fixture contains eleven older undated imported activities plus a newer
   dated call and models PostgreSQL descending null ordering before the
   ten-row limit.
2. RED, API: 1 failed; first item was `imported-0`, expected `newer-call`.
3. RED, web: 1 failed with the same observed and expected IDs.
4. Changed only the primary order expression in both repositories from
   `occurredAt` to `timelineSortAt`, retaining `createdAt` and ID tie-breakers.
   This matches migration 007, which backfills `timeline_sort_at` from
   `coalesce(occurred_at, created_at)` and then makes it non-null, and matches
   the current non-null schema column.
5. GREEN: API 1/1 and web 1/1 focused tests passed.

Full-chain command, with the task-local XDG and pnpm paths prefixed to each
pnpm invocation because the sandbox denies pnpm's default `/root/.local` path:

```text
pnpm --filter @workspace/api-server test &&
pnpm --filter @workspace/adventure-zone exec vitest run &&
pnpm run typecheck &&
pnpm run build
```

Final full-chain result after this report update:

```text
API:       61 passed files, 3 skipped; 755 passed tests, 48 skipped (803 total)
Web:       20 passed files; 131 passed tests
Typecheck: library build plus API, web, and scripts exited 0
Build:     API and web production builds exited 0
Overall:   exit 0
```

The existing non-failing source-map and large-chunk advisories remained. Manual
desktop/mobile/accessibility and configured-handler verification remains
blocked exactly as recorded above. The feature flag remains false; no deploy,
migration, or enablement was performed.

## Final whole-branch fix wave

All Critical and Important final-review findings were addressed with focused
regressions before the production changes. The transport schema now coerces
and validates ISO JSON dates while retaining Date objects in the service
contract, and the completion route test crosses the real Express JSON and owner
authorization boundaries. Contact fields and phone rows now use one
transactional endpoint; nullable extension/label values normalize safely, and
suppressed-phone validation rolls the contact update back.

Legacy phone compatibility is durable rather than one-time: migration 022 adds
an idempotent contacts trigger so normal create, quick create, ACT/import/apply,
and edits dual-write the primary phone row, while repository reads self-heal a
legacy-only record under a contact row lock. Suppressed rows cannot be omitted,
deleted, or changed in place. The editor protects their remove controls.

Do Not Call confirmation is bound to the selected phone ID in drafts, client
validation, and server validation. Changing or losing the selected phone clears
the confirmation and reason. Desktop method defaults derive from the selected
phone and never silently use `mobile_log`; mobile direction derives a canonical
script, and the server rejects incompatible mode/method/direction/script
metadata.

Feature-off behavior is fail-closed. `/calls/new`, `/calls/log`, caller finder,
quick caller, workspace, completion, contact actions, and event-profile actions
do not expose assisted entry when the shared server flag is false or unavailable.
No assisted workspace request occurs before the config response. The existing
Today link remains the fallback.

Finder query narrowing now excludes unrelated due-today candidates once a query
is typed, preserving genuine matches beyond the former 64-row interference;
ZIP and booking status participate in bounded matching. `Copy number` is
available for mobile, office, alternate, and unknown phone types, including
suppressed numbers, while call and voicemail actions remain unavailable for a
suppressed number.

Focused RED evidence included: HTTP completion 400 for valid ISO JSON; atomic
route 404s before the endpoint existed; missing migration 022; finder returning
unrelated due rows and missing status; five missing Copy fallbacks; two workspace
failures for stale DNC/default mobile method; four feature-off pages rendering
assisted UI and an API endpoint returning 200. Corresponding focused suites were
green after each minimal implementation. The broader pre-merge runs were API
768 passed/48 skipped and web 142 passed, with typecheck exit 0.

Current `main` was verified unchanged at
`470883df172c7bd8381086bd8f10ebf5323dba09`. Its four commits since merge-base
`548a4aaae177de89070f9ab3e74982900b3e054c` change nine ACT-replacement/spec
paths. Those exact main blobs were overlaid without assisted-calling conflicts;
their local Git blob hashes matched the remote main blob SHAs before the merge.

Manual release evidence remains separately blocked: the local browser remains
unreachable, no OS phone handler or clipboard permission can be verified, and
no private voicemail launcher is configured. This wave did not deploy, enable
the flag, or run migrations. `ASSISTED_CALLING_ENABLED` remains default false.

The assisted-calling fix commit is
`54aaefe17224ee6373b10f8d82af9405e383a03a`. The conflict-free main
integration is the true two-parent merge
`778720f68d1eba2b290726b72ddda76b283e10b5`, whose ordered parents are the
fix commit and main `470883df172c7bd8381086bd8f10ebf5323dba09`.

The exact final verification command, run from the final evidence tree with
the task-local XDG and pnpm paths exported, was:

```text
pnpm --filter @workspace/api-server test &&
pnpm --filter @workspace/adventure-zone exec vitest run &&
pnpm run typecheck &&
pnpm run build
```

It exited 0 with these counts:

```text
API:       62 passed files, 2 skipped; 774 passed tests, 49 skipped (823 total)
Web:       20 passed files; 144 passed tests
Typecheck: library build plus API, web, and scripts exited 0
Build:     API and web production builds exited 0
Overall:   exit 0
```

The existing non-failing source-map warnings and web chunk-size advisory were
the only diagnostics. Connector-created blobs for the final evidence changes
matched local `git hash-object` values, and the final connector commit used the
merge tree as its base. The branch ref was moved only after the full chain
passed, without force. The final commit SHA and remote tree SHA are returned in
the Task 10 handoff because a commit cannot embed its own content-derived SHA.
