import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/routes/leg-manager-admin.ts", "utf8");
const repo = readFileSync("src/features/leg-manager/finance-repository.ts", "utf8");

describe("admin finance record API", () => {
  it("exposes list, detail and update expense routes", () => {
    expect(route).toContain('router.get("/manager-admin/finance/expenses"');
    expect(route).toContain('router.get("/manager-admin/finance/expenses/:expenseId"');
    expect(route).toContain('router.patch("/manager-admin/finance/expenses/:expenseId"');
    expect(route).toContain("enrichAdminExpenseRecord");
  });

  it("updates the source expense and records audit history instead of copying it", () => {
    expect(repo).toContain("UPDATE leg_expenses SET");
    expect(repo).toContain("INSERT INTO leg_finance_audit");
    expect(repo).toContain("assignment_source = 'admin'");
    expect(repo).not.toContain("INSERT INTO leg_expenses (record_type");
  });
});
