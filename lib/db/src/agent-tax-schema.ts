import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bookings } from "./schema";

export const agentPayItems = pgTable("agent_pay_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  earnedDate: date("earned_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  amountCents: integer("amount_cents").notNull(),
  notes: text("notes"),
  revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("agent_pay_week_unique").on(t.earnedDate).where(sql`${t.kind} = 'weekly'`),
  check("agent_pay_kind_check", sql`${t.kind} IN ('weekly','manual')`),
  check("agent_pay_amount_check", sql`${t.amountCents} BETWEEN 1 AND 1000000000`),
]);

export const agentTaxRecords = pgTable("agent_tax_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  entryType: text("entry_type").notNull(),
  amountCents: integer("amount_cents"),
  recordDate: date("record_date", { mode: "string" }),
  taxYear: integer("tax_year").notNull(),
  category: text("category").notNull(),
  paymentMethod: text("payment_method").notNull(),
  counterparty: text("counterparty"),
  notes: text("notes"),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  payItemId: uuid("pay_item_id").references(() => agentPayItems.id, { onDelete: "restrict" }),
  paymentRequestId: uuid("payment_request_id"),
  storageKey: text("storage_key"),
  fileName: text("file_name"),
  fileMime: text("file_mime"),
  fileSize: integer("file_size"),
  revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  index("agent_tax_records_year").on(t.taxYear, t.createdAt.desc()),
  index("agent_tax_pay_item").on(t.payItemId),
  uniqueIndex("agent_tax_payment_request_unique").on(t.paymentRequestId).where(sql`${t.paymentRequestId} IS NOT NULL`),
  check("agent_tax_entry_type_check", sql`${t.entryType} IN ('income','expense','document')`),
  check("agent_tax_amount_check", sql`${t.amountCents} BETWEEN 0 AND 1000000000`),
  check("agent_tax_year_check", sql`${t.taxYear} BETWEEN 1900 AND 2200`),
  check("agent_tax_category_check", sql`${t.category} IN ('commission','travel','supplies','fees','tax_form','other')`),
  check("agent_tax_method_check", sql`${t.paymentMethod} IN ('venmo','cash','bank','check','card','other')`),
  check("agent_tax_money_date_check", sql`${t.entryType} = 'document' OR (${t.amountCents} IS NOT NULL AND ${t.recordDate} IS NOT NULL)`),
  check("agent_tax_date_year_check", sql`${t.recordDate} IS NULL OR EXTRACT(YEAR FROM ${t.recordDate}) = ${t.taxYear}`),
  check("agent_tax_attachment_check", sql`(${t.storageKey} IS NULL AND ${t.fileName} IS NULL AND ${t.fileMime} IS NULL AND ${t.fileSize} IS NULL) OR (${t.storageKey} IS NOT NULL AND ${t.fileName} IS NOT NULL AND ${t.fileMime} IS NOT NULL AND ${t.fileSize} > 0)`),
]);

export const agentTaxFileDeletions = pgTable("agent_tax_file_deletions", {
  storageKey: text("storage_key").primaryKey(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentTaxEstimateSettings = pgTable("agent_tax_estimate_settings", {
  taxYear: integer("tax_year").primaryKey(),
  settings: jsonb("settings").notNull(),
  revision: integer("revision").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [check("agent_tax_estimate_year_check", sql`${t.taxYear} IN (2025,2026)`)]);
