import { describe, expect, it } from "vitest";

import { latestInvoiceContractSeason } from "./invoice-contract-season";

describe("latestInvoiceContractSeason", () => {
  it("counts a linked uploaded contract in the newest invoice season", () => {
    const result = latestInvoiceContractSeason({
      invoices: [{
        invoiceNumber: "AZ-2027-PHIL-001",
        documentName: "Phillips County Fair 2027 Invoice",
        bookingStartsAt: null,
        issueDate: "2026-09-22",
        depositDueDate: "2026-10-12",
        balanceDueDate: null,
        effectiveStatus: "sent",
        remainingCents: 720000,
      }],
      contracts: [],
      contractDocuments: [
        { id: "2027-contract", effectiveDate: null, issueDate: null, displayName: "Phillips_County_Fair_2027_Contract", originalFilename: "Phillips_County_Fair_2027_Contract.pdf", links: [] },
        { id: "2026-contract", effectiveDate: null, issueDate: null, displayName: "Phillips County Fair 2026 - W", originalFilename: "phillips-2026.pdf", links: [] },
      ],
    });

    expect(result).toEqual({
      year: "2027",
      totalInvoices: 1,
      overdueCount: 0,
      outstandingCents: 720000,
      contracts: 1,
    });
  });

  it("does not double-count the same document", () => {
    const document = { id: "contract", effectiveDate: "2027-07-29", issueDate: null, displayName: "Contract", originalFilename: "contract.pdf", links: [] };
    expect(latestInvoiceContractSeason({ invoices: [], contracts: [], contractDocuments: [document, document] }).contracts).toBe(1);
  });
});
