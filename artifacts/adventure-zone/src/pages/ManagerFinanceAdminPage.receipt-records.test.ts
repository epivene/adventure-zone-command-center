import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/ManagerFinanceAdminPage.tsx", "utf8");
const card = readFileSync("src/components/manager-finance/admin-expense-record.tsx", "utf8");

describe("ManagerFinanceAdminPage receipt records", () => {
  it("loads individual finance records instead of showing totals only", () => {
    expect(page).toContain("/manager-admin/finance/expenses");
    expect(page).toContain("Submitted expenses & receipts");
    expect(page).toContain("AdminExpenseRecordCard");
    expect(page).toContain("General / Unassigned");
  });

  it("shows receipt evidence, manager submission details, edits and audit history", () => {
    expect(card).toContain("View receipt & details");
    expect(card).toContain("Submitted by:");
    expect(card).toContain("Open full receipt");
    expect(card).toContain("Edit finance details");
    expect(card).toContain("Change history");
    expect(card).toContain("/manager-admin/finance/expenses/");
  });
});
