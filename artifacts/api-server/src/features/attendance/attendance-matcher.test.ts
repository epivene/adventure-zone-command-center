import { describe, expect, it } from "vitest";

import { chooseAttendanceMatch } from "./attendance-matcher";

const row = {
  importRowId: "row-1",
  eventName: "Beaverhead County Fair ",
  location: "Dillon MT",
};

describe("attendance matching", () => {
  it("marks one exact active name and compatible location as confident", () => {
    expect(chooseAttendanceMatch(row, [
      { organizationId: "org-1", organizationName: "Beaverhead County Fair", consolidatedIntoId: null, locationId: "loc-1", city: "Dillon", region: "MT" },
    ])).toMatchObject({ state: "confident", organizationId: "org-1", organizationLocationId: "loc-1", confidence: 1 });
  });

  it("keeps an exact name pending when the source location conflicts", () => {
    expect(chooseAttendanceMatch(row, [
      { organizationId: "org-1", organizationName: "Beaverhead County Fair", consolidatedIntoId: null, locationId: "loc-1", city: "Bozeman", region: "MT" },
    ]).state).toBe("pending");
  });

  it("keeps ambiguous same-name locations pending", () => {
    expect(chooseAttendanceMatch(row, [
      { organizationId: "org-1", organizationName: "Beaverhead County Fair", consolidatedIntoId: null, locationId: "loc-1", city: "Dillon", region: "MT" },
      { organizationId: "org-2", organizationName: "Beaverhead County Fair", consolidatedIntoId: null, locationId: "loc-2", city: "Dillon", region: "MT" },
    ]).state).toBe("pending");
  });

  it("does not treat a fuzzy name as an automatic match", () => {
    expect(chooseAttendanceMatch(
      { ...row, eventName: "Beaverhead Co Fair" },
      [{ organizationId: "org-1", organizationName: "Beaverhead County Fair", consolidatedIntoId: null, locationId: "loc-1", city: "Dillon", region: "MT" }],
    ).state).toBe("pending");
  });

  it("returns a new-profile candidate when there is no plausible active profile", () => {
    expect(chooseAttendanceMatch(row, []).state).toBe("new_profile_candidate");
  });

  it("never targets a retired organization directly", () => {
    expect(chooseAttendanceMatch(row, [
      { organizationId: "old", organizationName: "Beaverhead County Fair", consolidatedIntoId: "canonical", locationId: "loc-old", city: "Dillon", region: "MT" },
      { organizationId: "canonical", organizationName: "Beaverhead County Fair", consolidatedIntoId: null, locationId: "loc-new", city: "Dillon", region: "MT" },
    ])).toMatchObject({ state: "confident", organizationId: "canonical", organizationLocationId: "loc-new" });
  });
});
