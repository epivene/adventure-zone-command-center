import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts, organizations } from "./schema";

export const leadImportBatchStatusValues = ["review", "archived"] as const;
export const leadImportRowStateValues = [
  "needs_review",
  "needs_correction",
  "verified",
  "skipped",
] as const;
export const leadEvidenceFieldValues = ["event_dates", "recipient_email"] as const;
export const leadEvidenceSourceKindValues = ["crm_contact", "act_description", "official_website", "manual"] as const;
export const leadRelationshipOutcomeValues = [
  "returning_contact",
  "reintroduction",
  "prior_outreach_no_response",
  "new_introduction",
  "needs_review",
] as const;

export type LeadImportBatchStatus = (typeof leadImportBatchStatusValues)[number];
export type LeadImportRowState = (typeof leadImportRowStateValues)[number];
export type LeadRelationshipOutcome = (typeof leadRelationshipOutcomeValues)[number];

export const leadImportBatches = pgTable("lead_import_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  originalFilename: text("original_filename").notNull(),
  fileSha256: text("file_sha256").notNull(),
  status: text("status").$type<LeadImportBatchStatus>().default("review").notNull(),
  rowCount: integer("row_count").notNull(),
  importedBy: text("imported_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("lead_import_batches_file_sha256_unique").on(table.fileSha256),
  index("lead_import_batches_status_updated_idx").on(table.status, table.updatedAt.desc()),
  check("lead_import_batches_filename_nonblank", sql`btrim(${table.originalFilename}) <> ''`),
  check("lead_import_batches_sha256_valid", sql`${table.fileSha256} ~ '^[0-9a-f]{64}$'`),
  check("lead_import_batches_row_count_valid", sql`${table.rowCount} between 1 and 5000`),
  check("lead_import_batches_status_valid", sql`${table.status} in ('review','archived')`),
]);

export const leadImportRows = pgTable("lead_import_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id").notNull().references(() => leadImportBatches.id, { onDelete: "cascade" }),
  sheetName: text("sheet_name").notNull(),
  sourceRowNumber: integer("source_row_number").notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  originalValues: jsonb("original_values").$type<Record<string, string | null>>().notNull(),
  company: text("company"),
  phone: text("phone"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  website: text("website"),
  industry: text("industry"),
  warnings: jsonb("warnings").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  state: text("state").$type<LeadImportRowState>().default("needs_review").notNull(),
  reviewVersion: integer("review_version").default(0).notNull(),
  selectedOrganizationId: uuid("selected_organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  selectedContactId: uuid("selected_contact_id").references(() => contacts.id, { onDelete: "restrict" }),
  contactMode: text("contact_mode").$type<"existing" | "manual" | "organization_inbox" | null>(),
  confirmedEventName: text("confirmed_event_name"),
  confirmedStartDate: date("confirmed_start_date"),
  confirmedEndDate: date("confirmed_end_date"),
  confirmedContactName: text("confirmed_contact_name"),
  confirmedContactRole: text("confirmed_contact_role"),
  confirmedRecipientEmail: text("confirmed_recipient_email"),
  recipientConfirmed: boolean("recipient_confirmed").default(false).notNull(),
  introductionSuitable: boolean("introduction_suitable").default(false).notNull(),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  relationshipOutcome: text("relationship_outcome").$type<LeadRelationshipOutcome | null>(),
  relationshipAnchorAt: timestamp("relationship_anchor_at", { withTimezone: true }),
  relationshipCutoffDate: date("relationship_cutoff_date"),
  relationshipEvidenceIds: jsonb("relationship_evidence_ids").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  latestOutboundAt: timestamp("latest_outbound_at", { withTimezone: true }),
  latestVerifiedResponseAt: timestamp("latest_verified_response_at", { withTimezone: true }),
  relationshipReviewRequired: boolean("relationship_review_required").default(false).notNull(),
  relationshipClassifiedAt: timestamp("relationship_classified_at", { withTimezone: true }),
  relationshipClassifiedBy: text("relationship_classified_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("lead_import_rows_source_position_unique").on(table.batchId, table.sheetName, table.sourceRowNumber),
  uniqueIndex("lead_import_rows_fingerprint_unique").on(table.batchId, table.sourceFingerprint),
  index("lead_import_rows_batch_state_idx").on(table.batchId, table.state, table.sourceRowNumber),
  index("lead_import_rows_relationship_outcome_idx").on(table.relationshipOutcome, table.relationshipClassifiedAt),
  check("lead_import_rows_sheet_name_nonblank", sql`btrim(${table.sheetName}) <> ''`),
  check("lead_import_rows_source_row_positive", sql`${table.sourceRowNumber} > 0`),
  check("lead_import_rows_fingerprint_valid", sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`),
  check("lead_import_rows_state_valid", sql`${table.state} in ('needs_review','needs_correction','verified','skipped')`),
  check("lead_import_rows_review_version_nonnegative", sql`${table.reviewVersion} >= 0`),
  check("lead_import_rows_contact_mode_valid", sql`${table.contactMode} is null or ${table.contactMode} in ('existing','manual','organization_inbox')`),
  check("lead_import_rows_confirmed_date_range_valid", sql`${table.confirmedStartDate} is null or ${table.confirmedEndDate} is null or ${table.confirmedEndDate} >= ${table.confirmedStartDate}`),
  check("lead_import_rows_relationship_outcome_valid", sql`${table.relationshipOutcome} is null or ${table.relationshipOutcome} in ('returning_contact','reintroduction','prior_outreach_no_response','new_introduction','needs_review')`),
  check("lead_import_rows_relationship_evidence_array", sql`jsonb_typeof(${table.relationshipEvidenceIds}) = 'array'`),
  check("lead_import_rows_relationship_classification_complete", sql`${table.relationshipOutcome} is null or (${table.relationshipAnchorAt} is not null and ${table.relationshipCutoffDate} is not null and ${table.relationshipClassifiedAt} is not null and ${table.relationshipClassifiedBy} is not null)`),
]);

export const leadAvailabilitySnapshots = pgTable("lead_availability_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  rowId: uuid("row_id").notNull().references(() => leadImportRows.id, { onDelete: "restrict" }),
  reviewVersion: integer("review_version").notNull(),
  proposedStartDate: date("proposed_start_date").notNull(),
  proposedEndDate: date("proposed_end_date").notNull(),
  ready: boolean("ready").notNull(),
  checkedBy: text("checked_by").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  selectedCalendarIds: jsonb("selected_calendar_ids").$type<string[]>().notNull(),
  sourceEvents: jsonb("source_events").$type<Array<Record<string, unknown>>>().notNull(),
  reservations: jsonb("reservations").$type<Array<Record<string, unknown>>>().notNull(),
}, (table) => [
  index("lead_availability_snapshots_row_checked_idx").on(table.rowId, table.checkedAt.desc()),
  check("lead_availability_snapshots_window_valid", sql`${table.proposedEndDate} >= ${table.proposedStartDate}`),
  check("lead_availability_snapshots_calendar_ids_array", sql`jsonb_typeof(${table.selectedCalendarIds}) = 'array'`),
  check("lead_availability_snapshots_source_events_array", sql`jsonb_typeof(${table.sourceEvents}) = 'array'`),
  check("lead_availability_snapshots_reservations_array", sql`jsonb_typeof(${table.reservations}) = 'array'`),
]);

export const leadImportEvidence = pgTable("lead_import_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  rowId: uuid("row_id").notNull().references(() => leadImportRows.id, { onDelete: "cascade" }),
  field: text("field").$type<(typeof leadEvidenceFieldValues)[number]>().notNull(),
  candidateValue: text("candidate_value").notNull(),
  sourceKind: text("source_kind").$type<(typeof leadEvidenceSourceKindValues)[number]>().notNull(),
  sourceReference: text("source_reference").notNull(),
  selected: boolean("selected").default(false).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("lead_import_evidence_row_field_idx").on(table.rowId, table.field),
  uniqueIndex("lead_import_evidence_one_selected_field").on(table.rowId, table.field).where(sql`${table.selected}`),
  check("lead_import_evidence_field_valid", sql`${table.field} in ('event_dates','recipient_email')`),
  check("lead_import_evidence_source_kind_valid", sql`${table.sourceKind} in ('crm_contact','act_description','official_website','manual')`),
  check("lead_import_evidence_reference_nonblank", sql`btrim(${table.sourceReference}) <> ''`),
]);
