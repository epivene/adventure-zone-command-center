import type { InvoiceStatus } from "@workspace/db/invoice-schema";

import type {
  InvoiceCalculationSource,
  InvoicePaymentSource,
  InvoiceSummary,
} from "./invoice-types";

function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function paymentStatus(
  invoice: InvoiceCalculationSource,
  paidCents: number,
): InvoiceStatus {
  if (invoice.status === "cancelled" || invoice.status === "draft") return invoice.status;
  if (paidCents >= invoice.totalCents) return "paid";
  if (invoice.depositCents > 0 && paidCents < invoice.depositCents) return "deposit_due";
  if (paidCents > 0 || invoice.depositCents > 0) return "deposit_paid";
  return "sent";
}

function dueDate(
  invoice: InvoiceCalculationSource,
  paidCents: number,
  status: InvoiceStatus,
): string | null {
  if (status === "draft" || status === "cancelled" || status === "paid") return null;
  if (
    invoice.depositCents > 0
    && paidCents < invoice.depositCents
    && invoice.depositDueDate
  ) {
    return invoice.depositDueDate;
  }
  return invoice.balanceDueDate;
}

export function summarizeInvoice(
  invoice: InvoiceCalculationSource,
  payments: InvoicePaymentSource[],
  today: Date,
): InvoiceSummary {
  const paidCents = payments.reduce(
    (sum, payment) => payment.voidedAt ? sum : sum + payment.amountCents,
    0,
  );
  const remainingCents = Math.max(invoice.totalCents - paidCents, 0);
  const creditCents = Math.max(paidCents - invoice.totalCents, 0);
  const reconciledStatus = paymentStatus(invoice, paidCents);
  const nextDueDate = dueDate(invoice, paidCents, reconciledStatus);
  const effectiveStatus = (
    remainingCents > 0
    && nextDueDate !== null
    && nextDueDate < calendarDate(today)
    && reconciledStatus !== "draft"
    && reconciledStatus !== "cancelled"
  ) ? "overdue" : reconciledStatus;

  return {
    storedStatus: invoice.status,
    effectiveStatus,
    paidCents,
    remainingCents,
    creditCents,
    nextDueDate,
  };
}

export function nextStatus(
  invoice: InvoiceCalculationSource,
  payments: InvoicePaymentSource[],
  requestedStatus?: InvoiceStatus,
): InvoiceStatus {
  if (requestedStatus === "cancelled" || requestedStatus === "draft") return requestedStatus;
  if (invoice.status === "cancelled" && requestedStatus === undefined) return "cancelled";
  const calculationSource = requestedStatus
    ? { ...invoice, status: requestedStatus }
    : { ...invoice, status: invoice.status === "draft" ? "sent" as const : invoice.status };
  const paidCents = payments.reduce(
    (sum, payment) => payment.voidedAt ? sum : sum + payment.amountCents,
    0,
  );
  return paymentStatus(calculationSource, paidCents);
}
