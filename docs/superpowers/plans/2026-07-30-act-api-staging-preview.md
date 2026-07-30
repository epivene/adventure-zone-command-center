# Act! API Staging and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, resumable Act! API snapshot and review pipeline for Companies, Contacts, Opportunities, Groups, and their supported relationships without changing production CRM records.

**Architecture:** A server-only Act! transport reads bounded OData pages into durable migration records through leased checkpoints. Pure parsers and matchers turn one finalized source snapshot plus one deterministic local snapshot into immutable preview proposals, while owner-only review actions save decisions without applying Places, People, Bookings, relationships, or calling lists. Existing Contact sync remains separate and continues to use exactly one primary two-way Act! Contact link per Person.

**Tech Stack:** Next.js 16 App Router and server actions, React 19, TypeScript 6, Drizzle ORM 0.45/PostgreSQL, Clerk owner authorization, Zod 4, Vitest/Testing Library, and the existing Act! Web API client.

## Global Constraints

- Use the Act! Web API as the production source. The legacy `.xls` files remain reconciliation evidence and test-fixture input only.
- Companies, Opportunities, Groups, and all migration relationships are read-only in this phase.
- Preserve the existing reviewed Contact synchronization flow and its two-way write behavior.
- Do not apply or mutate any Place, Person, Booking, Place-Person, Booking-Person, or calling-list record in this slice.
- Credentials remain server-side. Never persist credentials or include raw contact values in application logs or error messages.
- Store the source snapshot exactly once per run. Reopening a preview reads stored records and proposals; it never silently fetches or rematches.
- Use stable Act! IDs as the only automatic identity match. Every first-time fallback match remains reviewable.
- Source absence never deletes or deactivates a local record.
- A page, checkpoint, or proposal retry must be idempotent and must not duplicate records, relationships, or decisions.
- Network work is bounded to at most 10 Act! requests per server action.
- Every source record and relationship must end in one visible proposal, an explicit ignored reason, or a sanitized error.
- Keep existing `act_import_runs`, `act_sync_runs`, `act_sync_operations`, direct `actRecordId` columns, and historical rows readable.
- Use the user-facing terms Place, Person, Booking, and Calling list. Keep physical `organizations` and `contacts` table names for compatibility.
- Add no third-party dependency for this slice.
- Database migrations are forward-only and must preserve all existing IDs, history, packages, resources, routes, calls, activities, follow-ups, and sync state.

---

## File Structure

### New feature files

- `features/act-migration/migration-types.ts` — shared source, checkpoint, proposal, decision, and progress contracts.
- `features/act-migration/source-parser.ts` — pure entity and relationship parsing plus normalization.
- `features/act-migration/source-client.ts` — paged read-only Companies, Contacts, Opportunities, Groups, and relationship client.
- `features/act-migration/snapshot-repository.ts` — Drizzle run, checkpoint, page, lease, and snapshot persistence.
- `features/act-migration/snapshot-service.ts` — bounded start, capture, resume, and finalize orchestration.
- `features/act-migration/matching-normalization.ts` — shared conservative text, email, and website matching normalization.
- `features/act-migration/local-candidate-repository.ts` — deterministic local Place, Person, Booking, relationship, and external-link snapshot.
- `features/act-migration/matcher.ts` — pure match precedence and proposal synthesis.
- `features/act-migration/reconciliation.ts` — source/proposal digests and completion report.
- `features/act-migration/preview-repository.ts` — immutable proposal storage, paginated reads, and durable review decisions.
- `features/act-migration/preview-service.ts` — finalize a snapshot into one stored preview and expose progress/review operations.
- `features/organizations/place-types.ts` — stable Place type values and user-facing labels.
- `app/(private)/settings/act-migration/page.tsx` — owner-only Act! migration page.
- `app/(private)/settings/act-migration/actions.ts` — bounded owner-only start, continue, resume, and decision actions.
- `components/act-migration/act-migration-review.tsx` — progress, entity/state tabs, reconciliation, rows, and review controls.
- `docs/operations/act-migration.md` — staging, resume, review, reconciliation, and release procedure.

### New tests

- `tests/unit/act-migration-types.test.ts`
- `tests/unit/act-migration-source-parser.test.ts`
- `tests/unit/act-migration-matching-normalization.test.ts`
- `tests/unit/act-migration-matcher.test.ts`
- `tests/unit/act-migration-reconciliation.test.ts`
- `tests/unit/act-migration-actions.test.ts`
- `tests/unit/act-migration-review.test.tsx`
- `tests/integration/act-migration-client.test.ts`
- `tests/integration/act-migration-staging-migration.test.ts`
- `tests/integration/act-migration-snapshot-repository.test.ts`
- `tests/integration/act-migration-snapshot-service.test.ts`
- `tests/integration/act-migration-local-candidate-repository.test.ts`
- `tests/integration/act-migration-preview-repository.test.ts`
- `tests/integration/act-migration-docs.test.ts`

### Modified compatibility files

- `db/schema.ts` — migration tables plus canonical Act! link metadata.
- `db/migrations/0009_act_migration_staging.sql` — forward schema and existing Contact-link backfill.
- `db/migrations/meta/0009_snapshot.json`
- `db/migrations/meta/_journal.json`
- `features/act-sync/act-client.ts` — use the shared transport while preserving the existing public Contact client.
- `features/act-sync/act-types.ts` — export the shared transport request/rate-limit contracts.
- `features/act-sync/sync-repository.ts` — read and write only the primary two-way Contact link.
- `features/import/act-matcher.ts` — legacy Contact imports explicitly maintain the primary two-way link instead of relying on column defaults.
- `components/navigation/app-shell.tsx` — add a distinct `Act! migration` Settings link; retain `Act! sync`.
- `tests/integration/act-client.test.ts` — regression coverage for the existing Contact client.
- `tests/unit/act-sync-repository.test.ts` — primary/two-way link filtering and alias protection.
- `tests/integration/act-import-drizzle.test.ts` — legacy Contact import compatibility with canonical links.
- `tests/unit/schema-contract.test.ts` — migration tables, checks, indexes, and link metadata.
- `tests/unit/crm-database-test-gate.test.ts` — exact release-gate file list.
- `package.json` — include the new PostgreSQL suites in `test:crm-db`.

---

### Task 1: Define the Act! migration domain contracts

**Files:**
- Create: `features/act-migration/migration-types.ts`
- Create: `tests/unit/act-migration-types.test.ts`

**Interfaces:**
- Consumes: no new interfaces.
- Produces: `ActSourceEntityType`, `ActRelationshipType`, `ActMigrationStreamType`, `ActQueryMode`, `ActPageRequest`, `ActPage`, `MigrationPreviewState`, `MigrationDecision`, `MigrationReviewState`, `MigrationTargetEntityType`, `ActMigrationRunStatus`, `ActMigrationCheckpointStatus`, `sourceRecordKey()`, and `relationshipSourceKey()`.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from "vitest";

import {
  allowedDecisionsForPreviewState,
  isMigrationDecision,
  isMigrationTargetEntityType,
  migrationStreamRank,
  relationshipSourceKey,
  sourceRecordKey,
  type ActMigrationStreamType,
} from "@/features/act-migration/migration-types";

describe("Act migration contracts", () => {
  it("orders root entities before relationship streams", () => {
    const streams: ActMigrationStreamType[] = [
      "group_contact",
      "opportunity",
      "company_contact",
      "company",
    ];
    expect(
      streams.toSorted(
        (left, right) =>
          migrationStreamRank(left) - migrationStreamRank(right),
      ),
    ).toEqual([
      "company",
      "opportunity",
      "company_contact",
      "group_contact",
    ]);
  });

  it("allows only decisions that can resolve the visible preview state", () => {
    expect(allowedDecisionsForPreviewState("new")).toEqual([
      "approve_proposed",
      "ignore",
    ]);
    expect(allowedDecisionsForPreviewState("matched_unchanged")).toEqual([]);
    expect(allowedDecisionsForPreviewState("possible_duplicate")).toEqual([
      "link_existing",
      "keep_separate",
      "ignore",
    ]);
  });

  it("validates decisions and local proposal targets at runtime", () => {
    expect(isMigrationDecision("link_existing")).toBe(true);
    expect(isMigrationDecision("apply_now")).toBe(false);
    expect(isMigrationTargetEntityType("booking_contact")).toBe(true);
    expect(isMigrationTargetEntityType("company")).toBe(false);
  });

  it("builds deterministic entity and relationship keys", () => {
    expect(sourceRecordKey("company", " ACT-100 ")).toBe("company:ACT-100");
    expect(relationshipSourceKey("company_contact", "COMP-2", "CONTACT-9"))
      .toBe("company_contact:COMP-2:CONTACT-9");
  });

  it("rejects blank and delimiter-bearing source identifiers", () => {
    expect(() => sourceRecordKey("contact", " ")).toThrow(
      "Act! source identifiers must be nonblank.",
    );
    expect(() =>
      relationshipSourceKey("group_contact", "GROUP:2", "CONTACT-9"),
    ).toThrow("Act! source identifiers cannot contain colons.");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-types.test.ts
```

Expected: FAIL because `features/act-migration/migration-types.ts` does not exist.

- [ ] **Step 3: Add the minimal typed contracts**

```ts
export const actSourceEntityTypeValues = [
  "company",
  "contact",
  "opportunity",
  "group",
] as const;
export type ActSourceEntityType =
  (typeof actSourceEntityTypeValues)[number];

export const actRelationshipTypeValues = [
  "company_contact",
  "opportunity_company",
  "opportunity_contact",
  "group_contact",
] as const;
export type ActRelationshipType =
  (typeof actRelationshipTypeValues)[number];

export const actMigrationStreamTypeValues = [
  ...actSourceEntityTypeValues,
  ...actRelationshipTypeValues,
] as const;
export type ActMigrationStreamType =
  (typeof actMigrationStreamTypeValues)[number];

export const actMigrationRunStatusValues = [
  "snapshotting",
  "snapshot_complete",
  "matching",
  "previewed",
  "failed",
] as const;
export type ActMigrationRunStatus =
  (typeof actMigrationRunStatusValues)[number];

export const actMigrationCheckpointStatusValues = [
  "pending",
  "fetching",
  "complete",
  "failed",
] as const;
export type ActMigrationCheckpointStatus =
  (typeof actMigrationCheckpointStatusValues)[number];

export const actQueryModeValues = ["projected", "plain"] as const;
export type ActQueryMode = (typeof actQueryModeValues)[number];

export const migrationPreviewStateValues = [
  "new",
  "matched_unchanged",
  "change",
  "new_relationship",
  "possible_duplicate",
  "needs_review",
  "ignored",
  "error",
] as const;
export type MigrationPreviewState =
  (typeof migrationPreviewStateValues)[number];

export const migrationDecisionValues = [
  "approve_proposed",
  "link_existing",
  "keep_separate",
  "ignore",
] as const;
export type MigrationDecision = (typeof migrationDecisionValues)[number];

export const migrationReviewStateValues = [
  "not_required",
  "pending",
  "decided",
  "ignored",
] as const;
export type MigrationReviewState =
  (typeof migrationReviewStateValues)[number];

export const migrationTargetEntityTypeValues = [
  "organization",
  "contact",
  "booking",
  "organization_contact",
  "booking_contact",
  "calling_list",
  "calling_list_member",
] as const;
export type MigrationTargetEntityType =
  (typeof migrationTargetEntityTypeValues)[number];

const decisionsByPreviewState: Record<
  MigrationPreviewState,
  readonly MigrationDecision[]
> = {
  new: ["approve_proposed", "ignore"],
  matched_unchanged: [],
  change: ["approve_proposed", "ignore"],
  new_relationship: ["approve_proposed", "ignore"],
  possible_duplicate: ["link_existing", "keep_separate", "ignore"],
  needs_review: ["link_existing", "keep_separate", "ignore"],
  ignored: [],
  error: [],
};

export function migrationStreamRank(stream: ActMigrationStreamType) {
  return actMigrationStreamTypeValues.indexOf(stream);
}

export function allowedDecisionsForPreviewState(
  state: MigrationPreviewState,
) {
  return [...decisionsByPreviewState[state]];
}

export function isMigrationDecision(
  value: unknown,
): value is MigrationDecision {
  return (
    typeof value === "string" &&
    (migrationDecisionValues as readonly string[]).includes(value)
  );
}

export function isMigrationTargetEntityType(
  value: unknown,
): value is MigrationTargetEntityType {
  return (
    typeof value === "string" &&
    (migrationTargetEntityTypeValues as readonly string[]).includes(value)
  );
}

export type ActPageRequest = {
  skip: number;
  top: number;
  queryMode: ActQueryMode;
};

export type ActPage = {
  items: unknown[];
  nextSkip: number | null;
  queryMode: ActQueryMode;
};

function safeSourceId(value: string) {
  const sourceId = value.trim();
  if (!sourceId) {
    throw new Error("Act! source identifiers must be nonblank.");
  }
  if (sourceId.includes(":")) {
    throw new Error("Act! source identifiers cannot contain colons.");
  }
  return sourceId;
}

export function sourceRecordKey(
  type: ActSourceEntityType,
  sourceId: string,
) {
  return `${type}:${safeSourceId(sourceId)}`;
}

export function relationshipSourceKey(
  type: ActRelationshipType,
  sourceId: string,
  targetId: string,
) {
  return `${type}:${safeSourceId(sourceId)}:${safeSourceId(targetId)}`;
}
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-types.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Run typecheck and commit**

```powershell
npm run typecheck
git add features/act-migration/migration-types.ts tests/unit/act-migration-types.test.ts
git commit -m "feat: define Act migration contracts"
```

---

### Task 2: Add durable staging schema and canonical external-link metadata

**Files:**
- Modify: `db/schema.ts:654-765`
- Create: `features/organizations/place-types.ts`
- Modify: `features/act-sync/sync-repository.ts`
- Modify: `features/import/act-matcher.ts`
- Modify: `tests/unit/schema-contract.test.ts`
- Modify: `tests/unit/act-sync-repository.test.ts`
- Modify: `tests/integration/act-import-drizzle.test.ts`
- Create: `tests/integration/act-migration-staging-migration.test.ts`
- Create: `db/migrations/0009_act_migration_staging.sql`
- Create: `db/migrations/meta/0009_snapshot.json`
- Modify: `db/migrations/meta/_journal.json`

**Interfaces:**
- Consumes: all constants from `migration-types.ts`.
- Produces: `placeTypeValues`, expanded Place profile fields, `actMigrationRuns`, `actMigrationCheckpoints`, `actMigrationRecords`, `actMigrationProposals`, and extended `actExternalLinks`.

- [ ] **Step 1: Extend the schema contract test first**

Add assertions that:

```ts
expect(databaseSchema.placeTypeValues).toEqual([
  "fair",
  "city_government",
  "festival_event",
  "venue",
  "school",
  "tribe",
  "association",
  "company",
  "other",
]);
expect(Object.keys(databaseSchema.organizations)).toEqual(
  expect.arrayContaining([
    "placeType",
    "actIndustry",
    "phone",
    "normalizedPhone",
    "address1",
    "address2",
    "city",
    "region",
    "postalCode",
    "website",
  ]),
);
expect(Object.keys(databaseSchema.actMigrationRuns)).toEqual(
  expect.arrayContaining([
    "id",
    "requestKey",
    "sourceDatabaseKey",
    "requestedBy",
    "status",
    "sourceDigest",
    "proposalDigest",
    "summary",
    "lastErrorCode",
    "snapshotCompletedAt",
    "previewCompletedAt",
    "startedAt",
    "createdAt",
    "updatedAt",
  ]),
);
expect(Object.keys(databaseSchema.actMigrationCheckpoints)).toEqual(
  expect.arrayContaining([
    "id",
    "runId",
    "streamType",
    "partitionKey",
    "parentSourceId",
    "nextSkip",
    "pageSize",
    "queryMode",
    "status",
    "leaseOwner",
    "leaseExpiresAt",
    "retryAfter",
    "retryable",
    "attemptCount",
    "recordsStaged",
    "errorCode",
    "completedAt",
    "createdAt",
    "updatedAt",
  ]),
);
expect(Object.keys(databaseSchema.actMigrationRecords)).toEqual(
  expect.arrayContaining([
    "id",
    "runId",
    "streamType",
    "sourceKey",
    "sourceId",
    "targetSourceId",
    "rawSnapshot",
    "normalizedSnapshot",
    "fingerprint",
    "proposedAction",
    "reviewState",
    "proposalKey",
    "matchedEntityType",
    "matchedEntityId",
    "appliedEntityId",
    "errorCode",
    "errorFields",
    "createdAt",
    "updatedAt",
  ]),
);
expect(Object.keys(databaseSchema.actMigrationProposals)).toEqual(
  expect.arrayContaining([
    "id",
    "runId",
    "proposalKey",
    "state",
    "targetEntityType",
    "sourceRecordKeys",
    "candidateLocalIds",
    "proposedLocalId",
    "matchReason",
    "displaySnapshot",
    "decision",
    "decisionReason",
    "chosenLocalEntityId",
    "primarySourceId",
    "decidedBy",
    "decidedAt",
    "createdAt",
    "updatedAt",
  ]),
);
expect(Object.keys(actExternalLinks)).toEqual(
  expect.arrayContaining([
    "sourceEntityType",
    "isPrimary",
    "syncMode",
    "migrationRunId",
  ]),
);
```

Also assert the unique index names:

```ts
expect(indexNames(databaseSchema.actMigrationCheckpoints)).toContain(
  "act_migration_checkpoints_run_stream_partition_unique",
);
expect(indexNames(databaseSchema.actMigrationRecords)).toContain(
  "act_migration_records_run_stream_source_unique",
);
expect(indexNames(databaseSchema.actMigrationProposals)).toContain(
  "act_migration_proposals_run_key_unique",
);
expect(indexNames(actExternalLinks)).toEqual(
  expect.arrayContaining([
    "act_external_links_source_external_id_unique",
    "act_external_links_one_primary_per_local_source",
  ]),
);
```

- [ ] **Step 2: Run the schema contract and verify it fails**

Run:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/schema-contract.test.ts
```

Expected: FAIL because the staging tables and canonical-link columns do not exist.

- [ ] **Step 3: Add Drizzle tables and checks**

Use text checks backed by the Task 1 constant arrays. The table identities and uniqueness rules must be:

```ts
export const placeTypeValues = [
  "fair",
  "city_government",
  "festival_event",
  "venue",
  "school",
  "tribe",
  "association",
  "company",
  "other",
] as const;

export type PlaceType = (typeof placeTypeValues)[number];
```

Add these nullable Place profile columns while defaulting only `placeType`:

```ts
placeType: text("place_type").default("other").notNull(),
actIndustry: text("act_industry"),
phone: text("phone"),
normalizedPhone: text("normalized_phone"),
address1: text("address_1"),
address2: text("address_2"),
city: text("city"),
region: text("region"),
postalCode: text("postal_code"),
website: text("website"),
```

Add `organizations_place_type_valid` and a
`organizations_normalized_phone_idx` non-unique lookup index. Existing Places
backfill to `other`; do not guess a type or copy a Person's address into a
Place.

```ts
export const actMigrationRuns = pgTable(
  "act_migration_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestKey: uuid("request_key").notNull(),
    sourceDatabaseKey: text("source_database_key").notNull(),
    requestedBy: text("requested_by").notNull(),
    status: text("status").default("snapshotting").notNull(),
    sourceDigest: text("source_digest"),
    proposalDigest: text("proposal_digest"),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    lastErrorCode: text("last_error_code"),
    snapshotCompletedAt: timestamp("snapshot_completed_at", {
      withTimezone: true,
    }),
    previewCompletedAt: timestamp("preview_completed_at", {
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_migration_runs_request_key_unique").on(
      table.requestKey,
    ),
    check(
      "act_migration_runs_status_valid",
      sql`${table.status} in ('snapshotting', 'snapshot_complete', 'matching', 'previewed', 'failed')`,
    ),
    check(
      "act_migration_runs_source_database_key_nonblank",
      sql`btrim(${table.sourceDatabaseKey}) <> ''`,
    ),
    check(
      "act_migration_runs_requested_by_nonblank",
      sql`btrim(${table.requestedBy}) <> ''`,
    ),
  ],
);
```

Add checkpoints with `retryable: boolean("retryable").default(true).notNull()`,
non-negative checks, and a unique `(run_id, stream_type, partition_key)`
index. Add records with a unique `(run_id, stream_type, source_key)` index.
Add proposals with a unique `(run_id, proposal_key)` index and the exact
fields asserted in Step 1, including nullable `decision_reason`. Check every
stored status, query mode, preview state, review state, decision, and target
entity type against the exact Task 1 values.

Extend `actExternalLinks` with:

```ts
sourceEntityType: text("source_entity_type").notNull(),
isPrimary: boolean("is_primary").default(false).notNull(),
syncMode: text("sync_mode").default("pull_only").notNull(),
migrationRunId: uuid("migration_run_id").references(
  () => actMigrationRuns.id,
),
```

Replace the old external identity index with:

```ts
uniqueIndex("act_external_links_source_external_id_unique").on(
  table.sourceEntityType,
  table.actRecordId,
),
uniqueIndex("act_external_links_one_primary_per_local_source")
  .on(table.entityType, table.entityId, table.sourceEntityType)
  .where(sql`${table.isPrimary} = true`),
check(
  "act_external_links_sync_mode_valid",
  sql`${table.syncMode} in ('two_way', 'pull_only')`,
),
check(
  "act_external_links_type_pair_valid",
  sql`(${table.entityType}, ${table.sourceEntityType}) in (('organization', 'company'), ('contact', 'contact'), ('booking', 'opportunity'), ('calling_list', 'group'))`,
),
check(
  "act_external_links_contact_primary_sync_valid",
  sql`(${table.entityType} = 'contact' and ${table.sourceEntityType} = 'contact' and ((${table.isPrimary} = true and ${table.syncMode} = 'two_way') or (${table.isPrimary} = false and ${table.syncMode} = 'pull_only'))) or (${table.entityType} <> 'contact' and ${table.syncMode} = 'pull_only')`,
),
```

- [ ] **Step 4: Protect existing Contact sync from pull-only aliases**

Update every `sync-repository.ts` external-link read to require:

```ts
and(
  eq(actExternalLinks.entityType, "contact"),
  eq(actExternalLinks.sourceEntityType, "contact"),
  eq(actExternalLinks.isPrimary, true),
  eq(actExternalLinks.syncMode, "two_way"),
)
```

Update Contact sync link inserts and upserts to set:

```ts
{
  entityType: "contact",
  sourceEntityType: "contact",
  isPrimary: true,
  syncMode: "two_way",
}
```

Add a unit repository test whose fake link rows include a primary two-way link and a pull-only alias; assert only the primary link becomes `LocalSyncContact.actRecordId`.

Update `features/import/act-matcher.ts` so every legacy Contact link insert explicitly supplies the same four fields. Add a regression assertion to `tests/integration/act-import-drizzle.test.ts` that a legacy file import creates one primary two-way Contact link and never replaces an existing primary link with a different Act! ID.

- [ ] **Step 5: Generate and inspect migration 0009**

Run:

```powershell
npx drizzle-kit generate --name act_migration_staging
```

The generated SQL must:

1. Add the Place profile columns and backfill existing `place_type` values to `other` without inventing profile data.
2. Create all four migration tables and their constraints.
3. Add `source_entity_type` as nullable, plus safe `is_primary = false` and `sync_mode = 'pull_only'` defaults, before adding constraints.
4. Map existing local link types to source types: `contact → contact`, `organization → company`, `booking → opportunity`, and `calling_list → group`.
5. Insert missing canonical links for non-null direct Act! IDs on organizations, contacts, and bookings without changing the direct IDs.
6. For a Contact, make the link matching `contacts.act_record_id` primary/two-way. If the direct ID is null and exactly one Contact link exists, copy that link into the direct ID and make it primary/two-way. If several links exist without a direct ID, keep every link pull-only/nonprimary for visible consolidation review.
7. Mark organization/company and booking/opportunity links primary/pull-only.
8. Fail closed on unknown local link types, duplicate source ownership, or disagreement between a non-null direct ID and its external-link owner; never silently reassign an Act! ID.
9. Set `source_entity_type` non-null and add the type-pair, sync-mode, primary, and unique constraints only after the backfill.
10. Replace `act_external_links_entity_external_id_unique` with the two new canonical indexes.
11. Preserve every existing external-link ID and `import_run_id`.

- [ ] **Step 6: Add the PostgreSQL migration preservation test**

The test must apply migrations `0000` through `0008` in a disposable schema, insert:

```sql
INSERT INTO act_external_links
  (id, entity_type, entity_id, act_record_id, import_run_id)
VALUES
  ('88888888-8888-4888-8888-888888888888',
   'contact',
   '33333333-3333-4333-8333-333333333333',
   'ACT-CONTACT-1',
   '77777777-7777-4777-8777-777777777777');
```

Apply `0009_act_migration_staging.sql`, then assert:

```ts
expect(links).toEqual([{
  id: ids.actLink,
  source_entity_type: "contact",
  is_primary: true,
  sync_mode: "two_way",
  import_run_id: ids.importRun,
  migration_run_id: null,
}]);
```

Also prove:

- duplicate `(run, stream, source_key)` records are rejected;
- two primary Contact links for one Person are rejected;
- one additional pull-only alias is allowed;
- a pull-only alias cannot be marked `two_way`;
- organization and booking direct IDs receive primary pull-only links;
- a single Contact link can safely backfill a null direct Contact ID;
- several Contact links with no direct ID remain nonprimary for review;
- an unknown type pair or conflicting source owner makes the migration fail closed;
- existing organizations, contacts, bookings, relationship rows, activities, calls, and packages remain unchanged.

- [ ] **Step 7: Run focused tests and commit**

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/schema-contract.test.ts tests/unit/act-sync-repository.test.ts
node node_modules/vitest/vitest.mjs run tests/integration/act-migration-staging-migration.test.ts tests/integration/act-import-drizzle.test.ts
npm run typecheck
git add db/schema.ts db/migrations/0009_act_migration_staging.sql db/migrations/meta/0009_snapshot.json db/migrations/meta/_journal.json features/organizations/place-types.ts features/act-sync/sync-repository.ts features/import/act-matcher.ts tests/unit/schema-contract.test.ts tests/unit/act-sync-repository.test.ts tests/integration/act-migration-staging-migration.test.ts tests/integration/act-import-drizzle.test.ts
git commit -m "feat: add Act migration staging schema"
```

---

### Task 3: Extract the shared Act! transport and add paged read endpoints

**Files:**
- Modify: `features/act-sync/act-client.ts`
- Modify: `features/act-sync/act-types.ts`
- Create: `features/act-migration/source-client.ts`
- Modify: `tests/integration/act-client.test.ts`
- Create: `tests/integration/act-migration-client.test.ts`

**Interfaces:**
- Consumes: `ActPageRequest` and `ActPage`.
- Produces: `ActTransport`, `ActMigrationSourceClient`, and `HttpActMigrationSourceClient`.

- [ ] **Step 1: Write paged client tests**

Use a fetch recorder and assert the exact paths:

```ts
await client.listCompanies({ skip: 0, top: 200, queryMode: "projected" });
expect(requests.at(-1)?.url).toContain("/api/companies?");
expect(requests.at(-1)?.url).toContain("%24orderby=id");

await client.listCompaniesForContact("CONTACT-1", {
  skip: 0,
  top: 200,
  queryMode: "projected",
});
expect(requests.at(-1)?.url).toContain(
  "/api/contacts/CONTACT-1/companies?",
);
```

Cover all eight methods:

```ts
listCompanies
listContacts
listOpportunities
listGroups
listCompaniesForContact
listCompaniesForOpportunity
listContactsForOpportunity
listContactsForGroup
```

Prove a short page advances by its actual row count and only an empty page returns `nextSkip: null`.

- [ ] **Step 2: Run the new client test and verify failure**

```powershell
node node_modules/vitest/vitest.mjs run tests/integration/act-migration-client.test.ts
```

Expected: FAIL because the source client does not exist.

- [ ] **Step 3: Extract the authenticated transport without changing Contact behavior**

Expose:

```ts
export interface ActTransport {
  testConnection(): Promise<{ ok: true }>;
  requestJson(input: {
    path: `/api/${string}`;
    method: "GET" | "POST" | "PUT";
    query?: Readonly<Record<string, string>>;
    body?: unknown;
  }): Promise<unknown>;
  readonly rateLimit: ActRateLimit;
}
```

Move token caching, Basic authorization, bearer headers, timeout, redirect rejection, maximum response size, rate-limit parsing, response parsing, and sanitized `ActApiError` mapping behind that interface. Keep `ActClient.listContacts()`, `getContact()`, `createContact()`, and `updateContact()` behavior and signatures unchanged.

- [ ] **Step 4: Implement the read-only migration source client**

`HttpActMigrationSourceClient` must add `$skip`, `$top`, and `$orderby=id` for projected mode. Use these projections:

```ts
const sourceQueries = {
  company: {
    select: "id,name,phone,website,industry,edited",
    expand: "address($select=line1,line2,city,state,postalCode)",
  },
  contact: {
    select:
      "id,firstName,lastName,fullName,company,jobTitle,emailAddress,businessPhone,edited",
    expand:
      "businessAddress($select=line1,line2,city,state,postalCode)",
  },
  opportunity: {
    select:
      "id,name,status,estimatedCloseDate,actualCloseDate,total,probability,edited",
    expand:
      "stage($expand=process($select=name,id);$select=name,id)",
  },
  group: {
    select: "id,name,description,edited",
  },
} as const;
```

If projected mode returns an empty first page, return the checkpoint with `queryMode: "plain"` and the same `nextSkip` so the service retries the endpoint without `$select`, `$expand`, or `$orderby`. Never fall back from a non-empty projected page.

- [ ] **Step 5: Run migration and Contact client regression tests**

```powershell
node node_modules/vitest/vitest.mjs run tests/integration/act-client.test.ts tests/integration/act-migration-client.test.ts
npm run typecheck
```

Expected: existing Contact tests and all new read-only endpoint tests pass.

- [ ] **Step 6: Commit**

```powershell
git add features/act-sync/act-client.ts features/act-sync/act-types.ts features/act-migration/source-client.ts tests/integration/act-client.test.ts tests/integration/act-migration-client.test.ts
git commit -m "feat: add paged Act migration client"
```

---

### Task 4: Parse and normalize source records without leaking PII

**Files:**
- Create: `features/act-migration/source-parser.ts`
- Create: `tests/unit/act-migration-source-parser.test.ts`

**Interfaces:**
- Consumes: `ActMigrationStreamType`, `sourceRecordKey()`, and `relationshipSourceKey()`.
- Produces: `ParsedSourceItem<T>`, `StagedSourceItem`, `NormalizedCompany`, `NormalizedContact`, `NormalizedOpportunity`, `NormalizedGroup`, and `parseSourceItem()`.

- [ ] **Step 1: Write entity parser tests**

Cover:

- trimming display values while preserving the raw snapshot;
- lowercase email matching values;
- digit-only normalized phones;
- normalized names and city/state keys;
- exact Act! industry, status, stage, and group metadata preservation;
- a company-only Contact producing `personCandidate: false`;
- a missing stable ID returning a deterministic error with field names but no source values;
- shared mailboxes such as `info@`, `sales@`, and `office@` setting `sharedEmail: true`;
- relationship keys sorted by their semantic source/target order;
- numeric `.xls` sentinel values remaining ordinary API strings rather than being silently removed.

Example:

```ts
const parsed = parseSourceItem("contact", {
  id: " CONTACT-1 ",
  fullName: "  Avery Example ",
  emailAddress: " INFO@EXAMPLE.COM ",
  businessPhone: "(303) 555-0123",
});
expect(parsed).toMatchObject({
  ok: true,
  sourceId: "CONTACT-1",
  normalized: {
    displayName: "Avery Example",
    normalizedName: "avery example",
    email: "info@example.com",
    normalizedPhone: "3035550123",
    sharedEmail: true,
    personCandidate: true,
  },
});
```

- [ ] **Step 2: Run the parser test and verify failure**

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-source-parser.test.ts
```

Expected: FAIL because `source-parser.ts` does not exist.

- [ ] **Step 3: Implement pure discriminated parsers**

Use this result contract:

```ts
export type ParsedSourceItem<T> =
  | {
      ok: true;
      sourceId: string;
      sourceKey: string;
      rawSnapshot: Record<string, unknown>;
      normalized: T;
      fingerprint: string;
    }
  | {
      ok: false;
      deterministicErrorKey: string;
      rawSnapshot: Record<string, unknown>;
      errorCode: "missing_source_id" | "invalid_source_record";
      errorFields: string[];
    };

export type StagedSourceItem = {
  streamType: ActMigrationStreamType;
  sourceKey: string;
  sourceId: string | null;
  targetSourceId: string | null;
  rawSnapshot: Record<string, unknown>;
  normalizedSnapshot: Record<string, unknown>;
  fingerprint: string;
  errorCode: string | null;
  errorFields: string[];
};
```

Compute `fingerprint` with Node `createHash("sha256")` over canonical JSON whose object keys are recursively sorted. Error fields contain names such as `["id"]`, never rejected values.
For an invalid row, set `deterministicErrorKey` to
`error:${streamType}:${sha256(canonicalRawSnapshot)}`. The snapshot repository
uses that value as `sourceKey`, leaves `sourceId` null, and stores the row with
preview state `error`.

- [ ] **Step 4: Run focused tests and commit**

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-source-parser.test.ts
npm run typecheck
git add features/act-migration/source-parser.ts tests/unit/act-migration-source-parser.test.ts
git commit -m "feat: normalize Act migration sources"
```

---

### Task 5: Capture a durable, resumable source snapshot

**Files:**
- Modify: `db/schema.ts`
- Modify: `db/migrations/0009_act_migration_staging.sql`
- Modify: `db/migrations/meta/0009_snapshot.json`
- Modify: `tests/unit/schema-contract.test.ts`
- Create: `features/act-migration/snapshot-repository.ts`
- Create: `features/act-migration/snapshot-service.ts`
- Create: `tests/integration/act-migration-snapshot-repository.test.ts`
- Create: `tests/integration/act-migration-snapshot-service.test.ts`

**Interfaces:**
- Consumes: `ActMigrationSourceClient`, `parseSourceItem()`, and staging schema.
- Produces: `ActMigrationSnapshotRepository`, `DrizzleActMigrationSnapshotRepository`, `ActMigrationSnapshotService`, `SnapshotProgress`, and `FinalizedSourceSnapshot`.

- [ ] **Step 1: Write repository lease and page-idempotency tests**

Prove:

1. Reusing one `requestKey` returns the same run and creates four root checkpoints in source dependency order.
2. `claimNextCheckpoint()` leases one eligible row and two callers cannot claim the same row.
3. An expired lease can be reclaimed.
4. `storePage()` atomically upserts source records and advances `nextSkip`.
5. Replaying the same page keeps one row per `(run, stream, sourceKey)`.
6. An empty page completes that checkpoint.
7. `failCheckpoint()` stores only a sanitized error code, retryability, and retry time.
8. Snapshot finalization is rejected while any checkpoint is pending, fetching, or retryable-failed.

The repository interface must be:

```ts
export type ActMigrationCheckpoint = {
  id: string;
  runId: string;
  streamType: ActMigrationStreamType;
  partitionKey: string;
  parentSourceId: string | null;
  nextSkip: number;
  pageSize: number;
  queryMode: ActQueryMode;
  status: ActMigrationCheckpointStatus;
  retryAfter: Date | null;
  retryable: boolean;
};

export type SnapshotProgress = {
  runId: string;
  status: ActMigrationRunStatus;
  completedCheckpoints: number;
  totalCheckpoints: number;
  stagedRecords: number;
  failedCheckpoints: number;
  retryable: boolean;
  retryAfter: Date | null;
};

export type FinalizedSourceSnapshot = {
  runId: string;
  records: readonly StagedSourceItem[];
  checkpoints: readonly ActMigrationCheckpoint[];
  sourceDigest: string;
};

export interface ActMigrationSnapshotRepository {
  createRun(input: {
    requestKey: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }): Promise<{ id: string }>;
  claimNextCheckpoint(
    runId: string,
    leaseOwner: string,
    now: Date,
  ): Promise<ActMigrationCheckpoint | null>;
  storePage(input: {
    checkpointId: string;
    leaseOwner: string;
    expectedSkip: number;
    records: readonly StagedSourceItem[];
    nextSkip: number | null;
    queryMode: ActQueryMode;
    now: Date;
  }): Promise<void>;
  failCheckpoint(input: {
    checkpointId: string;
    leaseOwner: string;
    errorCode: string;
    retryable: boolean;
    retryAfter: Date | null;
    now: Date;
  }): Promise<void>;
  enqueueRelationshipCheckpoints(runId: string): Promise<void>;
  getProgress(runId: string): Promise<SnapshotProgress>;
  finalizeSourceSnapshot(runId: string): Promise<FinalizedSourceSnapshot>;
}
```

- [ ] **Step 2: Run repository tests and verify failure**

```powershell
node node_modules/vitest/vitest.mjs run tests/integration/act-migration-snapshot-repository.test.ts
```

Expected: FAIL because the snapshot repository does not exist.

- [ ] **Step 3: Implement atomic checkpoint persistence**

Claim with `FOR UPDATE SKIP LOCKED` in a short transaction, set a UUID lease owner and a five-minute expiry, and release the transaction before the network call. `storePage()` must verify the same lease owner and `expectedSkip` before writing records and advancing the checkpoint.

Because migration `0009` has not been released yet, add the missing
`retryable boolean default true not null` checkpoint column consistently to
the Drizzle schema, `0009` SQL, generated snapshot, and schema contract in
this task. `failCheckpoint()` must persist the supplied boolean independently
from `retryAfter`; do not infer retryability from whether a retry timestamp is
present.

On completion of all four root streams, enqueue:

- one `company_contact` checkpoint per staged Contact, using `/contacts/{id}/companies`;
- two Opportunity relationship checkpoints per staged Opportunity;
- one `group_contact` checkpoint per staged Group.

Use partition keys:

```ts
root
contact:${contactId}
opportunity:${opportunityId}:companies
opportunity:${opportunityId}:contacts
group:${groupId}:contacts
```

- [ ] **Step 4: Write service interruption and resume tests**

Use a fake source client and prove:

- `start()` performs no network request;
- `captureNext(runId, { maxRequests: 10 })` makes at most 10 requests;
- one failed page leaves earlier committed pages intact;
- retryable errors resume at the failed page;
- non-retryable invalid records remain visible as deterministic error records without discarding valid rows or blocking unrelated checkpoints;
- a short page advances by its real length;
- an empty page marks a stream complete;
- repeated capture after completion makes no network request;
- relationship checkpoints begin only after root entity completion.

- [ ] **Step 5: Implement bounded orchestration**

```ts
export class ActMigrationSnapshotService {
  constructor(
    private readonly client: ActMigrationSourceClient,
    private readonly repository: ActMigrationSnapshotRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(input: {
    requestKey: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }) {
    return this.repository.createRun(input);
  }

  async captureNext(
    runId: string,
    options: { maxRequests?: number } = {},
  ): Promise<SnapshotProgress> {
    const maxRequests = Math.min(10, Math.max(1, options.maxRequests ?? 10));
    for (let request = 0; request < maxRequests; request += 1) {
      const leaseOwner = crypto.randomUUID();
      const checkpoint = await this.repository.claimNextCheckpoint(
        runId,
        leaseOwner,
        this.now(),
      );
      if (!checkpoint) break;
      await this.captureCheckpointPage(checkpoint, leaseOwner);
    }
    return this.repository.getProgress(runId);
  }
}
```

Translate `ActApiError` into its safe `code`, `retryable`, and `retryAfter`. Do not send `rawSnapshot` through logs.

- [ ] **Step 6: Run focused tests and commit**

```powershell
node node_modules/vitest/vitest.mjs run tests/integration/act-migration-snapshot-repository.test.ts tests/integration/act-migration-snapshot-service.test.ts
npm run typecheck
git add db/schema.ts db/migrations/0009_act_migration_staging.sql db/migrations/meta/0009_snapshot.json tests/unit/schema-contract.test.ts features/act-migration/snapshot-repository.ts features/act-migration/snapshot-service.ts tests/integration/act-migration-snapshot-repository.test.ts tests/integration/act-migration-snapshot-service.test.ts
git commit -m "feat: capture resumable Act snapshots"
```

---

### Task 6: Build deterministic local candidates, matching, and reconciliation

**Files:**
- Modify: `features/act-migration/migration-types.ts`
- Modify: `features/act-migration/source-parser.ts`
- Create: `features/act-migration/matching-normalization.ts`
- Create: `features/act-migration/local-candidate-repository.ts`
- Create: `features/act-migration/matcher.ts`
- Create: `features/act-migration/reconciliation.ts`
- Modify: `db/schema.ts`
- Modify: `db/migrations/0009_act_migration_staging.sql`
- Modify: `db/migrations/meta/0009_snapshot.json`
- Modify: `tests/unit/act-migration-types.test.ts`
- Modify: `tests/unit/act-migration-source-parser.test.ts`
- Create: `tests/unit/act-migration-matching-normalization.test.ts`
- Modify: `tests/unit/schema-contract.test.ts`
- Create: `tests/integration/act-migration-local-candidate-repository.test.ts`
- Create: `tests/unit/act-migration-matcher.test.ts`
- Create: `tests/unit/act-migration-reconciliation.test.ts`

**Interfaces:**
- Consumes: one finalized source snapshot and canonical external links.
- Produces: conservative shared matching normalization,
  `LocalMigrationCandidateSnapshot`, `ActMigrationProposal`,
  `buildMigrationProposals()`, `MigrationReconciliationReport`, and
  `reconcileMigrationPreview()`.

- [ ] **Step 1: Write failing contract and normalization tests**

Prove:

- target dependency order is `organization`, `contact`,
  `organization_contact`, `booking`, `booking_contact`, `calling_list`,
  `calling_list_member`;
- proposal-aware decisions never offer `link_existing` without a candidate,
  never offer `keep_separate` outside a Person duplicate/consolidation, and
  do not offer create/link choices for unresolved Opportunity parents;
- source Company and Contact phones reuse
  `normalizeNorthAmericanPhone()` and therefore use the same E.164,
  extension-rejection, and invalid-value behavior as local CRM data;
- source and local names/city/region values use one
  `normalizeMatchingText()` whitespace-and-case contract;
- matching email normalization trims and lowercases only syntactically valid
  addresses;
- shared-mailbox detection covers `admin`, `billing`, `bookings`,
  `boxoffice`, `contact`, `customerservice`, `events`, `hello`, `info`,
  `inquiries`, `office`, `reservations`, `sales`, `support`, and `tickets`,
  including plus tags;
- website normalization accepts only HTTP(S) or bare-host input, rejects
  credentials and malformed/hostless values, lowercases the hostname,
  removes one leading `www.` and a terminal dot, and otherwise preserves
  subdomains;
- every parsed Group has `membershipSemantics: "unknown"` until a precise,
  trustworthy Act! API field is separately verified and projected;
- returned `group_contact` rows never imply that a Group is explicit/static.

Use:

```ts
export const migrationIssueCodeValues = [
  "ambiguous_person_match",
  "ambiguous_place_match",
  "company_only_contact_unresolved",
  "duplicate_source_id_conflict",
  "group_dynamic_unsupported",
  "group_membership_semantics_unknown",
  "group_target_unavailable",
  "needs_person",
  "opportunity_place_ambiguous",
  "opportunity_place_errored",
  "opportunity_place_location_incomplete",
  "opportunity_place_missing",
  "orphaned_external_link",
  "parent_proposal_unresolved",
  "shared_mailbox_match_blocked",
  "source_record_error",
] as const;
export type MigrationIssueCode =
  (typeof migrationIssueCodeValues)[number];

export function migrationTargetRank(
  target: MigrationTargetEntityType,
): number;

export function allowedDecisionsForProposal(input: {
  state: MigrationPreviewState;
  targetEntityType: MigrationTargetEntityType;
  issueCode: MigrationIssueCode | null;
  candidateLocalIds: readonly string[];
}): readonly MigrationDecision[];

export function normalizeMatchingText(value: string | null): string | null;
export function normalizeMatchingEmail(value: string | null): string | null;
export function isSharedMailboxEmail(value: string | null): boolean;
export function isGenericContactName(
  displayName: string | null,
  companyName: string | null,
): boolean;
export function normalizeWebsiteHost(value: string | null): string | null;

export type LocalPlaceCandidate = {
  id: string;
  name: string;
  normalizedName: string;
  placeType: string;
  actIndustry: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  normalizedCity: string | null;
  normalizedRegion: string | null;
  postalCode: string | null;
  website: string | null;
  normalizedWebsiteHost: string | null;
};

export type LocalPersonCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  normalizedName: string;
  email: string | null;
  normalizedEmail: string | null;
  sharedEmail: boolean;
  phone: string | null;
  normalizedPhone: string | null;
  jobTitle: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export type LocalBookingCandidate = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  venueName: string | null;
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  probability: string;
  notes: string | null;
};

export type LocalMigrationCandidateSnapshot = {
  places: readonly LocalPlaceCandidate[];
  people: readonly LocalPersonCandidate[];
  bookings: readonly LocalBookingCandidate[];
  placePeople: readonly {
    organizationId: string;
    contactId: string;
    active: boolean;
    isPrimary: boolean;
    role: string | null;
    source: string;
  }[];
  bookingPeople: readonly {
    bookingId: string;
    contactId: string;
    isPrimary: boolean;
    role: string | null;
    source: string;
  }[];
  externalLinks: readonly {
    entityType: "organization" | "contact" | "booking" | "calling_list";
    entityId: string;
    sourceEntityType: ActSourceEntityType;
    actRecordId: string;
    isPrimary: boolean;
    syncMode: "two_way" | "pull_only";
  }[];
};

export type ActMigrationProposal = {
  proposalKey: string;
  state: MigrationPreviewState;
  reviewState: MigrationReviewState;
  targetEntityType: MigrationTargetEntityType;
  sourceRecordKeys: readonly string[];
  candidateLocalIds: readonly string[];
  proposedLocalId: string | null;
  proposedPrimarySourceId: string | null;
  matchReason: string;
  issueCode: MigrationIssueCode | null;
  dependencyProposalKeys: readonly string[];
  displaySnapshot: Record<string, string | number | boolean | null>;
};

export function buildMigrationProposals(input: {
  source: FinalizedSourceSnapshot;
  local: LocalMigrationCandidateSnapshot;
}): readonly ActMigrationProposal[];
```

- [ ] **Step 2: Run the contract tests and verify failure**

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-types.test.ts tests/unit/act-migration-source-parser.test.ts tests/unit/act-migration-matching-normalization.test.ts tests/unit/schema-contract.test.ts
```

Expected: FAIL because the target ordering, shared normalization, Group
semantics, and proposal persistence contracts do not exist.

- [ ] **Step 3: Implement normalization and proposal persistence contracts**

Keep display values unchanged and comparison values separate. Do not expand
the Group API projection using a guessed field.

Extend the normalized source contracts so `NormalizedCompany` carries
`normalizedWebsiteHost`, `NormalizedContact` carries both display `email`
and `normalizedEmail`, and `NormalizedGroup` carries
`membershipSemantics: "unknown"`. Compute `sharedEmail` from the normalized
address, not from an unvalidated display value. An unlinked Contact is a
Person candidate only when it has a non-generic human name: blank names,
names equal to the Company name, and role labels such as Info, Office,
Sales, Support, Box Office, Reservations, or General Contact are
company-only. A valid existing stable Contact link overrides that heuristic
so an already-linked Person is never silently reclassified.

While migration `0009` remains unreleased, add these proposal columns to the
Drizzle schema, SQL migration, and snapshot:

```ts
reviewState: text("review_state").default("not_required").notNull(),
issueCode: text("issue_code"),
proposedPrimarySourceId: text("proposed_primary_source_id"),
dependencyProposalKeys: jsonb("dependency_proposal_keys")
  .$type<string[]>()
  .default(sql`'[]'::jsonb`)
  .notNull(),
```

Add checks for a valid review state, null-or-nonblank issue and proposed
primary source IDs, and an array-valued dependency list. Matching must keep
the proposed primary ID null or within that proposal's Contact source IDs.

- [ ] **Step 4: Write and implement deterministic local reads**

Create a PostgreSQL-gated integration test that inserts rows out of ID order.
The local repository must return, in stable ID order:

- all Places and their normalized name, address, phone, website, and type fields;
- all People and all Place-Person relationships, including inactive rows;
- all Bookings and Booking-Person relationships;
- canonical `company`, `contact`, `opportunity`, and `group` external links;
- existing primary two-way Contact links separately from pull-only aliases.

Run every read inside one read-only `REPEATABLE READ` transaction. An
inactive existing Place-Person pair is available as a reviewed
reactivation/change candidate; source absence never proposes deactivation.

- [ ] **Step 5: Write failing match-precedence and source-ownership tests**

Prove:

- Place matching follows stable Company link, unique normalized name plus
  city/state, then unique normalized name plus verified E.164 phone or
  normalized website host; ambiguous names require review;
- Person matching follows stable Contact link, unique non-shared email with
  compatible name, phone plus compatible name, then Place plus compatible
  name; shared mailboxes never merge People by email alone;
- one source Person can connect to several Places without duplication;
- several source Contact IDs may form one reviewed Person consolidation, and
  an existing primary two-way Contact link wins the proposed primary identity;
- pull-only alias Contact fields cannot overwrite or drive a `change` for a
  Person; aliases may preserve source identity and relationships only;
- generic role names, names equal to the Company, and shared-mailbox/generic
  combinations remain company-only unless a valid stable Contact link
  already owns the source ID;
- a company-only Contact never creates a Person or an invalid
  Contact-to-Place external link;
- a company-only Contact and its `company_contact` key fold into one Place
  proposal only when exactly one source Company relationship resolves it;
  Company values win and Contact phone/address only fill missing Place
  values, while Contact email is visibly ignored because Places have no
  email field;
- missing or multiple company relationships for a company-only Contact
  require review;
- an Opportunity stable link matches its Booking, while an unlinked
  Opportunity always proposes a new Booking and never fuzzy-merges;
- a reliable Opportunity Place is exactly one resolved
  `opportunity_company` parent; missing, ambiguous, errored, and
  location-incomplete parents have distinct issue codes;
- a Booking is ineligible until its Place supplies required city and region;
- a Booking with a reliable Place and no Person stays eligible with
  `needs_person` and `primaryContactId: null`;
- relationship proposals depend on both parents; new relationship metadata
  is `role: null` and `isPrimary: false`, while an existing pair preserves
  its current metadata;
- Group and `group_contact` records are explicitly owned by ignored
  proposals with `group_membership_semantics_unknown`;
- an existing `calling_list/group` link is reported as unavailable/orphaned
  because this slice has no local calling-list table;
- malformed and duplicate-conflict rows become error proposals;
- every staged `sourceKey` appears in exactly one proposal and never two.

Task 5 already converts a later same-ID/different-fingerprint occurrence into
a deterministic `duplicate_source_id_conflict` record with its own error
`sourceKey`. The matcher consumes that staged error row; it must not attempt
to rediscover duplicate IDs or collapse the canonical row and conflict row.

For company-only Contacts, ownership is explicit:

- exactly one Company edge whose valid parent proposal exists folds the
  Contact key and that edge key into the resolved Company/Place proposal;
- zero Company edges create one organization-target `needs_review` proposal
  owning the Contact key, with no dependency;
- multiple Company edges, or any edge with a missing/error parent, create
  one organization-target `needs_review` proposal owning the Contact key and
  every one of those edge keys, with each valid Company proposal key as a
  dependency;
- none of these paths creates a Person or a Contact-to-Place external link.

The source Company is the first endpoint of `company_contact`; Opportunity
is the first endpoint of `opportunity_company` and `opportunity_contact`;
Group is the first endpoint of `group_contact`. Do not reverse them.

- [ ] **Step 6: Implement pure deterministic matching**

The matcher must not query the database, call Act!, read the clock, or
generate random IDs. Sort by `migrationTargetRank()` and then `proposalKey`.
Put parent keys in `dependencyProposalKeys`; keep `issueCode` separate from
the user-facing reason; use one canonical comparable field set for both
unchanged/change classification and display data.

`proposedPrimarySourceId` is part of the proposal and proposal digest.
Existing primary two-way Contact identity wins; otherwise a consolidation
requires an explicit later review choice. Do not use alias field values to
construct the proposed Person update.

Decision legality is proposal-aware. `allowedDecisionsForProposal()` may
offer `link_existing` only when the proposal has a valid local candidate,
and `keep_separate` only for a Person duplicate/consolidation. Missing,
errored, or location-incomplete Opportunity parents, unresolved parent
dependencies, unavailable Groups, and source error rows cannot accept a
semantically invalid link/create choice; they expose only `ignore` or no
decision as appropriate. Task 7 must validate with this function rather
than the state-only helper.

Act! Opportunity status, stage, process, probability, total, and close dates
remain visible source metadata; this slice does not guess a mapping from
those values to local Booking workflow status, probability, or event dates.
New Booking proposals use the existing local defaults `new_lead` and
`possible`, leave event dates null, and derive required location only from
the resolved Place. Stable Booking comparisons must not report changes for
unmapped Act! fields.

Only an existing valid stable link may yield an automatic
`matched_unchanged` or `change` match. Every first-time name, address, phone,
website, email, consolidation, or relationship fallback remains visibly
review-required even when unique. Dangling external links are review-only.
This task must not mutate CRM entities, relationships, external links,
calling lists, or decisions.

- [ ] **Step 7: Write reconciliation tests**

Use:

```ts
export type MigrationReconciliationReport = {
  sourceCounts: Record<ActSourceEntityType, number>;
  relationshipCounts: Record<ActRelationshipType, number>;
  previewCounts: Record<MigrationPreviewState, number>;
  placesWithoutPeople: number;
  multiPlacePeople: number;
  opportunitiesWithoutPlace: number;
  opportunitiesWithoutPerson: number;
  duplicateSourceIdConflicts: number;
  incompleteCheckpoints: number;
  failedCheckpoints: number;
  sourceDigest: string;
  proposalDigest: string;
  complete: boolean;
};
```

Prove `complete` is true only when all checkpoints are complete, every staged
record key is owned exactly once (including ignored/error proposals), and
every dependency key exists. Missing/duplicate ownership and
pending/failed checkpoints make it false. Prove array input order does not
change either digest. The proposal digest covers state, review state, target,
source keys, candidates, proposed local ID, proposed primary source ID,
issue, dependencies, reason, and display snapshot in canonical order.

- [ ] **Step 8: Run focused tests and commit**

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-types.test.ts tests/unit/act-migration-source-parser.test.ts tests/unit/act-migration-matching-normalization.test.ts tests/unit/schema-contract.test.ts tests/integration/act-migration-local-candidate-repository.test.ts tests/unit/act-migration-matcher.test.ts tests/unit/act-migration-reconciliation.test.ts
npm run typecheck
node node_modules/drizzle-kit/bin.cjs check
git diff --check
git add features/act-migration/migration-types.ts features/act-migration/source-parser.ts features/act-migration/matching-normalization.ts features/act-migration/local-candidate-repository.ts features/act-migration/matcher.ts features/act-migration/reconciliation.ts db/schema.ts db/migrations/0009_act_migration_staging.sql db/migrations/meta/0009_snapshot.json tests/unit/act-migration-types.test.ts tests/unit/act-migration-source-parser.test.ts tests/unit/act-migration-matching-normalization.test.ts tests/unit/schema-contract.test.ts tests/integration/act-migration-local-candidate-repository.test.ts tests/unit/act-migration-matcher.test.ts tests/unit/act-migration-reconciliation.test.ts
git commit -m "feat: build Act migration proposals"
```

---

### Task 7: Store immutable previews and durable review decisions

**Files:**
- Create: `features/act-migration/preview-repository.ts`
- Create: `features/act-migration/preview-service.ts`
- Create: `tests/integration/act-migration-preview-repository.test.ts`

**Interfaces:**
- Consumes: `buildMigrationProposals()` and `reconcileMigrationPreview()`.
- Produces: `ActMigrationPreviewRepository`, `DrizzleActMigrationPreviewRepository`, `ActMigrationPreviewService`, `StoredMigrationPreviewPage`, and decision validation.

- [ ] **Step 1: Write preview immutability and decision tests**

Prove:

1. Finalizing a completed snapshot stores source and proposal digests.
2. Finalizing the same run twice returns the same rows without rematching.
3. A different proposal digest for an already-finalized run is rejected.
4. Preview reads page by entity type and preview state with deterministic ordering.
5. `approve_proposed` is accepted only for an approvable proposal.
6. `link_existing` requires one of `candidateLocalIds`.
7. `keep_separate` is accepted only for Person duplicate/consolidation proposals.
8. `ignore` requires a nonblank reason stored in decision metadata.
9. Choosing a primary source Contact requires one of that proposal’s source IDs.
10. A saved decision survives repository recreation and preview reload.
11. No decision method writes to organizations, contacts, bookings, relationship tables, or calling-list tables.

Persist and reload `reviewState`, `issueCode`,
`proposedPrimarySourceId`, and `dependencyProposalKeys` without deriving
them again. Reject a stored
dependency key that does not belong to the same run. An unresolved
dependency remains review-only; saving a child decision must not silently
resolve or apply its parent.

The interface must be:

```ts
export type MigrationPreviewQuery = {
  targetEntityType?: MigrationTargetEntityType;
  state?: MigrationPreviewState;
  page: number;
  pageSize: number;
};

export type StoredMigrationProposal = ActMigrationProposal & {
  id: string;
  decision: MigrationDecision | null;
  decisionReason: string | null;
  chosenLocalEntityId: string | null;
  primarySourceId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
};

export type StoredMigrationPreviewPage = {
  runId: string;
  rows: readonly StoredMigrationProposal[];
  report: MigrationReconciliationReport;
  page: number;
  pageSize: number;
  total: number;
};

export interface ActMigrationPreviewRepository {
  storeProposalsIfAbsent(input: {
    runId: string;
    sourceDigest: string;
    proposalDigest: string;
    proposals: readonly ActMigrationProposal[];
    report: MigrationReconciliationReport;
  }): Promise<void>;
  getPreview(
    runId: string,
    query: MigrationPreviewQuery,
  ): Promise<StoredMigrationPreviewPage>;
  saveDecision(input: {
    runId: string;
    proposalKey: string;
    decision: MigrationDecision;
    chosenLocalEntityId?: string;
    primarySourceId?: string;
    ignoreReason?: string;
    decidedBy: string;
  }): Promise<void>;
}
```

- [ ] **Step 2: Run the repository test and verify failure**

```powershell
node node_modules/vitest/vitest.mjs run tests/integration/act-migration-preview-repository.test.ts
```

Expected: FAIL because the preview repository does not exist.

- [ ] **Step 3: Implement one-time proposal persistence**

Use one transaction to:

1. lock the migration run;
2. verify it is `snapshot_complete` or already `previewed`;
3. store proposals with `onConflictDoNothing`;
4. verify every stored proposal fingerprint;
5. update staged record proposal/review fields;
6. store both digests and the reconciliation summary;
7. change the run to `previewed`.

Reopening a `previewed` run must read stored proposals only.

- [ ] **Step 4: Implement decision validation and auditing**

Save the authenticated Clerk user ID in `decidedBy`. Store only decision metadata in the proposal row. Add an `audit_entries` row with:

```ts
{
  entityType: "act_migration_proposal",
  entityId: proposal.id,
  action: "review_decision_changed",
  before: previousDecision,
  after: nextDecision,
}
```

Do not include raw source snapshots in the audit row.
In the same transaction, update every staged record referenced by the proposal
from `pending` to `decided` or `ignored`; decision changes must update the
proposal, referenced records, and audit entry atomically.

- [ ] **Step 5: Run focused tests and commit**

```powershell
node node_modules/vitest/vitest.mjs run tests/integration/act-migration-preview-repository.test.ts
npm run typecheck
git add features/act-migration/preview-repository.ts features/act-migration/preview-service.ts tests/integration/act-migration-preview-repository.test.ts
git commit -m "feat: store reviewed Act migration previews"
```

---

### Task 8: Add the owner-only migration progress and review interface

**Files:**
- Create: `app/(private)/settings/act-migration/page.tsx`
- Create: `app/(private)/settings/act-migration/actions.ts`
- Create: `components/act-migration/act-migration-review.tsx`
- Modify: `components/navigation/app-shell.tsx`
- Create: `tests/unit/act-migration-actions.test.ts`
- Create: `tests/unit/act-migration-review.test.tsx`

**Interfaces:**
- Consumes: `ActMigrationSnapshotService` and `ActMigrationPreviewService`.
- Produces: owner-only start/continue/resume/finalize/decision actions and the review UI.

- [ ] **Step 1: Write action-boundary tests**

Mock `requireOwner()` and prove it runs before service construction for:

```ts
startActMigrationAction(requestKey)
continueActMigrationAction(runId)
resumeActMigrationAction(runId)
finalizeActMigrationPreviewAction(runId)
saveActMigrationDecisionAction(input)
```

Validate request and run IDs as UUIDs, page sizes between 1 and 100, and decisions through the Task 1 value arrays. Hash the configured Act! database name with SHA-256 into `sourceDatabaseKey`; never store credential values or the raw database name. Return sanitized user messages for `ActApiError`, lease conflicts, invalid source records, and unknown failures.

- [ ] **Step 2: Write component tests**

Prove the component:

- says `Preview only — no Command Center or Act! records are changed`;
- shows Companies, Contacts, Opportunities, Groups, and relationship progress separately;
- continues snapshot capture in bounded action calls;
- stops and offers `Resume` after a retryable error;
- does not auto-retry a non-retryable error;
- shows entity and preview-state tabs with counts;
- pages rows without loading the complete 1,814-company snapshot into the browser;
- shows Places without People, multi-Place People, Opportunities without Place/Person, duplicate IDs, and incomplete/failed checkpoints;
- offers only decisions allowed by each proposal;
- has no Apply or Import button;
- preserves saved decisions after remount;
- keeps raw snapshots and credential fields out of rendered markup.

- [ ] **Step 3: Implement authenticated server actions**

Each action begins:

```ts
const actor = await requireOwner();
```

`continueActMigrationAction()` invokes at most 10 source requests. Return:

```ts
type ActMigrationActionResult =
  | {
      ok: true;
      runId: string;
      progress: SnapshotProgress;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      retryAfter: string | null;
    };
```

Revalidate `/settings/act-migration` only after a successful state change.

- [ ] **Step 4: Implement the page and component**

The page must remain `force-dynamic`, mask the database name with only the last four characters visible, and load a stored run without contacting Act!. Render:

1. Connection and preview-only warning.
2. Snapshot progress and resume controls.
3. Reconciliation summary.
4. Entity/state tabs.
5. Paginated proposal rows.
6. Durable review choices.

Add `Act! migration` beside the existing `Act! sync` Settings link. Do not rename or remove Contact sync.

- [ ] **Step 5: Run focused tests and commit**

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-actions.test.ts tests/unit/act-migration-review.test.tsx
npm run typecheck
git add app/(private)/settings/act-migration/page.tsx app/(private)/settings/act-migration/actions.ts components/act-migration/act-migration-review.tsx components/navigation/app-shell.tsx tests/unit/act-migration-actions.test.ts tests/unit/act-migration-review.test.tsx
git commit -m "feat: add Act migration preview workspace"
```

---

### Task 9: Add operations guidance and the Slice 2 release gate

**Files:**
- Create: `docs/operations/act-migration.md`
- Create: `tests/integration/act-migration-docs.test.ts`
- Modify: `package.json`
- Modify: `tests/unit/crm-database-test-gate.test.ts`

**Interfaces:**
- Consumes: every prior task.
- Produces: an exact production-safe staging and preview runbook plus release commands.

- [ ] **Step 1: Write the documentation contract test**

Require the runbook to include these exact safety concepts:

```ts
expect(contents).toContain("read-only Act! API");
expect(contents).toContain("does not apply CRM records");
expect(contents).toContain("stable Act! IDs");
expect(contents).toContain("resume");
expect(contents).toContain("reconciliation");
expect(contents).toContain("Places without People");
expect(contents).toContain("Opportunities without a reliable Place");
expect(contents).toContain("source absence never deletes");
expect(contents).toContain("raw PII");
expect(contents).toContain("Slice 3");
```

Also assert that no command instructs an operator to import any `.xls` file into production.

- [ ] **Step 2: Write the runbook**

Document:

1. required server-side Act! environment variables without example secrets;
2. connection test;
3. starting a new snapshot;
4. bounded progress and safe resume;
5. projected-query compatibility fallback;
6. retryable versus non-retryable failures;
7. preview states and allowed decisions;
8. reconciliation counts;
9. proof that no local CRM records are applied;
10. evidence to capture before Slice 3;
11. how to abandon a bad run without deleting local CRM data;
12. credential and PII logging rules.

- [ ] **Step 3: Extend the exact PostgreSQL release gate**

Append these suites to `test:crm-db` and its exact-list unit contract:

```text
tests/integration/act-migration-staging-migration.test.ts
tests/integration/act-migration-snapshot-repository.test.ts
tests/integration/act-migration-preview-repository.test.ts
```

Keep `--maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`.

- [ ] **Step 4: Run the complete Slice 2 verification gate**

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/act-migration-types.test.ts tests/unit/act-migration-source-parser.test.ts tests/unit/act-migration-matcher.test.ts tests/unit/act-migration-reconciliation.test.ts tests/unit/act-migration-actions.test.ts tests/unit/act-migration-review.test.tsx tests/integration/act-client.test.ts tests/integration/act-migration-client.test.ts tests/integration/act-migration-snapshot-service.test.ts tests/integration/act-migration-docs.test.ts
npm run test:crm-db
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

The Slice 2 gate passes only when:

1. every root and relationship stream can resume after a failed page;
2. all source records have stable IDs or a visible sanitized error;
3. replaying a completed source snapshot produces identical source and proposal digests;
4. every proposal is visible and paginated;
5. first-time fallback matches require review;
6. no migration action mutates CRM entity tables;
7. aliases cannot overwrite Person fields or become a second two-way Contact identity;
8. every source row and relationship is proposed, explicitly ignored, or visibly errored;
9. existing Contact sync, legacy import, packages/resources, calls, and relationship tests remain green.

- [ ] **Step 5: Commit the release gate**

```powershell
git add docs/operations/act-migration.md tests/integration/act-migration-docs.test.ts package.json tests/unit/crm-database-test-gate.test.ts
git commit -m "docs: add Act migration preview release gate"
```

---

## Slice Completion Gate

Before starting the reviewed-import slice, verify:

1. Every valid root record contains a stable Act! Company, Contact, Opportunity, or Group ID; invalid source rows remain visible as deterministic sanitized errors.
2. Company-Contact, Opportunity-Company, Opportunity-Contact, and Group-Contact relationships are staged with deterministic keys.
3. Failed or interrupted paging resumes from the last committed checkpoint.
4. A replay does not duplicate records, relationships, proposals, or decisions.
5. Existing primary two-way Contact links remain primary; aliases are pull-only.
6. Places, People, Bookings, relationships, and calling lists remain unchanged by every Slice 2 action.
7. Unique fallback matches remain visibly reviewable.
8. Ambiguous matches are never merged automatically.
9. The reconciliation report accounts for every source record and relationship.
10. Places without People, multi-Place People, Opportunities without Place/Person, unsupported Groups, and duplicate source IDs are visible.
11. Raw source PII never appears in logs or audit decision payloads.
12. The PostgreSQL gate, unit/integration suite, lint, typecheck, and production build pass.
