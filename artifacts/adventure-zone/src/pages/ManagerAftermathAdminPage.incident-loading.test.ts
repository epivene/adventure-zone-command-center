import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/ManagerAftermathAdminPage.tsx", "utf8");

describe("aftermath incident loading", () => {
  it("loads incidents independently and exposes a retry when they fail", () => {
    expect(source).toContain("async function loadIncidents()");
    expect(source).toContain("setIncidentLoadError");
    expect(source).toContain("Retry incidents");
    expect(source).not.toContain("Promise.all([\n      apiGet<any>(\"/event-wrap-up-admin\")");
  });
});
