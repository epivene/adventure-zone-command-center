import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/manager/receipt-expense-form.tsx", "utf8");

describe("receipt photo selection", () => {
  it("offers separate camera and gallery choices that use the same receipt handler", () => {
    expect(source).toContain("Take photo");
    expect(source).toContain("Choose from gallery");
    expect(source).toContain('capture="environment"');
    expect(source).toContain('aria-label="Choose receipt from gallery"');
    expect(source).toContain("onChange={chooseReceipt}");
  });
});
