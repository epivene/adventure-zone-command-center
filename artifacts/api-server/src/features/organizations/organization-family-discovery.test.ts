import { describe, expect, it } from "vitest";

import { discoverOrganizationFamilyCandidates } from "./organization-family-discovery";

describe("discoverOrganizationFamilyCandidates", () => {
  it("classifies strongly similar names in the same city and state as duplicates", () => {
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Twin Falls County Fair",
        city: "Filer",
        region: "ID",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "The Twin Falls County Fair",
        city: "Filer",
        region: "ID",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      normalizedName: "twin falls county fair",
      city: "filer",
      region: "id",
      classification: "duplicate",
    });
  });

  it("keeps similar names in different locations as a family/location review", () => {
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Twin Falls County Fair",
        city: "Filer",
        region: "ID",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "The Twin Falls County Fair",
        city: "Boise",
        region: "ID",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.classification).toBe("ambiguous_location_candidate");
  });
});
