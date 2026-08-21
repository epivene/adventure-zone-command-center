import { describe, expect, it } from "vitest";

import { discoverOrganizationFamilyCandidates } from "./organization-family-discovery";

describe("discoverOrganizationFamilyCandidates similar-name review", () => {
  it("surfaces parenthetical city variants for duplicate review even when secondary fields are incomplete", () => {
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: "main",
        name: "Adventure Van Expo",
        website: "https://adventurevanexpo.com/",
      },
      {
        id: "evergreen",
        name: "Adventure Van Expo (Evergreen, Co)",
        city: "Evergreen",
        region: "CO",
      },
    ]);

    const group = groups.find((candidate) =>
      candidate.candidateIds.includes("main") && candidate.candidateIds.includes("evergreen"),
    );

    expect(group).toBeDefined();
    expect(group?.classification).toBe("ambiguous_location_candidate");
    expect(group?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "name" }),
      ]),
    );
  });
});
