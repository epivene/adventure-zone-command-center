import { describe, expect, it } from "vitest";

import { GoogleAiRecentValidationService } from "./google-ai-recent-validation-service";

function row(input: { id: string; subject: string; candidates?: Array<{ id: string; name: string; kind: "profile" }> }) {
  return {
    id: input.id,
    threadId: `thread-${input.id}`,
    subject: input.subject,
    from: "organizer@example.org",
    to: "Adventure Zone <theadventurezone12@gmail.com>",
    date: "",
    internalDateMs: 1,
    labelIds: ["INBOX"],
    labels: [{ id: "INBOX", name: "INBOX", type: "system" as const }],
    hasAttachments: false,
    evidenceCodes: ["weighted_profile_text_ambiguous"],
    candidates: input.candidates ?? [],
    matchedContact: null,
    resolvedOrganization: null,
    organizationCandidates: [],
  };
}

const baseResult = {
  checkedLimit: 100,
  aiEnabled: false as const,
  historicalImportStarted: false as const,
  validationStatus: "ready_for_review" as const,
  counts: { discovered: 2, matched: 0, needsReview: 2, ignored: 0 },
  matched: [],
  needsReview: [
    row({
      id: "event",
      subject: "Payson City Golden Onion Days Payson UT Sept 3-7, 2026",
      candidates: [
        { id: "golden-onion", name: "Payson Golden Onion Days (Payson) UT", kind: "profile" },
        { id: "cinco", name: "Cinco De Mayo / Viva el Mariachi (Payson) UT", kind: "profile" },
      ],
    }),
    row({ id: "personal", subject: "Your payment was successfully processed" }),
  ],
  ignored: [],
};

function googleClient() {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    getThreadDetail: async (threadId: string) => ({
      id: threadId,
      subject: "",
      originalGmailUrl: "",
      messages: [{
        id: `${threadId}-message`,
        internalDateMs: 1,
        from: "organizer@example.org",
        to: "theadventurezone12@gmail.com",
        cc: "",
        subject: "",
        date: "",
        direction: "incoming" as const,
        bodyText: threadId.includes("event")
          ? "This is about Golden Onion Days in Payson, Utah."
          : "Payment confirmation for a personal purchase unrelated to Adventure Zone events.",
        attachments: [],
      }],
    }),
  };
}

describe("GoogleAiRecentValidationService", () => {
  it("moves high-confidence AI event matches and irrelevant mail out of Needs Review without returning body text", async () => {
    const ai = {
      providerName: "Test AI",
      complete: async (prompt: string) => {
        if (prompt.includes("golden-onion")) {
          return JSON.stringify({
            decision: "MATCH",
            profileId: "golden-onion",
            confidence: "high",
            reason: "Golden Onion Days and Payson UT identify the candidate event.",
          });
        }
        return JSON.stringify({
          decision: "IGNORE",
          profileId: null,
          confidence: "high",
          reason: "Personal payment notice with no CRM event context.",
        });
      },
    };

    const service = new GoogleAiRecentValidationService({
      baseValidation: { run: async () => baseResult },
      connection: { createReadClient: async () => googleClient() },
      aiFactory: async () => ai,
      aiEnabled: true,
    });

    const result = await service.run(100);

    expect(result.aiEnabled).toBe(true);
    expect(result.aiProvider).toBe("Test AI");
    expect(result.counts).toEqual({ discovered: 2, matched: 1, needsReview: 0, ignored: 1 });
    expect(result.matched[0]).toMatchObject({
      resolvedOrganization: { id: "golden-onion", name: "Payson Golden Onion Days (Payson) UT" },
      evidenceCodes: expect.arrayContaining(["ai_profile_match"]),
      aiTriage: expect.objectContaining({ outcome: "match", confidence: "high" }),
    });
    expect(result.ignored[0]).toMatchObject({
      evidenceCodes: expect.arrayContaining(["ai_ignore"]),
      aiTriage: expect.objectContaining({ outcome: "ignore", confidence: "high" }),
    });
    expect(JSON.stringify(result)).not.toContain("personal purchase unrelated");
  });
});
