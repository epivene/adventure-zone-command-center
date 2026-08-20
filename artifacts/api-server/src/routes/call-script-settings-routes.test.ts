import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync("src/routes/settings.ts", "utf8");
const calls = readFileSync("src/routes/calls.ts", "utf8");
const startup = readFileSync("src/index.ts", "utf8");

describe("editable call script API wiring", () => {
  it("exposes owner settings endpoints for list, save, and reset", () => {
    expect(settings).toContain('router.get("/settings/call-scripts"');
    expect(settings).toContain('router.put("/settings/call-scripts/:scriptKind/:nodeId"');
    expect(settings).toContain('router.delete("/settings/call-scripts/:scriptKind/:nodeId"');
  });

  it("includes current wording overrides in the guided workspace payload", () => {
    expect(calls).toContain("guidedScriptOverrides");
    expect(calls).toContain("DrizzleCallScriptSettingsRepository");
  });

  it("initializes the tiny settings table after the server starts listening", () => {
    expect(startup).toContain('"call script settings schema"');
    expect(startup.indexOf("app.listen(")).toBeLessThan(startup.indexOf('"call script settings schema"'));
  });
});
