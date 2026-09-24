import { it, expect } from "vitest";
import * as evidence from "./commercial-evidence";
const invoice = (
  id: string,
  year: number | null,
  status: import("@workspace/db/invoice-schema").InvoiceStatus = "sent",
) => ({
  id,
  eventYear: year,
  status,
  totalCents: 765000,
  depositCents: 382500,
  depositDueDate: "2026-10-01",
  balanceDueDate: "2027-07-23",
  payments: [],
});
it("counts only current-year issued invoices and actual non-voided payments", () => {
  expect(evidence.summarizeCommercialRecords).toBeTypeOf("function");
  const result = evidence.summarizeCommercialRecords(
    {
      eventYear: 2027,
      invoices: [
        {
          ...invoice("current", 2027),
          payments: [
            { amountCents: 100000, voidedAt: null },
            { amountCents: 282500, voidedAt: "2026-09-24" },
          ],
        },
        invoice("old", 2026),
        invoice("unknown", null),
        invoice("draft", 2027, "draft"),
        invoice("cancelled", 2027, "cancelled"),
      ],
      contracts: [],
    },
    new Date("2026-09-24"),
  );
  expect(result.totals).toEqual({
    outstandingCents: 665000,
    depositRemainingCents: 282500,
    recordedPaidCents: 100000,
  });
  expect(result.unclassified.invoices.map((i: any) => i.id)).toEqual([
    "unknown",
  ]);
  expect(result.historicalCount).toBe(1);
});
it("does not infer execution from an uploaded or printed signature, or payment from an invoice", () => {
  const result = evidence.summarizeCommercialRecords(
    {
      eventYear: 2027,
      invoices: [invoice("invoice", 2027)],
      contracts: [
        {
          id: "unsigned",
          eventYear: 2027,
          status: "sent_for_signature",
          files: [{ kind: "signed", confirmedAt: null }],
        },
        { id: "old-version", eventYear: 2027, status: "superseded", files: [] },
      ],
    },
    new Date("2026-09-24"),
  );
  expect(result.totals.recordedPaidCents).toBe(0);
  expect(result.contracts[0].execution).toBe("unconfirmed");
  expect(result.contracts[1].execution).toBe("historical");
});
it("keeps real nonvoided receipts in cash totals when the invoice is cancelled", () => {
  const result = evidence.summarizeCommercialRecords(
    {
      eventYear: 2027,
      invoices: [
        {
          ...invoice("cancelled", 2027, "cancelled"),
          payments: [{ amountCents: 100000, voidedAt: null }],
        },
      ],
      contracts: [],
    },
    new Date("2026-09-24"),
  );
  expect(result.totals).toEqual({
    outstandingCents: 0,
    depositRemainingCents: 0,
    recordedPaidCents: 100000,
  });
});
