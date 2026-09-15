import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  bookings,
  businessDocumentLinks,
  businessDocuments,
  db,
  invoicePayments,
  invoices,
  organizations,
  type InvoicePaymentRow,
  type InvoiceRow,
  type InvoiceStatus,
  type NewInvoiceRow,
} from "@workspace/db";

import { recordAuditEntry } from "@/features/audit/audit-service";
import { nextStatus } from "./invoice-calculations";

export type InvoiceListFilters = {
  organizationId?: string;
  bookingId?: string;
  status?: InvoiceStatus;
};

export type InvoiceDetailData = {
  invoice: InvoiceRow & {
    organizationName: string;
    bookingName: string | null;
    documentName: string;
  };
  payments: InvoicePaymentRow[];
};

export type InvoiceRepositoryPort = {
  bookingOrganizationId(bookingId: string): Promise<string | null>;
  documentCategory(documentId: string): Promise<string | null>;
  findActiveNumber(organizationId: string, invoiceNumber: string, excludeId?: string): Promise<{ id: string } | null>;
  create(input: NewInvoiceRow): Promise<InvoiceDetailData>;
  detail(invoiceId: string): Promise<InvoiceDetailData | null>;
  list(filters: InvoiceListFilters): Promise<InvoiceDetailData[]>;
  update(invoiceId: string, patch: Partial<InvoiceRow>, actor: string): Promise<InvoiceDetailData | null>;
  recordPayment(invoiceId: string, input: { amountCents: number; receivedDate: string; method?: string | null; notes?: string | null }, actor: string): Promise<InvoiceDetailData | null>;
  voidPayment(invoiceId: string, paymentId: string, actor: string): Promise<InvoiceDetailData | null>;
};

export class DrizzleInvoiceRepository implements InvoiceRepositoryPort {
  constructor(private readonly database: typeof db = db) {}

  async bookingOrganizationId(bookingId: string) {
    const [row] = await this.database.select({ organizationId: bookings.organizationId })
      .from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    return row?.organizationId ?? null;
  }

  async documentCategory(documentId: string) {
    const [row] = await this.database.select({ category: businessDocuments.category })
      .from(businessDocuments).where(eq(businessDocuments.id, documentId)).limit(1);
    return row?.category ?? null;
  }

  async findActiveNumber(organizationId: string, invoiceNumber: string, excludeId?: string) {
    const conditions = [
      eq(invoices.organizationId, organizationId),
      eq(invoices.invoiceNumber, invoiceNumber),
      isNull(invoices.cancelledAt),
    ];
    if (excludeId) conditions.push(sql`${invoices.id} <> ${excludeId}`);
    const [row] = await this.database.select({ id: invoices.id }).from(invoices)
      .where(and(...conditions)).limit(1);
    return row ?? null;
  }

  async create(input: NewInvoiceRow) {
    const [created] = await this.database.transaction(async (transaction) => {
      const rows = await transaction.insert(invoices).values(input).returning();
      const invoice = rows[0];
      if (!invoice) throw new Error("INVOICE_CREATE_FAILED");
      await recordAuditEntry(transaction, {
        entityType: "invoice",
        entityId: invoice.id,
        action: "created",
        before: null,
        after: invoice,
      });
      await transaction.insert(businessDocumentLinks).values({
        documentId: invoice.documentId,
        targetKind: "profile",
        organizationId: invoice.organizationId,
        confirmationMode: "manual",
        createdBy: invoice.createdBy,
      }).onConflictDoNothing();
      if (invoice.bookingId) {
        await transaction.insert(businessDocumentLinks).values({
          documentId: invoice.documentId,
          targetKind: "booking",
          bookingId: invoice.bookingId,
          confirmationMode: "manual",
          createdBy: invoice.createdBy,
        }).onConflictDoNothing();
      }
      return rows;
    });
    const result = await this.detail(created.id);
    if (!result) throw new Error("INVOICE_CREATE_FAILED");
    return result;
  }

  async detail(invoiceId: string): Promise<InvoiceDetailData | null> {
    const [row] = await this.database.select({
      invoice: invoices,
      organizationName: organizations.name,
      bookingName: bookings.name,
      documentName: businessDocuments.displayName,
    }).from(invoices)
      .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
      .leftJoin(bookings, eq(bookings.id, invoices.bookingId))
      .innerJoin(businessDocuments, eq(businessDocuments.id, invoices.documentId))
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!row) return null;
    const payments = await this.database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId))
      .orderBy(desc(invoicePayments.receivedDate), desc(invoicePayments.createdAt));
    return {
      invoice: {
        ...row.invoice,
        organizationName: row.organizationName,
        bookingName: row.bookingName,
        documentName: row.documentName,
      },
      payments,
    };
  }

  async list(filters: InvoiceListFilters): Promise<InvoiceDetailData[]> {
    const conditions = [];
    if (filters.organizationId) conditions.push(eq(invoices.organizationId, filters.organizationId));
    if (filters.bookingId) conditions.push(eq(invoices.bookingId, filters.bookingId));
    if (filters.status) conditions.push(eq(invoices.status, filters.status));
    const rows = await this.database.select({ id: invoices.id }).from(invoices)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(invoices.updatedAt));
    return (await Promise.all(rows.map(({ id }) => this.detail(id))))
      .filter((value): value is InvoiceDetailData => value !== null);
  }

  async update(invoiceId: string, patch: Partial<InvoiceRow>, actor: string) {
    await this.database.transaction(async (transaction) => {
      const [before] = await transaction.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!before) return;
      const [after] = await transaction.update(invoices)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId)).returning();
      if (after) {
        await recordAuditEntry(transaction, {
          entityType: "invoice", entityId: invoiceId, action: "updated", before, after,
        });
      }
    });
    return this.detail(invoiceId);
  }

  async recordPayment(
    invoiceId: string,
    input: { amountCents: number; receivedDate: string; method?: string | null; notes?: string | null },
    actor: string,
  ) {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select id from invoices where id = ${invoiceId} for update`);
      const [invoice] = await transaction.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) return;
      const [payment] = await transaction.insert(invoicePayments).values({
        invoiceId, ...input, method: input.method ?? null, notes: input.notes ?? null, createdBy: actor,
      }).returning();
      const payments = await transaction.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId));
      const status = nextStatus(invoice, payments);
      await transaction.update(invoices).set({
        status,
        paidAt: status === "paid" ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(invoices.id, invoiceId));
      if (payment) {
        await recordAuditEntry(transaction, {
          entityType: "invoice_payment", entityId: payment.id, action: "created", before: null, after: payment,
        });
      }
    });
    return this.detail(invoiceId);
  }

  async voidPayment(invoiceId: string, paymentId: string, actor: string) {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select id from invoices where id = ${invoiceId} for update`);
      const [invoice] = await transaction.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) return;
      const [before] = await transaction.select().from(invoicePayments).where(and(
        eq(invoicePayments.id, paymentId),
        eq(invoicePayments.invoiceId, invoiceId),
      )).limit(1);
      if (!before || before.voidedAt) return;
      const [after] = await transaction.update(invoicePayments)
        .set({ voidedAt: new Date(), voidedBy: actor })
        .where(eq(invoicePayments.id, paymentId)).returning();
      const payments = await transaction.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId));
      const status = nextStatus(invoice, payments);
      await transaction.update(invoices).set({
        status,
        paidAt: status === "paid" ? invoice.paidAt ?? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(invoices.id, invoiceId));
      if (after) {
        await recordAuditEntry(transaction, {
          entityType: "invoice_payment", entityId: paymentId, action: "voided", before, after,
        });
      }
    });
    return this.detail(invoiceId);
  }
}
