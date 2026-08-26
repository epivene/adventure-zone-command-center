import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { communicationTemplates, contacts, organizations } from "./schema";
import { googleWorkspaceConnections } from "./google-workspace-schema";

export const leadImportBatchStatusValues = ["review", "archived"] as const;
export const leadImportRowStateValues = [
  "needs_review",
  "needs_correction",
  "verified",
  "skipped",
] as const;
export const leadEvidenceFieldValues = ["event_dates", "recipient_email"] as const;
export const leadEvidenceSourceKindValues = ["crm_contact", "act_description", "official_website", "manual"] as const;
export const leadTerritoryStatusValues = ["open", "ask_amy_dave", "closed", "licensing_issue", "needs_review"] as const;
export const leadFitStatusValues = ["approved", "needs_review", "not_a_fit"] as const;
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
export type LeadTerritoryStatus = (typeof leadTerritoryStatusValues)[number];
export type LeadFitStatus = (typeof leadFitStatusValues)[number];
export const leadGmailDraftStateValues = ["prepared", "created", "retryable_error", "manual_review"] as const;
export type LeadGmailDraftState = (typeof leadGmailDraftStateValues)[number];

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
  territoryStatus: text("territory_status").$type<LeadTerritoryStatus>().default("needs_review").notNull(),
  fitStatus: text("fit_status").$type<LeadFitStatus>().default("needs_review").notNull(),
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
  check("lead_import_rows_territory_status_valid", sql`${table.territoryStatus} in ('open','ask_amy_dave','closed','licensing_issue','needs_review')`),
  check("lead_import_rows_fit_status_valid", sql`${table.fitStatus} in ('approved','needs_review','not_a_fit')`),
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
  packageAvailability: jsonb("package_availability").$type<Record<string, unknown>>().notNull(),
}, (table) => [
  unique("lead_availability_snapshots_row_version_unique").on(table.rowId, table.reviewVersion),
  index("lead_availability_snapshots_row_checked_idx").on(table.rowId, table.checkedAt.desc()),
  check("lead_availability_snapshots_window_valid", sql`${table.proposedEndDate} >= ${table.proposedStartDate}`),
  check("lead_availability_snapshots_calendar_ids_array", sql`jsonb_typeof(${table.selectedCalendarIds}) = 'array'`),
  check("lead_availability_snapshots_source_events_array", sql`jsonb_typeof(${table.sourceEvents}) = 'array'`),
  check("lead_availability_snapshots_reservations_array", sql`jsonb_typeof(${table.reservations}) = 'array'`),
  check("lead_availability_snapshots_package_availability_object", sql`jsonb_typeof(${table.packageAvailability}) = 'object'`),
]);

export const communicationBlocks = pgTable("communication_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  targetType: text("target_type").$type<"organization" | "contact" | "recipient_email" | "lead_import_row" | "internal_preview">().notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
  normalizedEmail: text("normalized_email"),
  rowId: uuid("row_id").references(() => leadImportRows.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  active: boolean("active").default(true).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  removedBy: text("removed_by"),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removalReason: text("removal_reason"),
}, (table) => [
  uniqueIndex("communication_blocks_active_target_unique")
    .on(table.targetType, sql`coalesce(${table.organizationId}::text,'')`, sql`coalesce(${table.contactId}::text,'')`, sql`coalesce(${table.normalizedEmail},'')`, sql`coalesce(${table.rowId}::text,'')`)
    .where(sql`${table.active}`),
  index("communication_blocks_active_lookup_idx").on(table.active, table.normalizedEmail, table.organizationId, table.contactId, table.rowId),
  check("communication_blocks_target_valid", sql`${table.targetType} in ('organization','contact','recipient_email','lead_import_row','internal_preview')`),
  check("communication_blocks_exact_target", sql`(
    (${table.targetType} = 'organization' and ${table.organizationId} is not null and ${table.contactId} is null and ${table.normalizedEmail} is null and ${table.rowId} is null)
    or (${table.targetType} = 'contact' and ${table.organizationId} is null and ${table.contactId} is not null and ${table.normalizedEmail} is null and ${table.rowId} is null)
    or (${table.targetType} = 'lead_import_row' and ${table.organizationId} is null and ${table.contactId} is null and ${table.normalizedEmail} is null and ${table.rowId} is not null)
    or (${table.targetType} = 'recipient_email' and ${table.organizationId} is null and ${table.contactId} is null and ${table.rowId} is null and ${table.normalizedEmail} is not null and ${table.normalizedEmail} = lower(btrim(${table.normalizedEmail})) and ${table.normalizedEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (${table.targetType} = 'internal_preview' and ${table.organizationId} is null and ${table.contactId} is null and ${table.normalizedEmail} is null and ${table.rowId} is null)
  )`),
]);

export const communicationBlockEvents = pgTable("communication_block_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  blockId: uuid("block_id").notNull().references(() => communicationBlocks.id, { onDelete: "restrict" }),
  action: text("action").$type<"created" | "removed">().notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("communication_block_events_history_idx").on(table.blockId, table.createdAt),
  check("communication_block_events_action_valid", sql`${table.action} in ('created','removed')`),
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


export const leadGmailDraftLinks = pgTable("lead_gmail_draft_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  rowId: uuid("row_id").notNull().references(() => leadImportRows.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
  googleConnectionId: uuid("google_connection_id").notNull().references(() => googleWorkspaceConnections.id, { onDelete: "restrict" }),
  communicationTemplateId: uuid("communication_template_id").notNull().references(() => communicationTemplates.id, { onDelete: "restrict" }),
  templateVersion: text("template_version").notNull(), recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(), body: text("body").notNull(), gmailDraftId: text("gmail_draft_id"),
  gmailMessageId: text("gmail_message_id"), state: text("state").$type<LeadGmailDraftState>().default("prepared").notNull(),
  lastErrorCode: text("last_error_code"), idempotencyKey: text("idempotency_key").notNull(),
  attemptCount: integer("attempt_count").default(1).notNull(), actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  unique("lead_gmail_draft_links_row_unique").on(table.rowId),
  unique("lead_gmail_draft_links_idempotency_unique").on(table.idempotencyKey),
  uniqueIndex("lead_gmail_draft_links_gmail_draft_unique").on(table.gmailDraftId).where(sql`${table.gmailDraftId} is not null`),
  uniqueIndex("lead_gmail_draft_links_gmail_message_unique").on(table.gmailMessageId).where(sql`${table.gmailMessageId} is not null`),
  index("lead_gmail_draft_links_state_updated_idx").on(table.state, table.updatedAt.desc()),
  index("lead_gmail_draft_links_organization_updated_idx").on(table.organizationId, table.updatedAt.desc()),
  check("lead_gmail_draft_links_state_valid", sql`${table.state} in ('prepared','created','retryable_error','manual_review')`),
  check("lead_gmail_draft_links_email_valid", sql`${table.recipientEmail} = lower(btrim(${table.recipientEmail})) and ${table.recipientEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`),
  check("lead_gmail_draft_links_attempt_positive", sql`${table.attemptCount} > 0`),
  check("lead_gmail_draft_links_created_complete", sql`${table.state} <> 'created' or (${table.gmailDraftId} is not null and ${table.gmailMessageId} is not null and ${table.completedAt} is not null and ${table.lastErrorCode} is null)`),
]);
