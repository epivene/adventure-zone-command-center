import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ProfileLocationsPanel", () => {
  it("uses the existing location detail and scoped-note APIs", () => {
    const source = readFileSync(new URL("./profile-locations-panel.tsx", import.meta.url), "utf8");

    expect(source).toContain("/organizations/${profileId}/locations");
    expect(source).toContain("/${locationId}/notes");
    expect(source).toContain("Contacts");
    expect(source).toContain("Notes");
    expect(source).toContain("History");
    expect(source).toContain("Bookings");
    expect(source).toContain("Follow-ups");
  });

  it("explains that locations preserve their own history while rolling up to the profile", () => {
    const source = readFileSync(new URL("./profile-locations-panel.tsx", import.meta.url), "utf8");
    expect(source).toContain("Each location keeps its own contacts, notes, history, bookings, and follow-ups");
    expect(source).toContain("The main Profile still shows the overall relationship");
  });
});
