import { describe, expect, it, vi } from "vitest";

import { ADVENTURE_ZONE_EMAIL_RULES } from "./draft-guardrails";
import { AiOpportunityEmailWriter } from "./ai-opportunity-email-writer";

const context = {
  opportunityId: "10000000-0000-4000-8000-000000000001",
  organizationId: "20000000-0000-4000-8000-000000000001",
  eventYear: 2026,
  eventName: "Sample Fair",
  city: "Sample City",
  region: "CO",
  startsAt: new Date("2026-09-10T15:00:00.000Z"),
  endsAt: new Date("2026-09-12T23:00:00.000Z"),
  contactId: null,
  recipientEmail: "fair@example.com",
  recipientName: "Casey",
  recipientAmbiguous: false,
  priorRelationshipSummary: ["2025 email: Casey asked us to check back for the next fair."],
  sameYearSentCount: 0,
  sameYearDeclined: false,
  existingDraftId: null,
  calendarEvidence: [{ summary: "No conflicting Adventure Zone booking" }],
  packageAvailability: { adventureZone: "available", piratesRebellion: "available", warriorsPlayground: "available" },
  protectedRecord: false,
  territoryExceptionApproved: false,
};

describe("AiOpportunityEmailWriter", () => {
  it("generates from evidence with the approved commercial guardrails in the prompt", async () => {
    const ai = {
      providerName: "test",
      complete: vi.fn(async () => JSON.stringify({ subject: "Adventure Zone for Sample Fair", body: "Hi Casey, draft body" })),
    };
    const writer = new AiOpportunityEmailWriter(ai);

    const result = await writer.generate({ context, purpose: "new_outreach" });

    expect(result).toEqual({ subject: "Adventure Zone for Sample Fair", body: "Hi Casey, draft body" });
    const prompt = ai.complete.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain(ADVENTURE_ZONE_EMAIL_RULES.payForPlay);
    expect(prompt).toContain("$9,000 / 1–4 days");
    expect(prompt).toContain("$7,500 / 1–4 days (ammo extra)");
    expect(prompt).toContain("Never invent prior interactions");
    expect(prompt).toContain("Do not promise revenue, attendance, or minimum sales");
    expect(prompt).toContain("Casey asked us to check back");
  });

  it("rewrites only from the supplied current draft and requested action", async () => {
    const ai = {
      providerName: "test",
      complete: vi.fn(async () => JSON.stringify({ subject: "Same subject", body: "Shorter body" })),
    };
    const writer = new AiOpportunityEmailWriter(ai);

    const result = await writer.rewrite({
      opportunityId: context.opportunityId,
      draftId: "draft-1",
      purpose: "follow_up",
      action: "shorter",
      subject: "Same subject",
      body: "Long current body",
    });

    expect(result).toEqual({ subject: "Same subject", body: "Shorter body" });
    const prompt = ai.complete.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain("Action: shorter");
    expect(prompt).toContain("Long current body");
    expect(prompt).toContain("Do not add new facts");
  });

  it("rejects malformed AI output instead of guessing", async () => {
    const writer = new AiOpportunityEmailWriter({ providerName: "test", complete: vi.fn(async () => "not-json") });

    await expect(writer.generate({ context, purpose: "new_outreach" })).rejects.toThrow("OPPORTUNITY_EMAIL_AI_OUTPUT_INVALID");
  });
});
