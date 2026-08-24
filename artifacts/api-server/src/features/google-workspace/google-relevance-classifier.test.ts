import { describe, expect, it } from "vitest";

import { classifyGoogleMessageRelevance } from "./google-relevance-classifier";

const baseMessage = {
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX"],
  internalDateMs: 1787510000000,
  snippet: "hello",
  headers: {
    from: "Someone <someone@gmail.com>",
    to: "zone@example.com",
    cc: "",
    subject: "Hello",
    date: "",
  },
  hasAttachments: false,
};

const emptyEvidence = {
  approvedLabelIds: new Set<string>(),
  contacts: [] as Array<{ id: string; name: string; emails: string[] }>,
  organizations: [] as Array<{ id: string; name: string; domains: string[] }>,
  profiles: [] as Array<{ id: string; name: string }>,
  existingThreadTarget: null as null | { id: string; name: string; kind: "profile" | "organization" | "booking" },
};

describe("classifyGoogleMessageRelevance", () => {
  it("matches an exact saved contact email even when the message only has Inbox", () => {
    const result = classifyGoogleMessageRelevance({
      message: {
        ...baseMessage,
        headers: { ...baseMessage.headers, from: "Fair Office <BOOKING@fair.org>" },
      },
      evidence: {
        ...emptyEvidence,
        contacts: [{ id: "c1", name: "Fair Office", emails: ["booking@fair.org"] }],
      },
    });

    expect(result.status).toBe("matched");
    expect(result.evidenceCodes).toContain("exact_contact_email");
    expect(result.candidates).toEqual([{ id: "c1", name: "Fair Office", kind: "contact" }]);
  });

  it("matches a unique non-public organization domain", () => {
    const result = classifyGoogleMessageRelevance({
      message: {
        ...baseMessage,
        headers: { ...baseMessage.headers, from: "events@countyfair.org" },
      },
      evidence: {
        ...emptyEvidence,
        organizations: [{ id: "o1", name: "County Fair", domains: ["countyfair.org"] }],
      },
    });

    expect(result.status).toBe("matched");
    expect(result.evidenceCodes).toContain("exact_organization_domain");
  });

  it("does not infer an organization from a generic public-mail domain", () => {
    const result = classifyGoogleMessageRelevance({
      message: baseMessage,
      evidence: {
        ...emptyEvidence,
        organizations: [{ id: "o1", name: "Someone", domains: ["gmail.com"] }],
      },
    });

    expect(result.status).toBe("ignored");
    expect(result.evidenceCodes).not.toContain("exact_organization_domain");
  });

  it("keeps an approved business label for review when ownership is unknown", () => {
    const result = classifyGoogleMessageRelevance({
      message: { ...baseMessage, labelIds: ["INBOX", "Label_Shows"] },
      evidence: {
        ...emptyEvidence,
        approvedLabelIds: new Set(["Label_Shows"]),
      },
    });

    expect(result.status).toBe("review");
    expect(result.evidenceCodes).toContain("approved_business_label");
  });

  it("does not treat Spam or common system labels alone as business relevance", () => {
    for (const labelIds of [["SPAM"], ["SENT"], ["IMPORTANT", "STARRED"], ["TRASH"]]) {
      const result = classifyGoogleMessageRelevance({
        message: { ...baseMessage, labelIds },
        evidence: emptyEvidence,
      });
      expect(result.status).toBe("ignored");
    }
  });

  it("matches an already approved thread relationship", () => {
    const result = classifyGoogleMessageRelevance({
      message: baseMessage,
      evidence: {
        ...emptyEvidence,
        existingThreadTarget: { id: "p1", name: "Known Fair", kind: "profile" },
      },
    });

    expect(result.status).toBe("matched");
    expect(result.evidenceCodes).toContain("existing_thread_association");
  });

  it("queues an exact bounded profile-name subject match for review but never automatic ownership", () => {
    const result = classifyGoogleMessageRelevance({
      message: {
        ...baseMessage,
        headers: { ...baseMessage.headers, subject: "Vendor application - Big Sky Country Fair" },
      },
      evidence: {
        ...emptyEvidence,
        profiles: [{ id: "p1", name: "Big Sky Country Fair" }],
      },
    });

    expect(result.status).toBe("review");
    expect(result.evidenceCodes).toContain("exact_profile_name_text");
    expect(result.candidates).toEqual([{ id: "p1", name: "Big Sky Country Fair", kind: "profile" }]);
  });
});
