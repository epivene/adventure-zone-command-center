import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const page = readFileSync("src/pages/ManagerFinanceAdminPage.tsx", "utf8");
const card = readFileSync("src/components/manager-finance/admin-expense-record.tsx", "utf8");
describe("Finance receipt records", () => {
  it("loads individual submissions and keeps General / Unassigned visible", () => {
    expect(page).toContain("/manager-admin/finance/expenses");
    expect(page).toContain("Submitted expenses & receipts");
    expect(page).toContain("General / Unassigned");
  });
  it("shows photos, entered details, corrections and history", () => {
    expect(card).toContain("View receipt & details");
    expect(card).toContain("Submitted by:");
    expect(card).toContain("Open full receipt");
    expect(card).toContain("Edit finance details");
    expect(card).toContain("Change history");
  });
});
