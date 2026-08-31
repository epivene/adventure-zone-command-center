import { describe, expect, it } from "vitest";

import { importedTravelLegPatch } from "./imported-travel-leg";

describe("approved-profile booking travel leg updates", () => {
  it("does not clear a manually assigned leg when an existing booking import has no leg", () => {
    expect(importedTravelLegPatch(null)).toEqual({});
    expect(importedTravelLegPatch(undefined)).toEqual({});
  });

  it("applies an explicit imported leg", () => {
    expect(importedTravelLegPatch("11111111-1111-4111-8111-111111111111")).toEqual({
      travelLegId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
