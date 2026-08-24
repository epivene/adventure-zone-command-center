import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/workspace-switcher.tsx", "utf8");

describe("workspace switcher menu", () => {
  it("uses a compact icon-backed workspace picker without a redundant heading", () => {
    expect(source).not.toContain(">Workspaces<");
    expect(source).toContain("House");
    expect(source).toContain("LayoutGrid");
    expect(source).toContain("Megaphone");
    expect(source).toContain("MapPinned");
    expect(source).toContain("Settings2");
  });

  it("visually marks the current workspace", () => {
    expect(source).toContain("Check");
    expect(source).toContain("workspace === item.workspace");
    expect(source).toContain("bg-orange-50");
  });

  it("keeps Admin Tools as a separated footer action", () => {
    expect(source).toContain("DropdownMenuSeparator");
    expect(source).toContain('href="/settings"');
  });
});
