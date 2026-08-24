import { describe, expect, it } from "vitest";

import { matchGoogleTextToProfiles } from "./google-weighted-profile-matcher";

const profiles = [
  { id: "bear-lake", name: "County Fair - Bear Lake (Montpelier) ID" },
  { id: "grant", name: "County Fair - Grant (Moses Lake) WA" },
  { id: "lake-or", name: "County Fair - Lake (Lakeview) OR" },
  { id: "lake-mt", name: "County Fair - Lake (Ronan) MT" },
  { id: "salt-lake", name: "County Fair - Salt Lake (S Jordan) UT" },
];

describe("matchGoogleTextToProfiles", () => {
  it("matches reordered event words when a distinctive name token and state identify one profile", () => {
    const result = matchGoogleTextToProfiles({
      text: "RE: Deposit Received for the Adventure Zone to be at the Lake County Fair OR 2026",
      profiles,
    });

    expect(result.status).toBe("matched");
    expect(result.candidates[0]).toMatchObject({
      id: "lake-or",
      name: "County Fair - Lake (Lakeview) OR",
      kind: "profile",
    });
    expect(result.evidenceCodes).toContain("weighted_profile_text_match");
  });

  it("uses city and state clues to strongly match a differently formatted event name", () => {
    const result = matchGoogleTextToProfiles({
      text: "Mohave County Fair Kingman AZ Sept 17-2026",
      profiles: [
        { id: "mohave", name: "County Fair - Mohave (Kingman) AZ" },
        { id: "coconino", name: "County Fair - Coconino (Flagstaff) AZ" },
      ],
    });

    expect(result.status).toBe("matched");
    expect(result.candidates[0]?.id).toBe("mohave");
  });

  it("does not auto-match a generic county fair when several profiles remain plausible", () => {
    const result = matchGoogleTextToProfiles({
      text: "County Fair 2026",
      profiles,
    });

    expect(result.status).not.toBe("matched");
  });

  it("returns best likely profiles for review when the lead is not strong enough", () => {
    const result = matchGoogleTextToProfiles({
      text: "Lake County Fair 2026",
      profiles,
    });

    expect(result.status).toBe("review");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(["lake-or", "lake-mt"]),
    );
    expect(result.evidenceCodes).toContain("weighted_profile_text_ambiguous");
  });
});
