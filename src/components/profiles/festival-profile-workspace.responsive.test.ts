import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/festival-profile-workspace.tsx", "utf8");

describe("festival profile mobile presentation", () => {
  it("surfaces next action before annual detail on mobile while preserving desktop column order", () => {
    expect(source).toContain('className="order-last grid min-w-0 gap-4 lg:order-first"');
    expect(source).toContain('className="order-first grid min-w-0 content-start gap-4 lg:order-last"');
    expect(source).toContain('className="min-h-11 w-full sm:min-h-9 sm:w-fit"');
    expect(source).toContain("break-words text-3xl font-bold tracking-tight");
  });
});
