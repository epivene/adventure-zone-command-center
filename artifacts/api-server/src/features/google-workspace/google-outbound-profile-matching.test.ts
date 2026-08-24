import { describe, expect, it } from "vitest";

import { classifyGoogleMessageRelevance } from "./google-relevance-classifier";

const emptyEvidence = {
  approvedLabelIds: new Set<string>(),
  mailboxEmails: new Set(["theadventurezone12@gmail.com"]),
  contacts: [] as Array<{ id: string; name: string; emails: string[] }>,
  organizations: [] as Array<{ id: string; name: string; domains: string[] }>,
  profiles: [] as Array<{ id: string; name: string }>,
  existingThreadTarget: null,
};

const message = {
  id: "m1",
  threadId: "t1",
  labelIds: ["SENT"],
  internalDateMs: 1,
  snippet: "",
  headers: {
    from: "Adventure Zone <theadventurezone12@gmail.com>",
    to: "loganpride@example.org",
    cc: "",
    subject: "Logan Pride Festival Logan UT Sept 19, 2026",
    date: "",
  },
  hasAttachments: false,
};

describe("outbound Gmail profile matching", () => {
  it("does not match the sender's internal contact on a SENT message", () => {
    const result = classifyGoogleMessageRelevance({
      message,
      evidence: {
        ...emptyEvidence,
        contacts: [
          {
            id: "david",
            name: "David Gordon",
            emails: ["theadventurezone12@gmail.com"],
          },
        ],
      },
    });

    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({ id: "david" }),
    );
    expect(result.evidenceCodes).not.toContain("exact_contact_email");
  });

  it("matches a unique profile name in an outbound subject despite punctuation differences", () => {
    const result = classifyGoogleMessageRelevance({
      message,
      evidence: {
        ...emptyEvidence,
        contacts: [
          {
            id: "david",
            name: "David Gordon",
            emails: ["theadventurezone12@gmail.com"],
          },
        ],
        profiles: [
          {
            id: "logan-pride",
            name: "Logan Pride Festival (Logan) UT",
          },
        ],
      },
    });

    expect(result.status).toBe("matched");
    expect(result.evidenceCodes).toContain("exact_profile_name_subject");
    expect(result.candidates).toEqual([
      {
        id: "logan-pride",
        name: "Logan Pride Festival (Logan) UT",
        kind: "profile",
      },
    ]);
  });

  it("does not match the connected mailbox contact when a promotion lacks INBOX/SENT labels", () => {
    const result = classifyGoogleMessageRelevance({
      message: {
        ...message,
        id: "promo",
        labelIds: ["CATEGORY_PROMOTIONS", "UNREAD"],
        headers: {
          ...message.headers,
          from: "Traeger <Traeger@email.traeger.com>",
          to: "Adventure Zone <theadventurezone12@gmail.com>",
          subject: "We Built a Better Griddle",
        },
      },
      evidence: {
        ...emptyEvidence,
        contacts: [
          {
            id: "david",
            name: "David Gordon",
            emails: ["theadventurezone12@gmail.com"],
          },
        ],
      },
    });

    expect(result.status).toBe("ignored");
    expect(result.candidates).toEqual([]);
    expect(result.evidenceCodes).not.toContain("exact_contact_email");
  });
});
