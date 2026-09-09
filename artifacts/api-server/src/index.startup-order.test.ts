import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/index.ts", "utf8");

describe("server startup ordering", () => {
  it("binds the Render port behind a closed traffic gate before required schema checks", () => {
    const starting = source.indexOf("markAppStarting();");
    const listen = source.indexOf("const server = app.listen");
    const required = source.indexOf("await runRequiredSchemaStartup();");
    const ready = source.indexOf("markAppReady();");
    expect(starting).toBeGreaterThanOrEqual(0);
    expect(starting).toBeLessThan(listen);
    expect(listen).toBeLessThan(required);
    expect(required).toBeLessThan(ready);
  });

  it("binds the HTTP server before post-listen maintenance and worker startup", () => {
    const listen = source.indexOf("const server = app.listen");
    const maintenance = source.indexOf("runPostListenMaintenance()", listen);
    const workers = source.indexOf("startBackgroundWorkers()", listen);
    expect(listen).toBeGreaterThanOrEqual(0);
    expect(maintenance).toBeGreaterThan(listen);
    expect(workers).toBeGreaterThan(maintenance);
  });

  it("opens readiness only after post-listen maintenance is settled", () => {
    const maintenance = source.indexOf("runMaintenanceAndStartWorkers({");
    const ready = source.indexOf("markAppReady();");
    expect(maintenance).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(maintenance);
  });

  it("starts one Paper Notes loop after maintenance and closes it during shutdown", () => {
    expect(source).toContain("paperNoteLoop.start();");
    expect(source).toContain("paperNoteLoop.close(),");
    expect(source).toContain("workerId: `paper-notes-${randomUUID()}`");
    expect(source.indexOf("paperNoteLoop.start();")).toBeGreaterThan(source.indexOf("async function startBackgroundWorkers()"));
  });

  it("seeds the approved Early Bird rule before starting its reminder loop", () => {
    const seed = source.indexOf("ensureEarlyBirdPromoOffer(db)");
    const start = source.indexOf("earlyBirdPromoLoop.start();");
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(seed);
    expect(source).toContain("earlyBirdPromoLoop.close(),");
  });
});


