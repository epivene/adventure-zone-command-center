import { describe, expect, it } from "vitest";

import { nextStatus, summarizeInvoice } from "./invoice-calculations";
import type { InvoiceCalculationSource, InvoicePaymentSource } from "./invoice-types";

const today = new Date("2026-09-15T12:00:00Z");

function invoice(overrides: Partial<InvoiceCalculationSource> = {}): InvoiceCalculationSource {
  return {
    status: "sent",
    totalCents: 750_000,
    depositCents: 300_000,
    depositDueDate: "2026-09-20",
    balanceDueDate: "2027-09-03",
    ...overrides,
  };
}

function payments(amountCents: number): InvoicePaymentSource[] {
  return amountCents ? [{ amountCents, voidedAt: null }] : [];
}

describe("invoice calculations", () => {
  it.each([
    { paid: 0, expected: { remainingCents: 750_000, creditCents: 0, effectiveStatus: "deposit_due" } },
    { paid: 300_000, expected: { remainingCents: 450_000, creditCents: 0, effectiveStatus: "deposit_paid" } },
    { paid: 750_000, expected: { remainingCents: 0, creditCents: 0, effectiveStatus: "paid" } },
    { paid: 760_000, expected: { remainingCents: 0, creditCents: 10_000, effectiveStatus: "paid" } },
  ])("summarizes payment total $paid", ({ paid, expected }) => {
    expect(summarizeInvoice(invoice(), payments(paid), today)).toMatchObject(expected);
  });

  it("calculates overdue without persisting an overdue status", () => {
    const result = summarizeInvoice(
      invoice({ depositCents: 0, balanceDueDate: "2026-09-14" }),
      [],
      today,
    );
    expect(result.effectiveStatus).toBe("overdue");
    expect(result.storedStatus).toBe("sent");
  });

  it("uses the deposit deadline until the deposit is paid", () => {
    expect(summarizeInvoice(invoice(), [], today).nextDueDate).toBe("2026-09-20");
    expect(summarizeInvoice(invoice(), payments(300_000), today).nextDueDate).toBe("2027-09-03");
  });

  it("ignores voided payments", () => {
    expect(summarizeInvoice(invoice(), [{ amountCents: 300_000, voidedAt: "2026-09-15" }], today).paidCents).toBe(0);
  });

  it("keeps draft and cancelled records out of overdue state", () => {
    expect(summarizeInvoice(invoice({ status: "draft", depositDueDate: "2026-09-14" }), [], today).effectiveStatus).toBe("draft");
    expect(summarizeInvoice(invoice({ status: "cancelled", depositDueDate: "2026-09-14" }), [], today).effectiveStatus).toBe("cancelled");
  });

  it("reconciles stored status after payment changes", () => {
    expect(nextStatus(invoice(), payments(300_000))).toBe("deposit_paid");
    expect(nextStatus(invoice(), payments(750_000))).toBe("paid");
    expect(nextStatus(invoice({ status: "paid" }), [])).toBe("deposit_due");
  });
});
