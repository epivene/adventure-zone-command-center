import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/call-workspace-flow.css", "utf8");

describe("Today call queue laptop layout", () => {
  it("stacks the embedded queue and workspace at laptop widths", () => {
    expect(css).toContain("@media (min-width: 1024px) and (max-width: 1535px)");
    expect(css).toContain('[data-testid="call-queue-layout"]');
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) !important");
  });

  it("keeps the selected workspace above the queue while stacked", () => {
    expect(css).toContain('[data-testid="selected-call-workspace"]');
    expect(css).toContain('[data-testid="call-queue-panel"]');
    expect(css).toContain("order: 1 !important");
    expect(css).toContain("order: 2 !important");
  });
});
