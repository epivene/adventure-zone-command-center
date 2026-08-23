import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("canonical navigation links", () => {
  it("does not expose standalone Quick Add", () => {
    expect(source).not.toContain('href="/quick-add"');
    expect(source).not.toContain('href: "/quick-add"');
  });

  it("keeps caller creation as a shortcut into Calls add mode", () => {
    expect(source).toContain('<Link href="/calls/workspace?mode=add">New caller</Link>');
  });
});
