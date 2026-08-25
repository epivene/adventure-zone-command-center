import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const leadImportBatchStatusValues = ["review", "archived"] as const;
export const leadImportRowStateValues = [
  "needs_review",
  "needs_correction",
  "verified",
  "skipped",
] as const;

export type LeadImportBatchStatus = (typeof leadImportBatchStatusValues)[number];
export type LeadImportRowState = (typeof leadImportRowStateValues)[number];

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("lead_import_rows_source_position_unique").on(table.batchId, table.sheetName, table.sourceRowNumber),
  uniqueIndex("lead_import_rows_fingerprint_unique").on(table.batchId, table.sourceFingerprint),
  index("lead_import_rows_batch_state_idx").on(table.batchId, table.state, table.sourceRowNumber),
  check("lead_import_rows_sheet_name_nonblank", sql`btrim(${table.sheetName}) <> ''`),
  check("lead_import_rows_source_row_positive", sql`${table.sourceRowNumber} > 0`),
  check("lead_import_rows_fingerprint_valid", sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`),
  check("lead_import_rows_state_valid", sql`${table.state} in ('needs_review','needs_correction','verified','skipped')`),
]);
