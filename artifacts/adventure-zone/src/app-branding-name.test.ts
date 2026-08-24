import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const index = readFileSync("index.html", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const callScripts = readFileSync("src/pages/SettingsCallScriptsPage.tsx", "utf8");
const assistantDrawer = readFileSync("src/components/assistant/assistant-drawer.tsx", "utf8");
const assistantService = readFileSync("../api-server/src/features/assistant/assistant-service.ts", "utf8");

const productSurfaces = [index, app, callScripts, assistantDrawer, assistantService];

describe("AdventureZone Command Terminal branding", () => {
  it("uses the new product name on browser and entry surfaces", () => {
    expect(index).toContain("AdventureZone Command Terminal");
    expect(app).toContain("AdventureZone Command Terminal");
  });

  it("does not show the retired Command Center product wording on active product surfaces", () => {
    for (const source of productSurfaces) {
      expect(source).not.toContain("Adventure Zone Command Center");
      expect(source).not.toContain("General Command Center");
      expect(source).not.toContain("saved Command Center");
      expect(source).not.toContain("uses Command Center");
    }
  });

  it("keeps Command Panel as a feature name", () => {
    expect(app).toContain('path="/command"');
  });
});
