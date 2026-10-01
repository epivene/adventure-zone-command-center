# Shared booking work queue

## Goal and approved scope

Desiree and Com need to see who is handling an event, the current step, what
remains, and the next action. The first release provides shared work status and
duplicate-work protection. It does not send email, start paid in-app AI, schedule
Com, or change booking, payment, contract, or routing status.

## Existing code inspected

- `features/office/office-task-repository.ts` and `routes/office-admin-tasks.ts`
  provide coordinator-account tasks and an existing Tasks surface.
- `features/assistant-workspace/profile-task-*` and
  `db/assistant-workspace-profile-tasks.ts` provide batches, leases and progress
  for the in-app assistant. Their authority and source messages belong to that
  assistant, so Com must not be represented as an in-app assistant run.
- `features/chatgpt-connection/operation-store.ts` supplies transactional,
  idempotent receipts. Existing connector mutations enforce scopes and revisions.
- Connector merge support inventories linked record types. New queue links must
  participate in merge preservation and stale-preview checks.

These findings are from the local merge-connector snapshot at f9ccdf9. Before
implementation, reconcile with current main and preserve unrelated changes.

## Approach

Use a small shared activity store, surfaced in the existing task workspace and
on profiles, with links to existing drafts, documents and follow-ups. Existing
office and assistant tasks retain their behavior; do not migrate or restart them.

Extending office-task ownership directly would entangle Com with coordinator
login accounts. Reusing assistant runs would entangle it with paid execution.
The shared activity store avoids both while keeping one Tasks navigation entry.

## Activity and display

An activity identifies the profile, booking year (required), optional booking,
queue category, title, responsible actor, status, next action, optional due time,
latest progress, and linked records. Queue categories follow the five established
booking queues. Statuses are queued, researching, draft_ready, waiting_desiree,
waiting_customer, blocked, completed and cancelled.

Progress may include completed/total counts and a short remaining-work summary.
Counts must be nonnegative and completed cannot exceed total. Status and last
update are reported by the worker; the UI must never imply a live Com heartbeat.
Show stale work as last updated at a timestamp, not as actively running.

The task view filters by status, queue, booking year and responsible actor. A
profile card shows its active activity with next action and review links.
Keep cards readable on folded and unfolded phone widths, avoiding wide tables.
Users can update status, hand off responsibility, and complete/cancel an activity.

## Duplicate protection and concurrency

Allow one nonterminal activity per profile and booking year. Different years
remain independent. One activity can cover research, draft revisions and related
paperwork; these are steps rather than competing tasks.

Enforce the active uniqueness rule in the database, not with a read-before-write
check alone. Starting work for an occupied profile/year returns the existing
activity and its responsible actor. It never silently takes over.

All updates require the exact revision. A stale update returns a conflict and
current record for review. Handoffs are explicit owner actions, or release and
claim operations respecting current ownership. Expired/stale progress never
automatically releases ownership. Completed/cancelled activities remain history;
new work creates a new activity and can reference the previous activity.

## Connector and permissions

Add paginated list/read, claim/create, update-progress/status and release tools.
Reads require crm:read. Create requires crm:append; editing existing activities
requires crm:update. Missing scopes return the existing consent-required behavior;
do not broaden scopes automatically. Connection ownership and revocation are
checked for every operation. A connector may update only work it owns; the
authenticated app owner can explicitly reassign it.

Use the existing OperationStore for stable request keys and committed receipts.
Same-key retries return the original result; changed payloads under the same key
are rejected. A failure rolls back the activity and receipt together.

Resolve linked internal IDs against accessible profiles and verify profile/year
associations where stored. External review links allow HTTPS only and must be
rendered as links, never executable content. Keep original evidence in its
existing notes, email, draft or document record; avoid copying whole histories.

## Boundaries and coordination

This is coordination metadata. It does not grant send, signature, payment,
inventory, merge or booking authority. Completing an activity does not mark a
follow-up complete or a draft sent. Follow-ups retain their existing due dates
and completion evidence. Queue progress does not create CRM timeline notes.

Com must claim work before research/drafting and update the same activity during
revisions. Existing workflows that do not participate can still operate; this
release cannot prevent independent Gmail edits or duplicate work in unconnected
chats. Surface that limit in connector documentation.

On profile merge, preserve activity history and links. If both profiles have
active work in the same year, block the merge with a clear resolution request;
do not discard either activity or automatically choose a winner.

## Acceptance and verification

- Two concurrent claims for the same profile/year produce one active activity.
- Different years can be claimed independently; duplicate retries do not add work.
- Wrong owner, revoked connections, missing scope and stale revisions fail safely.
- Owner edits survive stale Com writes, with a visible conflict and reread path.
- Interruptions retain counts, next action and links without replaying operations.
- Terminal activities remain visible in history and permit a new active activity.
- Merge conflict checks and link preservation include these tables.
- App task/profile views show status, owner, update time, progress and review links.
- Loading, empty, error and update-conflict states are explicit and usable on phones.
- Tests verify no email sending, worker scheduling or paid model calls are invoked.
- Run focused database/service/UI tests and both builds; document unrelated failures.

## Later releases

Reply-triggered follow-up changes, a combined email review editor, automatic
booking-readiness checks and route-aware recommendations are separate changes.
Do not bundle them into this first release.
