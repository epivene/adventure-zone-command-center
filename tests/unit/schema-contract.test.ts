import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as databaseSchema from "@/db/schema";
import {
  activities,
  actContactSyncStates,
  actExternalLinks,
  actImportRuns,
  actSyncOperations,
  actSyncRuns,
  activityRevisions,
  auditEntries,
  bookings,
  bookingContacts,
  callSessions,
  contacts,
  followUps,
  organizations,
  organizationContacts,
  travelLegs,
} from "@/db/schema";
import { initialTravelLegs } from "@/db/seed";
import { bookingStatusValues } from "@/features/bookings/booking-types";
import {
  requestApprovalStatusValues,
  specialRequestTreatmentValues,
} from "@/features/packages/package-types";

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe("booking status contract", () => {
  it("contains the approved workflow in order", () => {
    expect(bookingStatusValues).toEqual([
      "new_lead", "researching", "contact_due", "contacted", "interested",
      "possible", "unlikely", "quote_sent", "pending_decision",
      "pending_contract", "contract_received", "confirmed", "declined",
      "cancelled", "completed", "renewal_due",
    ]);
  });
});

describe("database schema contract", () => {
  it("exports normalized Place-Person and Booking-Person relationships", () => {
    expect(Object.keys(organizationContacts)).toEqual(expect.arrayContaining([
      "id",
      "organizationId",
      "contactId",
      "role",
      "isPrimary",
      "active",
      "source",
      "createdAt",
      "updatedAt",
    ]));
    expect(Object.keys(bookingContacts)).toEqual(expect.arrayContaining([
      "id",
      "bookingId",
      "contactId",
      "role",
      "isPrimary",
      "source",
      "createdAt",
      "updatedAt",
    ]));

    expect(
      getTableConfig(organizationContacts).uniqueConstraints
        .map((constraint) => constraint.name),
    ).toContain("organization_contacts_organization_contact_unique");
    expect(
      getTableConfig(organizationContacts).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    ).toContain("organization_contacts_one_active_primary");
    expect(
      getTableConfig(organizationContacts).checks.map((check) => check.name),
    ).toContain("organization_contacts_primary_is_active");
    expect(
      getTableConfig(bookingContacts).uniqueConstraints
        .map((constraint) => constraint.name),
    ).toContain("booking_contacts_booking_contact_unique");
    expect(
      getTableConfig(bookingContacts).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    ).toContain("booking_contacts_one_primary");
    expect(
      getTableConfig(contacts).foreignKeys.map((key) => key.getName()),
    ).toContain("contacts_primary_organization_contact_fk");
    expect(
      getTableConfig(bookings).foreignKeys.map((key) => key.getName()),
    ).toContain("bookings_primary_booking_contact_fk");
  });

  it("exports the Stage 1 normalized tables", () => {
    expect(Object.keys(contacts)).toEqual(expect.arrayContaining([
      "id", "organizationId", "firstName", "lastName", "email", "phone",
      "jobTitle", "address1", "address2", "city", "region", "postalCode",
      "actRecordId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(organizations)).toEqual(expect.arrayContaining([
      "id", "name", "actRecordId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(bookings)).toEqual(expect.arrayContaining([
      "id", "organizationId", "primaryContactId", "name", "city", "region",
      "status", "probability", "travelLegId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(followUps)).toEqual(expect.arrayContaining([
      "id", "bookingId", "kind", "dueAt", "completedAt", "outcome",
      "nextFollowUpId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(travelLegs)).toEqual(expect.arrayContaining([
      "id", "name", "color", "sortOrder", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(auditEntries)).toEqual(expect.arrayContaining([
      "id", "entityType", "entityId", "action", "before", "after", "createdAt",
    ]));
    expect(Object.keys(actImportRuns)).toEqual(expect.arrayContaining([
      "id", "sourceFileName", "status", "startedAt", "completedAt", "summary", "createdAt",
    ]));
    expect(Object.keys(actExternalLinks)).toEqual(expect.arrayContaining([
      "id", "entityType", "entityId", "actRecordId", "importRunId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(actContactSyncStates)).toEqual(expect.arrayContaining([
      "contactId", "baseSnapshot", "actEditedAt", "lastSyncedAt",
      "localDirty", "state", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(actSyncRuns)).toEqual(expect.arrayContaining([
      "id", "status", "startedAt", "completedAt", "summary",
      "activeQueueToken", "createdAt",
    ]));
    expect(Object.keys(actSyncOperations)).toEqual(expect.arrayContaining([
      "id", "runId", "rowKey", "localContactId", "actRecordId", "category",
      "decision", "status", "baseSnapshot", "localSnapshot", "actSnapshot",
      "error", "retryable", "createdAt", "updatedAt",
    ]));
  });

  it("exports durable Act migration staging and canonical link metadata", () => {
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
        "reviewState",
        "targetEntityType",
        "sourceRecordKeys",
        "candidateLocalIds",
        "proposedLocalId",
        "issueCode",
        "proposedPrimarySourceId",
        "dependencyProposalKeys",
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

    expect(indexNames(databaseSchema.actMigrationCheckpoints)).toContain(
      "act_migration_checkpoints_run_stream_partition_unique",
    );
    expect(indexNames(databaseSchema.actMigrationRecords)).toContain(
      "act_migration_records_run_stream_source_unique",
    );
    expect(databaseSchema.actMigrationRecords.sourceId.notNull).toBe(false);
    expect(
      getTableConfig(databaseSchema.actMigrationRecords).checks.map(
        (constraint) => constraint.name,
      ),
    ).toContain("act_migration_records_source_key_nonblank");
    expect(indexNames(databaseSchema.actMigrationProposals)).toContain(
      "act_migration_proposals_run_key_unique",
    );
    expect(
      getTableConfig(databaseSchema.actMigrationProposals).checks.map(
        (constraint) => constraint.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        "act_migration_proposals_review_state_valid",
        "act_migration_proposals_issue_code_nonblank",
        "act_migration_proposals_proposed_primary_source_id_nonblank",
        "act_migration_proposals_dependency_proposal_keys_array",
      ]),
    );
    expect(indexNames(actExternalLinks)).toEqual(
      expect.arrayContaining([
        "act_external_links_source_external_id_unique",
        "act_external_links_one_primary_per_local_source",
      ]),
    );
  });

  it("exports the CRM activity and call workspace fields", () => {
    expect(organizations.lastResort).toBeDefined();
    expect(organizations.lastResortReason).toBeDefined();
    expect(contacts.normalizedPhone).toBeDefined();
    expect(contacts.quickAddRequestKey).toBeDefined();
    expect(activities.organizationId).toBeDefined();
    expect(activities.contactId).toBeDefined();
    expect(activities.bookingId).toBeDefined();
    expect(activityRevisions.activityId).toBeDefined();
    expect(callSessions.disposition).toBeDefined();
    expect(callSessions.requestKey).toBeDefined();
    expect(callSessions.nextFollowUpId).toBeDefined();
    expect(callSessions.resultingBookingStatus).toBeDefined();
    expect(
      getTableConfig(callSessions).checks.map((constraint) => constraint.name),
    ).toEqual(expect.arrayContaining([
      "call_sessions_parent_required",
      "call_sessions_ended_at_not_before_started",
    ]));
    expect(
      getTableConfig(callSessions).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    ).toContain("call_sessions_request_key_unique");
    expect(
      getTableConfig(contacts).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    ).toContain("contacts_quick_add_request_key_unique");
    expect(getTableConfig(activities).indexes.map((index) => index.config.name))
      .toEqual(expect.arrayContaining([
        "activities_organization_occurred_at_idx",
        "activities_contact_occurred_at_idx",
        "activities_booking_occurred_at_idx",
      ]));
    expect(getTableConfig(activityRevisions).indexes.map((index) => index.config.name))
      .toContain("activity_revisions_activity_created_at_idx");
    expect(getTableConfig(followUps).indexes.map((index) => index.config.name))
      .toContain("follow_ups_open_due_at_idx");
  });

  it("constrains contact sync state and operation identity", () => {
    expect(
      getTableConfig(actContactSyncStates).checks.map(
        (constraint) => constraint.name,
      ),
    ).toContain("act_contact_sync_states_state_valid");
    expect(
      getTableConfig(actSyncOperations).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    ).toContain("act_sync_operations_run_row_unique");
  });
});

describe("travel-leg seed contract", () => {
  it("provides exactly four configured travel legs in display order", () => {
    expect(initialTravelLegs).toEqual([
      { name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
      { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
      { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
      { name: "Leg 4", color: "#15956B", sortOrder: 4 },
    ]);
  });

  it("enforces the fixed four sort-order slots in PostgreSQL", () => {
    expect(
      getTableConfig(travelLegs).checks.map((constraint) => constraint.name),
    ).toContain("travel_legs_sort_order_between_1_and_4");
  });
});

describe("package and resource schema contract", () => {
  it("adds shared attraction totals and all eight package/resource tables", () => {
    expect(bookings.physicalAttractionTotal).toBeDefined();
    expect(bookings.attractionTotalApprovalReason).toBeDefined();
    expect(databaseSchema.packageTemplates.code).toBeDefined();
    expect(databaseSchema.bookingPackageSelections.bookingId).toBeDefined();
    expect(databaseSchema.bookingSpecialRequests.treatment).toBeDefined();
    expect(databaseSchema.resources.countsAsAttraction).toBeDefined();
    expect(databaseSchema.resourcePackageTags.packageTemplateId).toBeDefined();
    expect(databaseSchema.bookingResourceAssignments.resourceId).toBeDefined();
    expect(
      databaseSchema.bookingResourcePackageAttributions.packageTemplateId,
    ).toBeDefined();
    expect(databaseSchema.resourceConflictOverrides.conflictKey).toBeDefined();
  });

  it("uses the package policy request values at the database boundary", () => {
    expect(databaseSchema.specialRequestTreatmentValues).toBe(
      specialRequestTreatmentValues,
    );
    expect(databaseSchema.requestApprovalStatusValues).toBe(
      requestApprovalStatusValues,
    );
    expect(databaseSchema.resourceStatusValues).toEqual([
      "available",
      "unavailable",
      "maintenance",
      "archived",
    ]);

    expect(
      getTableConfig(databaseSchema.bookingSpecialRequests).checks.map(
        (constraint) => constraint.name,
      ),
    ).toEqual(expect.arrayContaining([
      "booking_special_requests_description_nonblank",
      "booking_special_requests_treatment_valid",
      "booking_special_requests_approval_status_valid",
    ]));
    expect(
      getTableConfig(databaseSchema.resources).checks.map(
        (constraint) => constraint.name,
      ),
    ).toEqual(expect.arrayContaining([
      "resources_code_nonblank",
      "resources_name_nonblank",
      "resources_category_nonblank",
      "resources_status_valid",
      "resources_setup_minutes_nonnegative",
      "resources_teardown_minutes_nonnegative",
      "resources_minimum_transfer_minutes_nonnegative",
    ]));
  });

  it("prevents duplicate selections, assignments, tags, attributions, and overrides", () => {
    const uniqueIndexNames = [
      databaseSchema.packageTemplates,
      databaseSchema.bookingPackageSelections,
      databaseSchema.resources,
      databaseSchema.resourcePackageTags,
      databaseSchema.bookingResourceAssignments,
      databaseSchema.bookingResourcePackageAttributions,
      databaseSchema.resourceConflictOverrides,
    ].flatMap((table) =>
      getTableConfig(table).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    );

    expect(uniqueIndexNames).toEqual(expect.arrayContaining([
      "package_templates_code_unique",
      "booking_package_selections_booking_package_unique",
      "resources_code_unique",
      "resource_package_tags_resource_package_unique",
      "booking_resource_assignments_booking_resource_unique",
      "booking_resource_package_attributions_assignment_package_unique",
      "resource_conflict_overrides_booking_conflict_unique",
    ]));
  });

  it("indexes resource assignment lookups and special-request operations filters", () => {
    const indexColumns = [
      databaseSchema.bookingResourceAssignments,
      databaseSchema.bookingSpecialRequests,
    ].flatMap((table) =>
      getTableConfig(table).indexes.map((index) => ({
        name: index.config.name,
        columns: index.config.columns.map((column) =>
          "name" in column ? column.name : undefined
        ),
      })),
    );

    expect(indexColumns).toEqual(expect.arrayContaining([
      {
        name: "booking_resource_assignments_resource_id_idx",
        columns: ["resource_id"],
      },
      {
        name: "booking_special_requests_booking_status_treatment_idx",
        columns: ["booking_id", "approval_status", "treatment"],
      },
    ]));
  });

  it("keeps package/resource child rows connected through foreign keys", () => {
    expect(
      getTableConfig(databaseSchema.bookingPackageSelections).foreignKeys,
    ).toHaveLength(2);
    expect(
      getTableConfig(databaseSchema.bookingSpecialRequests).foreignKeys,
    ).toHaveLength(1);
    expect(getTableConfig(databaseSchema.resourcePackageTags).foreignKeys)
      .toHaveLength(2);
    expect(
      getTableConfig(databaseSchema.bookingResourceAssignments).foreignKeys,
    ).toHaveLength(2);
    expect(
      getTableConfig(databaseSchema.bookingResourcePackageAttributions)
        .foreignKeys,
    ).toHaveLength(2);
    expect(
      getTableConfig(databaseSchema.resourceConflictOverrides).foreignKeys,
    ).toHaveLength(2);
  });

  it("requires nonblank conflict override audit metadata", () => {
    expect(
      getTableConfig(databaseSchema.resourceConflictOverrides).checks.map(
        (constraint) => constraint.name,
      ),
    ).toEqual(expect.arrayContaining([
      "resource_conflict_overrides_conflict_key_nonblank",
      "resource_conflict_overrides_reason_nonblank",
      "resource_conflict_overrides_acknowledged_by_nonblank",
    ]));
  });
});
