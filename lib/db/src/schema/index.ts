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
  primaryKey,
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
export const actReplacementStreamTypeValues = [
  "company",
  "contact",
  "opportunity",
  "group",
  "company_contact",
  "opportunity_company",
  "opportunity_contact",
  "group_contact",
  "activity",
  "note",
  "history",
  "activity_contact",
  "activity_company",
  "activity_opportunity",
  "note_contact",
  "note_company",
  "note_opportunity",
  "history_contact",
  "history_company",
  "history_opportunity",
] as const;
export const actReplacementRunPhaseValues = [
  "extracting",
  "extract_complete",
  "organizing",
  "ready_to_apply",
  "applying",
  "complete",
  "complete_with_issues",
  "failed",
  "superseded",
] as const;
export const actReplacementCheckpointKindValues = [
  "list",
  "plain_list_fallback",
  "detail",
  "relationship",
] as const;
export const actReplacementCheckpointRequirednessValues = [
  "required",
  "optional_capability",
] as const;
export const actReplacementCheckpointStateValues = [
  "pending",
  "leased",
  "retry_wait",
  "complete",
  "unsupported",
  "failed",
] as const;
export const actArchiveCompletenessValues = [
  "discovered",
  "complete",
  "partial",
  "failed",
] as const;
export const actSnapshotScopeValues = [
  "list_projected",
  "list_plain",
  "detail",
  "relationship",
] as const;
export const actRequestAuditStateValues = [
  "started",
  "succeeded",
  "failed",
] as const;
export const actSafeErrorCodeValues = [
  "not_configured",
  "authentication_failed",
  "permission_denied",
  "query_rejected",
  "not_found",
  "endpoint_unsupported",
  "rate_limited",
  "timeout",
  "unavailable",
  "invalid_response",
  "pagination_stalled",
] as const;
export type ActSafeErrorCode = (typeof actSafeErrorCodeValues)[number];
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
  "spoke_with_contact",
  "wrong_number",
  "do_not_call",
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
  /** Optional non-destructive parent organization for manual event/location membership. */
  parentOrganizationId: uuid("parent_organization_id").references(
    (): AnyPgColumn => organizations.id,
    { onDelete: "restrict" },
  ),
  /** Set when this profile has been retired via the consolidation workflow. */
  consolidatedIntoId: uuid("consolidated_into_id").references(
    (): AnyPgColumn => organizations.id,
    { onDelete: "restrict" },
  ),
  /** Timestamp when the consolidation was applied. */
  consolidatedAt: timestamp("consolidated_at", { withTimezone: true }),
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
  index("organizations_parent_organization_id_idx").on(table.parentOrganizationId),
]);

export const organizationFamilyReviews = pgTable(
  "organization_family_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupKey: text("group_key").notNull(),
    candidateIds: jsonb("candidate_ids").$type<string[]>().notNull(),
    status: text("status").$type<"proposed" | "not_related">().notNull(),
    evidence: jsonb("evidence").$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("organization_family_reviews_group_key_unique").on(table.groupKey),
    check(
      "organization_family_reviews_status_valid",
      sql`${table.status} in ('proposed', 'not_related')`,
    ),
    check(
      "organization_family_reviews_candidates_array",
      sql`jsonb_typeof(${table.candidateIds}) = 'array'`,
    ),
  ],
);

export const organizationLocations = pgTable(
  "organization_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    venueName: text("venue_name"),
    address1: text("address_1"),
    address2: text("address_2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    website: text("website"),
    phone: text("phone"),
    normalizedPhone: text("normalized_phone"),
    email: text("email"),
    localStatus: text("local_status"),
    travelLegId: uuid("travel_leg_id").references(
      (): AnyPgColumn => travelLegs.id,
      { onDelete: "set null" },
    ),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    actRecordId: text("act_record_id").unique(),
    actSourceLabel: text("act_source_label"),
    /**
     * Set when this location was created via the consolidation workflow.
     * Identifies the retired source organization that contributed this location,
     * enabling accurate redirect lookups.
     */
    consolidationSourceOrgId: uuid("consolidation_source_org_id").references(
      (): AnyPgColumn => organizations.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("organization_locations_organization_id_idx").on(table.organizationId),
    index("organization_locations_normalized_phone_idx").on(table.normalizedPhone),
    index("organization_locations_travel_leg_id_idx").on(table.travelLegId),
    uniqueIndex("organization_locations_consolidation_source_org_unique")
      .on(table.organizationId, table.consolidationSourceOrgId)
      .where(sql`${table.consolidationSourceOrgId} is not null`),
  ],
);

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
  organizationLocationId: uuid("organization_location_id").references(
    () => organizationLocations.id,
    { onDelete: "set null" },
  ),
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


export const contactPhoneTypeValues = ["mobile", "office", "alternate", "unknown"] as const;
export const contactPhoneTypeEnum = pgEnum("contact_phone_type", contactPhoneTypeValues);

export const contactPhones = pgTable("contact_phones", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  normalizedNumber: text("normalized_number"),
  type: contactPhoneTypeEnum("type").default("unknown").notNull(),
  extension: text("extension"),
  label: text("label"),
  primary: boolean("primary").default(false).notNull(),
  source: text("source").default("local").notNull(),
  doNotCallAt: timestamp("do_not_call_at", { withTimezone: true }),
  doNotCallReason: text("do_not_call_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("contact_phones_one_primary_per_contact").on(table.contactId).where(sql`${table.primary}`),
  uniqueIndex("contact_phones_contact_normalized_number_unique").on(table.contactId, table.normalizedNumber).where(sql`${table.normalizedNumber} is not null`),
  index("contact_phones_normalized_number_idx").on(table.normalizedNumber),
  check("contact_phones_number_nonblank", sql`btrim(${table.number}) <> ''`),
]);

export const travelLegs = pgTable(
  "travel_legs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    // NOTE: The generated unique constraint (travel_legs_sort_order_unique) was
    // manually altered to DEFERRABLE INITIALLY IMMEDIATE via ALTER TABLE so that
    // drag-reorder can defer the check to commit time. If drizzle-kit push ever
    // recreates this constraint, re-run:
    //   ALTER TABLE travel_legs DROP CONSTRAINT travel_legs_sort_order_unique;
    //   ALTER TABLE travel_legs ADD CONSTRAINT travel_legs_sort_order_unique UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE;
    sortOrder: integer("sort_order").notNull().unique(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    baseAddress: text("base_address"),
    defaultVehicleName: text("default_vehicle_name"),
    defaultMpg: doublePrecision("default_mpg"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "travel_legs_default_mpg_positive",
      sql`${table.defaultMpg} is null or ${table.defaultMpg} > 0`,
    ),
  ],
);

export const legManagerAccess = pgTable("leg_manager_access", {
  legId: uuid("leg_id")
    .primaryKey()
    .references(() => travelLegs.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  sessionVersion: integer("session_version").default(1).notNull(),
  managerName: text("manager_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("leg_manager_access_session_version_positive", sql`${table.sessionVersion} >= 1`),
]);

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
  organizationLocationId: uuid("organization_location_id").references(
    () => organizationLocations.id,
    { onDelete: "set null" },
  ),
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
    normalCapacity: integer("normal_capacity").notNull(),
    temporaryUnavailableQuantity: integer("temporary_unavailable_quantity").notNull(),
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
    check(
      "package_templates_normal_capacity_nonnegative",
      sql`${table.normalCapacity} >= 0`,
    ),
    check(
      "package_templates_temporary_unavailable_quantity_nonnegative",
      sql`${table.temporaryUnavailableQuantity} >= 0`,
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
  organizationLocationId: uuid("organization_location_id").references(
    () => organizationLocations.id,
    { onDelete: "set null" },
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
  subject: text("subject"),
  status: text("status"),
  body: text("body").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  timelineSortAt: timestamp("timeline_sort_at", { withTimezone: true }).notNull(),
  dateIsImportFallback: boolean("date_is_import_fallback").default(false).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  /** Act! source record key (e.g. "act_note:{id}") -- set only on imported items; used for idempotent re-import. */
  actRecordId: text("act_record_id"),
  sourceRecordId: uuid("source_record_id").references(() => actSourceRecords.id, { onDelete: "restrict" }),
  sourceVersionId: uuid("source_version_id").references(() => actSourceRecordVersions.id, { onDelete: "restrict" }),
  sourceType: text("source_type"),
  organizationLocationId: uuid("organization_location_id").references(
    () => organizationLocations.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  check(
    "activities_parent_required",
    sql`${table.organizationId} is not null or ${table.contactId} is not null or ${table.bookingId} is not null or ${table.sourceRecordId} is not null`,
  ),
  check("activities_occurred_at_required_for_local", sql`${table.occurredAt} is not null or ${table.sourceRecordId} is not null`),
  check("activities_source_type_valid", sql`${table.sourceType} is null or ${table.sourceType} in ('note', 'history', 'activity')`),
  uniqueIndex("activities_act_record_id_unique")
    .on(table.actRecordId)
    .where(sql`${table.actRecordId} is not null`),
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
  // Partial composite index for the calendar query   covers both
  // kind = 'calendar' and kind = 'act_history' predicates so PostgreSQL
  // jumps straight to the date window instead of scanning every row.
  index("activities_kind_timeline_sort_at_idx")
    .on(table.kind, table.timelineSortAt)
    .where(sql`${table.kind} in ('calendar', 'act_history')`),
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
    phoneId: uuid("phone_id").references(() => contactPhones.id, { onDelete: "set null" }),
    direction: text("direction").default("outgoing").notNull(),
    method: text("method").default("standard_call").notNull(),
    phoneNumberSnapshot: text("phone_number_snapshot"),
    phoneExtensionSnapshot: text("phone_extension_snapshot"),
    scriptKind: text("script_kind"),
    bookingId: uuid("booking_id").references(() => bookings.id),
    followUpId: uuid("follow_up_id").references(() => followUps.id),
    nextFollowUpId: uuid("next_follow_up_id").references(() => followUps.id),
    disposition: callDispositionEnum("disposition").notNull(),
    resultingBookingStatus: bookingStatusEnum("resulting_booking_status"),
    noteActivityId: uuid("note_activity_id").references(() => activities.id),
    organizationLocationId: uuid("organization_location_id").references(
      () => organizationLocations.id,
      { onDelete: "set null" },
    ),
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
      "call_sessions_direction_valid",
      sql`${table.direction} in ('incoming', 'outgoing')`,
    ),
    check(
      "call_sessions_method_valid",
      sql`${table.method} in ('standard_call', 'office_call', 'individual_voicemail', 'mobile_log', 'browser_voip')`,
    ),
    check(
      "call_sessions_script_kind_valid",
      sql`${table.scriptKind} is null or ${table.scriptKind} in ('first_outreach', 'follow_up', 'contract_follow_up', 'incoming_inquiry')`,
    ),
    check(
      "call_sessions_ended_at_not_before_started",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const computerCallSessions = pgTable(
  "computer_call_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    phoneId: uuid("phone_id").notNull().references(() => contactPhones.id),
    provider: text("provider").$type<"twilio">().notNull(),
    providerCallSid: text("provider_call_sid").unique(),
    direction: text("direction").$type<"outbound">().default("outbound").notNull(),
    method: text("method").$type<"browser_voip">().default("browser_voip").notNull(),
    status: text("status").$type<
      | "created"
      | "queued"
      | "ringing"
      | "in-progress"
      | "completed"
      | "busy"
      | "no-answer"
      | "canceled"
      | "failed"
      | "unknown"
    >().notNull(),
    callerIdSnapshot: text("caller_id_snapshot").notNull(),
    destinationNumberSnapshot: text("destination_number_snapshot").notNull(),
    intentExpiresAt: timestamp("intent_expires_at", { withTimezone: true }).notNull(),
    intentConsumedAt: timestamp("intent_consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    durationSeconds: integer("duration_seconds"),
    errorCode: text("error_code"),
    errorSummary: text("error_summary"),
  },
  (table) => [
    check("computer_call_sessions_provider_valid", sql`${table.provider} = 'twilio'`),
    check("computer_call_sessions_direction_valid", sql`${table.direction} = 'outbound'`),
    check("computer_call_sessions_method_valid", sql`${table.method} = 'browser_voip'`),
    check(
      "computer_call_sessions_status_valid",
      sql`${table.status} in ('created', 'queued', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'canceled', 'failed', 'unknown')`,
    ),
    check(
      "computer_call_sessions_duration_seconds_nonnegative",
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`,
    ),
    index("computer_call_sessions_owner_created_at_idx").on(
      table.ownerId,
      table.createdAt.desc(),
    ),
    index("computer_call_sessions_phone_id_idx").on(table.phoneId),
    index("computer_call_sessions_provider_call_sid_idx").on(table.providerCallSid),
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
    requestKey: text("request_key").notNull(),
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

export const actReplacementRuns = pgTable(
  "act_replacement_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestKey: text("request_key").notNull(),
    sourceDatabaseKey: text("source_database_key").notNull(),
    requestedBy: text("requested_by").notNull(),
    pageSize: integer("page_size").notNull(),
    previewOnly: boolean("preview_only").default(true).notNull(),
    phase: text("phase").default("extracting").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    manifestDigestVersion: text("manifest_digest_version"),
    manifestGeneration: uuid("manifest_generation"),
    lastErrorCode: text("last_error_code"),
    organizerToken: uuid("organizer_token"),
    organizerLeaseExpiresAt: timestamp("organizer_lease_expires_at", {
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    extractCompletedAt: timestamp("extract_completed_at", {
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_replacement_runs_database_request_unique").on(
      table.sourceDatabaseKey,
      table.requestKey,
    ),
    uniqueIndex("act_replacement_runs_id_database_unique").on(
      table.id,
      table.sourceDatabaseKey,
    ),
    uniqueIndex("act_replacement_runs_one_active_per_database")
      .on(table.sourceDatabaseKey)
      .where(
        sql`${table.phase} in ('extracting', 'extract_complete', 'organizing', 'ready_to_apply', 'applying')`,
      ),
    check(
      "act_replacement_runs_request_key_nonblank",
      sql`btrim(${table.requestKey}) <> ''`,
    ),
    check(
      "act_replacement_runs_source_database_key_nonblank",
      sql`btrim(${table.sourceDatabaseKey}) <> ''`,
    ),
    check(
      "act_replacement_runs_requested_by_nonblank",
      sql`btrim(${table.requestedBy}) <> ''`,
    ),
    check(
      "act_replacement_runs_page_size_valid",
      sql`${table.pageSize} in (25, 50, 100, 200)`,
    ),
    check("act_replacement_runs_manifest_digest_version_valid", sql`${table.manifestDigestVersion} is null or ${table.manifestDigestVersion} = 'canonical-json-v1'`),
    check("act_replacement_runs_organizer_lease_consistency", sql`(${table.organizerToken} is null) = (${table.organizerLeaseExpiresAt} is null)`),
    check(
      "act_replacement_runs_phase_valid",
      sql`${table.phase} in (${sqlTextValues(actReplacementRunPhaseValues)})`,
    ),
  ],
);

function actSourceRecordVersionIdColumn(): AnyPgColumn {
  return actSourceRecordVersions.id;
}

function actSourceRecordVersionSourceIdColumn(): AnyPgColumn {
  return actSourceRecordVersions.sourceRecordId;
}

function actSourceRecordVersionFingerprintColumn(): AnyPgColumn {
  return actSourceRecordVersions.fingerprint;
}

export const actSourceRecords = pgTable(
  "act_source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDatabaseKey: text("source_database_key").notNull(),
    streamType: text("stream_type").notNull(),
    sourceKey: text("source_key").notNull(),
    actRecordId: text("act_record_id"),
    firstSeenRunId: uuid("first_seen_run_id")
      .notNull()
      .references(() => actReplacementRuns.id),
    lastSeenRunId: uuid("last_seen_run_id")
      .notNull()
      .references(() => actReplacementRuns.id),
    latestVersionId: uuid("latest_version_id").references(
      (): AnyPgColumn => actSourceRecordVersions.id,
    ),
    latestFingerprint: text("latest_fingerprint"),
    relationshipEvidence: jsonb("relationship_evidence")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    archiveCompleteness: text("archive_completeness")
      .default("discovered")
      .notNull(),
    normalizationStatus: text("normalization_status")
      .default("pending")
      .notNull(),
    linkingStatus: text("linking_status").default("pending").notNull(),
    errorCode: text("error_code"),
    unsupportedReason: text("unsupported_reason"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
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
    uniqueIndex("act_source_records_database_stream_source_key_unique").on(
      table.sourceDatabaseKey,
      table.streamType,
      table.sourceKey,
    ),
    uniqueIndex("act_source_records_database_stream_act_id_unique")
      .on(table.sourceDatabaseKey, table.streamType, table.actRecordId)
      .where(sql`${table.actRecordId} is not null`),
    uniqueIndex("act_source_records_id_database_unique").on(
      table.id,
      table.sourceDatabaseKey,
    ),
    uniqueIndex("act_source_records_id_database_stream_unique").on(
      table.id,
      table.sourceDatabaseKey,
      table.streamType,
    ),
    foreignKey({
      columns: [table.firstSeenRunId, table.sourceDatabaseKey],
      foreignColumns: [actReplacementRuns.id, actReplacementRuns.sourceDatabaseKey],
      name: "act_source_records_first_seen_run_database_fk",
    }),
    foreignKey({
      columns: [table.lastSeenRunId, table.sourceDatabaseKey],
      foreignColumns: [actReplacementRuns.id, actReplacementRuns.sourceDatabaseKey],
      name: "act_source_records_last_seen_run_database_fk",
    }),
    foreignKey({
      columns: [table.latestVersionId, table.id, table.latestFingerprint],
      foreignColumns: [
        actSourceRecordVersionIdColumn(),
        actSourceRecordVersionSourceIdColumn(),
        actSourceRecordVersionFingerprintColumn(),
      ],
      name: "act_source_records_latest_version_owner_fk",
    }),
    check(
      "act_source_records_source_database_key_nonblank",
      sql`btrim(${table.sourceDatabaseKey}) <> ''`,
    ),
    check(
      "act_source_records_stream_type_valid",
      sql`${table.streamType} in (${sqlTextValues(actReplacementStreamTypeValues)})`,
    ),
    check(
      "act_source_records_source_key_nonblank",
      sql`btrim(${table.sourceKey}) <> ''`,
    ),
    check(
      "act_source_records_act_record_id_nonblank",
      sql`${table.actRecordId} is null or btrim(${table.actRecordId}) <> ''`,
    ),
    check(
      "act_source_records_latest_fingerprint_nonblank",
      sql`${table.latestFingerprint} is null or btrim(${table.latestFingerprint}) <> ''`,
    ),
    check(
      "act_source_records_latest_version_pair_valid",
      sql`(${table.latestVersionId} is null) = (${table.latestFingerprint} is null)`,
    ),
    check(
      "act_source_records_relationship_evidence_object",
      sql`jsonb_typeof(${table.relationshipEvidence}) = 'object'`,
    ),
    check(
      "act_source_records_archive_completeness_valid",
      sql`${table.archiveCompleteness} in (${sqlTextValues(actArchiveCompletenessValues)})`,
    ),
  ],
);

export const actSourceRecordVersions = pgTable(
  "act_source_record_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => actSourceRecords.id),
    sourceDatabaseKey: text("source_database_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    rawSnapshot: jsonb("raw_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    snapshotScope: text("snapshot_scope").notNull(),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceEditedAt: timestamp("source_edited_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    observedRunId: uuid("observed_run_id")
      .notNull()
      .references(() => actReplacementRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_source_record_versions_record_fingerprint_unique").on(
      table.sourceRecordId,
      table.fingerprint,
    ),
    uniqueIndex("act_source_record_versions_id_source_unique").on(
      table.id,
      table.sourceRecordId,
    ),
    uniqueIndex("act_source_record_versions_id_source_fingerprint_unique").on(
      table.id,
      table.sourceRecordId,
      table.fingerprint,
    ),
    foreignKey({
      columns: [table.sourceRecordId, table.sourceDatabaseKey],
      foreignColumns: [actSourceRecords.id, actSourceRecords.sourceDatabaseKey],
      name: "act_source_record_versions_source_database_fk",
    }),
    foreignKey({
      columns: [table.observedRunId, table.sourceDatabaseKey],
      foreignColumns: [actReplacementRuns.id, actReplacementRuns.sourceDatabaseKey],
      name: "act_source_record_versions_observed_run_database_fk",
    }),
    index("act_source_record_versions_observed_run_idx").on(
      table.observedRunId,
    ),
    check(
      "act_source_record_versions_fingerprint_nonblank",
      sql`btrim(${table.fingerprint}) <> ''`,
    ),
    check(
      "act_source_record_versions_raw_snapshot_object",
      sql`jsonb_typeof(${table.rawSnapshot}) = 'object'`,
    ),
    check(
      "act_source_record_versions_snapshot_scope_valid",
      sql`${table.snapshotScope} in (${sqlTextValues(actSnapshotScopeValues)})`,
    ),
  ],
);

export const actArchiveProfileImportJobs = pgTable(
  "act_archive_profile_import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actReplacementRuns.id, { onDelete: "cascade" }),
    sourceDatabaseKey: text("source_database_key").notNull(),
    requestKey: text("request_key").notNull(),
    requestedBy: text("requested_by").notNull(),
    phase: text("phase").default("companies").notNull(),
    cursorSourceRecordId: uuid("cursor_source_record_id"),
    eligibleCount: integer("eligible_count").default(0).notNull(),
    processedCount: integer("processed_count").default(0).notNull(),
    createdCount: integer("created_count").default(0).notNull(),
    linkedCount: integer("linked_count").default(0).notNull(),
    updatedCount: integer("updated_count").default(0).notNull(),
    alreadyImportedCount: integer("already_imported_count").default(0).notNull(),
    preservedCount: integer("preserved_count").default(0).notNull(),
    retryableFailureCount: integer("retryable_failure_count").default(0).notNull(),
    membershipSnapshotVersion: integer("membership_snapshot_version"),
    failureAttemptCount: integer("failure_attempt_count").default(0).notNull(),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("act_archive_profile_import_jobs_run_unique").on(table.runId),
    unique("act_archive_profile_import_jobs_run_request_key_unique").on(
      table.runId,
      table.requestKey,
    ),
    unique("act_archive_profile_import_jobs_id_database_unique").on(
      table.id,
      table.sourceDatabaseKey,
    ),
    foreignKey({
      columns: [table.runId, table.sourceDatabaseKey],
      foreignColumns: [actReplacementRuns.id, actReplacementRuns.sourceDatabaseKey],
      name: "act_archive_profile_import_jobs_run_database_fk",
    }),
    index("act_archive_profile_import_jobs_claim_idx")
      .on(table.phase, table.leaseExpiresAt, table.updatedAt)
      .where(sql`${table.phase} in ('companies','contacts')`),
    check(
      "act_archive_profile_import_jobs_phase_valid",
      sql`${table.phase} in ('companies','contacts','complete','failed')`,
    ),
    check(
      "act_archive_profile_import_jobs_lease_expiry_consistency",
      sql`(${table.leaseToken} is null) = (${table.leaseExpiresAt} is null)`,
    ),
    check(
      "act_archive_profile_import_jobs_lease_owner_consistency",
      sql`(${table.leaseToken} is null) = (${table.leaseOwner} is null)`,
    ),
    check(
      "act_archive_profile_import_jobs_request_actor_nonblank",
      sql`btrim(${table.requestKey}) <> '' and btrim(${table.requestedBy}) <> ''`,
    ),
    check(
      "act_archive_profile_import_jobs_progress_counts_nonnegative",
      sql`${table.eligibleCount} >= 0 and ${table.processedCount} >= 0`,
    ),
    check(
      "act_archive_profile_import_jobs_outcome_counts_nonnegative",
      sql`${table.createdCount} >= 0 and ${table.linkedCount} >= 0 and ${table.updatedCount} >= 0`,
    ),
    check(
      "act_archive_profile_import_jobs_remaining_counts_nonnegative",
      sql`${table.alreadyImportedCount} >= 0 and ${table.preservedCount} >= 0 and ${table.retryableFailureCount} >= 0`,
    ),
    check(
      "act_archive_profile_import_jobs_failure_attempt_nonnegative",
      sql`${table.failureAttemptCount} >= 0`,
    ),
  ],
);

export const actArchiveProfileImportSources = pgTable(
  "act_archive_profile_import_sources",
  {
    jobId: uuid("job_id").notNull(),
    sourceDatabaseKey: text("source_database_key").notNull(),
    sourceRecordId: uuid("source_record_id").notNull(),
    sourceVersionId: uuid("source_version_id").notNull(),
    phase: text("phase").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.jobId, table.sourceRecordId],
      name: "act_archive_profile_import_sources_pkey",
    }),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [actArchiveProfileImportJobs.id],
      name: "act_archive_profile_import_sources_job_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceRecordId],
      foreignColumns: [actSourceRecords.id],
      name: "act_archive_profile_import_sources_source_record_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceVersionId],
      foreignColumns: [actSourceRecordVersions.id],
      name: "act_archive_profile_import_sources_source_version_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.jobId, table.sourceDatabaseKey],
      foreignColumns: [actArchiveProfileImportJobs.id, actArchiveProfileImportJobs.sourceDatabaseKey],
      name: "act_archive_profile_import_sources_job_database_fk",
    }),
    foreignKey({
      columns: [table.sourceRecordId, table.sourceDatabaseKey],
      foreignColumns: [actSourceRecords.id, actSourceRecords.sourceDatabaseKey],
      name: "act_archive_profile_import_sources_source_database_fk",
    }),
    foreignKey({
      columns: [table.sourceVersionId, table.sourceRecordId],
      foreignColumns: [actSourceRecordVersions.id, actSourceRecordVersions.sourceRecordId],
      name: "act_archive_profile_import_sources_version_owner_fk",
    }),
    index("act_archive_profile_import_sources_job_phase_source_idx").on(
      table.jobId,
      table.phase,
      table.sourceRecordId,
    ),
    check(
      "act_archive_profile_import_sources_phase_valid",
      sql`${table.phase} in ('companies','contacts')`,
    ),
  ],
);

export const actArchiveProfileImportResults = pgTable(
  "act_archive_profile_import_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => actArchiveProfileImportJobs.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => actSourceRecords.id, { onDelete: "restrict" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => actSourceRecordVersions.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    targetEntityType: text("target_entity_type"),
    targetEntityId: uuid("target_entity_id"),
    reasonCode: text("reason_code"),
    resolutionPolicyVersion: text("resolution_policy_version").notNull(),
    aiProvider: text("ai_provider"),
    aiConfidence: text("ai_confidence"),
    evidenceLabels: jsonb("evidence_labels")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("act_archive_profile_import_results_job_source_unique").on(
      table.jobId,
      table.sourceRecordId,
    ),
    check(
      "act_archive_profile_import_results_status_valid",
      sql`${table.status} in ('created','linked','updated','already_imported','preserved','retryable_failed')`,
    ),
    check(
      "act_archive_profile_import_results_target_type_valid",
      sql`${table.targetEntityType} is null or ${table.targetEntityType} in ('organization','contact')`,
    ),
    check(
      "act_archive_profile_import_results_target_pair_valid",
      sql`(${table.targetEntityType} is null) = (${table.targetEntityId} is null)`,
    ),
    check(
      "act_archive_profile_import_results_ai_confidence_valid",
      sql`${table.aiConfidence} is null or ${table.aiConfidence} in ('high','medium','low')`,
    ),
    check(
      "act_archive_profile_import_results_evidence_labels_array",
      sql`jsonb_typeof(${table.evidenceLabels}) = 'array'`,
    ),
  ],
);

export const actArchiveRecoveryRuns = pgTable(
  "act_archive_recovery_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDatabaseKey: text("source_database_key").notNull(),
    requestedBy: text("requested_by").notNull(),
    requestKey: text("request_key").notNull(),
    state: text("state").default("running").notNull(),
    candidateCount: integer("candidate_count").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("act_archive_recovery_runs_database_request_unique").on(table.sourceDatabaseKey, table.requestKey),
    check("act_archive_recovery_runs_state_valid", sql`${table.state} in ('running','complete','failed')`),
    check("act_archive_recovery_runs_database_nonblank", sql`btrim(${table.sourceDatabaseKey}) <> ''`),
    check("act_archive_recovery_runs_actor_nonblank", sql`btrim(${table.requestedBy}) <> '' and btrim(${table.requestKey}) <> ''`),
    check("act_archive_recovery_runs_candidate_count_nonnegative", sql`${table.candidateCount} >= 0`),
  ],
);

export const actArchiveRecoveryItems = pgTable(
  "act_archive_recovery_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull().references(() => actArchiveRecoveryRuns.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id),
    streamType: text("stream_type").notNull(),
    priority: integer("priority").notNull(),
    state: text("state").default("pending").notNull(),
    targetSummary: jsonb("target_summary").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastErrorCode: text("last_error_code"),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("act_archive_recovery_items_run_source_unique").on(table.runId, table.sourceRecordId),
    foreignKey({
      columns: [table.sourceVersionId, table.sourceRecordId],
      foreignColumns: [actSourceRecordVersions.id, actSourceRecordVersions.sourceRecordId],
      name: "act_archive_recovery_items_version_owner_fk",
    }),
    index("act_archive_recovery_items_claim_idx").on(table.state, table.retryAfter, table.priority, table.sourceRecordId),
    check("act_archive_recovery_items_state_valid", sql`${table.state} in ('pending','leased','already_present','recovered','needs_review','dropped_unusable','retryable_failed')`),
    check("act_archive_recovery_items_target_summary_object", sql`jsonb_typeof(${table.targetSummary}) = 'object'`),
    check("act_archive_recovery_items_attempt_count_nonnegative", sql`${table.attemptCount} >= 0`),
    check("act_archive_recovery_items_lease_consistency", sql`(${table.leaseToken} is null and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null) or (${table.leaseToken} is not null and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`),
  ],
);

export const actArchiveRecoveryDecisions = pgTable(
  "act_archive_recovery_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull().references(() => actArchiveRecoveryRuns.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id),
    sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id),
    decision: text("decision").notNull(),
    targetEntityType: text("target_entity_type"),
    targetEntityId: uuid("target_entity_id"),
    decidedBy: text("decided_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceVersionId, table.sourceRecordId],
      foreignColumns: [actSourceRecordVersions.id, actSourceRecordVersions.sourceRecordId],
      name: "act_archive_recovery_decisions_version_owner_fk",
    }),
    index("act_archive_recovery_decisions_source_idx").on(table.runId, table.sourceRecordId, table.createdAt),
    check("act_archive_recovery_decisions_decision_valid", sql`${table.decision} in ('assign_parent','drop_unusable','retry')`),
    check("act_archive_recovery_decisions_target_type_valid", sql`${table.targetEntityType} is null or ${table.targetEntityType} in ('organization','contact','booking','calling_list','activity')`),
    check("act_archive_recovery_decisions_target_pair_valid", sql`(${table.targetEntityType} is null) = (${table.targetEntityId} is null)`),
    check("act_archive_recovery_decisions_actor_nonblank", sql`btrim(${table.decidedBy}) <> ''`),
  ],
);


export const actReplacementCheckpoints = pgTable(
  "act_replacement_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actReplacementRuns.id),
    sourceDatabaseKey: text("source_database_key").notNull(),
    streamType: text("stream_type").notNull(),
    checkpointKind: text("checkpoint_kind").notNull(),
    partitionKey: text("partition_key").notNull(),
    requiredness: text("requiredness").notNull(),
    parentSourceRecordId: uuid("parent_source_record_id").references(
      () => actSourceRecords.id,
    ),
    parentActRecordId: text("parent_act_record_id"),
    sourceRecordId: uuid("source_record_id").references(
      () => actSourceRecords.id,
    ),
    nextSkip: integer("next_skip").default(0).notNull(),
    pageSize: integer("page_size").notNull(),
    queryMode: text("query_mode").default("projected").notNull(),
    deriveDetails: boolean("derive_details").default(true).notNull(),
    state: text("state").default("pending").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    retryable: boolean("retryable").default(true).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    responseRows: integer("response_rows").default(0).notNull(),
    observedIdentities: integer("observed_identities").default(0).notNull(),
    archivedIdentities: integer("archived_identities").default(0).notNull(),
    completeIdentities: integer("complete_identities").default(0).notNull(),
    partialIdentities: integer("partial_identities").default(0).notNull(),
    failedIdentities: integer("failed_identities").default(0).notNull(),
    snapshotVersionsInserted: integer("snapshot_versions_inserted")
      .default(0)
      .notNull(),
    errorCode: text("error_code"),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_replacement_checkpoints_run_stream_partition_unique").on(
      table.runId,
      table.streamType,
      table.partitionKey,
    ),
    uniqueIndex("act_replacement_checkpoints_context_unique").on(
      table.id,
      table.runId,
      table.sourceDatabaseKey,
      table.streamType,
    ),
    uniqueIndex("act_replacement_checkpoints_request_context_unique").on(
      table.id,
      table.runId,
      table.streamType,
    ),
    foreignKey({
      columns: [table.runId, table.sourceDatabaseKey],
      foreignColumns: [actReplacementRuns.id, actReplacementRuns.sourceDatabaseKey],
      name: "act_replacement_checkpoints_run_database_fk",
    }),
    foreignKey({
      columns: [table.parentSourceRecordId, table.sourceDatabaseKey],
      foreignColumns: [actSourceRecords.id, actSourceRecords.sourceDatabaseKey],
      name: "act_replacement_checkpoints_parent_source_database_fk",
    }),
    foreignKey({
      columns: [table.sourceRecordId, table.sourceDatabaseKey, table.streamType],
      foreignColumns: [
        actSourceRecords.id,
        actSourceRecords.sourceDatabaseKey,
        actSourceRecords.streamType,
      ],
      name: "act_replacement_checkpoints_source_database_stream_fk",
    }),
    index("act_replacement_checkpoints_claim_idx").on(
      table.state,
      table.retryAfter,
      table.leaseExpiresAt,
    ),
    check(
      "act_replacement_checkpoints_stream_type_valid",
      sql`${table.streamType} in (${sqlTextValues(actReplacementStreamTypeValues)})`,
    ),
    check(
      "act_replacement_checkpoints_kind_valid",
      sql`${table.checkpointKind} in (${sqlTextValues(actReplacementCheckpointKindValues)})`,
    ),
    check(
      "act_replacement_checkpoints_requiredness_valid",
      sql`${table.requiredness} in (${sqlTextValues(actReplacementCheckpointRequirednessValues)})`,
    ),
    check(
      "act_replacement_checkpoints_partition_key_nonblank",
      sql`btrim(${table.partitionKey}) <> ''`,
    ),
    check(
      "act_replacement_checkpoints_query_mode_valid",
      sql`${table.queryMode} in (${sqlTextValues(actQueryModeValues)})`,
    ),
    check(
      "act_replacement_checkpoints_state_valid",
      sql`${table.state} in (${sqlTextValues(actReplacementCheckpointStateValues)})`,
    ),
    check(
      "act_replacement_checkpoints_next_skip_nonnegative",
      sql`${table.nextSkip} >= 0`,
    ),
    check(
      "act_replacement_checkpoints_page_size_positive",
      sql`${table.pageSize} > 0`,
    ),
    check(
      "act_replacement_checkpoints_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "act_replacement_checkpoints_counters_nonnegative",
      sql`${table.responseRows} >= 0 and ${table.observedIdentities} >= 0 and ${table.archivedIdentities} >= 0 and ${table.completeIdentities} >= 0 and ${table.partialIdentities} >= 0 and ${table.failedIdentities} >= 0 and ${table.snapshotVersionsInserted} >= 0`,
    ),
  ],
);

export const actReplacementPageReceipts = pgTable(
  "act_replacement_page_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actReplacementRuns.id),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => actReplacementCheckpoints.id),
    streamType: text("stream_type").notNull(),
    pageSkip: integer("page_skip").notNull(),
    nextSkip: integer("next_skip"),
    queryMode: text("query_mode").notNull(),
    pageFingerprint: text("page_fingerprint").notNull(),
    responseRows: integer("response_rows").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_replacement_page_receipts_checkpoint_cursor_unique").on(
      table.checkpointId,
      table.pageSkip,
    ),
    foreignKey({
      columns: [table.checkpointId, table.runId, table.streamType],
      foreignColumns: [
        actReplacementCheckpoints.id,
        actReplacementCheckpoints.runId,
        actReplacementCheckpoints.streamType,
      ],
      name: "act_replacement_page_receipts_checkpoint_context_fk",
    }),
    check(
      "act_replacement_page_receipts_page_skip_nonnegative",
      sql`${table.pageSkip} >= 0`,
    ),
    check(
      "act_replacement_page_receipts_next_skip_nonnegative",
      sql`${table.nextSkip} is null or ${table.nextSkip} >= 0`,
    ),
    check(
      "act_replacement_page_receipts_query_mode_valid",
      sql`${table.queryMode} in (${sqlTextValues(actQueryModeValues)})`,
    ),
    check(
      "act_replacement_page_receipts_fingerprint_nonblank",
      sql`btrim(${table.pageFingerprint}) <> ''`,
    ),
    check(
      "act_replacement_page_receipts_response_rows_nonnegative",
      sql`${table.responseRows} >= 0`,
    ),
  ],
);

export const actReplacementObservations = pgTable(
  "act_replacement_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actReplacementRuns.id),
    sourceDatabaseKey: text("source_database_key").notNull(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => actSourceRecords.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => actSourceRecordVersions.id),
    snapshotScope: text("snapshot_scope").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_replacement_observations_run_source_unique").on(
      table.runId,
      table.sourceRecordId,
    ),
    foreignKey({
      columns: [table.runId, table.sourceDatabaseKey],
      foreignColumns: [actReplacementRuns.id, actReplacementRuns.sourceDatabaseKey],
      name: "act_replacement_observations_run_database_fk",
    }),
    foreignKey({
      columns: [table.sourceRecordId, table.sourceDatabaseKey],
      foreignColumns: [actSourceRecords.id, actSourceRecords.sourceDatabaseKey],
      name: "act_replacement_observations_source_database_fk",
    }),
    foreignKey({
      columns: [table.versionId, table.sourceRecordId],
      foreignColumns: [actSourceRecordVersions.id, actSourceRecordVersions.sourceRecordId],
      name: "act_replacement_observations_version_source_fk",
    }),
    check(
      "act_replacement_observations_snapshot_scope_valid",
      sql`${table.snapshotScope} in (${sqlTextValues(actSnapshotScopeValues)})`,
    ),
  ],
);

export const actReplacementRequestAudits = pgTable(
  "act_replacement_request_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actReplacementRuns.id),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => actReplacementCheckpoints.id),
    streamType: text("stream_type").notNull(),
    method: text("method").default("GET").notNull(),
    pathTemplate: text("path_template").notNull(),
    state: text("state").default("started").notNull(),
    httpStatus: integer("http_status"),
    safeErrorCode: text("safe_error_code").$type<ActSafeErrorCode>(),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.checkpointId, table.runId, table.streamType],
      foreignColumns: [
        actReplacementCheckpoints.id,
        actReplacementCheckpoints.runId,
        actReplacementCheckpoints.streamType,
      ],
      name: "act_replacement_request_audits_checkpoint_context_fk",
    }),
    check(
      "act_replacement_request_audits_method_get_only",
      sql`${table.method} = 'GET'`,
    ),
    check(
      "act_replacement_request_audits_stream_type_valid",
      sql`${table.streamType} in (${sqlTextValues(actReplacementStreamTypeValues)})`,
    ),
    check(
      "act_replacement_request_audits_path_template_safe",
      sql`${table.pathTemplate} = '/authorize' or ${table.pathTemplate} ~ '^/api/[A-Za-z0-9_{}:-]+(/[A-Za-z0-9_{}:-]+)*$'`,
    ),
    check(
      "act_replacement_request_audits_state_valid",
      sql`${table.state} in (${sqlTextValues(actRequestAuditStateValues)})`,
    ),
    check(
      "act_replacement_request_audits_http_status_valid",
      sql`${table.httpStatus} is null or ${table.httpStatus} between 100 and 599`,
    ),
    check(
      "act_replacement_request_audits_duration_nonnegative",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
    check(
      "act_replacement_request_audits_safe_error_code_valid",
      sql`${table.safeErrorCode} is null or ${table.safeErrorCode} in (${sqlTextValues(actSafeErrorCodeValues)})`,
    ),
  ],
);

export type ActReplacementRun = typeof actReplacementRuns.$inferSelect;
export type NewActReplacementRun = typeof actReplacementRuns.$inferInsert;
export type ActReplacementCheckpoint =
  typeof actReplacementCheckpoints.$inferSelect;
export type NewActReplacementCheckpoint =
  typeof actReplacementCheckpoints.$inferInsert;
export type ActReplacementPageReceipt =
  typeof actReplacementPageReceipts.$inferSelect;
export type NewActReplacementPageReceipt =
  typeof actReplacementPageReceipts.$inferInsert;
export type ActSourceRecord = typeof actSourceRecords.$inferSelect;
export type NewActSourceRecord = typeof actSourceRecords.$inferInsert;
export type ActSourceRecordVersion =
  typeof actSourceRecordVersions.$inferSelect;
export type NewActSourceRecordVersion =
  typeof actSourceRecordVersions.$inferInsert;
export type ActArchiveProfileImportJob =
  typeof actArchiveProfileImportJobs.$inferSelect;
export type NewActArchiveProfileImportJob =
  typeof actArchiveProfileImportJobs.$inferInsert;
export type ActArchiveProfileImportSource =
  typeof actArchiveProfileImportSources.$inferSelect;
export type NewActArchiveProfileImportSource =
  typeof actArchiveProfileImportSources.$inferInsert;
export type ActArchiveProfileImportResult =
  typeof actArchiveProfileImportResults.$inferSelect;
export type NewActArchiveProfileImportResult =
  typeof actArchiveProfileImportResults.$inferInsert;
export type ActReplacementObservation =
  typeof actReplacementObservations.$inferSelect;
export type NewActReplacementObservation =
  typeof actReplacementObservations.$inferInsert;
export type ActReplacementRequestAudit =
  typeof actReplacementRequestAudits.$inferSelect;
export type NewActReplacementRequestAudit =
  typeof actReplacementRequestAudits.$inferInsert;

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
      sql`${table.source} in ('act_migration', 'act_import', 'manual')`,
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
    sourceDatabaseKey: text("source_database_key"),
    sourceRecordId: uuid("source_record_id").references(() => actSourceRecords.id, { onDelete: "restrict" }),
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
    uniqueIndex("act_external_links_legacy_source_external_id_unique")
      .on(table.sourceEntityType, table.actRecordId)
      .where(sql`${table.sourceDatabaseKey} is null`),
    uniqueIndex("act_external_links_database_source_record_unique")
      .on(table.sourceRecordId)
      .where(sql`${table.sourceRecordId} is not null`),
    uniqueIndex("act_external_links_database_source_act_id_unique")
      .on(table.sourceDatabaseKey, table.sourceEntityType, table.actRecordId)
      .where(sql`${table.sourceDatabaseKey} is not null`),
    uniqueIndex("act_external_links_one_primary_per_local_source")
      .on(table.entityType, table.entityId, table.sourceEntityType)
      .where(sql`${table.isPrimary} = true`),
    foreignKey({
      columns: [table.sourceRecordId, table.sourceDatabaseKey, table.sourceEntityType],
      foreignColumns: [
        actSourceRecords.id,
        actSourceRecords.sourceDatabaseKey,
        actSourceRecords.streamType,
      ],
      name: "act_external_links_archive_source_scope_fk",
    }),
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
      sql`(${table.entityType} = 'contact' and ${table.sourceEntityType} = 'contact' and ((${table.isPrimary} = true and ${table.syncMode} = 'two_way') or (${table.isPrimary} = false and ${table.syncMode} = 'pull_only') or (${table.isPrimary} = true and ${table.syncMode} = 'pull_only' and ${table.sourceDatabaseKey} is not null and ${table.sourceRecordId} is not null))) or (${table.entityType} <> 'contact' and ${table.syncMode} = 'pull_only')`,
    ),
    check("act_external_links_source_database_key_nonblank", sql`${table.sourceDatabaseKey} is null or btrim(${table.sourceDatabaseKey}) <> ''`),
  ],
);

export const actReplacementOutcomes = pgTable("act_replacement_outcomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => actReplacementRuns.id, { onDelete: "cascade" }),
  sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id),
  sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id),
  state: text("state").notNull().default("pending"),
  normalized: jsonb("normalized").$type<Record<string, unknown>>(),
  mappingWarnings: jsonb("mapping_warnings").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  unsupportedFieldPaths: jsonb("unsupported_field_paths").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  candidates: jsonb("candidates").$type<Record<string, unknown>[]>(),
  issues: jsonb("issues").$type<Record<string, unknown>[]>(),
  match: jsonb("match").$type<Record<string, unknown>>(),
  targetEntityType: text("target_entity_type"),
  targetEntityId: uuid("target_entity_id"),
  leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  retryAfter: timestamp("retry_after", { withTimezone: true }), retryable: boolean("retryable").default(true).notNull(), organizedAt: timestamp("organized_at", { withTimezone: true }), attemptCount: integer("attempt_count").default(0).notNull(),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("act_replacement_outcomes_run_source_unique").on(table.runId, table.sourceRecordId), check("act_replacement_outcomes_target_type_valid", sql`${table.targetEntityType} is null or ${table.targetEntityType} in ('organization','contact','booking','calling_list','activity')`),
  check("act_replacement_outcomes_state_valid", sql`${table.state} in ('pending','leased','ready','already_present','awaiting_review','unassigned','unsupported','ignored','applied','failed')`),
]);

export const actSourceAssignments = pgTable("act_source_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id, { onDelete: "restrict" }),
  targetEntityType: text("target_entity_type").notNull(), targetEntityId: uuid("target_entity_id").notNull(),
  role: text("role").notNull().default("primary"), isPrimary: boolean("is_primary").default(false).notNull(),
  manualAuthority: boolean("manual_authority").notNull(), assignedBy: text("assigned_by").notNull(), supersededAt: timestamp("superseded_at", { withTimezone: true }), supersededBy: text("superseded_by"),
  sourceVersionId: uuid("source_version_id").references(() => actSourceRecordVersions.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("act_source_assignments_source_target_unique").on(table.sourceRecordId, table.targetEntityType, table.targetEntityId), check("act_source_assignments_target_type_valid", sql`${table.targetEntityType} in ('organization','contact','booking','calling_list','activity')`), check("act_source_assignments_manual_actor_valid", sql`${table.manualAuthority} = true and ${table.assignedBy} is not null and btrim(${table.assignedBy}) <> ''`), check("act_source_assignments_supersession_actor_valid", sql`${table.supersededAt} is null or (${table.supersededBy} is not null and btrim(${table.supersededBy}) <> '')`)]);

export const actReplacementReviewDecisions = pgTable("act_replacement_review_decisions", {
  id: uuid("id").defaultRandom().primaryKey(), sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id, { onDelete: "restrict" }),
  sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id, { onDelete: "restrict" }), scope: text("scope").notNull(), decision: text("decision").notNull(),
  requestKey: text("request_key").notNull(), requestFingerprint: text("request_fingerprint").notNull(), fieldName: text("field_name"), relationshipSlot: text("relationship_slot"), targetEntityType: text("target_entity_type"), targetEntityId: uuid("target_entity_id"),
  reviewedSourceValue: jsonb("reviewed_source_value").$type<unknown>(), reviewedSourceValueFingerprint: text("reviewed_source_value_fingerprint"),
  reviewedLocalValue: jsonb("reviewed_local_value").$type<unknown>(), reviewedLocalValueFingerprint: text("reviewed_local_value_fingerprint"),
  active: boolean("active").default(true).notNull(), supersededAt: timestamp("superseded_at", { withTimezone: true }), supersededBy: text("superseded_by"), decidedBy: text("decided_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("act_replacement_review_decisions_active_unique").on(table.sourceRecordId, table.scope, sql`coalesce(${table.relationshipSlot}, ${table.fieldName}, '')`).where(sql`${table.active} = true`), check("act_replacement_review_decisions_scope_valid", sql`${table.scope} in ('duplicate_identity','field_conflict','relationship','unsupported_record')`), check("act_replacement_review_decisions_field_scope_requires_name", sql`${table.scope} = 'field_conflict' and ${table.fieldName} is not null and btrim(${table.fieldName}) <> '' or ${table.scope} <> 'field_conflict' and ${table.fieldName} is null`), check("act_replacement_review_decisions_target_type_valid", sql`${table.targetEntityType} is null or ${table.targetEntityType} in ('organization','contact','booking','calling_list','activity')`), check("act_replacement_review_decisions_supersession_requires_actor", sql`${table.supersededAt} is null or (${table.supersededBy} is not null and btrim(${table.supersededBy}) <> '')`), check("act_replacement_review_decisions_actor_valid", sql`btrim(${table.decidedBy}) <> ''`), check("act_replacement_review_decisions_request_fingerprint_valid", sql`btrim(${table.requestFingerprint}) <> ''`), check("act_replacement_review_decisions_decision_valid", sql`${table.decision} in ('link_existing','keep_separate','keep_local','use_source','assign_parent','keep_unlinked','ignore_source')`), check("act_replacement_review_decisions_scope_decision_valid", sql`(${table.scope} = 'duplicate_identity' and ${table.decision} in ('link_existing','keep_separate')) or (${table.scope} = 'field_conflict' and ${table.decision} in ('keep_local','use_source')) or (${table.scope} = 'relationship' and ${table.decision} in ('assign_parent','keep_unlinked','ignore_source')) or (${table.scope} = 'unsupported_record' and ${table.decision} = 'ignore_source') or (${table.active} = false and ${table.supersededAt} is not null and ${table.supersededBy} = 'migration:018_invalid_scope_decision')`), check("act_replacement_review_decisions_relationship_parent_valid", sql`${table.decision} <> 'assign_parent' or (${table.scope} = 'relationship' and ${table.relationshipSlot} is not null and btrim(${table.relationshipSlot}) <> '' and ${table.targetEntityType} is not null and ${table.targetEntityId} is not null)`)]);

export const actReplacementBulkReviewRequests = pgTable("act_replacement_bulk_review_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => actReplacementRuns.id, { onDelete: "cascade" }),
  requestKey: text("request_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  requestedBy: text("requested_by").notNull(),
  manifestDigest: text("manifest_digest").notNull(),
  expectedManifestDigest: text("expected_manifest_digest"),
  automaticSummary: jsonb("automatic_summary").$type<Record<string, number>>(),
  rebuildState: text("rebuild_state").default("complete").notNull(),
  rebuildToken: uuid("rebuild_token"),
  rebuildLeaseExpiresAt: timestamp("rebuild_lease_expires_at", { withTimezone: true }),
  decisionIds: jsonb("decision_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  reviewedOperationIds: jsonb("reviewed_operation_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("act_replacement_bulk_review_requests_run_key_unique").on(table.runId, table.requestKey),
  check("act_replacement_bulk_review_requests_key_nonblank", sql`btrim(${table.requestKey}) <> ''`),
  check("act_replacement_bulk_review_requests_fingerprint_nonblank", sql`btrim(${table.requestFingerprint}) <> ''`),
  check("act_replacement_bulk_review_requests_actor_nonblank", sql`btrim(${table.requestedBy}) <> ''`),
  check("act_replacement_bulk_review_requests_digest_nonblank", sql`btrim(${table.manifestDigest}) <> ''`),
  check("act_replacement_bulk_review_requests_expected_digest_nonblank", sql`${table.expectedManifestDigest} is null or btrim(${table.expectedManifestDigest}) <> ''`),
  check("act_replacement_bulk_review_requests_rebuild_state_valid", sql`${table.rebuildState} in ('pending','rebuilding','complete')`),
  check("act_replacement_bulk_review_requests_rebuild_lease_valid", sql`(${table.rebuildState} = 'rebuilding' and ${table.rebuildToken} is not null and ${table.rebuildLeaseExpiresAt} is not null) or (${table.rebuildState} <> 'rebuilding' and ${table.rebuildToken} is null and ${table.rebuildLeaseExpiresAt} is null)`),
  check("act_replacement_bulk_review_requests_decision_ids_array", sql`jsonb_typeof(${table.decisionIds}) = 'array'`),
  check("act_replacement_bulk_review_requests_operation_ids_array", sql`jsonb_typeof(${table.reviewedOperationIds}) = 'array'`),
]);

export const actReplacementApplyOperations = pgTable("act_replacement_apply_operations", {
  id: uuid("id").defaultRandom().primaryKey(), runId: uuid("run_id").notNull().references(() => actReplacementRuns.id, { onDelete: "cascade" }), sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id), sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id),
  manifestGeneration: uuid("manifest_generation"),
  operationKey: text("operation_key").notNull(), targetType: text("target_type").notNull(), action: text("action").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), dependencyOperationKeys: jsonb("dependency_operation_keys").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), requiredForSourceOutcome: boolean("required_for_source_outcome").default(false).notNull(), safeByDefault: boolean("safe_by_default").default(false).notNull(),
  batchId: uuid("batch_id"), status: text("status").default("pending").notNull(), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at", { withTimezone: true }), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), retryable: boolean("retryable").default(true).notNull(), retryAfter: timestamp("retry_after", { withTimezone: true }), executedAt: timestamp("executed_at", { withTimezone: true }), attemptCount: integer("attempt_count").default(0).notNull(), lastErrorCode: text("last_error_code"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("act_replacement_apply_operations_run_key_unique").on(table.runId, table.operationKey),
  index("act_replacement_apply_operations_current_manifest_idx").on(table.runId, table.manifestGeneration),
  check("act_replacement_apply_operations_status_valid", sql`${table.status} in ('pending','leased','applied','already_present','blocked','failed')`),
  check("act_replacement_apply_operations_approval_requires_actor", sql`${table.approvedAt} is null or ${table.approvedBy} is not null`),
  check("act_replacement_apply_operations_lease_consistency", sql`${table.status} = 'leased' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null or ${table.status} <> 'leased'`),
  check("act_replacement_apply_operations_action_valid", sql`${table.action} in ('create','link_existing','fill_missing','overwrite_reviewed','create_relationship','record_provenance')`),
  check("act_replacement_apply_operations_target_valid", sql`${table.targetType} in ('organization','contact','booking','calling_list','activity','organization_contact','booking_contact','calling_list_member','activity_association')`),
]);

export const actReplacementApprovalRequests = pgTable("act_replacement_approval_requests", {
  id: uuid("id").defaultRandom().primaryKey(), requestKey: text("request_key").notNull(), runId: uuid("run_id").notNull().references(() => actReplacementRuns.id, { onDelete: "cascade" }), manifestDigest: text("manifest_digest").notNull(), approvalMode: text("approval_mode"), approvalModeVersion: integer("approval_mode_version"), selectedOperationIds: jsonb("selected_operation_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), dependencyClosedOperationIds: jsonb("dependency_closed_operation_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), selectedCount: integer("selected_count").default(0).notNull(), dependencyCount: integer("dependency_count").default(0).notNull(), rejectedCount: integer("rejected_count").default(0).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("act_replacement_approval_requests_run_key_unique").on(table.runId, table.requestKey),
  check("act_replacement_approval_requests_digest_nonblank", sql`btrim(${table.manifestDigest}) <> ''`),
  check("act_replacement_approval_requests_mode_valid", sql`${table.approvalMode} is null or ${table.approvalMode} in ('automatic_safe','explicit_manual')`),
  check("act_replacement_approval_requests_mode_version_valid", sql`${table.approvalModeVersion} is null or ${table.approvalModeVersion} = 1`),
  check("act_replacement_approval_requests_mode_pair_valid", sql`(${table.approvalMode} is null and ${table.approvalModeVersion} is null) or (${table.approvalMode} is not null and ${table.approvalModeVersion} is not null)`),
]);

export const actReplacementApplyBatches = pgTable("act_replacement_apply_batches", {
  id: uuid("id").defaultRandom().primaryKey(), requestKey: text("request_key").notNull(), runId: uuid("run_id").notNull().references(() => actReplacementRuns.id, { onDelete: "cascade" }), approvalRequestKey: text("approval_request_key"), startCursor: integer("start_cursor"), manifestDigest: text("manifest_digest").notNull(), selectedOperationIds: jsonb("selected_operation_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), dependencyClosedOperationIds: jsonb("dependency_closed_operation_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), selectedCount: integer("selected_count").default(0).notNull(), dependencyCount: integer("dependency_count").default(0).notNull(), rejectedCount: integer("rejected_count").default(0).notNull(), state: text("state").default("queued").notNull(), startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), replayFingerprint: text("replay_fingerprint"), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), attemptToken: uuid("attempt_token"), attemptCount: integer("attempt_count").default(0).notNull(), lastErrorCode: text("last_error_code"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("act_replacement_apply_batches_one_active_per_run").on(table.runId).where(sql`${table.state} in ('queued','applying')`), unique("act_replacement_apply_batches_run_request_key_unique").on(table.runId, table.requestKey), check("act_replacement_apply_batches_state_valid", sql`${table.state} in ('queued','applying','complete','complete_with_issues')`), check("act_replacement_apply_batches_lease_consistency", sql`(${table.state} = 'applying' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null and ${table.attemptToken} is not null) or (${table.state} <> 'applying' and ${table.attemptToken} is null)`), check("act_replacement_apply_batches_cursor_nonnegative", sql`${table.startCursor} is null or ${table.startCursor} >= 0`)]);

export const actImportedFieldOrigins = pgTable("act_imported_field_origins", {
  id: uuid("id").defaultRandom().primaryKey(), entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), fieldName: text("field_name").notNull(), sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id), sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id), operationId: uuid("operation_id").notNull().references(() => actReplacementApplyOperations.id), sourceValueFingerprint: text("source_value_fingerprint").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("act_imported_field_origins_entity_field_unique").on(table.entityType, table.entityId, table.fieldName), check("act_imported_field_origins_entity_type_valid", sql`${table.entityType} in ('organization','contact','booking','calling_list','activity')`), check("act_imported_field_origins_field_name_nonblank", sql`btrim(${table.fieldName}) <> ''`)]);

export const activityAssociations = pgTable("activity_associations", {
  id: uuid("id").defaultRandom().primaryKey(), activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }), organizationId: uuid("organization_id").references(() => organizations.id), contactId: uuid("contact_id").references(() => contacts.id), bookingId: uuid("booking_id").references(() => bookings.id), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [check("activity_associations_exactly_one_target", sql`num_nonnulls(${table.organizationId}, ${table.contactId}, ${table.bookingId}) = 1`), uniqueIndex("activity_associations_activity_organization_unique").on(table.activityId, table.organizationId).where(sql`${table.organizationId} is not null`), uniqueIndex("activity_associations_activity_contact_unique").on(table.activityId, table.contactId).where(sql`${table.contactId} is not null`), uniqueIndex("activity_associations_activity_booking_unique").on(table.activityId, table.bookingId).where(sql`${table.bookingId} is not null`)]);

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

// ---------------------------------------------------------------------------
// Trips, route planning & fuel estimates
// ---------------------------------------------------------------------------

export const tripEstimateSourceValues = ["live", "cached", "manual"] as const;
export type TripEstimateSource = (typeof tripEstimateSourceValues)[number];

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    travelLegId: uuid("travel_leg_id")
      .notNull()
      .references(() => travelLegs.id),
    name: text("name").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    startLabel: text("start_label").notNull(),
    startLatitude: doublePrecision("start_latitude"),
    startLongitude: doublePrecision("start_longitude"),
    endLabel: text("end_label").notNull(),
    endLatitude: doublePrecision("end_latitude"),
    endLongitude: doublePrecision("end_longitude"),
    vehicleName: text("vehicle_name"),
    mpg: doublePrecision("mpg"),
    fuelPricePerGallon: doublePrecision("fuel_price_per_gallon"),
    routeConfirmedAt: timestamp("route_confirmed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("trips_name_nonblank", sql`nullif(trim(${table.name}), '') is not null`),
    check("trips_date_range_valid", sql`${table.endDate} >= ${table.startDate}`),
    check("trips_mpg_positive", sql`${table.mpg} is null or ${table.mpg} > 0`),
    check(
      "trips_fuel_price_nonnegative",
      sql`${table.fuelPricePerGallon} is null or ${table.fuelPricePerGallon} >= 0`,
    ),
    index("trips_travel_leg_idx").on(table.travelLegId),
    index("trips_date_range_idx").on(table.startDate, table.endDate),
  ],
);

export const tripStops = pgTable(
  "trip_stops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("trip_stops_trip_booking_unique").on(table.tripId, table.bookingId),
    index("trip_stops_trip_idx").on(table.tripId),
    check("trip_stops_sort_order_positive", sql`${table.sortOrder} >= 1`),
  ],
);

export const tripSegments = pgTable(
  "trip_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    fromKey: text("from_key").notNull(),
    toKey: text("to_key").notNull(),
    fromLabel: text("from_label").notNull(),
    toLabel: text("to_label").notNull(),
    miles: doublePrecision("miles"),
    minutes: doublePrecision("minutes"),
    source: text("source").$type<TripEstimateSource>(),
    estimatedAt: timestamp("estimated_at", { withTimezone: true }),
    overrideMiles: doublePrecision("override_miles"),
    overrideMinutes: doublePrecision("override_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("trip_segments_trip_sequence_unique").on(table.tripId, table.sequence),
    index("trip_segments_trip_idx").on(table.tripId),
    check(
      "trip_segments_source_valid",
      sql`${table.source} is null or ${table.source} in (${sqlTextValues(tripEstimateSourceValues)})`,
    ),
    check(
      "trip_segments_miles_nonnegative",
      sql`${table.miles} is null or ${table.miles} >= 0`,
    ),
    check(
      "trip_segments_minutes_nonnegative",
      sql`${table.minutes} is null or ${table.minutes} >= 0`,
    ),
    check(
      "trip_segments_override_miles_nonnegative",
      sql`${table.overrideMiles} is null or ${table.overrideMiles} >= 0`,
    ),
    check(
      "trip_segments_override_minutes_nonnegative",
      sql`${table.overrideMinutes} is null or ${table.overrideMinutes} >= 0`,
    ),
  ],
);

export const legScheduleIssues = pgTable(
  "leg_schedule_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    notes: text("notes").notNull(),
    status: text("status").default("open").notNull(),
    clientMutationId: uuid("client_mutation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    unique("leg_schedule_issues_leg_mutation_unique").on(table.legId, table.clientMutationId),
    index("leg_schedule_issues_leg_status_idx").on(table.legId, table.status),
    check("leg_schedule_issues_kind_valid", sql`${table.kind} in ('wrong_datetime','wrong_location','wrong_leg','route_problem','event_details_changed','other')`),
    check("leg_schedule_issues_status_valid", sql`${table.status} in ('open','resolved')`),
  ],
);

export const tripResourceAssignments = pgTable(
  "trip_resource_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("trip_resource_assignments_trip_resource_unique").on(
      table.tripId,
      table.resourceId,
    ),
    index("trip_resource_assignments_resource_idx").on(table.resourceId),
  ],
);

export const routingCacheEntries = pgTable(
  "routing_cache_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cacheKey: text("cache_key").notNull(),
    miles: doublePrecision("miles").notNull(),
    minutes: doublePrecision("minutes").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("routing_cache_entries_cache_key_unique").on(table.cacheKey),
    check("routing_cache_entries_miles_nonnegative", sql`${table.miles} >= 0`),
    check(
      "routing_cache_entries_minutes_nonnegative",
      sql`${table.minutes} >= 0`,
    ),
  ],
);


//  AI booking suggestions
// Persisted so suggestions survive server restarts/redeploys (Render spins the
// server down on idle and restarts on every deploy).

export const aiSuggestionConfidenceValues = ["high", "medium", "low"] as const;
export type AiSuggestionConfidence =
  (typeof aiSuggestionConfidenceValues)[number];

export const aiSuggestionStatusValues = [
  "pending",
  "accepted",
  "dismissed",
] as const;
export type AiSuggestionStatus = (typeof aiSuggestionStatusValues)[number];

export const aiBookingSuggestions = pgTable(
  "ai_booking_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** ISO date string (YYYY-MM-DD) for the suggested booking start, or null */
    suggestedDate: text("suggested_date"),
    suggestedDateEnd: text("suggested_date_end"),
    clientName: text("client_name"),
    tripDescription: text("trip_description").notNull(),
    location: text("location"),
    confidence: text("confidence")
      .$type<AiSuggestionConfidence>()
      .default("low")
      .notNull(),
    sourceSnippet: text("source_snippet").notNull(),
    actRecordId: text("act_record_id"),
    status: text("status")
      .$type<AiSuggestionStatus>()
      .default("pending")
      .notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id),
    /** Matched source contact, when the analyzed record had one */
    contactId: uuid("contact_id").references(() => contacts.id),
    /** Matched source organization (event profile), when the record had one */
    organizationId: uuid("organization_id").references(() => organizations.id),
    /** Stable dedupe key: actRecordId+date, or client+date (see suggestion store) */
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ai_booking_suggestions_dedupe_key_unique").on(table.dedupeKey),
    check(
      "ai_booking_suggestions_confidence_valid",
      sql`${table.confidence} in (${sqlTextValues(aiSuggestionConfidenceValues)})`,
    ),
    check(
      "ai_booking_suggestions_status_valid",
      sql`${table.status} in (${sqlTextValues(aiSuggestionStatusValues)})`,
    ),
  ],
);

export const legEventIncome = pgTable("leg_event_income", {
  id: uuid("id").defaultRandom().primaryKey(),
  legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
  tripSegmentId: uuid("trip_segment_id").references(() => tripSegments.id, { onDelete: "set null" }),
  cashCents: integer("cash_cents").default(0).notNull(),
  squareCents: integer("square_cents").default(0).notNull(),
  otherCents: integer("other_cents").default(0).notNull(),
  otherLabel: text("other_label"), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), notes: text("notes"),
  clientMutationId: uuid("client_mutation_id").notNull(), revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("leg_event_income_leg_mutation_unique").on(table.legId, table.clientMutationId), index("leg_event_income_leg_trip_idx").on(table.legId, table.tripId), check("leg_event_income_cash_nonnegative", sql`${table.cashCents} >= 0`), check("leg_event_income_square_nonnegative", sql`${table.squareCents} >= 0`), check("leg_event_income_other_nonnegative", sql`${table.otherCents} >= 0`), check("leg_event_income_revision_positive", sql`${table.revision} >= 1`)]);

export const legExpenses = pgTable("leg_expenses", {
  id: uuid("id").defaultRandom().primaryKey(), legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }), tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }), tripSegmentId: uuid("trip_segment_id").references(() => tripSegments.id, { onDelete: "set null" }),
  category: text("category").notNull(), merchant: text("merchant"), amountCents: integer("amount_cents").notNull(), taxCents: integer("tax_cents").default(0).notNull(), paymentSource: text("payment_source").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), notes: text("notes"), employeeNote: text("employee_note"), detailJson: jsonb("detail_json"), clientMutationId: uuid("client_mutation_id").notNull(), revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("leg_expenses_leg_mutation_unique").on(table.legId, table.clientMutationId), index("leg_expenses_leg_trip_idx").on(table.legId, table.tripId), check("leg_expenses_amount_nonnegative", sql`${table.amountCents} >= 0`), check("leg_expenses_tax_nonnegative", sql`${table.taxCents} >= 0`), check("leg_expenses_category_valid", sql`${table.category} in ('fuel','food','rv_park','vehicle_maintenance','trailer_maintenance','supplies','employee_related','other')`), check("leg_expenses_payment_source_valid", sql`${table.paymentSource} in ('adventure_zone_cash','adventure_zone_debit','personal')`), check("leg_expenses_revision_positive", sql`${table.revision} >= 1`)]);

export const legCashEntries = pgTable("leg_cash_entries", {
  id: uuid("id").defaultRandom().primaryKey(), legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }), bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }), tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }), tripSegmentId: uuid("trip_segment_id").references(() => tripSegments.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), amountCents: integer("amount_cents").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), notes: text("notes"), clientMutationId: uuid("client_mutation_id").notNull(), revision: integer("revision").default(1).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("leg_cash_entries_leg_mutation_unique").on(table.legId, table.clientMutationId), index("leg_cash_entries_leg_trip_idx").on(table.legId, table.tripId), check("leg_cash_entries_kind_valid", sql`${table.kind} in ('event_cash_collected','expense_paid_cash','advance_received','cash_turned_in','cash_returned','manager_reimbursed','adjustment')`), check("leg_cash_entries_amount_valid", sql`${table.kind} = 'adjustment' or ${table.amountCents} >= 0`), check("leg_cash_entries_revision_positive", sql`${table.revision} >= 1`)]);

export const legMileageEntries = pgTable("leg_mileage_entries", {
  id: uuid("id").defaultRandom().primaryKey(), legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }), bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }), tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }), tripSegmentId: uuid("trip_segment_id").references(() => tripSegments.id, { onDelete: "set null" }), miles: doublePrecision("miles"), odometerStart: doublePrecision("odometer_start"), odometerEnd: doublePrecision("odometer_end"), vehicleLabel: text("vehicle_label"), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), notes: text("notes"), clientMutationId: uuid("client_mutation_id").notNull(), revision: integer("revision").default(1).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("leg_mileage_entries_leg_mutation_unique").on(table.legId, table.clientMutationId), index("leg_mileage_entries_leg_trip_idx").on(table.legId, table.tripId), check("leg_mileage_entries_distance_valid", sql`(${table.miles} is not null and ${table.miles} >= 0) or (${table.odometerStart} is not null and ${table.odometerEnd} is not null and ${table.odometerEnd} >= ${table.odometerStart})`), check("leg_mileage_entries_revision_positive", sql`${table.revision} >= 1`)]);

export const legReceipts = pgTable("leg_receipts", {
  id: uuid("id").defaultRandom().primaryKey(), legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }), expenseId: uuid("expense_id").notNull().references(() => legExpenses.id, { onDelete: "cascade" }), objectKey: text("object_key"), imageStatus: text("image_status").default("image_pending").notNull(), mimeType: text("mime_type"), clientMutationId: uuid("client_mutation_id").notNull(), revision: integer("revision").default(1).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("leg_receipts_leg_mutation_unique").on(table.legId, table.clientMutationId), index("leg_receipts_leg_expense_idx").on(table.legId, table.expenseId), check("leg_receipts_image_status_valid", sql`${table.imageStatus} in ('image_pending','image_uploaded','image_failed')`), check("leg_receipts_revision_positive", sql`${table.revision} >= 1`)]);

export const crewWorkers = pgTable(
  "crew_workers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    normalizedPhone: text("normalized_phone"),
    email: text("email"),
    city: text("city"),
    region: text("region"),
    locationText: text("location_text"),
    rehireStatus: text("rehire_status").default("undecided").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("crew_workers_location_idx").on(table.region, table.city),
    index("crew_workers_normalized_phone_idx").on(table.normalizedPhone).where(sql`${table.normalizedPhone} is not null`),
    check("crew_workers_name_nonblank", sql`nullif(trim(${table.name}), '') is not null`),
    check("crew_workers_rehire_status_valid", sql`${table.rehireStatus} in ('rehirable','undecided','do_not_rehire')`),
  ],
);

export const crewWorkHistory = pgTable(
  "crew_work_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workerId: uuid("worker_id").notNull().references(() => crewWorkers.id, { onDelete: "restrict" }),
    legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    role: text("role").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    rating: integer("rating"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("crew_work_history_worker_started_idx").on(table.workerId, table.startedAt.desc()),
    index("crew_work_history_leg_started_idx").on(table.legId, table.startedAt.desc()),
    check("crew_work_history_role_nonblank", sql`nullif(trim(${table.role}), '') is not null`),
    check("crew_work_history_dates_valid", sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`),
    check("crew_work_history_rating_valid", sql`${table.rating} is null or ${table.rating} between 0 and 5`),
  ],
);

export const crewManagerNotes = pgTable(
  "crew_manager_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workerId: uuid("worker_id").notNull().references(() => crewWorkers.id, { onDelete: "restrict" }),
    legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("crew_manager_notes_worker_created_idx").on(table.workerId, table.createdAt.desc()),
    index("crew_manager_notes_leg_created_idx").on(table.legId, table.createdAt.desc()),
    check("crew_manager_notes_note_nonblank", sql`nullif(trim(${table.note}), '') is not null`),
  ],
);

export const eventManagerReviews = pgTable(
  "event_manager_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "restrict" }),
    legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
    rating: integer("rating").notNull(),
    feedback: text("feedback"),
    organizerSiteNotes: text("organizer_site_notes"),
    crewNotes: text("crew_notes"),
    recommendReturn: text("recommend_return"),
    clientMutationId: uuid("client_mutation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("event_manager_reviews_booking_created_idx").on(table.bookingId, table.createdAt.desc()),
    index("event_manager_reviews_leg_created_idx").on(table.legId, table.createdAt.desc()),
    uniqueIndex("event_manager_reviews_leg_mutation_unique").on(table.legId, table.clientMutationId),
    check("event_manager_reviews_rating_valid", sql`${table.rating} between 0 and 5`),
    check("event_manager_reviews_recommend_return_valid", sql`${table.recommendReturn} is null or ${table.recommendReturn} in ('yes','no','unsure')`),
  ],
);

export const legIncidents = pgTable("leg_incidents", {
  id: uuid("id").primaryKey(),
  legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
  type: text("type").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  locationText: text("location_text"), peopleInvolved: text("people_involved"), description: text("description").notNull(), actionTaken: text("action_taken"), followUpNeeded: boolean("follow_up_needed").default(false).notNull(),
  clientMutationId: uuid("client_mutation_id").notNull(), revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("leg_incidents_leg_mutation_unique").on(table.legId, table.clientMutationId), index("leg_incidents_leg_occurred_idx").on(table.legId, table.occurredAt.desc()), check("leg_incidents_type_nonblank", sql`nullif(trim(${table.type}), '') is not null`), check("leg_incidents_description_nonblank", sql`nullif(trim(${table.description}), '') is not null`), check("leg_incidents_revision_positive", sql`${table.revision} >= 1`)]);

export const legIncidentAttachments = pgTable("leg_incident_attachments", {
  id: uuid("id").primaryKey(), legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }), incidentId: uuid("incident_id").notNull().references(() => legIncidents.id, { onDelete: "cascade" }), objectKey: text("object_key"), imageStatus: text("image_status").default("image_pending").notNull(), mimeType: text("mime_type"), clientMutationId: uuid("client_mutation_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("leg_incident_attachments_leg_mutation_unique").on(table.legId, table.clientMutationId), index("leg_incident_attachments_incident_idx").on(table.incidentId), check("leg_incident_attachments_status_valid", sql`${table.imageStatus} in ('image_pending','image_uploaded','image_failed')`)]);
