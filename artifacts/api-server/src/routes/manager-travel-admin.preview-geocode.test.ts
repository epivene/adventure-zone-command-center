import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/manager-travel-admin.ts", "utf8");

describe("manager travel admin preview map", () => {
  it("resolves missing event coordinates before returning the preview payload", () => {
    expect(source).toContain("resolveManagerMapEventLocations");
    expect(source).toContain("NominatimGeocodingProvider");
    expect(source).toContain("const events = await resolveManagerMapEventLocations(payload.events, managerMapGeocoder)");
    expect(source).toContain("res.json({ ...payload, events })");
  });
});
