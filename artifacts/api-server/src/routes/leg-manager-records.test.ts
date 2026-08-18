import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/leg-manager-records.ts", "utf8");
const routes = readFileSync("src/routes/index.ts", "utf8");

describe("manager saved record routes", () => {
  it("uses authenticated leg scope for money and incident changes", () => {
    expect(source).toContain("req.legManager!.legId");
    expect(source).not.toContain("req.body.legId");
    expect(source).toContain('router.patch("/manager/expenses/:expenseId"');
    expect(source).toContain('router.delete("/manager/expenses/:expenseId"');
    expect(source).toContain('router.delete("/manager/receipts/:receiptId"');
    expect(source).toContain('router.patch("/manager/incidents/:incidentId"');
    expect(source).toContain('router.delete("/manager/incidents/:incidentId"');
  });

  it("returns signed receipt image URLs and cleans stored images on delete", () => {
    expect(source).toContain("getSignedReadUrl");
    expect(source).toContain("deleteExpenseReceiptObjects");
    expect(source).toContain("deleteReceipt");
  });

  it("is mounted before owner-only routes", () => {
    expect(routes).toContain('import managerRecordsRouter from "./leg-manager-records"');
    expect(routes.indexOf("router.use(managerRecordsRouter)")).toBeLessThan(routes.indexOf("router.use(requireOwnerMiddleware)"));
  });
});
