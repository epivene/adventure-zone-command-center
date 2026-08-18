import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync("src/pages/EventWrapUpAdminPage.tsx", "utf8");
describe("Event Wrap-up receipt evidence", () => {
  it("shows event-linked manager expenses and receipt evidence directly", () => {
    expect(source).toContain("Expenses & receipts");
    expect(source).toContain("/manager-admin/finance/expenses?bookingId=");
    expect(source).toContain("AdminExpenseRecordCard");
  });
  it("isolates receipt loading failures from the wrap-up", () => {
    expect(source).toContain("financeError");
    expect(source).toContain("Retry receipts");
    expect(source).toContain("loadFinanceEvidence");
  });
});
