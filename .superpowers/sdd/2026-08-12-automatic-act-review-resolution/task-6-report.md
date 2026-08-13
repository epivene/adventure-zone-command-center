# Task 6 report: automatic review frontend

## Outcome

- Added the typed `resolveAutomaticReview(runId, { expectedManifestDigest, requestKey })` client boundary using the existing shared request/error mapping.
- Added `Resolve obvious issues` only for organized (`ready_to_apply`) runs with a current manifest and review-required outcomes.
- The action explains exact-match linking, new records for remaining ambiguity, ACT-value selection, skipped/archive-retained unsupported records, and manual handling of uncertain cases.
- Busy state and the synchronous busy ref prevent overlapping clicks. One click generates one request key and reuses it for the bounded transient network retry; a later explicit click generates a different key.
- Success merges the bounded workflow response, refreshes the durable run, invalidates the current paged review query, removes resolved rows, and retains manual controls when `manualReview > 0`.
- The accessible `Automatically resolved` region renders only bounded linked/new/relationship/ACT-value/unsupported counters and explicitly says when records still need manual review. It does not claim that all relationships were resolved.

## TDD evidence

Tests were added before production code.

Initial RED:

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run \
    src/features/act-replacement/act-replacement-client.test.ts \
    src/pages/ActMigrationPage.test.tsx

Test Files  2 failed (2)
Tests  5 failed | 34 passed (39)
```

The client failures were `resolveAutomaticReview is not a function`; the page failures could not find `Resolve obvious issues`.

A later request-key recovery regression was also observed RED before adding retry behavior:

```text
Test Files  1 failed (1)
Tests  1 failed | 37 passed (38)
```

It failed because the command was called once rather than twice with the same per-click key.

Final focused GREEN:

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx

Test Files  1 passed (1)
Tests  38 passed (38)
```

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run src/features/act-replacement/act-replacement-client.test.ts

Test Files  1 passed (1)
Tests  2 passed (2)
```

## Broader verification

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run

Test Files  9 passed (9)
Tests  79 passed (79)
Exit status 0
```

```text
$ pnpm --filter @workspace/adventure-zone build

1904 modules transformed
built in 4.79s
Exit status 0
```

The build retained existing sourcemap-location and large-chunk warnings.

```text
$ git diff --check
(no output)
Exit status 0
```

The required frontend typecheck was run but remains blocked by unrelated pre-existing diagnostics:

```text
$ pnpm --filter @workspace/adventure-zone typecheck

src/features/activities/activity-repository.ts:70,95,216
src/features/contacts/contact-repository.ts:524,546
src/pages/OrganizationsPage.tsx:119
Exit status 2
```

There were no typecheck diagnostics in the Task 6 client, page, component, or tests.

## React review

Applied `vercel:react-best-practices` after implementation. The interaction remains in an event handler, visibility is derived during render, functional state updates are used, and the new UI has native button plus labelled-region semantics. No extra effects, client libraries, or bundle dependencies were added.

## Remaining concern

- Workspace owners must resolve the unrelated activity/contact timeline typing and `OrganizationsPage` callback errors before the frontend typecheck can be claimed globally green.

## Fix round 1/5: post-organize phases and live result status

### Root cause

The action's render predicate and click guard independently hard-coded `ready_to_apply`. A durable `complete_with_issues` run can still expose `canReview` and `canApplySafe`, but both frontend gates rejected it before `resolveAutomaticReview` could run. The asynchronous result also used a named `region`, which did not announce the newly rendered summary as status output.

### RED

The page regressions were added before production changes:

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx

Test Files  1 failed (1)
Tests  2 failed | 44 passed (46)
Exit status 1
```

The failures independently proved that:

- `complete_with_issues` did not render `Resolve obvious issues`, so the click could not reach the typed client;
- the success summary could not be found as the named `status` role.

Seven excluded phases (`extracting`, `extract_complete`, `organizing`, `applying`, `complete`, `failed`, and `superseded`) remained hidden during RED.

### GREEN implementation

- Added one shared post-organize allowlist predicate containing only `ready_to_apply` and `complete_with_issues`; both the render predicate and click guard use it.
- Kept manifest, positive review count, `canReview`, and synchronous busy-lock checks unchanged.
- Changed the named success summary to `role="status"` with explicit `aria-live="polite"`.
- Added a visibility-and-click regression for a reviewable/apply-safe `complete_with_issues` run and loaded-UI assertions for every excluded phase.
- Re-applied `vercel:react-best-practices`; phase visibility remains render-derived with no new effects or dependencies, and the asynchronous result has one labelled polite status.

Focused GREEN:

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx

Test Files  1 passed (1)
Tests  46 passed (46)
Exit status 0
```

### Fix-round verification

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run

Test Files  9 passed (9)
Tests  87 passed (87)
Exit status 0
```

```text
$ pnpm --filter @workspace/adventure-zone build

1904 modules transformed
built in 4.94s
Exit status 0
```

The build retained the existing sourcemap-location and large-chunk warnings.

```text
$ pnpm --filter @workspace/adventure-zone typecheck

src/features/activities/activity-repository.ts:70,95,216
src/features/contacts/contact-repository.ts:524,546
src/pages/OrganizationsPage.tsx:119
Exit status 2
```

Typecheck again reported only the pre-existing unrelated baseline, with no Task 6 diagnostic.

```text
$ git diff --check
(no output)
Exit status 0
```
