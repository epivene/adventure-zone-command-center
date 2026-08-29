import { describe, expect, it, vi } from "vitest";

import { DraftContextResolver } from "./draft-context-resolver";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";

function sources() {
  return {
    getOpportunity: vi.fn(async () => ({
      id: OPPORTUNITY_ID,
      organizationId: ORGANIZATION_ID,
      eventYear: 2026,
      bookingId: null,
      contactId: "old-contact",
      status: "ready_to_contact" as const,
    })),
    getProfileContext: vi.fn(async () => ({
      eventName: "Sample County Fair",
      city: "Sample City",
      region: "CO",
      startsAt: new Date("2026-09-10T15:00:00.000Z"),
      endsAt: new Date("2026-09-12T23:00:00.000Z"),
      protectedRecord: false,
      territoryExceptionApproved: false,
    })),
    listRecipientCandidates: vi.fn(async () => [
      {
        contactId: "old-contact",
        email: "old@example.com",
        name: "Old ACT Contact",
        verifiedAt: new Date("2025-06-01T12:00:00.000Z"),
        source: "act" as const,
      },
      {
        contactId: "new-contact",
        email: "current@example.com",
        name: "Current Organizer",
        verifiedAt: new Date("2026-08-25T12:00:00.000Z"),
        source: "profile" as const,
      },
    ]),
    listRelationshipSummary: vi.fn(async () => [
      "ACT: emailed in 2025",
      "Gmail: organizer replied in 2026",
      "Call: requested updated package details",
    ]),
    countSameYearSent: vi.fn(async () => 1),
    hasSameYearDecline: vi.fn(async () => true),
    getCurrentDraftId: vi.fn(async () => "draft-1"),
    getCalendarEvidence: vi.fn(async () => [{ calendarId: "adventure-zone" }]),
    getPackageAvailability: vi.fn(async () => ({ adventureZone: "available" })),
  };
}

describe("DraftContextResolver", () => {
  it("uses the newest verified recipient instead of stale ACT contact data", async () => {
    const deps = sources();
    const resolver = new DraftContextResolver(deps);
    const context = await resolver.resolve(OPPORTUNITY_ID);

    expect(context.contactId).toBe("new-contact");
    expect(context.recipientEmail).toBe("current@example.com");
    expect(context.recipientName).toBe("Current Organizer");
    expect(context.recipientAmbiguous).toBe(false);
    expect(deps.listRelationshipSummary).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      2026,
      "current@example.com",
    );
  });

  it("passes through relationship, current-year, draft, and calendar evidence without inventing facts", async () => {
    const resolver = new DraftContextResolver(sources());
    const context = await resolver.resolve(OPPORTUNITY_ID);

    expect(context.priorRelationshipSummary).toEqual([
      "ACT: emailed in 2025",
      "Gmail: organizer replied in 2026",
      "Call: requested updated package details",
    ]);
    expect(context.sameYearSentCount).toBe(1);
    expect(context.sameYearDeclined).toBe(true);
    expect(context.existingDraftId).toBe("draft-1");
    expect(context.calendarEvidence).toEqual([{ calendarId: "adventure-zone" }]);
    expect(context.packageAvailability).toEqual({ adventureZone: "available" });
  });

  it("marks equally current conflicting verified recipients as ambiguous and does not guess relationship history", async () => {
    const deps = sources();
    deps.listRecipientCandidates.mockResolvedValue([
      { contactId: "a", email: "a@example.com", name: "A", verifiedAt: new Date("2026-08-25T12:00:00.000Z"), source: "profile" },
      { contactId: "b", email: "b@example.com", name: "B", verifiedAt: new Date("2026-08-25T12:00:00.000Z"), source: "gmail" },
    ]);
    const context = await new DraftContextResolver(deps).resolve(OPPORTUNITY_ID);

    expect(context.recipientEmail).toBeNull();
    expect(context.recipientAmbiguous).toBe(true);
    expect(deps.listRelationshipSummary).not.toHaveBeenCalled();
    expect(context.priorRelationshipSummary).toEqual([]);
  });
});
