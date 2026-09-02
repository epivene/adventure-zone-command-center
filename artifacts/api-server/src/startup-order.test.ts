import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "index.ts"), "utf8");

describe("API startup order", () => {
  it("validates config before binding the port", () => {
    expect(source.indexOf("validateOwnerConfig();")).toBeLessThan(source.indexOf("app.listen("));
  });

  it("binds the HTTP server before running database maintenance", () => {
    expect(source.indexOf("app.listen(")).toBeLessThan(source.indexOf("runStartupStep("));
  });

  it("keeps API traffic gated until required schema startup completes", () => {
    expect(source.indexOf("markAppStarting();")).toBeLessThan(source.indexOf("app.listen("));
    expect(source.indexOf("app.listen(")).toBeLessThan(source.indexOf("runRequiredSchemaStartup();"));
    expect(source.indexOf("runRequiredSchemaStartup();")).toBeLessThan(source.indexOf("markAppReady();"));
  });

  it("keeps background workers behind post-listen maintenance", () => {
    expect(source.indexOf("runPostListenMaintenance")).toBeLessThan(source.indexOf("leadScoutLoop.start()"));
  });
});
