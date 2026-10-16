import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookings } from "./schema";

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
  storageKey: text("storage_key"),
  fileName: text("file_name"),
  fileMime: text("file_mime"),
  fileSize: integer("file_size"),
  revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("agent_tax_records_year").on(table.taxYear, table.createdAt)]);

export const agentTaxFileDeletions = pgTable("agent_tax_file_deletions", {
  storageKey: text("storage_key").primaryKey(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
});
