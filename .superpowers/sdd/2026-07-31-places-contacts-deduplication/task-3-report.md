# Task 3 report — reviewed migration apply workflow

## Delivered

- Passed an explicit `enabled`/`disabled` reviewed-import rollout state and a digest-bearing reviewed-import summary from the migration page to its client workspace.
- Added a visible **Apply approved changes** action only for complete, finalized previews with server-approved work and an authorized rollout.
- Added one confirmation step that lists approved Places, Contacts, Relationships, and Calling lists before the queue is started. The confirmation makes clear that writes affect Command Center only and never change Act!.
- Hardened the start action: it requires owner authorization, a valid run/request ID, the current stored preview digest, the single confirmation token, enabled rollout, and server-computed approved work before it constructs the bounded apply service.
- Added in-session queue result copy for succeeded, skipped, blocked, and failed operations, plus continuation and same-batch retry controls. The retry calls the existing idempotent batch retry path rather than creating a new batch.
- Kept unresolved proposals visible as queued for later review and added an explicit disabled-rollout message.

## Test-first evidence

The action tests were added and run before the action change. They failed because the action still accepted the old client manifest input and did not compare the reviewed preview digest:

```text
Tests  2 failed | 32 passed (34)
```

The UI tests were then added and run before the client change. They failed because the interface still rendered the direct import button and lacked the disabled-rollout message:

```text
Tests  2 failed | 21 passed (23)
```

## Verification

```text
npx vitest run tests/unit/act-migration-review.test.tsx tests/unit/act-migration-actions.test.ts tests/unit/act-env.test.ts --maxWorkers=1
Test Files  3 passed (3)
Tests       65 passed (65)

npm run typecheck
exit 0

git diff --check
exit 0
```

## Self-review

- The client-supplied manifest was removed from the public apply action. The queue continues to rebuild its manifest from the locked, stored preview, while the action now rejects a stale digest before it reaches that queue.
- The action checks server-computed `ready` and `approved` values, so a browser cannot broaden approval selection or start an empty reviewed import.
- The same request key is retained for a confirmation submission, and follow-up retry controls operate on the returned batch ID; this preserves the existing queue idempotency boundary.
- The fallback `applyEnabled` prop remains only for existing isolated component callers. The page uses the explicit rollout state and reviewed-import summary path.

## Concerns

- PostgreSQL integration tests were intentionally not run for this UI/action/env task. No disposable `CRM_TEST_DATABASE_URL` is configured in this worktree, and this change does not alter migrations or queue persistence.
- Queue result and retry controls are maintained in client session state after starting a batch. A refreshed page still preserves the durable queue and its idempotency guarantees, but a later task could expose persisted batch history if operators need to resume a batch after navigation.
