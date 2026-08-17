import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/ManagerHomePage.tsx", "utf8");

describe("Manager Home money API", () => {
  it("loads the authenticated manager money summary instead of the page URL", () => {
    expect(source).toContain('managerApi<MoneySummary>("/manager/money/summary")');
    expect(source).not.toContain('managerApi<any>("/manager/money")');
    expect(source).toContain("cashPosition?.cashOnHandCents");
    expect(source).toContain("expenseTotalCents");
  });
});
