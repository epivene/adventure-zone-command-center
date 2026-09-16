import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { businessDocuments } from "./business-document-schema";
import { bookings, organizations } from "./schema";

export const invoiceStatusValues = [
  "draft",
  "sent",
  "deposit_due",
  "deposit_paid",
  "paid",
  "cancelled",
] as const;

export type InvoiceStatus = (typeof invoiceStatusValues)[number];

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    documentId: uuid("document_id").notNull().references(() => businessDocuments.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").$type<InvoiceStatus>().default("draft").notNull(),
    currency: text("currency").default("USD").notNull(),
    totalCents: integer("total_cents").notNull(),
    depositCents: integer("deposit_cents").default(0).notNull(),
    issueDate: date("issue_date").notNull(),
    depositDueDate: date("deposit_due_date"),
    balanceDueDate: date("balance_due_date"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("invoices_profile_number_active_unique")
      .on(table.organizationId, table.invoiceNumber)
      .where(sql`${table.cancelledAt} is null`),
    index("invoices_organization_updated_idx").on(table.organizationId, table.updatedAt),
    index("invoices_booking_updated_idx").on(table.bookingId, table.updatedAt),
    index("invoices_status_due_idx").on(table.status, table.balanceDueDate),
    check("invoices_status_valid", sql`${table.status} in ('draft','sent','deposit_due','deposit_paid','paid','cancelled')`),
    check("invoices_amounts_valid", sql`${table.totalCents} >= 0 and ${table.depositCents} >= 0 and ${table.depositCents} <= ${table.totalCents}`),
    check("invoices_currency_usd", sql`${table.currency} = 'USD'`),
    check("invoices_cancelled_consistent", sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)`),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    receivedDate: date("received_date").notNull(),
    method: text("method"),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by"),
  },
  (table) => [
    index("invoice_payments_invoice_received_idx").on(table.invoiceId, table.receivedDate),
    check("invoice_payments_amount_positive", sql`${table.amountCents} > 0`),
    check("invoice_payments_void_consistent", sql`(${table.voidedAt} is null) = (${table.voidedBy} is null)`),
  ],
);

export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoiceRow = typeof invoices.$inferInsert;
export type InvoicePaymentRow = typeof invoicePayments.$inferSelect;
export type NewInvoicePaymentRow = typeof invoicePayments.$inferInsert;
