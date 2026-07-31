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
3. Select **Start preview snapshot** once. After a timeout or uncertain result,
   reload and select or resume the newest stored run before starting another.
   Each later Start generates a fresh request key, so do not treat a repeated
   click as the same request.
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
- duplicate source ID conflicts;
- incomplete and failed checkpoint counts;
- the source digest, proposal digest, and complete flag.

Unsupported Groups are counted separately from stored proposal rows in the
read-only evidence query in section 9.

The complete flag is acceptable only with a nonempty checkpoint set, zero
incomplete checkpoints, zero failed checkpoints, unique proposal ownership,
valid proposal dependencies, and valid primary-source choices. Replaying the
same completed source snapshot must reproduce the same source and proposal
digests.

## 9. Proof that no local CRM records are applied

For the reviewed run, retain all of the following evidence:

1. the preview-only warning and the absence of an Apply or Import control;
2. before/after read-only counts and maximum update times for Places, People,
   Bookings, Place-Person relationships, and Booking-Person relationships;
3. the stored run status, count-only summary, source digest, and proposal
   digest retrieved by the parameterized query below;
4. passing mutation-safety integration tests against a disposable test-only
   database;
5. confirmation that the Act! source was not changed.

Use the approved database console in read-only mode. Bind the reviewed UUID as
the `:run_id` parameter; do not interpolate a value into the statement:

```sql
SELECT id, status, summary, source_digest, proposal_digest
FROM act_migration_runs
WHERE id = :run_id;
```

The stored `summary` contains counts and digests only and supplies its stored
report fields: root, relationship, preview-state, report edge-case, and
checkpoint counts. The stored summary does not contain the unsupported Group
count. Capture the output without adding source rows or display values.

Retrieve that missing count with this PII-safe parameterized aggregate:

```sql
SELECT count(*)::bigint AS unsupported_group_count
FROM act_migration_proposals
WHERE run_id = :run_id
  AND target_entity_type = 'calling_list'
  AND issue_code IN (
    'group_target_unavailable',
    'group_membership_semantics_unknown'
  );
```

This query returns only the count of unsupported Group calling-list proposals;
it does not select proposal snapshots, reasons, or display values.

Before starting the run and again after review, execute this read-only query:

```sql
SELECT 'organizations' AS table_name, count(*) AS row_count,
       max(updated_at) AS max_updated_at
FROM organizations
UNION ALL
SELECT 'contacts', count(*), max(updated_at) FROM contacts
UNION ALL
SELECT 'bookings', count(*), max(updated_at) FROM bookings
UNION ALL
SELECT 'organization_contacts', count(*), max(updated_at)
FROM organization_contacts
UNION ALL
SELECT 'booking_contacts', count(*), max(updated_at)
FROM booking_contacts
ORDER BY table_name;
```

Slice 2 has no local Calling-list entity table or storage. Prove Calling-list
invariance through the absence of any apply/storage path in Slice 2 and the
mutation-safety tests; do not request a count from a nonexistent table.

Any CRM entity count or update-time difference stops the gate. Preserve the
evidence and investigate; do not “correct” the difference with a migration
decision.

## 10. Evidence required before Slice 3

Before proposing the reviewed-import slice, capture in restricted operations
evidence:

- commit SHA, deployment identifier, operator, UTC timestamps, run ID, and only
  the masked Act! database suffix;
- the parameterized `act_migration_runs` result containing status, stored
  count-only summary, source digest, and proposal digest;
- the parameterized `unsupported_group_count` result;
- the before/after five-table row-count and `max(updated_at)` results;
- the mutation-safety test result, including the no-Calling-list-storage
  boundary;
- sanitized retryable and non-retryable failure/resume evidence where
  available;
- the non-database verification output and the real disposable-PostgreSQL
  release-gate output.

Operational evidence must be redacted, PII-free evidence. Do not capture names,
contact values, addresses, source snapshots, review-row screenshots, or
free-text reasons. If a screenshot is required by an external approval process,
redact all PII before storing it.

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
snapshots, and raw PII must never appear in application logs, error messages,
operational evidence, chat, tickets, or audit decision payloads. The minimum
necessary PII is visible only in the owner-only review through safe
`displaySnapshot` fields; credentials and raw source snapshots never enter
rendered props.

Audit decision payloads may contain safe source/proposal IDs, selected safe
candidate IDs, a review reason, actor ID, and timestamp only. Free-text review
reasons must contain no PII, secrets, or copied source values.

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
secret store and ensure inherited `PGPORT` is unset. The installed client uses
`PGPORT` when a URL omits its port, so the preflight rejects every nonempty
value, including whitespace; put any nondefault port explicitly in each URL.
The test URL's database name must contain a case-insensitive, delimited
`test` token, such as exact `test`, `crm_test`, or `test-crm`; a substring in a
word such as `contest` or `testing` is rejected. The preflight below also
rejects malformed/non-PostgreSQL URLs, missing host/database values, and the
same normalized host, port, and database identity as `DATABASE_URL`. Each URL
must use exactly one URL authority host; raw or encoded comma-separated hosts
are rejected. Each authority may contain at most one raw `@` credential
separator; additional separators are rejected before the client can reinterpret
hidden hosts. The `host`, `hostname`, and `hostaddr` host override parameters
are not allowed. One or more terminal DNS dots are removed before host identity
comparison. Single-separator credentials, localhost, bracketed IPv6 hosts, and
explicit ports remain valid.

```powershell
function ConvertTo-PostgresDatabaseIdentity {
  param(
    [string]$Value,
    [string]$VariableName
  )

  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Trim() -ne $Value) {
    throw "$VariableName must be a valid PostgreSQL URL."
  }

  $schemeEnd = $Value.IndexOf("://")
  if ($schemeEnd -lt 0) {
    throw "$VariableName must be a valid PostgreSQL URL."
  }
  $authorityStart = $schemeEnd + 3
  $authorityEnd = $Value.IndexOfAny(
    [char[]]@("/", "?", "#"),
    $authorityStart
  )
  $authority = if ($authorityEnd -lt 0) {
    $Value.Substring($authorityStart)
  }
  else {
    $Value.Substring($authorityStart, $authorityEnd - $authorityStart)
  }
  if ([regex]::Matches($authority, "@").Count -gt 1) {
    throw "$VariableName must use at most one raw @ credential separator."
  }
  $hostAuthority = $authority.Substring($authority.IndexOf("@") + 1)
  try {
    $decodedHostAuthority = [Uri]::UnescapeDataString($hostAuthority)
  }
  catch {
    throw "$VariableName must be a valid PostgreSQL URL."
  }
  if ($decodedHostAuthority.Contains(",")) {
    throw "$VariableName must use exactly one URL authority host."
  }

  $uri = $null
  if (
    -not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -notin @("postgres", "postgresql")
  ) {
    throw "$VariableName must be a valid PostgreSQL URL."
  }
  if ($uri.Host.Contains(",")) {
    throw "$VariableName must use exactly one URL authority host."
  }
  try {
    $decodedQuery = [Uri]::UnescapeDataString($uri.Query)
  }
  catch {
    throw "$VariableName must be a valid PostgreSQL URL."
  }
  if ($decodedQuery -match "(?i)(?:^\?|&)(?:host|hostname|hostaddr)=") {
    throw "$VariableName host override parameters are not allowed."
  }

  try {
    $databaseName = [Uri]::UnescapeDataString(
      $uri.AbsolutePath.TrimStart([char]"/")
    )
  }
  catch {
    throw "$VariableName must be a valid PostgreSQL URL."
  }
  $normalizedHost = $uri.DnsSafeHost.ToLowerInvariant().TrimEnd([char]".")
  if (
    [string]::IsNullOrWhiteSpace($normalizedHost) -or
    [string]::IsNullOrWhiteSpace($databaseName)
  ) {
    throw "$VariableName must include a host and database name."
  }

  $port = if ($uri.Port -lt 0) { 5432 } else { $uri.Port }
  return [PSCustomObject]@{
    Database = $databaseName.ToLowerInvariant()
    Identity = "{0}|{1}|{2}" -f @(
      $normalizedHost,
      $port,
      $databaseName.ToLowerInvariant()
    )
  }
}

try {
  if (-not [string]::IsNullOrEmpty($env:PGPORT)) {
    throw "PGPORT must be unset when CRM_TEST_DATABASE_URL is set."
  }
  $testIdentity = ConvertTo-PostgresDatabaseIdentity `
    -Value $env:CRM_TEST_DATABASE_URL `
    -VariableName "CRM_TEST_DATABASE_URL"
  if (
    $testIdentity.Database -notmatch
      "(?i)(^|[^a-z0-9])test($|[^a-z0-9])"
  ) {
    throw "CRM_TEST_DATABASE_URL database name must contain a delimited test token."
  }

  if (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    $applicationIdentity = ConvertTo-PostgresDatabaseIdentity `
      -Value $env:DATABASE_URL `
      -VariableName "DATABASE_URL"
    if ($testIdentity.Identity -eq $applicationIdentity.Identity) {
      throw "CRM_TEST_DATABASE_URL must not identify the same database as DATABASE_URL."
    }
  }

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
