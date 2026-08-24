import { describe, expect, it } from "vitest";

import { matchGoogleBodyToProfiles } from "./google-body-profile-matcher";

const profiles = [
  { id: "logan-pride", name: "Logan Pride Festival (Logan) UT" },
  { id: "harvest-moon", name: "Harvest Moon Hurrah (Spanish Fork) UT" },
  { id: "adventure-zone", name: "Adventure Zone, The (Logan) UT" },
];

describe("matchGoogleBodyToProfiles", () => {
  it("matches a unique external profile mentioned in readable email body text", () => {
    const result = matchGoogleBodyToProfiles({
      bodyText: "We would love to have Adventure Zone return to Logan Pride Festival this September.",
      profiles,
    });

    expect(result).toEqual({
      status: "matched",
      evidenceCodes: ["exact_profile_name_body"],
      candidates: [
        { id: "logan-pride", name: "Logan Pride Festival (Logan) UT", kind: "profile" },
      ],
    });
  });

  it("does not treat the Adventure Zone company profile name in signatures as ownership evidence", () => {
    const result = matchGoogleBodyToProfiles({
      bodyText: "Thanks, Adventure Zone\nFamily owned carnival entertainment",
      profiles,
    });

    expect(result.status).toBe("none");
    expect(result.candidates).toEqual([]);
  });

  it("keeps multiple external profile mentions in review instead of guessing", () => {
    const result = matchGoogleBodyToProfiles({
      bodyText: "We are coordinating Logan Pride Festival and Harvest Moon Hurrah this fall.",
      profiles,
    });

    expect(result.status).toBe("review");
    expect(result.evidenceCodes).toEqual(["ambiguous_profile_name_body"]);
    expect(result.candidates).toHaveLength(2);
  });

  it("does not match short generic profile names from incidental body words", () => {
    const result = matchGoogleBodyToProfiles({
      bodyText: "The fair schedule is attached.",
      profiles: [{ id: "fair", name: "Fair" }],
    });

    expect(result.status).toBe("none");
  });
});
