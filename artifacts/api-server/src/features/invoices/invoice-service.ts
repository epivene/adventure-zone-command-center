import { z } from "zod";
import { invoiceStatusValues, type InvoiceStatus } from "@workspace/db/invoice-schema";

import { summarizeInvoice } from "./invoice-calculations";
import type { InvoiceDetailData, InvoiceListFilters, InvoiceRepositoryPort } from "./invoice-repository";

const nullableDate = z.string().date().nullable().optional();
const invoiceFieldsSchema = z.object({
  organizationId: z.string().uuid(),
  bookingId: z.string().uuid().nullable().optional(),
  documentId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(100),
  status: z.enum(invoiceStatusValues).default("draft"),
  totalCents: z.number().int().min(0),
  depositCents: z.number().int().min(0).default(0),
  issueDate: z.string().date(),
  depositDueDate: nullableDate,
  balanceDueDate: nullableDate,
  notes: z.string().trim().max(5000).nullable().optional(),
});

export const createInvoiceSchema = invoiceFieldsSchema.superRefine((value, context) => {
  if (value.depositCents > value.totalCents) {
    context.addIssue({ code: "custom", path: ["depositCents"], message: "Deposit cannot exceed invoice total." });
  }
});

export const updateInvoiceSchema = invoiceFieldsSchema.omit({
  organizationId: true,
  documentId: true,
}).partial().superRefine((value, context) => {
  if (Object.keys(value).length === 0) {
    context.addIssue({ code: "custom", message: "Provide at least one change." });
  }
  if (
    value.totalCents !== undefined
    && value.depositCents !== undefined
    && value.depositCents > value.totalCents
  ) {
    context.addIssue({ code: "custom", path: ["depositCents"], message: "Deposit cannot exceed invoice total." });
  }
});

export const paymentSchema = z.object({
  amountCents: z.number().int().positive(),
  receivedDate: z.string().date(),
  method: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export class InvoiceServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly fields?: Record<string, string>) {
    super(message);
  }
}

function present(data: InvoiceDetailData, today: Date) {
  const summary = summarizeInvoice(data.invoice, data.payments, today);
  return { ...data.invoice, ...summary, payments: data.payments };
}

export class InvoiceService {
  constructor(private readonly repository: InvoiceRepositoryPort) {}

  async list(filters: InvoiceListFilters, today = new Date()) {
    return Promise.all((await this.repository.list(filters)).map((row) => present(row, today)));
  }

  async detail(invoiceId: string, today = new Date()) {
    const row = await this.repository.detail(invoiceId);
    if (!row) throw new InvoiceServiceError("INVOICE_NOT_FOUND", "Invoice not found.");
    return present(row, today);
  }

  async create(raw: unknown, actor: string, today = new Date()) {
    const parsed = createInvoiceSchema.safeParse(raw);
    if (!parsed.success) throw new InvoiceServiceError("INVOICE_INVALID", "Check the invoice fields.");
    const input = parsed.data;
    if (input.bookingId && await this.repository.bookingOrganizationId(input.bookingId) !== input.organizationId) {
      throw new InvoiceServiceError("INVOICE_BOOKING_PROFILE_MISMATCH", "The booking does not belong to the selected profile.");
    }
    if (await this.repository.documentCategory(input.documentId) !== "invoice") {
      throw new InvoiceServiceError("INVOICE_DOCUMENT_INVALID", "Choose an invoice document.");
    }
    if (await this.repository.findActiveNumber(input.organizationId, input.invoiceNumber)) {
      throw new InvoiceServiceError("INVOICE_NUMBER_EXISTS", "That invoice number is already active for this profile.");
    }
    const cancelled = input.status === "cancelled";
    const row = await this.repository.create({
      ...input,
      bookingId: input.bookingId ?? null,
      depositDueDate: input.depositDueDate ?? null,
      balanceDueDate: input.balanceDueDate ?? null,
      notes: input.notes ?? null,
      currency: "USD",
      createdBy: actor,
      cancelledAt: cancelled ? today : null,
      sentAt: input.status === "draft" || cancelled ? null : today,
      paidAt: null,
    });
    return present(row, today);
  }

  async update(invoiceId: string, raw: unknown, actor: string, today = new Date()) {
    const parsed = updateInvoiceSchema.safeParse(raw);
    if (!parsed.success) throw new InvoiceServiceError("INVOICE_INVALID", "Check the invoice fields.");
    const current = await this.repository.detail(invoiceId);
    if (!current) throw new InvoiceServiceError("INVOICE_NOT_FOUND", "Invoice not found.");
    if (parsed.data.bookingId && await this.repository.bookingOrganizationId(parsed.data.bookingId) !== current.invoice.organizationId) {
      throw new InvoiceServiceError("INVOICE_BOOKING_PROFILE_MISMATCH", "The booking does not belong to the selected profile.");
    }
    if (parsed.data.invoiceNumber && await this.repository.findActiveNumber(current.invoice.organizationId, parsed.data.invoiceNumber, invoiceId)) {
      throw new InvoiceServiceError("INVOICE_NUMBER_EXISTS", "That invoice number is already active for this profile.");
    }
    const status = parsed.data.status as InvoiceStatus | undefined;
    const row = await this.repository.update(invoiceId, {
      ...parsed.data,
      ...(status === "cancelled" ? { cancelledAt: today } : status ? { cancelledAt: null } : {}),
    }, actor);
    if (!row) throw new InvoiceServiceError("INVOICE_NOT_FOUND", "Invoice not found.");
    return present(row, today);
  }

  async recordPayment(invoiceId: string, raw: unknown, actor: string, today = new Date()) {
    const parsed = paymentSchema.safeParse(raw);
    if (!parsed.success) throw new InvoiceServiceError("INVOICE_PAYMENT_INVALID", "Check the payment fields.");
    const row = await this.repository.recordPayment(invoiceId, parsed.data, actor);
    if (!row) throw new InvoiceServiceError("INVOICE_NOT_FOUND", "Invoice not found.");
    return present(row, today);
  }

  async voidPayment(invoiceId: string, paymentId: string, actor: string, today = new Date()) {
    const row = await this.repository.voidPayment(invoiceId, paymentId, actor);
    if (!row) throw new InvoiceServiceError("INVOICE_NOT_FOUND", "Invoice or payment not found.");
    return present(row, today);
  }

  async summary(filters: InvoiceListFilters, today = new Date()) {
    const records = await this.list(filters, today);
    return {
      totalInvoices: records.length,
      overdueCount: records.filter((row) => row.effectiveStatus === "overdue").length,
      overdueCents: records.filter((row) => row.effectiveStatus === "overdue").reduce((sum, row) => sum + row.remainingCents, 0),
      depositDueCount: records.filter((row) => row.effectiveStatus === "deposit_due").length,
      outstandingCents: records.reduce((sum, row) => sum + row.remainingCents, 0),
    };
  }
}
