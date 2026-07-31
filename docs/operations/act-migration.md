# Act! Migration Staging and Preview Operations

This runbook covers the Slice 2 staging and review workflow for Companies,
Contacts, Opportunities, Groups, and their supported relationships. Capture
uses the read-only Act! API. The workflow writes durable snapshot,
checkpoint, preview, decision, and audit metadata in the application database,
but it does not apply CRM records in either system.

The migration workflow is separate from the existing reviewed Contact sync.
It has no Apply or Import action. A saved approval is a stored review decision
only; it is never an applied or imported Place, Person, Booking, relationship,
or Calling list change.

## Safety boundaries

- Only the configured owner may operate the workspace.
- Act! is a read-only source for this workflow. No Act! record is created,
  edited, or deleted.
- Places, People, Bookings, Place-Person and Booking-Person relationships, and
  Calling lists remain unchanged. Only migration staging and review metadata
  may change.
- Stable Act! IDs are the only automatic identity match. First-time fallback
  matches remain reviewable, and ambiguous matches are never merged
  automatically.
- In this workflow, source absence never deletes or deactivates a local record.
- A stored preview is immutable. Reopening it reads the stored snapshot,
  proposals, and stored review decisions; it never silently fetches or rematches.
- Legacy `.xls` files are reconciliation evidence and test fixtures only.
  They are not a production import source for this workflow.

## 1. Required server-side Act! environment variables

Configure all four names in the deployment platform's server-side secret
store. Do not put values in this runbook, source control, screenshots, tickets,
chat, shell history, or any `NEXT_PUBLIC_` variable.

| Name | Purpose |
| --- | --- |
| `ACT_API_BASE_URL` | The fixed approved Act! Premium Cloud Web API endpoint |
| `ACT_DATABASE_NAME` | The source Act! database identifier |
| `ACT_USERNAME` | The shared Act! account name |
| `ACT_PASSWORD` | The shared Act! account password |

All four must be present together. After changing them, redeploy before
testing. The migration page may display only configuration status and a masked
database suffix; it must not expose the database name, username, password, or
authorization header.

## 2. Test connection

The migration workspace has no **Test connection** control. Open
**Settings → Act! Sync** and use its existing **Test connection** action, which
uses the same server-side Act! configuration. It reports only a sanitized
result and does not change contacts. Return to **Settings → Act! migration**
only after that check succeeds.

If the connection check fails, stop. Correct the server-side configuration or
account permission and redeploy. Do not start a migration to diagnose
credentials, and do not paste the response, credentials, or source records
into logs or support channels.

## 3. Start preview snapshot

1. Open **Settings → Act! migration** as the configured owner.
2. Confirm the page says **Preview only — no Command Center or Act! records are
   changed** and shows only a masked database suffix.
3. Select **Start preview snapshot** once. The request key makes an accidental
   repeat idempotent.
4. Record the run ID and UTC start time in the restricted operations log.

The action reads Companies, Contacts, Opportunities, Groups, and the
Company-Contact, Opportunity-Company, Opportunity-Contact, and Group-Contact
relationship streams. It stores each page once in migration staging. Invalid
rows remain visible as deterministic sanitized errors; valid rows retain
stable Act! IDs.

## 4. Bounded progress and safe resume

This bounded progress model keeps every operator action short and resumable.
Each start, continue, or resume action makes at most 10 Act! requests. The
workspace runs only one continuation at a time and persists each completed
page and checkpoint before moving on. A failed request stops that action; it
does not skip ahead or restart a completed page.

Use **Continue snapshot** while progress is changing. A lease no-op stops
automatic continuation and offers **Check again**, preventing a tight retry
loop. Use **Resume** only for a displayed retryable interruption and only after
its `retryAfter` time, when present. Resume the same run: it continues from the
last committed offset and does not duplicate staged records, relationships,
proposals, or decisions.

Reloading or navigating away is safe. The run, checkpoint, and stored preview
state are durable. Never create manual CRM records to compensate for a paused
capture.

## 5. Projected-query compatibility fallback

The projected-query compatibility fallback is automatic and narrowly scoped.
If the first projected page is empty, the checkpoint retries the same offset
in plain query mode without `$select`, `$expand`, or `$orderby`. Later empty
pages complete normally; they do not switch modes.

The fallback is a compatibility read, not permission to ignore missing data.
After it occurs, review every stream count, checkpoint, sanitized error, and
reconciliation result before finalizing the preview.

## 6. Retryable and non-retryable failures

Retryable failures include rate limiting, temporary Act! unavailability, and
retryable server/network interruptions. Stop clicking, preserve the run, wait
until the displayed `retryAfter` time when supplied, and then select
**Resume**. The same checkpoint and offset must continue.

Non-retryable failures include missing configuration, rejected credentials,
missing Web API permission, non-retryable client responses, and malformed Act!
responses. Do not force or repeatedly retry the run. Preserve its sanitized
failure evidence, correct the configuration, permission, or source issue, and
start a fresh run after remediation.

Unknown errors are shown as static sanitized copy. Operators must never add raw
response bodies or source values to an error report.

## 7. Preview states and allowed decisions

Finalization is available only when every checkpoint is complete. It creates
one immutable proposal set from the finalized source snapshot and a
deterministic local snapshot.

| Preview state | Meaning | Possible stored decisions |
| --- | --- | --- |
| `new` | Proposed new local target | `approve_proposed`, `ignore` |
| `matched_unchanged` | Stable match with no proposed change | None |
| `change` | Proposed change to a matched target | `approve_proposed`, `ignore` |
| `new_relationship` | Proposed relationship | `approve_proposed`, `ignore` |
| `possible_duplicate` | Candidate duplicates require review | `link_existing`, `keep_separate`, `ignore` |
| `needs_review` | A reviewer must resolve the proposal | `link_existing`, `keep_separate`, `ignore` |
| `ignored` | Explicitly excluded by the proposal rules | None |
| `error` | Sanitized source or proposal error | None |

The exact controls are proposal-aware. `link_existing` appears only when a
current candidate is available. `keep_separate` is limited to eligible Person
duplicate cases. Unresolved Place, Booking, relationship, or Calling list
issues may allow only `ignore`. An ignore decision requires a reason. Select
only candidates and primary sources shown by the workspace.

`approve_proposed` means “record this review decision for Slice 3”; it does not
apply, import, merge, or synchronize the proposal. Review decisions preserve
the actor and timestamp and remain visible after reload.

## 8. Reconciliation counts

The reconciliation report must account for every source record and
relationship exactly once as a proposal, explicit ignored reason, or visible
sanitized error. Capture and retain:

- source counts for Company, Contact, Opportunity, and Group;
- relationship counts for all four supported relationship streams;
- counts for every preview state;
- Places without People and multi-Place People;
- Opportunities without a reliable Place and Opportunities without a reliable
  Person;
- unsupported Groups and duplicate source ID conflicts;
- incomplete and failed checkpoint counts;
- the source digest, proposal digest, and complete flag.

The complete flag is acceptable only with a nonempty checkpoint set, zero
incomplete checkpoints, zero failed checkpoints, unique proposal ownership,
valid proposal dependencies, and valid primary-source choices. Replaying the
same completed source snapshot must reproduce the same source and proposal
digests.

## 9. Proof that no local CRM records are applied

For the reviewed run, retain all of the following evidence:

1. the preview-only warning and the absence of an Apply or Import control;
2. before/after read-only counts and update-time evidence from Places, People,
   Bookings, Place-Person relationships, Booking-Person relationships, and
   Calling lists;
3. the run's staging, proposal, decision, and audit-metadata counts, which are
   expected to grow without changing CRM entity rows;
4. passing mutation-safety integration tests against a disposable test-only
   database;
5. confirmation that the Act! source was not changed.

Any CRM entity count or update-time difference stops the gate. Preserve the
evidence and investigate; do not “correct” the difference with a migration
decision.

## 10. Evidence required before Slice 3

Before proposing the reviewed-import slice, capture in restricted operations
evidence:

- commit SHA, deployment identifier, operator, UTC timestamps, run ID, and only
  the masked Act! database suffix;
- per-stream staged, completed, failed, and checkpoint counts;
- reconciliation counts, completion status, source digest, and proposal
  digest;
- paginated examples of every populated preview state, including first-time
  fallback and ambiguous matches;
- Places without People, multi-Place People, Opportunities without a reliable
  Place or Person, unsupported Groups, and duplicate source IDs;
- persisted review decisions with safe IDs, actor, and timestamp;
- sanitized retryable and non-retryable failure/resume evidence where
  available;
- the non-database verification output and the real disposable-PostgreSQL
  release-gate output.

An unset `CRM_TEST_DATABASE_URL`, a skipped suite, or a gated suite is not a
PostgreSQL release-gate pass. Record it as **PostgreSQL gate NOT RUN**. Do not
start Slice 3 until the gate has actually run and passed.

## 11. Abandoning a bad run safely

To abandon a bad run safely, stop all continue/resume actions and navigate away.
Retain the run, checkpoints, source snapshot, sanitized errors, stored preview,
and stored review decisions as evidence. Never hand-edit or delete the run or
its staging rows.

After the source, configuration, or permission issue is remediated, start a
fresh run with a fresh request key. Do not reuse the old run as if it
succeeded. Abandonment requires no deletion or rollback of Places, People,
Bookings, relationships, or Calling lists because the preview workflow never
changed them.

## 12. Credential and PII logging rules

Credentials, authorization headers, tokens, raw database names, raw source
snapshots, and raw PII must never appear in application logs, browser props,
screenshots, chat, tickets, error messages, or audit decision payloads. Audit
decision payloads may contain safe source/proposal IDs, selected safe candidate
IDs, a review reason, actor ID, and timestamp only.

Use the application's static sanitized error messages and masked database
suffix. If credentials or raw PII are exposed, stop the workflow, restrict the
affected evidence, follow the approved incident process, rotate the affected
credential, and do not resume until sanitized logging is confirmed.

## Slice 2 verification commands

Run the non-database gate in a shell where both `CRM_TEST_DATABASE_URL` and
`CRM_RELEASE_TESTS` are unset:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-types.test.ts tests/unit/act-migration-source-parser.test.ts tests/unit/act-migration-matcher.test.ts tests/unit/act-migration-reconciliation.test.ts tests/unit/act-migration-actions.test.ts tests/unit/act-migration-page.test.tsx tests/unit/act-migration-review.test.tsx tests/integration/act-client.test.ts tests/integration/act-migration-client.test.ts tests/integration/act-migration-snapshot-service.test.ts tests/integration/act-migration-docs.test.ts
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

The PostgreSQL gate is separate. `CRM_TEST_DATABASE_URL` must identify an
explicitly disposable, test-only PostgreSQL database that may create and drop
isolated schemas. It must never point to production or to data that must
survive. `CRM_RELEASE_TESTS=1` is mandatory so missing database configuration
fails closed; skipped or gated PostgreSQL suites fail the release.

In a fresh PowerShell session, obtain `CRM_TEST_DATABASE_URL` from the approved
secret store, validate the database identity as disposable and test-only, then
run:

```powershell
if (-not $env:CRM_TEST_DATABASE_URL) {
  throw "CRM_TEST_DATABASE_URL is required for the PostgreSQL release gate."
}

try {
  $env:CRM_RELEASE_TESTS = "1"
  npm run test:crm-db
  if ($LASTEXITCODE -ne 0) {
    throw "The PostgreSQL release gate failed."
  }
}
finally {
  Remove-Item Env:CRM_RELEASE_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:CRM_TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
```

Do not report the Slice 2 gate as passed unless the exact commit passes the
focused suite, typecheck, lint, full unit/integration suite, production build,
diff check, and the serial PostgreSQL suites with zero skips or failures.
