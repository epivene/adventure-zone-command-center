import { describe, expect, it } from "vitest";

import {
  selectedProfilesHaveConflictingCompleteLocations,
  shouldBlockSelectedProfileMergeForLocation,
} from "./organization-merge-subset-safety";

describe("selectedProfilesHaveConflictingCompleteLocations", () => {
  it("allows two Fishtail duplicate copies when one copy is missing its recorded location", () => {
    expect(selectedProfilesHaveConflictingCompleteLocations([
      { id: "fishtail-a", city: "Fishtail", region: "MT" },
      { id: "fishtail-b", city: null, region: null },
    ])).toBe(false);
  });

  it("allows duplicate copies with the same complete city and region", () => {
    expect(selectedProfilesHaveConflictingCompleteLocations([
      { id: "fishtail-a", city: "Fishtail", region: "MT" },
      { id: "fishtail-b", city: "fishtail", region: "mt" },
    ])).toBe(false);
  });

  it("blocks merging selected profiles whose complete locations conflict", () => {
    expect(selectedProfilesHaveConflictingCompleteLocations([
      { id: "fishtail", city: "Fishtail", region: "MT" },
      { id: "idaho-falls", city: "Idaho Falls", region: "ID" },
    ])).toBe(true);
  });
});

describe("shouldBlockSelectedProfileMergeForLocation", () => {
  const differentCities = [
    { id: "window-rock", city: "Window Rock", region: "AZ" },
    { id: "st-michaels", city: "St. Michaels", region: "AZ" },
  ];

  it("blocks different complete locations without an explicit review", () => {
    expect(shouldBlockSelectedProfileMergeForLocation(differentCities, false)).toBe(true);
  });

  it("allows different complete locations after explicit reviewer confirmation", () => {
    expect(shouldBlockSelectedProfileMergeForLocation(differentCities, true)).toBe(false);
  });
});
