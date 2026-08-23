import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/today/call-queue-workspace.tsx", "utf8");

describe("Today call queue laptop layout", () => {
  it("keeps the embedded call workspace stacked at normal laptop widths", () => {
    expect(source).toContain("2xl:grid-cols-[minmax(17rem,.72fr)_minmax(0,1.28fr)]");
    expect(source).toContain("2xl:items-start");
    expect(source).not.toContain("lg:grid-cols-[minmax(17rem,.72fr)_minmax(0,1.28fr)]");
  });

  it("only swaps queue/workspace ordering on very wide screens", () => {
    expect(source).toContain("2xl:order-1");
    expect(source).toContain("2xl:order-2");
  });
});
