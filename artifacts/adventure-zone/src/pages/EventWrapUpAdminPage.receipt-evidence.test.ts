import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/EventWrapUpAdminPage.tsx", "utf8");

describe("EventWrapUpAdminPage finance evidence", () => {
  it("shows event-linked expenses and receipts directly in the wrap-up", () => {
    expect(source).toContain("Expenses & receipts");
    expect(source).toContain("/manager-admin/finance/expenses?bookingId=");
    expect(source).toContain("AdminExpenseRecordCard");
    expect(source).toContain("Refresh receipts");
  });

  it("loads receipt evidence independently so one failure does not blank the wrap-up", () => {
    expect(source).toContain("financeError");
    expect(source).toContain("Retry receipts");
    expect(source).toContain("loadFinanceEvidence");
  });
});
