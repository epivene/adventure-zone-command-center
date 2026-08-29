import { describe, expect, it } from "vitest";

import {
  ADVENTURE_ZONE_EMAIL_RULES,
  evaluateDraftGuardrails,
  type DraftContext,
} from "./draft-guardrails";

function makeContext(overrides: Partial<DraftContext> = {}): DraftContext {
  return {
    opportunityId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    eventYear: 2026,
    eventName: "Sample County Fair",
    city: "Sample City",
    region: "CO",
    startsAt: new Date("2026-09-10T15:00:00.000Z"),
    endsAt: new Date("2026-09-12T23:00:00.000Z"),
    contactId: "contact-1",
    recipientEmail: "booking@example.com",
    recipientName: "Casey Organizer",
    recipientAmbiguous: false,
    priorRelationshipSummary: [],
    sameYearSentCount: 0,
    sameYearDeclined: false,
    existingDraftId: null,
    calendarEvidence: [{}],
    packageAvailability: { checked: true },
    protectedRecord: false,
    territoryExceptionApproved: false,
    ...overrides,
  };
}

describe("evaluateDraftGuardrails", () => {
  it("blocks a missing or ambiguous recipient", () => {
    expect(evaluateDraftGuardrails(makeContext({ recipientEmail: null }), "new_outreach").blocker?.code)
      .toBe("missing_recipient");
    expect(evaluateDraftGuardrails(makeContext({ recipientEmail: null, recipientAmbiguous: true }), "new_outreach").blocker?.code)
      .toBe("ambiguous_recipient");
  });

  it.each(["NM", "OR", "CA", "KS", "OK", "TX"])("blocks routine new outreach in %s", (region) => {
    expect(evaluateDraftGuardrails(makeContext({ region }), "new_outreach").blocker?.code)
      .toBe("territory_hold");
  });

  it("allows a human-approved territory exception", () => {
    expect(evaluateDraftGuardrails(makeContext({ region: "TX", territoryExceptionApproved: true }), "new_outreach").blocker)
      .toBeNull();
  });

  it("converts a repeated same-year introduction into follow-up purpose", () => {
    expect(evaluateDraftGuardrails(makeContext({ sameYearSentCount: 1 }), "new_outreach").effectivePurpose)
      .toBe("follow_up");
  });

  it("blocks current-year decline and protected records", () => {
    expect(evaluateDraftGuardrails(makeContext({ sameYearDeclined: true }), "new_outreach").blocker?.code)
      .toBe("current_year_decline");
    expect(evaluateDraftGuardrails(makeContext({ protectedRecord: true }), "follow_up").blocker?.code)
      .toBe("protected_record");
  });

  it("requires both current package availability and calendar evidence", () => {
    expect(evaluateDraftGuardrails(makeContext({ packageAvailability: null }), "new_outreach").blocker?.code)
      .toBe("availability_unknown");
    expect(evaluateDraftGuardrails(makeContext({ calendarEvidence: [] }), "new_outreach").blocker?.code)
      .toBe("availability_unknown");
    expect(evaluateDraftGuardrails(makeContext({ packageAvailability: null, calendarEvidence: [] }), "new_outreach").blocker?.code)
      .toBe("availability_unknown");
  });

  it("blocks unresolved package availability instead of treating ambiguous Calendar evidence as safe", () => {
    expect(evaluateDraftGuardrails(makeContext({
      packageAvailability: { status: "unresolved", blockers: ["ambiguous Calendar package usage"] },
    }), "new_outreach").blocker?.code).toBe("availability_unknown");
  });
});

describe("Adventure Zone email generation rule contract", () => {
  it("keeps the approved package, pricing, insurance, and pay-for-play facts", () => {
    expect(ADVENTURE_ZONE_EMAIL_RULES.inventory).toEqual({
      adventureZone: 5,
      piratesRebellion: 3,
      warriorsPlayground: 1,
      restrictedPirateExcluded: true,
    });
    expect(ADVENTURE_ZONE_EMAIL_RULES.pricing).toEqual({
      adventureZone: "$9,000 / 1–4 days",
      piratesRebellion: "$7,500 / 1–4 days",
      warriorsPlayground: "$7,500 / 1–4 days (ammo extra)",
    });
    expect(ADVENTURE_ZONE_EMAIL_RULES.insurance).toBe("$2M");
    expect(ADVENTURE_ZONE_EMAIL_RULES.payForPlay).toBe(
      "In some instances, we may also be able to come at no up-front charge, charge the public to play, and pay your event a percentage of our ticket box sales.",
    );
  });

  it("forbids guarantees and routine sponsorship-purchase language", () => {
    expect(ADVENTURE_ZONE_EMAIL_RULES.forbiddenClaims).toEqual(expect.arrayContaining([
      "revenue guarantee",
      "attendance guarantee",
      "minimum-sales promise",
      "no guarantee",
      "offer to purchase sponsorship",
    ]));
    expect(ADVENTURE_ZONE_EMAIL_RULES.preferredPartnershipTerms).toEqual([
      "entertainment partnership",
      "event partnership",
      "separate staffed attraction area",
      "family-entertainment area",
    ]);
  });
});
