import { describe, expect, it } from "vitest";

import { classifyGoogleMessageRelevance } from "./google-relevance-classifier";

const message = {
  id: "m-payson",
  threadId: "t-payson",
  labelIds: ["SENT"],
  internalDateMs: 1,
  snippet: "Payson City Golden Onion Days Payson UT Sept 3-7, 2026",
  headers: {
    from: "Adventure Zone <theadventurezone12@gmail.com>",
    to: "Janeen Dean <events@paysonutah.gov>",
    cc: "",
    subject: "Payson City Golden Onion Days Payson UT Sept 3-7, 2026",
    date: "",
  },
  hasAttachments: false,
};

describe("Google event evidence vs contact precedence", () => {
  it("does not let a contact match override ambiguous event/profile evidence", () => {
    const result = classifyGoogleMessageRelevance({
      message,
      evidence: {
        approvedLabelIds: new Set<string>(),
        mailboxEmails: new Set(["theadventurezone12@gmail.com"]),
        contacts: [
          { id: "janeen", name: "Janeen Dean", emails: ["events@paysonutah.gov"] },
        ],
        organizations: [],
        profiles: [
          { id: "golden-onion-a", name: "Payson Golden Onion Days (Payson) UT" },
          { id: "golden-onion-b", name: "Golden Onion Days (Payson) UT" },
          { id: "cinco", name: "Cinco De Mayo / Viva el Mariachi (Payson) UT" },
        ],
        existingThreadTarget: null,
      },
    });

    expect(result.status).toBe("review");
    expect(result.evidenceCodes).toContain("weighted_profile_text_ambiguous");
    expect(result.evidenceCodes).toContain("exact_contact_email");
    expect(result.candidates).toContainEqual(
      expect.objectContaining({ id: "janeen", kind: "contact" }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({ id: "golden-onion-a", kind: "profile" }),
    );
  });
});
