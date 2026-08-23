import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/office/office-shell.tsx", "utf8");

describe("Office Coordinator responsive shell", () => {
  it("keeps the full labeled top navigation off tablet widths", () => {
    expect(source).toContain('hidden xl:block');
    expect(source).not.toContain('hidden md:block');
  });

  it("keeps bottom navigation available until the wide desktop breakpoint", () => {
    expect(source).toContain('xl:hidden');
    expect(source).not.toContain('md:hidden');
  });

  it("keeps Sign out compact in the header", () => {
    expect(source).toContain('button-secondary hidden shrink-0 px-2.5 py-1.5 text-xs sm:inline-flex');
  });
});
