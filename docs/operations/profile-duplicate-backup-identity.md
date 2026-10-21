# Preserve backup source identities during reversible profile merges

The owner duplicate-review merge discovered google_drive_backup_jobs.entity_id and google_drive_backup_mappings.entity_id as generic organization references. Both tables are uniquely keyed by (entity_kind, entity_id). Reparenting source backups onto an already-backed-up survivor therefore raises a uniqueness error; without a collision it incorrectly redirects the original source identity and potentially an active worker lease.

These rows now stay outside duplicate-review reference capture, movement, locking and undo journaling. This follows the retainedMergeReferences policy already used by the connector merge flow. Jobs, generations, leases, run links and separate Drive file mappings retain their original identities. Normal organization/child backup enqueue triggers still run; backup workers independently handle archived sources and their source_removed_at state.

Business records still move under the existing transactional merge. Their stale-preview, uniqueness and undo protections remain. No constraint is removed, no backup record is deleted, and no remote Drive write is introduced. Older merge journals are unchanged; this corrects new previews/merges.

Verification: reproduced the exact google_drive_backup_jobs conflict in PGlite before the patch. Three new regressions failed on the baseline and passed after the change: colliding identities with merge/undo, source-only identities, and independent backup-worker progress between preview, merge and undo. The full available focused checkout passed 18 tests (existing merge/undo, scan and fetch regressions included). Targeted TypeScript checks passed for the service and matcher. Full monorepo build/typecheck and a production merge remain unverified in this partial checkout.

Deploy, reopen Compare / Merge to obtain a fresh preview, and retry the reviewed pair. No manual backup cleanup is needed for this failure.
