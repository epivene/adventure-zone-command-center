# One-Time Act! Import Design

**Date:** 2026-08-07  
**Status:** Approved for implementation

## Goal

Complete the one-time Act! replacement import so archived Act! records can be organized, reviewed, and safely added to Adventure Zone Command Center in small, resumable batches.

## User experience

The existing Act! import page becomes a single guided workflow:

1. **Fetch** — copy every available Act! record into the durable archive using the selected extraction batch size.
2. **Organize** — normalize the archive into organizations, contacts, bookings, calling lists, activities, and their relationships.
3. **Review** — separate automatically safe records from duplicates, conflicts, unsupported records, and unresolved relationships.
4. **Import** — approve and apply only safe operations in bounded batches.
5. **Finish** — report imported, already-present, blocked, failed, and still-needing-review totals.

The normal path should require only clear, plain-language buttons. Advanced diagnostics remain available but do not expose Act! credentials, authorization headers, raw request bodies, or unsanitized source data.

## Approved behavior

- Clearly safe records may be approved and imported automatically.
- Duplicate identities, conflicting non-empty local fields, unsupported records, ambiguous matches, and unresolved relationships must wait for explicit review.
- Existing non-empty local values are never overwritten by the automatic path.
- The import never deletes local records.
- The import is one-time, but every step is durable and resumable after a Render restart.
- Small batches are used for both extraction and live application. The default extraction batch remains 100; the default apply batch is 25 operations.
- Repeating a request with the same request key is idempotent and cannot duplicate data.
- A changed manifest invalidates stale approval or apply requests.
- The live apply route remains disabled unless the explicit server-side apply flag is enabled.

## Architecture

### Durable organizer

A production organizer service reads complete archived source versions for one run, normalizes them, resolves relationships and local matches, and builds one deterministic manifest. It persists outcomes and operations with idempotent upserts keyed by run and operation key.

The organizer updates the run phase only after reconciliation succeeds:

- `extract_complete` → `organizing`
- `organizing` → `ready_to_apply`
- reconciliation failure → `complete_with_issues` or a retryable organizing state with a safe error code

An interrupted organization pass can be rerun without creating duplicate outcomes or operations.

### Review boundary

The review API returns sanitized display values, outcome states, issue codes, operation metadata, and the manifest digest. Operation payloads and raw archive values do not appear in list responses.

Safe-default approval selects only operations marked `safeByDefault`, closes required dependencies, and rejects any operation belonging to an outcome that still requires review.

### Bounded apply runner

The apply coordinator accepts the approved dependency-closed operation keys, slices them into batches of 25, and applies batches sequentially. Each batch:

- verifies the current manifest digest;
- claims a durable lease;
- skips operations already applied or already present;
- creates entities before relationship operations;
- records field origins and provenance;
- releases its lease with terminal counts;
- can be safely replayed after interruption.

A batch with blocked or failed operations stops automatic continuation and returns the workflow to review. It does not roll back successfully completed earlier batches and does not delete imported data.

### Frontend workflow

The client adds typed methods for organizing, loading review data and the safe manifest, approving safe defaults, and applying approved operations.

The import page displays:

- the current stage and resumable progress;
- safe-to-import and needs-review counts;
- issue summaries grouped by reason;
- a searchable/paged review list;
- an explicit “Import safe records” confirmation;
- live batch counts and a retry action;
- a final reconciliation summary.

The apply action is unavailable when extraction or organization is incomplete, no safe operations exist, the manifest changed, or the server reports that live apply is disabled.

## Data safety and ownership

All routes retain the existing owner-only run lookup and database scoping. Act! credentials stay server-side. Source records, approvals, manifests, and apply batches remain tied to the run and source database key.

Automatic behavior may create records, fill genuinely empty fields, create verified relationships, and record provenance. Overwrite operations require a separate explicit field-conflict decision and are excluded from safe-default approval.

## Error handling

The UI translates known safe error codes into actions:

- configuration or authentication errors: fix the Render secrets and resume;
- retryable Act! or database errors: resume the current stage;
- stale manifest or stale source version: reload review before approval;
- blocked dependency or local-value conflict: move the source to review;
- live apply disabled: show the exact server-setting requirement without attempting a write.

Unknown errors display a generic failure message and keep technical diagnostics collapsed.

## Testing

Backend tests cover deterministic organization, idempotent persistence, safe-default filtering, dependency closure, batch size limits, restart/replay behavior, stale-digest rejection, local-value protection, relationship ordering, and final reconciliation.

Frontend tests cover stage transitions, issue counts, the review-required boundary, apply confirmation, batches of no more than 25, restart/resume display, disabled apply behavior, and terminal summaries.

A disposable PostgreSQL integration test verifies migrations, archive-to-manifest persistence, application into local tables, provenance, relationships, and replay without duplicates. Production rollout does not enable live apply until the focused tests, typecheck, build, and disposable-database gate pass.

## Rollout

1. Deploy organizer and review UI with `ACT_MIGRATION_APPLY_ENABLED=false`.
2. Run or resume extraction and verify archive/reconciliation counts.
3. Organize the production run and review issue totals.
4. Enable `ACT_MIGRATION_APPLY_ENABLED=true` only for the approved one-time import window.
5. Import safe operations in batches of 25 and resolve remaining review items.
6. Verify final counts and return the flag to `false`.

Disabling the flag stops future live batches. Any data reversal requires a separate audited plan; this workflow performs no automatic destructive rollback.
