import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const route = readFileSync("src/routes/manager-finance-admin.ts", "utf8");
const repo = readFileSync("src/features/leg-manager/admin-finance-repository.ts", "utf8");

describe("manager finance admin routes", () => {
  it("exposes list, detail and correction endpoints", () => {
    expect(route).toContain('router.get("/manager-admin/finance/expenses"');
    expect(route).toContain('router.get("/manager-admin/finance/expenses/:expenseId"');
    expect(route).toContain('router.patch("/manager-admin/finance/expenses/:expenseId"');
    expect(route).toContain("enrichAdminExpenseRecord");
  });
  it("updates one source expense and appends audit history", () => {
    expect(repo).toContain("UPDATE leg_expenses SET");
    expect(repo).toContain("INSERT INTO leg_finance_audit");
    expect(repo).toContain("assignment_source='admin'");
  });
});
