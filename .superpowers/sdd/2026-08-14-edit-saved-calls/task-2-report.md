# Task 2 report — atomically edit a call note and outcome

## Scope

- Added `EditActivityInput.callOutcome?: PersistedCallDisposition` to API and web activity types.
- Extended the API edit Zod schema to accept only the persisted call disposition values:
  `no_answer`, `left_voicemail`, `follow_up_needed`, `interested`, `proposal_sent`, `booked`, `declined`, `last_resort`, `spoke_with_contact`, `wrong_number`, `do_not_call`.
- Updated `DrizzleActivityRepository.edit` to:
  - lock the activity row;
  - lock the linked call session only when `callOutcome` is supplied;
  - reject `callOutcome` edits for activities without a linked call session with `INVALID_ACTIVITY_INPUT`;
  - insert the activity body revision;
  - update `activities.body`;
  - update only `call_sessions.disposition`;
  - record audit snapshots for the activity and call session changes;
  - return the updated timeline item through the existing projection.
- Left the `/activities/edit` response envelope unchanged: `{ ok: true, activity }` / `{ ok: false, error }`.

## TDD evidence

Added tests first:

1. `ActivityService editing > rejects an invalid call disposition before reaching the repository`
   - Guards the service/schema boundary.
   - Expected break caught: accepting an unknown disposition and calling the repository.
2. `DrizzleActivityRepository timeline ordering > atomically updates only the note body and linked call disposition`
   - Guards the linked call edit path.
   - Expected break caught: failing to update the call session disposition, failing to increase revisions, or touching booking/contact association tables.
3. `DrizzleActivityRepository timeline ordering > rejects call outcome edits for unlinked activities without changing the note`
   - Guards the safe invalid-input path.
   - Expected break caught: updating the note/revision before proving a linked call session exists.

## Verification run

Attempted focused tests:

```bash
pnpm --dir artifacts/api-server test src/features/activities/activity-service.test.ts src/features/activities/activity-repository.test.ts
```

Result: blocked by the local partial harness before assertions:

- `ERR_MODULE_NOT_FOUND` resolving `./activity-service` from `activity-service.test.ts`.

Attempted repository test alone:

```bash
pnpm --dir artifacts/api-server test src/features/activities/activity-repository.test.ts
```

Result: blocked before assertions by Node 24 strip-only TypeScript handling:

- `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only mode`.

Attempted API typecheck:

```bash
pnpm --dir artifacts/api-server typecheck
```

Result: blocked because this snapshot does not include `tsc`:

- `sh: 1: tsc: not found`.

Static checks performed:

- Confirmed edit schema imports `callDispositionValues` and uses `z.enum(callDispositionValues).optional()`.
- Confirmed API and web `EditActivityInput` types include `callOutcome?: PersistedCallDisposition`.
- Confirmed repository edit path only mutates `activityRevisions`, `callSessions`, and `activities` for a linked call outcome edit.
- Confirmed no `CallService.complete` call or booking/contact/DNC/follow-up writer call exists in the activities edit path.

## Concerns

- The workspace snapshot is partial and has no `.git`; commits were applied through the GitHub connector.
- Local focused tests and API typecheck could not complete because the supplied local harness is missing/has incompatible tooling, not because of assertion failures.

## Fix round 1 evidence

Review finding addressed:

- Updated the linked-call outcome repository test to import `auditEntries` and expect the required insert sequence:
  `[activityRevisions, auditEntries, auditEntries]`.
- Kept the mutation-boundary checks for the linked outcome edit:
  - updates remain `[callSessions, activities]`;
  - booking/contact/follow-up/organization-contact tables are not inserted or updated.

Verification attempted:

```bash
pnpm --dir repo/artifacts/api-server test src/features/activities/activity-repository.test.ts src/features/activities/activity-service.test.ts
```

Result: still blocked before assertions by the local Node 24 strip-only TypeScript loader:

- `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only mode`.

```bash
pnpm --dir repo/artifacts/api-server typecheck
```

Result: still blocked because this snapshot does not include `tsc`:

- `sh: 1: tsc: not found`.

Static check:

```bash
rg "auditEntries|insertedTables|followUps|bookingContacts|organizationContacts" repo/artifacts/api-server/src/features/activities/activity-repository.test.ts -n
```

Result: confirmed `auditEntries` is imported, the expected audit insert assertions are present, and forbidden booking/contact/follow-up/organization-contact insert/update guards are present.
