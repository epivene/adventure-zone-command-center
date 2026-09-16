import type { InvoiceStatus } from "@workspace/db/invoice-schema";

export type InvoiceEffectiveStatus = InvoiceStatus | "overdue";

export type InvoiceCalculationSource = {
  status: InvoiceStatus;
  totalCents: number;
  depositCents: number;
  depositDueDate: string | null;
  balanceDueDate: string | null;
};

export type InvoicePaymentSource = {
  amountCents: number;
  voidedAt: Date | string | null;
};

export type InvoiceSummary = {
  storedStatus: InvoiceStatus;
  effectiveStatus: InvoiceEffectiveStatus;
  paidCents: number;
  remainingCents: number;
  creditCents: number;
  nextDueDate: string | null;
};
