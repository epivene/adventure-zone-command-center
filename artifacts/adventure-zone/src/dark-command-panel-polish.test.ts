import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const switcherSource = readFileSync("src/components/navigation/workspace-switcher.tsx", "utf8");
const commandSource = readFileSync("src/pages/AdminCommandPanelPage.tsx", "utf8");

describe("dark command panel polish", () => {
  it("uses the existing bounce-house favicon in the workspace identity", () => {
    expect(switcherSource).toContain('src="/favicon.svg"');
    expect(switcherSource).not.toContain("<Tent");
  });

  it("uses theme-aware surfaces for Admin Tools", () => {
    expect(commandSource).toContain('bg-card');
    expect(commandSource).toContain('text-card-foreground');
    expect(commandSource).toContain('border-border');
    expect(commandSource).toContain('text-muted-foreground');
  });
});
