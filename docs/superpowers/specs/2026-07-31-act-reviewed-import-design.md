# Act! Reviewed Import Design

**Date:** 2026-07-31  
**Status:** Approved for implementation planning  
**Roadmap slice:** Slice 3, expanded to include calling-list persistence

## 1. Purpose

Slice 3 turns a completed, deterministic Act! migration preview into an
owner-controlled, resumable import. It applies only explicitly approved work,
keeps unresolved work visible, preserves local operational history, and is
idempotent under retries and concurrent requests.

This slice also adds first-class calling-list persistence. Explicit Act! Groups
can therefore be imported without discarding their memberships. Dynamic Groups
are imported only when their rules can be represented exactly; the importer
never silently converts a dynamic Group into a stale static snapshot.

The production Slice 2 evidence run proved the starting boundary:

- 5,069 staged source records and relationships;
- 5,040 stored proposals;
- identical source and proposal digests across two independent previews;
- zero preview errors, incomplete checkpoints, failed checkpoints, or
  duplicate source IDs;
- no changes to the five existing CRM entity and relationship tables; and
- 32 Groups blocked only because calling-list storage did not yet exist.

## 2. Goals

- Apply approved Places, People, Place-Person relationships, Bookings,
  Booking-Person relationships, calling lists, and calling-list memberships.
- Permit low-risk bulk review without allowing the browser to broaden the
  server-authorized selection.
- Permit approved work to progress while ambiguous or unresolved proposals
  remain queued.
- Use bounded, dependency-ordered operations that resume after failure.
- Make repeated and concurrent apply requests idempotent.
- Preserve one primary two-way Act! Contact link and pull-only aliases for a
  consolidated Person.
- Preserve explicit Group memberships and exact supported dynamic Group
  semantics.
- Reconcile every proposal into an applied, ignored, failed, blocked, or
  visibly pending state.
- Keep credentials, source snapshots, contact PII, and free-text review data
  out of operational logs.

## 3. Non-goals

- Act! Company, Opportunity, or Group writeback.
- Deleting local records when a source record is absent.
- The complete Place-first search, list, and call-first interface from Slice 4.
- Manual calling workflow changes from Slice 5.
- Phone-provider integration.
- Approximate conversion of unsupported dynamic Group rules.
- A general-purpose background job platform.

## 4. Authority and immutable inputs

The importer reads only the selected completed `act_migration_runs` snapshot,
its staged records, its proposal digest, and its stored review decisions. It
does not reread live Act! data during apply.

The stored source and proposal snapshots remain immutable. A proposal decision
may be revised by the owner until an apply operation is created for that
proposal. Scheduling freezes the decision and its choices; retries reuse that
exact operation. Each apply batch stores a manifest digest over the proposal
keys, decisions, chosen local IDs, selected primary Act! Contact IDs, and
dependency keys that the batch will execute.

The official Act! Group model exposes Group identity, descriptive fields,
hierarchy, contact count, and relationships, but does not expose whether a
Group is static or dynamic and does not return a dynamic Group's OData filter.
Consequently, staged membership alone is never treated as proof that a Group
is static. Static import requires an explicit owner confirmation after checking
the Group in Act!. References:

- [Act! Web API Swagger schema](https://actforweb.actops.com/act.web.api/swagger/docs/v1)
- [Act! OData querying reference](https://actforweb.actops.com/act.web.api/OData/index)

Only the configured owner may bulk-review, create an apply batch, continue or
retry a batch, or revise an unapplied decision. The existing server-side owner
check remains mandatory on every action.

## 5. Persistence model

### 5.1 Calling lists

`calling_lists` stores:

- UUID primary key;
- nonblank name;
- kind: `static` or `dynamic`;
- optional filter version and filter definition, both required only for a
  dynamic list;
- source status: `active` or `inactive`;
- created and updated timestamps.

The canonical Act! Group identity is stored in `act_external_links` with
`entity_type = 'calling_list'`, `source_entity_type = 'group'`, and
`sync_mode = 'pull_only'`. No direct Act! ID column is added to
`calling_lists`.

`calling_list_memberships` stores:

- UUID primary key;
- calling-list UUID;
- Person/contact UUID;
- membership source: `act_migration` or `manual`;
- active flag; and
- created and updated timestamps.

A unique constraint on `(calling_list_id, contact_id)` prevents duplicate
memberships. Explicit membership rows belong only to static lists. Dynamic
list membership is evaluated from the versioned filter definition and is not
materialized by this slice.

### 5.2 Dynamic filter format

Version 1 is a strict JSON filter tree for People and their related Places:

```ts
type CallingListFilterV1 = {
  version: 1;
  entity: "person";
  where:
    | {
        op: "and" | "or";
        clauses: CallingListFilterV1["where"][];
      }
    | {
        op: "predicate";
        field:
          | "person.city"
          | "person.region"
          | "person.job_title"
          | "place.id"
          | "place.place_type"
          | "place.city"
          | "place.region";
        operator: "eq" | "in" | "is_empty" | "is_not_empty";
        value?: string | string[];
      };
};
```

The database requires version `1` for non-null definitions. Application
validation rejects unknown fields, operators, empty boolean clauses, invalid
value shapes, and excessive nesting. An Act! dynamic Group converts only when
the source response contains its complete rule and every node maps exactly to
this format. Missing rules, unknown operators, or unsupported fields remain a
blocked proposal with the existing source snapshot retained for review.

### 5.3 Apply batches and operations

`act_migration_apply_batches` stores:

- UUID primary key and unique owner-supplied request key;
- migration run ID and requested-by owner ID;
- status: `pending`, `applying`, `partially_applied`, `applied`, or `failed`;
- manifest digest and count-only summary;
- started, completed, created, and updated timestamps; and
- a sanitized last error code.

`act_migration_apply_operations` stores:

- UUID primary key;
- batch ID, run ID, and proposal key;
- target entity type and dependency proposal keys;
- status: `pending`, `leased`, `blocked`, `applied`, `ignored`, or `failed`;
- attempt count, lease owner, and lease expiry;
- applied local entity ID when applicable;
- sanitized error code and retryable flag; and
- created, updated, and completed timestamps.

The unique constraint on `(run_id, proposal_key)` makes one operation the
canonical execution record for a proposal across all retries and later batch
requests. A repeated request key returns the original batch. A new request
includes only newly approved or retryable operations that do not already have
a terminal execution record.

The migration run adds `applying`, `partially_applied`, and `applied` states.
It is `partially_applied` when no worker is active but review, blocked, or
failed proposals remain. It becomes `applied` only when every proposal is in a
permitted terminal state and no failed, blocked, or pending review work
remains.

## 6. Review behavior

### 6.1 Individual decisions

- `approve_proposed` creates a new entity or applies the exact mapped field
  changes shown in the preview.
- `link_existing` attaches the stable Act! identity to the selected local
  entity without overwriting its existing local fields.
- `keep_separate` creates a distinct Person despite the possible match.
- `confirm_static_group` records that the owner verified the Group is static
  in Act! and permits its frozen explicit memberships to import.
- `ignore` performs no CRM write and retains a required reason.
- `matched_unchanged` requires an already-valid stable source link and needs no
  owner decision. A missing link is an invariant violation and blocks apply.

A scheduled or applied proposal decision cannot be changed. A decision whose
dependencies changed after preview fails manifest validation rather than
applying a different result.

### 6.2 Bulk decisions

Bulk approval is available only for:

- collision-free `new` proposals with no issue code, candidate ambiguity, or
  unresolved primary Act! Contact choice; and
- `new_relationship` proposals whose parent proposals are already stable or
  are approved in the same dependency closure.

Bulk approval is not available for `change`, `possible_duplicate`,
`needs_review`, any proposal with unresolved dependencies, any dynamic Group,
any Group requiring static confirmation, or any consolidated Person requiring
a primary source choice.

The command accepts a run ID, target entity type, preview state, and current
filter scope rather than a browser-supplied list of arbitrary proposal keys.
The server reruns the eligibility predicate inside the decision transaction,
locks the selected rows, applies a fixed maximum number per request, and
returns changed and remaining counts.

Bulk ignore is allowed for a single target/state/issue-code scope and requires
one nonblank reason. It stores the reason and an audit record on every affected
proposal. The server applies the same bounded-selection and locking rules.

## 7. Apply behavior

### 7.1 Confirmation

The selected design uses a single confirmation button. Before the button, the
page displays exact approved, pending, blocked, ignored, already applied, and
failed counts by entity type. The owner selects **Import approved records**
once; no typed phrase is required.

The action generates a unique request key before submission, disables while
busy, and reuses that key for retries. The server independently recomputes the
manifest and affected counts. Empty manifests do not create a batch.

Production apply controls are unavailable unless
`ACT_MIGRATION_APPLY_ENABLED=true`. The flag defaults to disabled when absent
or malformed.

### 7.2 Dependency order

Operations are ranked and claimed in this order:

1. Places;
2. People;
3. Place-Person relationships;
4. Bookings;
5. Booking-Person relationships;
6. calling lists; and
7. calling-list memberships.

A relationship or membership remains `blocked` until every dependency has a
stable local entity ID. A parent failure never produces an orphaned child.
Later successful parent work makes the child eligible for retry.

Each continue request claims at most 25 operations with a short lease. Each
proposal applies in its own database transaction so a deterministic validation
failure does not roll back unrelated successful operations.

### 7.3 Entity semantics

**Places:** Approved new proposals create an Organization/Place. Approved
changes update only the mapped Company identity, address, phone, website,
industry, and location fields present in the frozen proposal. A stable
pull-only Company external link is created or verified.

**People:** Approved new or keep-separate proposals create a Person. Approved
changes update only the mapped Contact fields in the frozen proposal. A
consolidated Person receives exactly one approved primary two-way Contact link;
additional Contact IDs become pull-only aliases. An existing primary link wins
unless the review explicitly selected another valid primary before apply.

**Place-Person relationships:** Approved proposals create or reactivate the
unique association. They preserve reviewed role and primary semantics and keep
the compatibility `contacts.organization_id` pointer synchronized only when
the association is the approved primary Place.

**Bookings:** Approved Opportunity proposals create or update only mapped
Booking fields. A reliable Place is required. A reliable Person is optional;
when absent, the Booking imports with its visible `Needs person` condition and
without a fake Person.

**Booking-Person relationships:** Approved proposals create the unique
association after both parents exist and synchronize the compatibility primary
contact pointer only for the approved primary relationship.

**Calling lists:** An explicit Group creates a static source-backed list. A
dynamic Group creates a dynamic source-backed list only after exact filter
conversion. Because the current Act! read model supplies neither a static flag
nor a dynamic rule, a Group can enter the static path only through its
individual `confirm_static_group` decision. That decision is unavailable to
bulk actions and its audit entry records only the decision, actor, timestamp,
and source ID—not display values. All Group external links are pull-only.

**Calling-list memberships:** Explicit Group-Contact relationships create or
reactivate unique static-list memberships after both the list and Person are
resolved. Dynamic Groups never receive materialized membership rows.

### 7.4 Local data preservation

The importer never removes local calls, activities, notes, follow-ups,
Bookings, relationships, audit history, or manually created calling-list
memberships. Source absence never deletes or deactivates a local record in this
slice. A link-existing decision preserves current local fields. Pull-only alias
links cannot overwrite a Person or receive Act! writeback.

## 8. Concurrency, failure, and recovery

Operation claims use row locks with skip-locked behavior and expiring leases.
Workers verify the run, proposal, decision, manifest digest, and dependency
state again inside the apply transaction. Expired leases return retryable
operations to the queue. Applied and ignored operations are terminal.

Retryable database or worker failures retain a sanitized code and can be
reclaimed. Deterministic validation, authority, identity-conflict, and
unsupported-semantics failures remain visible until the owner changes an
unapplied decision or the underlying application capability changes.

External-link, entity, relationship, and membership unique constraints are the
final idempotency boundary. A semantic retry that finds its exact intended
result returns success without duplicating audit entries. A conflicting owner
or incompatible existing record fails closed.

No error returned to the browser or application log contains source snapshots,
names, email addresses, phone numbers, postal addresses, credentials, or
free-text review reasons.

## 9. Audit and reconciliation

Audit entries are created for:

- every individual or bulk decision;
- apply-batch creation and completion;
- entity creation or mapped-field update;
- relationship creation or reactivation;
- external-link creation or primary/sync-mode change;
- calling-list and membership creation;
- ignored proposals; and
- retry and terminal failure transitions.

The run workspace reports count-only totals by target and operation state. It
also reports source, proposal, manifest, and applied-result digests.
Reconciliation treats every proposal as exactly one of:

- automatically reconciled stable no-op;
- applied;
- explicitly ignored;
- failed with a visible code;
- blocked by a visible dependency or capability reason; or
- pending visible review.

No proposal may disappear from reconciliation because it was not selected for
the current batch.

## 10. Testing strategy

### 10.1 Unit tests

- Bulk eligibility and bounded scope.
- Manifest construction and stable digesting.
- Decision-to-operation semantics.
- Dependency ordering and blocked-state resolution.
- Entity field-ownership mappings.
- Contact primary and pull-only alias authority.
- Calling-list filter validation and exact Act! Group-rule conversion.
- Sanitized public error mapping.
- Count-only reconciliation.

### 10.2 PostgreSQL integration tests

- Migrations, constraints, and rollback compatibility.
- All seven target types and their external links.
- Individual and bulk decision concurrency.
- Batch request-key idempotency.
- Concurrent workers, row leases, expiry, and skip-locked claims.
- Partial success, deterministic failure, retryable failure, and resume.
- Parent dependency blocking and later release.
- Repeated and concurrent entity, relationship, list, and membership apply.
- Primary Contact authority and pull-only alias protections.
- Audit completeness and semantic-retry audit suppression.
- Final reconciliation with pending reviews still visible.

### 10.3 UI and action tests

- Owner authorization on every mutation.
- Server-enforced bulk scope.
- Apply-feature flag behavior.
- Exact pre-apply counts and the single confirmation button.
- Double-click/request-key reuse.
- Progress, partial completion, blocked, failed, and retry states.
- No Apply control for an incomplete or digest-mismatched preview.

### 10.4 Source mutation safety

Tests prove apply services have no Act! client dependency and never invoke an
Act! write endpoint. Existing Contact synchronization remains a separate,
explicit workflow and continues to honor primary-link authority.

## 11. Rollout and production gate

1. Deploy schema and code with `ACT_MIGRATION_APPLY_ENABLED` absent or false.
2. Verify migrations on a disposable restored database.
3. Run the complete non-database and real disposable-PostgreSQL release gates.
4. Confirm the selected production preview is complete and its replay digests
   still match.
5. Capture a production backup and complete the approved restore check.
6. Capture PII-free before-import entity, relationship, list, membership, and
   external-link counts.
7. Enable `ACT_MIGRATION_APPLY_ENABLED=true`.
8. Review and apply one small, low-risk batch.
9. Verify counts, audit entries, reconciliation, source invariance, and
   duplicate invariance.
10. Continue bounded approved batches while unresolved proposals remain
    visible.
11. Disable the flag immediately if identity conflicts, unexplained count
    changes, missing audits, source mutation, or duplicate creation appears.

## 12. Acceptance criteria

- Approved work imports in dependency order without rereading Act!.
- Low-risk bulk approval cannot include an ineligible proposal.
- Pending review does not block unrelated approved work.
- Explicit Groups and memberships import as static source-backed calling
  lists.
- Dynamic Groups import only with an exactly reproducible local rule.
- No Group membership snapshot imports without an individual owner
  `confirm_static_group` decision or an exactly converted dynamic rule.
- Repeating or racing an apply request creates no duplicate entity,
  relationship, external link, calling list, or membership.
- A failed or crashed worker resumes from durable operation state.
- Local operational history and unrelated fields remain unchanged.
- Every source proposal remains applied, ignored, failed, blocked, or visibly
  pending.
- Production apply is impossible while the feature flag is disabled.
- Logs and operational summaries remain PII-free.
