import { describe, expect, it } from "vitest";

import { classifyGoogleMessageRelevance } from "./google-relevance-classifier";

const evidenceBase = {
  approvedLabelIds: new Set<string>(),
  mailboxEmails: new Set(["theadventurezone12@gmail.com"]),
  contacts: [],
  organizations: [],
  existingThreadTarget: null,
};

function message(subject: string) {
  return {
    id: "m1",
    threadId: "t1",
    labelIds: ["SENT"],
    internalDateMs: 1,
    snippet: "",
    headers: {
      from: "Adventure Zone <theadventurezone12@gmail.com>",
      to: "fairgrounds@example.org",
      cc: "",
      subject,
      date: "",
    },
    hasAttachments: false,
  };
}

describe("weighted Gmail relevance classification", () => {
  it("auto-matches Lake County Fair despite the CRM name using a different word order", () => {
    const result = classifyGoogleMessageRelevance({
      message: message("RE: Deposit Received for the Adventure Zone to be at the Lake County Fair OR 2026"),
      evidence: {
        ...evidenceBase,
        profiles: [
          { id: "lake-or", name: "County Fair - Lake (Lakeview) OR" },
          { id: "lake-mt", name: "County Fair - Lake (Ronan) MT" },
          { id: "grant", name: "County Fair - Grant (Moses Lake) WA" },
        ],
      },
    });

    expect(result.status).toBe("matched");
    expect(result.candidates).toEqual([
      { id: "lake-or", name: "County Fair - Lake (Lakeview) OR", kind: "profile" },
    ]);
    expect(result.evidenceCodes).toContain("weighted_profile_text_match");
  });

  it("keeps similarly named profiles in review and supplies likely candidates", () => {
    const result = classifyGoogleMessageRelevance({
      message: message("Lake County Fair 2026"),
      evidence: {
        ...evidenceBase,
        profiles: [
          { id: "lake-or", name: "County Fair - Lake (Lakeview) OR" },
          { id: "lake-mt", name: "County Fair - Lake (Ronan) MT" },
        ],
      },
    });

    expect(result.status).toBe("review");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      "lake-or",
      "lake-mt",
    ]);
  });
});
