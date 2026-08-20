import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const menu = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("Call Scripts settings navigation", () => {
  it("registers the owner settings route", () => {
    expect(app).toContain('import SettingsCallScriptsPage from "@/pages/SettingsCallScriptsPage"');
    expect(app).toContain('<Route path="/settings/call-scripts" component={SettingsCallScriptsPage} />');
  });

  it("links Call scripts from the Settings menu group", () => {
    expect(menu).toContain('{ href: "/settings/call-scripts", label: "Call scripts" }');
  });
});
