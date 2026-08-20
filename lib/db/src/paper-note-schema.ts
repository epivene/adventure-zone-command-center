import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  activities,
  contactPhoneTypeEnum,
  organizationLocations,
  organizations,
} from "./schema";

export const paperNoteBatchStatusValues = [
  "draft",
  "queued",
  "extracting",
  "review",
  "importing",
  "imported",
  "failed",
  "archived",
] as const;

export const paperNotePageStatusValues = [
  "uploading",
  "uploaded",
  "queued",
  "extracting",
  "extracted",
  "needs_retry",
  "reviewed_empty",
] as const;

export const paperNotePageStageValues = [
  "prepare",
  "segment",
  "extract_entries",
  "complete",
] as const;

export const paperNoteEntryStateValues = [
  "needs_review",
  "ready",
  "approved",
  "skipped",
  "imported",
] as const;

export const paperNoteDestinationModeValues = [
  "existing_profile",
  "existing_profile_new_location",
  "new_profile",
  "skip",
] as const;

export const phoneStatusValues = ["active", "questionable", "inactive"] as const;
export const phoneStatusEnum = pgEnum("phone_status", phoneStatusValues);

export type PaperNoteBatchStatus = (typeof paperNoteBatchStatusValues)[number];
export type PaperNotePageStatus = (typeof paperNotePageStatusValues)[number];
export type PaperNotePageStage = (typeof paperNotePageStageValues)[number];
export type PaperNoteEntryState = (typeof paperNoteEntryStateValues)[number];
export type PaperNoteDestinationMode = (typeof paperNoteDestinationModeValues)[number];
export type PhoneStatus = (typeof phoneStatusValues)[number];

function sqlTextValues(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "));
}

export const paperNoteBatches = pgTable("paper_note_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  status: text("status").$type<PaperNoteBatchStatus>().default("draft").notNull(),
  createdBy: text("created_by").default("owner").notNull(),
  pageCount: integer("page_count").default(0).notNull(),
  importRequestKey: uuid("import_request_key").unique(),
  importSummary: jsonb("import_summary").$type<Record<string, unknown> | null>(),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  extractionStartedAt: timestamp("extraction_started_at", { withTimezone: true }),
  reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
  importStartedAt: timestamp("import_started_at", { withTimezone: true }),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("paper_note_batches_status_valid", sql`${table.status} in (${sqlTextValues(paperNoteBatchStatusValues)})`),
  check("paper_note_batches_page_count_nonnegative", sql`${table.pageCount} >= 0`),
  index("paper_note_batches_status_updated_idx").on(table.status, table.updatedAt.desc()),
]);

export const paperNotePages = pgTable("paper_note_pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id").notNull().references(() => paperNoteBatches.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").default(0).notNull(),
  width: integer("width"),
  height: integer("height"),
  rotationDegrees: integer("rotation_degrees").default(0).notNull(),
  originalObjectKey: text("original_object_key").notNull(),
  analysisObjectKey: text("analysis_object_key"),
  sha256: text("sha256"),
  status: text("status").$type<PaperNotePageStatus>().default("uploading").notNull(),
  currentStage: text("current_stage").$type<PaperNotePageStage | null>(),
  pageHeading: text("page_heading"),
  pageActivityDate: date("page_activity_date"),
  pageContext: jsonb("page_context").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  roughTranscription: text("rough_transcription"),
  attemptCount: integer("attempt_count").default(0).notNull(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("paper_note_pages_batch_sort_unique").on(table.batchId, table.sortOrder),
  uniqueIndex("paper_note_pages_batch_sha256_unique").on(table.batchId, table.sha256).where(sql`${table.sha256} is not null`),
  index("paper_note_pages_work_queue_idx").on(table.status, table.leaseExpiresAt, table.createdAt),
  check("paper_note_pages_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  check("paper_note_pages_size_valid", sql`${table.sizeBytes} >= 0 and ${table.sizeBytes} <= 12582912`),
  check("paper_note_pages_rotation_valid", sql`${table.rotationDegrees} in (0, 90, 180, 270)`),
  check("paper_note_pages_status_valid", sql`${table.status} in (${sqlTextValues(paperNotePageStatusValues)})`),
]);

export const paperNoteEntries = pgTable("paper_note_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id").notNull().references(() => paperNoteBatches.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull().references(() => paperNotePages.id, { onDelete: "cascade" }),
  sourceOrder: integer("source_order").notNull(),
  sourceRegion: jsonb("source_region").$type<Record<string, unknown> | null>(),
  extractionPayload: jsonb("extraction_payload").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  reviewPayload: jsonb("review_payload").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  reviewVersion: integer("review_version").default(0).notNull(),
  state: text("state").$type<PaperNoteEntryState>().default("needs_review").notNull(),
  destinationMode: text("destination_mode").$type<PaperNoteDestinationMode | null>(),
  selectedOrganizationId: uuid("selected_organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  selectedOrganizationLocationId: uuid("selected_organization_location_id").references(() => organizationLocations.id, { onDelete: "restrict" }),
  targetSnapshot: jsonb("target_snapshot").$type<Record<string, unknown> | null>(),
  validationIssues: jsonb("validation_issues").$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  importedOrganizationId: uuid("imported_organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  importedOrganizationLocationId: uuid("imported_organization_location_id").references(() => organizationLocations.id, { onDelete: "restrict" }),
  importedActivityId: uuid("imported_activity_id").references(() => activities.id, { onDelete: "set null" }),
  importResult: jsonb("import_result").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("paper_note_entries_page_source_order_unique").on(table.pageId, table.sourceOrder),
  index("paper_note_entries_batch_state_idx").on(table.batchId, table.state, table.sourceOrder),
  check("paper_note_entries_source_order_nonnegative", sql`${table.sourceOrder} >= 0`),
  check("paper_note_entries_review_version_nonnegative", sql`${table.reviewVersion} >= 0`),
  check("paper_note_entries_state_valid", sql`${table.state} in (${sqlTextValues(paperNoteEntryStateValues)})`),
]);

export const organizationPhones = pgTable("organization_phones", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  normalizedNumber: text("normalized_number"),
  type: contactPhoneTypeEnum("type").default("unknown").notNull(),
  extension: text("extension"),
  normalizedExtension: text("normalized_extension"),
  label: text("label"),
  instructions: text("instructions"),
  status: phoneStatusEnum("status").default("active").notNull(),
  primary: boolean("primary").default(false).notNull(),
  source: text("source").default("local").notNull(),
  sourcePaperNoteEntryId: uuid("source_paper_note_entry_id").references(() => paperNoteEntries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("organization_phones_normalized_number_idx").on(table.normalizedNumber),
  index("organization_phones_source_paper_note_entry_idx").on(table.sourcePaperNoteEntryId),
  check("organization_phones_number_nonblank", sql`btrim(${table.number}) <> ''`),
  check("organization_phones_source_valid", sql`${table.source} in ('local', 'legacy_backfill', 'paper_note')`),
]);
