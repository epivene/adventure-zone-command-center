import {
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  bookingStatusValues,
  probabilityValues,
} from "@/features/bookings/booking-types";
import {
  requestApprovalStatusValues,
  specialRequestTreatmentValues,
  type RequestApprovalStatus,
  type SpecialRequestTreatment,
} from "@/features/packages/package-types";

export {
  requestApprovalStatusValues,
  specialRequestTreatmentValues,
} from "@/features/packages/package-types";

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
  lastResort: boolean("last_resort").default(false).notNull(),
  lastResortReason: text("last_resort_reason"),
  lastResortChangedAt: timestamp("last_resort_changed_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check(
    "organizations_last_resort_reason_required",
    sql`not ${table.lastResort} or nullif(trim(${table.lastResortReason}), '') is not null`,
  ),
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
      "travel_legs_sort_order_between_1_and_4",
      sql`${table.sortOrder} between 1 and 4`,
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
  check(
    "bookings_physical_attraction_total_nonnegative",
    sql`${table.physicalAttractionTotal} is null or ${table.physicalAttractionTotal} >= 0`,
  ),
]);

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

export const actExternalLinks = pgTable(
  "act_external_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    actRecordId: text("act_record_id").notNull(),
    importRunId: uuid("import_run_id").references(() => actImportRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_external_links_entity_external_id_unique").on(
      table.entityType,
      table.actRecordId,
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
