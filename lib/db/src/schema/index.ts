import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Inlined type constants (originally from features/)
const bookingStatusValues = [
  "new_lead","researching","contact_due","contacted","interested","possible",
  "unlikely","quote_sent","pending_decision","pending_contract","contract_received",
  "confirmed","declined","cancelled","completed","renewal_due",
] as const;
export type BookingStatus = (typeof bookingStatusValues)[number];

const probabilityValues = ["likely","possible","unlikely"] as const;
export type Probability = (typeof probabilityValues)[number];

const placeTypeValues = [
  "fair","city_government","festival_event","venue","school","tribe",
  "association","company","other",
] as const;
export type PlaceType = (typeof placeTypeValues)[number];

const specialRequestTreatmentValues = ["add_to_count","replace_included","note_only"] as const;
export type SpecialRequestTreatment = (typeof specialRequestTreatmentValues)[number];

const requestApprovalStatusValues = ["needs_approval","approved","declined"] as const;
export type RequestApprovalStatus = (typeof requestApprovalStatusValues)[number];

const actSourceEntityTypeValues = ["company","contact","opportunity","group"] as const;
const actRelationshipTypeValues = ["company_contact","opportunity_company","opportunity_contact","group_contact"] as const;
const actMigrationStreamTypeValues = [...actSourceEntityTypeValues, ...actRelationshipTypeValues] as const;
const actMigrationRunStatusValues = ["snapshotting","snapshot_complete","matching","previewed","applying","partially_applied","applied","failed"] as const;
const actMigrationCheckpointStatusValues = ["pending","fetching","complete","failed"] as const;
const actQueryModeValues = ["projected","plain"] as const;
const migrationPreviewStateValues = ["new","matched_unchanged","change","new_relationship","possible_duplicate","needs_review","ignored","error"] as const;
const migrationDecisionValues = ["approve_proposed","link_existing","keep_separate","confirm_static_group","ignore"] as const;
const migrationApplyBatchStatusValues = ["pending","applying","partially_applied","applied","failed"] as const;
const migrationApplyOperationStatusValues = ["pending","leased","blocked","applied","ignored","failed"] as const;
const migrationReviewStateValues = ["not_required","pending","decided","ignored"] as const;
const migrationTargetEntityTypeValues = ["organization","contact","organization_contact","booking","booking_contact","calling_list","calling_list_member"] as const;

export const resourceStatusValues = [
  "available",
  "unavailable",
  "maintenance",
  "archived",
] as const;
export type ResourceStatus = (typeof resourceStatusValues)[number];

export const packageAttributionSourceValues = [
  "inferred",
  "manual",
] as const;
export type PackageAttributionSource =
  (typeof packageAttributionSourceValues)[number];

function sqlTextValues(values: readonly string[]) {
  return sql.raw(
    values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "),
  );
}

export const bookingStatusEnum = pgEnum("booking_status", bookingStatusValues);
export const probabilityEnum = pgEnum("probability", probabilityValues);
export const activityKindValues = [
  "call",
  "note",
  "follow_up",
  "status_change",
  "booking_update",
  "contract_update",
  "calendar",
  "act_history",
  "approved_suggestion",
] as const;
export const callDispositionValues = [
  "no_answer",
  "left_voicemail",
  "follow_up_needed",
  "interested",
  "proposal_sent",
  "booked",
  "declined",
  "last_resort",
] as const;
export const activityKindEnum = pgEnum("activity_kind", activityKindValues);
export const callDispositionEnum = pgEnum(
  "call_disposition",
  callDispositionValues,
);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  actRecordId: text("act_record_id").unique(),
  placeType: text("place_type").$type<PlaceType>().default("other").notNull(),
  actIndustry: text("act_industry"),
  phone: text("phone"),
  normalizedPhone: text("normalized_phone"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  website: text("website"),
  lastResort: boolean("last_resort").default(false).notNull(),
  lastResortReason: text("last_resort_reason"),
  lastResortChangedAt: timestamp("last_resort_changed_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check(
    "organizations_place_type_valid",
    sql`${table.placeType} in (${sqlTextValues(placeTypeValues)})`,
  ),
  check(
    "organizations_last_resort_reason_required",
    sql`not ${table.lastResort} or nullif(trim(${table.lastResortReason}), '') is not null`,
  ),
  index("organizations_normalized_phone_idx").on(table.normalizedPhone),
]);

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  normalizedPhone: text("normalized_phone"),
  quickAddRequestKey: uuid("quick_add_request_key"),
  jobTitle: text("job_title"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  actRecordId: text("act_record_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.organizationId, table.id],
    foreignColumns: [
      organizationContacts.organizationId,
      organizationContacts.contactId,
    ],
    name: "contacts_primary_organization_contact_fk",
  }),
  index("contacts_normalized_phone_idx").on(table.normalizedPhone),
  uniqueIndex("contacts_quick_add_request_key_unique")
    .on(table.quickAddRequestKey)
    .where(sql`${table.quickAddRequestKey} is not null`),
]);

export const travelLegs = pgTable(
  "travel_legs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    sortOrder: integer("sort_order").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "travel_legs_sort_order_between_1_and_9",
      sql`${table.sortOrder} between 1 and 9`,
    ),
  ],
);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  primaryContactId: uuid("primary_contact_id").references(() => contacts.id),
  name: text("name").notNull(),
  venueName: text("venue_name"),
  address1: text("address_1"),
  city: text("city").notNull(),
  region: text("region").notNull(),
  postalCode: text("postal_code"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: bookingStatusEnum("status").default("new_lead").notNull(),
  probability: probabilityEnum("probability").default("possible").notNull(),
  travelLegId: uuid("travel_leg_id").references(() => travelLegs.id),
  actRecordId: text("act_record_id").unique(),
  notes: text("notes"),
  physicalAttractionTotal: integer("physical_attraction_total"),
  attractionTotalApprovalReason: text("attraction_total_approval_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.id, table.primaryContactId],
    foreignColumns: [
      bookingContacts.bookingId,
      bookingContacts.contactId,
    ],
    name: "bookings_primary_booking_contact_fk",
  }),
  check(
    "bookings_physical_attraction_total_nonnegative",
    sql`${table.physicalAttractionTotal} is null or ${table.physicalAttractionTotal} >= 0`,
  ),
]);

export const organizationContacts = pgTable(
  "organization_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    contactId: uuid("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id),
    role: text("role"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    source: text("source").default("local").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("organization_contacts_organization_contact_unique").on(
      table.organizationId,
      table.contactId,
    ),
    uniqueIndex("organization_contacts_one_active_primary")
      .on(table.organizationId)
      .where(sql`${table.active} and ${table.isPrimary}`),
    index("organization_contacts_contact_id_idx").on(table.contactId),
    check(
      "organization_contacts_primary_is_active",
      sql`not ${table.isPrimary} or ${table.active}`,
    ),
  ],
);

export const bookingContacts = pgTable(
  "booking_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references((): AnyPgColumn => bookings.id),
    contactId: uuid("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id),
    role: text("role"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    source: text("source").default("local").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("booking_contacts_booking_contact_unique").on(
      table.bookingId,
      table.contactId,
    ),
    uniqueIndex("booking_contacts_one_primary")
      .on(table.bookingId)
      .where(sql`${table.isPrimary}`),
    index("booking_contacts_contact_id_idx").on(table.contactId),
  ],
);

export const packageTemplates = pgTable(
  "package_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    baseAttractionCount: integer("base_attraction_count").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("package_templates_code_unique").on(table.code),
    check(
      "package_templates_code_nonblank",
      sql`nullif(trim(${table.code}), '') is not null`,
    ),
    check(
      "package_templates_name_nonblank",
      sql`nullif(trim(${table.name}), '') is not null`,
    ),
    check(
      "package_templates_base_attraction_count_positive",
      sql`${table.baseAttractionCount} > 0`,
    ),
  ],
);

export const bookingPackageSelections = pgTable(
  "booking_package_selections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    packageTemplateId: uuid("package_template_id")
      .notNull()
      .references(() => packageTemplates.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("booking_package_selections_booking_package_unique").on(
      table.bookingId,
      table.packageTemplateId,
    ),
  ],
);

export const bookingSpecialRequests = pgTable(
  "booking_special_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    treatment: text("treatment").$type<SpecialRequestTreatment>().notNull(),
    approvalStatus: text("approval_status")
      .$type<RequestApprovalStatus>()
      .default("needs_approval")
      .notNull(),
    decisionReason: text("decision_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("booking_special_requests_booking_status_treatment_idx").on(
      table.bookingId,
      table.approvalStatus,
      table.treatment,
    ),
    check(
      "booking_special_requests_description_nonblank",
      sql`nullif(trim(${table.description}), '') is not null`,
    ),
    check(
      "booking_special_requests_treatment_valid",
      sql`${table.treatment} in (${sqlTextValues(specialRequestTreatmentValues)})`,
    ),
    check(
      "booking_special_requests_approval_status_valid",
      sql`${table.approvalStatus} in (${sqlTextValues(requestApprovalStatusValues)})`,
    ),
  ],
);

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    countsAsAttraction: boolean("counts_as_attraction").default(false).notNull(),
    movable: boolean("movable").default(false).notNull(),
    normalTravelLegId: uuid("normal_travel_leg_id").references(
      () => travelLegs.id,
    ),
    setupMinutes: integer("setup_minutes").default(0).notNull(),
    teardownMinutes: integer("teardown_minutes").default(0).notNull(),
    minimumTransferMinutes: integer("minimum_transfer_minutes")
      .default(0)
      .notNull(),
    status: text("status").$type<ResourceStatus>().default("available").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("resources_code_unique").on(table.code),
    check(
      "resources_code_nonblank",
      sql`nullif(trim(${table.code}), '') is not null`,
    ),
    check(
      "resources_name_nonblank",
      sql`nullif(trim(${table.name}), '') is not null`,
    ),
    check(
      "resources_category_nonblank",
      sql`nullif(trim(${table.category}), '') is not null`,
    ),
    check(
      "resources_status_valid",
      sql`${table.status} in (${sqlTextValues(resourceStatusValues)})`,
    ),
    check(
      "resources_setup_minutes_nonnegative",
      sql`${table.setupMinutes} >= 0`,
    ),
    check(
      "resources_teardown_minutes_nonnegative",
      sql`${table.teardownMinutes} >= 0`,
    ),
    check(
      "resources_minimum_transfer_minutes_nonnegative",
      sql`${table.minimumTransferMinutes} >= 0`,
    ),
  ],
);

export const resourcePackageTags = pgTable(
  "resource_package_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    packageTemplateId: uuid("package_template_id")
      .notNull()
      .references(() => packageTemplates.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("resource_package_tags_resource_package_unique").on(
      table.resourceId,
      table.packageTemplateId,
    ),
  ],
);

export const bookingResourceAssignments = pgTable(
  "booking_resource_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    attributionSource: text("attribution_source")
      .$type<PackageAttributionSource>()
      .default("inferred")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("booking_resource_assignments_booking_resource_unique").on(
      table.bookingId,
      table.resourceId,
    ),
    index("booking_resource_assignments_resource_id_idx").on(table.resourceId),
    check(
      "booking_resource_assignments_attribution_source_valid",
      sql`${table.attributionSource} in (${sqlTextValues(
        packageAttributionSourceValues,
      )})`,
    ),
  ],
);

export const bookingResourcePackageAttributions = pgTable(
  "booking_resource_package_attributions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingResourceAssignmentId: uuid("booking_resource_assignment_id")
      .notNull()
      .references(() => bookingResourceAssignments.id, { onDelete: "cascade" }),
    packageTemplateId: uuid("package_template_id")
      .notNull()
      .references(() => packageTemplates.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "booking_resource_package_attributions_assignment_package_unique",
    ).on(
      table.bookingResourceAssignmentId,
      table.packageTemplateId,
    ),
  ],
);

export const resourceConflictOverrides = pgTable(
  "resource_conflict_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id),
    conflictKey: text("conflict_key").notNull(),
    reason: text("reason").notNull(),
    acknowledgedBy: text("acknowledged_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("resource_conflict_overrides_booking_conflict_unique").on(
      table.bookingId,
      table.conflictKey,
    ),
    check(
      "resource_conflict_overrides_conflict_key_nonblank",
      sql`nullif(trim(${table.conflictKey}), '') is not null`,
    ),
    check(
      "resource_conflict_overrides_reason_nonblank",
      sql`nullif(trim(${table.reason}), '') is not null`,
    ),
    check(
      "resource_conflict_overrides_acknowledged_by_nonblank",
      sql`nullif(trim(${table.acknowledgedBy}), '') is not null`,
    ),
  ],
);

export const followUps = pgTable("follow_ups", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookings.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  kind: text("kind").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcome: text("outcome"),
  nextFollowUpId: uuid("next_follow_up_id").references(
    (): AnyPgColumn => followUps.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check(
    "follow_ups_parent_required",
    sql`${table.bookingId} is not null or ${table.organizationId} is not null or ${table.contactId} is not null`,
  ),
  index("follow_ups_open_due_at_idx")
    .on(table.dueAt)
    .where(sql`${table.completedAt} is null`),
]);

export const activities = pgTable("activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  bookingId: uuid("booking_id").references(() => bookings.id),
  kind: activityKindEnum("kind").notNull(),
  body: text("body").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check(
    "activities_parent_required",
    sql`${table.organizationId} is not null or ${table.contactId} is not null or ${table.bookingId} is not null`,
  ),
  index("activities_organization_occurred_at_idx").on(
    table.organizationId,
    table.occurredAt.desc(),
  ),
  index("activities_contact_occurred_at_idx").on(
    table.contactId,
    table.occurredAt.desc(),
  ),
  index("activities_booking_occurred_at_idx").on(
    table.bookingId,
    table.occurredAt.desc(),
  ),
]);

export const activityRevisions = pgTable(
  "activity_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    activityId: uuid("activity_id").notNull().references(() => activities.id),
    priorBody: text("prior_body").notNull(),
    replacementBody: text("replacement_body").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("activity_revisions_activity_created_at_idx").on(
      table.activityId,
      table.createdAt.desc(),
    ),
  ],
);

export const callSessions = pgTable(
  "call_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestKey: uuid("request_key"),
    organizationId: uuid("organization_id").references(() => organizations.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    followUpId: uuid("follow_up_id").references(() => followUps.id),
    nextFollowUpId: uuid("next_follow_up_id").references(() => followUps.id),
    disposition: callDispositionEnum("disposition").notNull(),
    resultingBookingStatus: bookingStatusEnum("resulting_booking_status"),
    noteActivityId: uuid("note_activity_id").references(() => activities.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("call_sessions_request_key_unique")
      .on(table.requestKey)
      .where(sql`${table.requestKey} is not null`),
    check(
      "call_sessions_parent_required",
      sql`${table.organizationId} is not null or ${table.contactId} is not null or ${table.bookingId} is not null or ${table.followUpId} is not null`,
    ),
    check(
      "call_sessions_ended_at_not_before_started",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const auditEntries = pgTable("audit_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  reversesEntryId: uuid("reverses_entry_id")
    .unique()
    .references((): AnyPgColumn => auditEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const actImportRuns = pgTable("act_import_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceFileName: text("source_file_name").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
      sql`${table.status} in (${sqlTextValues(actMigrationRunStatusValues)})`,
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

export const actMigrationCheckpoints = pgTable(
  "act_migration_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actMigrationRuns.id, { onDelete: "cascade" }),
    streamType: text("stream_type").notNull(),
    partitionKey: text("partition_key").notNull(),
    parentSourceId: text("parent_source_id"),
    nextSkip: integer("next_skip").default(0).notNull(),
    pageSize: integer("page_size").notNull(),
    queryMode: text("query_mode").default("projected").notNull(),
    status: text("status").default("pending").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    retryable: boolean("retryable").default(true).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    recordsStaged: integer("records_staged").default(0).notNull(),
    errorCode: text("error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_migration_checkpoints_run_stream_partition_unique").on(
      table.runId,
      table.streamType,
      table.partitionKey,
    ),
    check(
      "act_migration_checkpoints_stream_type_valid",
      sql`${table.streamType} in (${sqlTextValues(actMigrationStreamTypeValues)})`,
    ),
    check(
      "act_migration_checkpoints_query_mode_valid",
      sql`${table.queryMode} in (${sqlTextValues(actQueryModeValues)})`,
    ),
    check(
      "act_migration_checkpoints_status_valid",
      sql`${table.status} in (${sqlTextValues(actMigrationCheckpointStatusValues)})`,
    ),
    check(
      "act_migration_checkpoints_partition_key_nonblank",
      sql`btrim(${table.partitionKey}) <> ''`,
    ),
    check(
      "act_migration_checkpoints_next_skip_nonnegative",
      sql`${table.nextSkip} >= 0`,
    ),
    check(
      "act_migration_checkpoints_page_size_positive",
      sql`${table.pageSize} > 0`,
    ),
    check(
      "act_migration_checkpoints_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "act_migration_checkpoints_records_staged_nonnegative",
      sql`${table.recordsStaged} >= 0`,
    ),
  ],
);

export const actMigrationRecords = pgTable(
  "act_migration_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actMigrationRuns.id, { onDelete: "cascade" }),
    streamType: text("stream_type").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceId: text("source_id"),
    targetSourceId: text("target_source_id"),
    rawSnapshot: jsonb("raw_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    normalizedSnapshot: jsonb("normalized_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    fingerprint: text("fingerprint").notNull(),
    proposedAction: text("proposed_action"),
    reviewState: text("review_state").default("not_required").notNull(),
    proposalKey: text("proposal_key"),
    matchedEntityType: text("matched_entity_type"),
    matchedEntityId: uuid("matched_entity_id"),
    appliedEntityId: uuid("applied_entity_id"),
    errorCode: text("error_code"),
    errorFields: jsonb("error_fields").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_migration_records_run_stream_source_unique").on(
      table.runId,
      table.streamType,
      table.sourceKey,
    ),
    check(
      "act_migration_records_stream_type_valid",
      sql`${table.streamType} in (${sqlTextValues(actMigrationStreamTypeValues)})`,
    ),
    check(
      "act_migration_records_source_key_nonblank",
      sql`btrim(${table.sourceKey}) <> ''`,
    ),
    check(
      "act_migration_records_proposed_action_valid",
      sql`${table.proposedAction} is null or ${table.proposedAction} in (${sqlTextValues(migrationPreviewStateValues)})`,
    ),
    check(
      "act_migration_records_review_state_valid",
      sql`${table.reviewState} in (${sqlTextValues(migrationReviewStateValues)})`,
    ),
    check(
      "act_migration_records_matched_entity_type_valid",
      sql`${table.matchedEntityType} is null or ${table.matchedEntityType} in (${sqlTextValues(migrationTargetEntityTypeValues)})`,
    ),
  ],
);

export const actMigrationProposals = pgTable(
  "act_migration_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actMigrationRuns.id, { onDelete: "cascade" }),
    proposalKey: text("proposal_key").notNull(),
    state: text("state").notNull(),
    reviewState: text("review_state").default("not_required").notNull(),
    targetEntityType: text("target_entity_type").notNull(),
    sourceRecordKeys: jsonb("source_record_keys").$type<string[]>().notNull(),
    candidateLocalIds: jsonb("candidate_local_ids").$type<string[]>().notNull(),
    proposedLocalId: uuid("proposed_local_id"),
    issueCode: text("issue_code"),
    proposedPrimarySourceId: text("proposed_primary_source_id"),
    duplicateGroupKey: text("duplicate_group_key"),
    duplicateSourceIds: jsonb("duplicate_source_ids")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    dependencyProposalKeys: jsonb("dependency_proposal_keys")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    matchReason: text("match_reason"),
    displaySnapshot: jsonb("display_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    decision: text("decision"),
    decisionReason: text("decision_reason"),
    chosenLocalEntityId: uuid("chosen_local_entity_id"),
    primarySourceId: text("primary_source_id"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_migration_proposals_run_key_unique").on(
      table.runId,
      table.proposalKey,
    ),
    check(
      "act_migration_proposals_state_valid",
      sql`${table.state} in (${sqlTextValues(migrationPreviewStateValues)})`,
    ),
    check(
      "act_migration_proposals_review_state_valid",
      sql`${table.reviewState} in (${sqlTextValues(migrationReviewStateValues)})`,
    ),
    check(
      "act_migration_proposals_target_entity_type_valid",
      sql`${table.targetEntityType} in (${sqlTextValues(migrationTargetEntityTypeValues)})`,
    ),
    check(
      "act_migration_proposals_decision_valid",
      sql`${table.decision} is null or ${table.decision} in (${sqlTextValues(migrationDecisionValues)})`,
    ),
    check(
      "act_migration_proposals_issue_code_nonblank",
      sql`${table.issueCode} is null or btrim(${table.issueCode}) <> ''`,
    ),
    check(
      "act_migration_proposals_proposed_primary_source_id_nonblank",
      sql`${table.proposedPrimarySourceId} is null or btrim(${table.proposedPrimarySourceId}) <> ''`,
    ),
    check(
      "act_migration_proposals_duplicate_source_ids_array",
      sql`jsonb_typeof(${table.duplicateSourceIds}) = 'array'`,
    ),
    check(
      "act_migration_proposals_dependency_proposal_keys_array",
      sql`jsonb_typeof(${table.dependencyProposalKeys}) = 'array'`,
    ),
  ],
);

export const callingLists = pgTable(
  "calling_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    filterVersion: integer("filter_version"),
    filterDefinition: jsonb("filter_definition").$type<Record<string, unknown>>(),
    sourceStatus: text("source_status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "calling_lists_name_nonblank",
      sql`nullif(trim(${table.name}), '') is not null`,
    ),
    check(
      "calling_lists_kind_valid",
      sql`${table.kind} in ('static', 'dynamic')`,
    ),
    check(
      "calling_lists_filter_definition_valid",
      sql`(${table.kind} = 'static' and ${table.filterVersion} is null and ${table.filterDefinition} is null) or (${table.kind} = 'dynamic' and ${table.filterVersion} = 1 and ${table.filterDefinition} is not null and jsonb_typeof(${table.filterDefinition}) = 'object')`,
    ),
    check(
      "calling_lists_source_status_valid",
      sql`${table.sourceStatus} in ('active', 'inactive')`,
    ),
    index("calling_lists_dynamic_kind_idx")
      .on(table.kind)
      .where(sql`${table.kind} = 'dynamic'`),
  ],
);

export const callingListMemberships = pgTable(
  "calling_list_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callingListId: uuid("calling_list_id")
      .notNull()
      .references(() => callingLists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    source: text("source").default("act_migration").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("calling_list_memberships_list_contact_unique").on(
      table.callingListId,
      table.contactId,
    ),
    check(
      "calling_list_memberships_source_valid",
      sql`${table.source} in ('act_migration', 'manual')`,
    ),
    index("calling_list_memberships_active_idx")
      .on(table.callingListId, table.contactId)
      .where(sql`${table.active}`),
  ],
);

export const actMigrationApplyBatches = pgTable(
  "act_migration_apply_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestKey: uuid("request_key").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actMigrationRuns.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").notNull(),
    status: text("status").default("pending").notNull(),
    manifestDigest: text("manifest_digest").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    lastErrorCode: text("last_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("act_migration_apply_batches_request_key_unique").on(
      table.requestKey,
    ),
    check(
      "act_migration_apply_batches_status_valid",
      sql`${table.status} in (${sqlTextValues(migrationApplyBatchStatusValues)})`,
    ),
    check(
      "act_migration_apply_batches_requested_by_nonblank",
      sql`btrim(${table.requestedBy}) <> ''`,
    ),
    check(
      "act_migration_apply_batches_manifest_digest_nonblank",
      sql`btrim(${table.manifestDigest}) <> ''`,
    ),
    index("act_migration_apply_batches_run_id_idx").on(table.runId),
  ],
);

export const actMigrationApplyOperations = pgTable(
  "act_migration_apply_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => actMigrationApplyBatches.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => actMigrationRuns.id, { onDelete: "cascade" }),
    proposalKey: text("proposal_key").notNull(),
    targetEntityType: text("target_entity_type").notNull(),
    dependencyProposalKeys: jsonb("dependency_proposal_keys")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    resolvedDependencies: jsonb("resolved_dependencies")
      .$type<{ proposalKey: string; targetEntityType: string; entityId: string }[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    status: text("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    appliedEntityId: uuid("applied_entity_id"),
    errorCode: text("error_code"),
    retryable: boolean("retryable").default(true).notNull(),
    wasCreated: boolean("was_created"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("act_migration_apply_operations_run_proposal_unique").on(
      table.runId,
      table.proposalKey,
    ),
    check(
      "act_migration_apply_operations_target_entity_type_valid",
      sql`${table.targetEntityType} in (${sqlTextValues(migrationTargetEntityTypeValues)})`,
    ),
    check(
      "act_migration_apply_operations_dependency_proposal_keys_array",
      sql`jsonb_typeof(${table.dependencyProposalKeys}) = 'array'`,
    ),
    check(
      "act_migration_apply_operations_resolved_dependencies_array",
      sql`jsonb_typeof(${table.resolvedDependencies}) = 'array'`,
    ),
    check(
      "act_migration_apply_operations_status_valid",
      sql`${table.status} in (${sqlTextValues(migrationApplyOperationStatusValues)})`,
    ),
    check(
      "act_migration_apply_operations_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "act_migration_apply_operations_lease_valid",
      sql`(${table.status} = 'leased') = (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
    index("act_migration_apply_operations_run_batch_idx").on(
      table.runId,
      table.batchId,
    ),
    index("act_migration_apply_operations_runnable_claim_idx")
      .on(table.batchId, table.status, table.leaseExpiresAt)
      .where(sql`${table.status} in ('pending', 'leased') and ${table.retryable}`),
  ],
);

export const actExternalLinks = pgTable(
  "act_external_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    sourceEntityType: text("source_entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    actRecordId: text("act_record_id").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    syncMode: text("sync_mode").default("pull_only").notNull(),
    importRunId: uuid("import_run_id").references(() => actImportRuns.id),
    migrationRunId: uuid("migration_run_id").references(
      () => actMigrationRuns.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
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
  ],
);

export const actContactSyncStates = pgTable(
  "act_contact_sync_states",
  {
    contactId: uuid("contact_id")
      .primaryKey()
      .references(() => contacts.id),
    baseSnapshot: jsonb("base_snapshot").$type<Record<string, string | null>>(),
    actEditedAt: timestamp("act_edited_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    localDirty: boolean("local_dirty").default(false).notNull(),
    state: text("state").default("unlinked").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "act_contact_sync_states_state_valid",
      sql`${table.state} in ('unlinked', 'synced', 'waiting', 'conflict')`,
    ),
  ],
);

export const actSyncRuns = pgTable(
  "act_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: text("status").default("previewing").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    activeQueueToken: uuid("active_queue_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "act_sync_runs_status_valid",
      sql`${table.status} in ('previewing', 'previewed', 'applying', 'partial', 'completed', 'failed')`,
    ),
  ],
);

export const actSyncOperations = pgTable(
  "act_sync_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actSyncRuns.id),
    rowKey: text("row_key").notNull(),
    localContactId: uuid("local_contact_id").references(() => contacts.id),
    actRecordId: text("act_record_id"),
    category: text("category").notNull(),
    decision: text("decision"),
    status: text("status").default("pending").notNull(),
    baseSnapshot: jsonb("base_snapshot").$type<Record<string, string | null>>(),
    localSnapshot: jsonb("local_snapshot").$type<Record<string, string | null>>(),
    actSnapshot: jsonb("act_snapshot").$type<Record<string, string | null>>(),
    error: text("error"),
    retryable: boolean("retryable").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_sync_operations_run_row_unique").on(
      table.runId,
      table.rowKey,
    ),
    check(
      "act_sync_operations_status_valid",
      sql`${table.status} in ('pending', 'approved', 'applying', 'completed', 'failed', 'skipped')`,
    ),
  ],
);