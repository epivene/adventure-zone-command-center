import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/ManagerEventWrapUpPage.tsx", "utf8");

describe("Manager event report role boundary", () => {
  it("does not expose office finance closeout tools to leg managers", () => {
    expect(source).not.toContain("EventWrapUpFinanceCheck");
    expect(source).not.toContain("EventWrapUpProfitability");
    expect(source).not.toContain("EventWrapUpSettlement");
  });

  it("does not block manager completion on actual cash", () => {
    expect(source).not.toContain("actualCashCents === null");
  });
});
