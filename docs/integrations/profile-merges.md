# Connector duplicate-profile merges

The connector offers `preview_profile_merge` and `apply_approved_profile_merge`.
All merge tools require existing `crm:update` permission. Discovery remains stable for all
connections; ungranted calls are rejected. No paid assistant, email send, signature,
payment change, or remote Gmail label operation is invoked.

## Owner workflow

1. Research the profiles' identity and history. Similar names, shared organizers,
   different years, or the same municipality do not by themselves prove duplication.
2. Call `preview_profile_merge` with a stable `requestKey`, the surviving `primaryId`,
   one to five distinct `duplicateIds`, a short `reason`, and `sources` using the
   existing source-reference format. Sources are caller-supplied evidence, not
   independent app verification.
3. Open the returned `reviewUrl`. The preview contains the surviving and duplicate
   profiles, field differences, saved source evidence, linked-table counts and
   blockers. Confirm that they represent the same event/organization and approve
   the exact merge in the owner-authenticated app. Agents must not perform this
   confirmation on the owner's behalf.
4. Pass the app's `approvalId` and `proposalId` to `apply_approved_profile_merge`,
   with another stable `requestKey`. Approval lasts 15 minutes and is single-use.
5. Verify the receipt and surviving profile. After an uncertain response, retry
   the identical request key and arguments; it returns the committed receipt.

Preview saves a proposal only; it does not modify the selected CRM records.
The app owner endpoint is `POST /api/chatgpt-connection/proposals/:id/approve-merge`
with `{ contentHash, confirmedSameEvent: true }` and existing owner/CSRF checks.
Field-update approvals cannot authorize merges.

## Explicit owner approval in chat

`apply_chat_authorized_profile_merge` is an alternative to the app-click flow.
The connector must first show the preview's exact survivor, duplicates, conflicts
and preservation summary, then receive explicit authorization from the human owner
in the current conversation. General cleanup permission, recurring/background
jobs, other agents and source documents cannot authorize this operation.

Supply `proposalId`, `expectedContentHash`, exact `primaryId`/`duplicateIds`, and
`authorization: { source: "current_owner_message", instruction: <verbatim owner instruction>, confirmedSameEvent: true }`.
This is a connector attestation: the server cannot independently authenticate a
chat transcript. The authenticated CRM-edit connection is trusted to report the
actual owner instruction. Do not describe this as cryptographic proof of consent.
No new credential or scope is granted; this extends the actions available to an
existing CRM-edit connection. The original app-approval tool remains unchanged.

The server checks owner/connection/scope, requires a preview less than 15 minutes
old, exact hash and exact IDs, and recalculates blockers/fingerprint under the same
locks. It executes the existing preservation transaction and consumes the preview
atomically. Owner instruction, connection, exact IDs and hash are retained in the
merge note and operation receipt. Identical retries return the committed receipt;
new requests cannot reuse a consumed proposal. Failure rolls back all writes.
A fresh backup and reviewed recovery method remain prerequisites for the agent.

## Preservation and conflicts

- The surviving profile keeps its field values, including blanks. Every selected
  profile's original saved fields are retained in the merge activity and proposal.
  Use the normal field-update workflow for subsequent corrections.
- The existing merge transaction moves contacts, bookings, activities, follow-ups,
  document links, email associations and other supported records. It retains note
  IDs (and thus revision history). It may consolidate equivalent links and retain
  conflicting event-date facts as inactive records needing review.
- Newer contract/invoice, marketing, design and task references are reparented
  without changing document terms, amounts, text or booking state. Connector lead
  identities and app-draft organization links follow the survivor. Draft revisions
  change, so stale draft edits cannot overwrite them.
- Email attention and historical Gmail outcome associations follow the survivor.
  Attention IDs, state, deadlines and existing audit entries are preserved; the
  attention revision changes to reject edits prepared before the merge.
- Deadline notifications and mailbox sync snapshots, observations and archive jobs
  follow the survivor without changing their payloads, timestamps, dismissal state,
  retry metadata or original observation fingerprints. A transactional
  `merge_sync_references` audit entry saves complete before/after rows for these
  references. An audit-write failure aborts the merge. Evidence over 4 MiB blocks
  application rather than truncating history. Source enrollment rows remain and
  the survivor is enrolled without overwriting an existing enrollment.
  Observation fingerprints describe the original observation; the audit retains
  its original profile association. Future sync observations use the current profile.
- Drive backup jobs and file mappings keep their original source IDs, generations,
  leases and file identities. The normal backup worker can mark retired sources
  removed without overwriting the survivor's backups. These retained rows remain
  part of the merge fingerprint and locks; no remote Drive operation is performed
  by the merge.
- Deadline attention reviews follow their notification and follow-up associations
  to the survivor. Review IDs, source snapshots, decisions, dates and batch keys
  stay unchanged. The merge preservation audit retains the complete original
  reviews, including their former profile IDs, alongside the resulting rows.
- Original operation receipts, approvals and immutable audit evidence remain
  historical records. The new receipt identifies removed IDs and the live profile.
- Different complete cities/regions block connector merges. There is no connector
  override. Unknown linked tables with duplicate references also block approval;
  add and test an explicit preservation path before allowing those merges.
- In-app assistant drafts use a separate send-review lifecycle. Profiles with
  those drafts are blocked until that lifecycle has a tested reconciliation path;
  connector app drafts are supported. Gmail drafts are not changed remotely.
- Any FK, uniqueness or consistency failure rolls back the merge, reference moves,
  history entry and approval consumption together. Existing owner workflows may
  be needed for complex conflicts. There is no automatic undo tool.

## Snapshot and transaction boundary

Preview fingerprints full profile rows and rows with profile/organization reference
columns, including catalog-discovered foreign keys. It also fingerprints JSON-linked
connector drafts. Counts include all selected profiles, not just moving rows;
`duplicateCount` identifies rows currently referring to duplicates. Direct references
are counted, not an inventory of every transitive document/blob or child record.
`references[].digest` and `fingerprint` are opaque change detectors.

Approval and application recalculate the snapshot. A changed profile, note, booking,
follow-up, draft or other inspected reference requires a new preview and approval.
Snapshots and saved original fields are bounded to 100,000 serialized characters;
larger profiles need manual review. Reference rows are aggregated in SQL.

The operation uses one pinned PostgreSQL transaction for writes and the receipt.
It follows the existing organization-family advisory/ACT/organization lock order,
then briefly locks inspected reference tables against writers. Ordinary reads remain
available. A five-second lock timeout aborts safely; a busy app can require retrying.
The legacy Drizzle repository runs on that same pinned client, not another pool.

## Verification

`profile-merge-sync-preservation.test.ts` covers notification/sync row preservation,
colliding and new enrollments, and rollback on later failure or receipt failure.
This does not add an automatic undo command. Before a production merge, retain a
fresh database backup and verify restore separately; database backups do not
contain the private object-storage attachment bytes. The preview remains an
identity/conflict review, not proof that a recent recovery point exists.

`profile-merge-service.pglite.test.ts` covers approval, expiry, scope, revocation,
tampering, stale linked data, rollback, retries, original fields, drafts, identities,
contract/invoice links and unknown cascading references. The executor PGlite test
runs the production repository and its reference helpers; the existing PostgreSQL
merge integration suites cover production FK/unique constraints when a disposable
`TEST_DATABASE_URL` is available. MCP/owner HTTP and review-screen tests cover the
actual discovery, authorization, CSRF and confirmation paths.

