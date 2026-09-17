import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/manager/manager-shell.tsx", "utf8");

describe("manager shell Business Drive reconciliation", () => {
  it("preserves the newer appearance-aware shell classes", () => {
    expect(source).toContain("bg-background");
    expect(source).toContain("text-foreground");
    expect(source).toContain("border-border");
    expect(source).toContain("bg-card/95");
  });

  it("keeps checklist attachment upload routing and metadata gating", () => {
    expect(source).toContain('kind === "checklist_attachment"');
    expect(source).toContain("row.bookingId");
    expect(source).toContain("/checklist-attachments/${row.receiptId}/image");
    expect(source).toContain("/checklist-results/");
  });
});
