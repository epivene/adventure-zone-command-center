import { describe, expect, it, vi } from "vitest";

import { ProductionDraftContextSources } from "./production-draft-context-sources";

const opportunityId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

function deps() {
  return {
    opportunities: {
      get: vi.fn(async () => ({
        id: opportunityId,
        organizationId,
        eventYear: 2026,
        bookingId: "33333333-3333-4333-8333-333333333333",
        contactId: null,
        status: "ready_to_contact",
        emailAutomationProtected: true,
        territoryExceptionApproved: true,
      })),
    },
    profiles: {
      get: vi.fn(async () => ({
        eventName: "Sample Fair",
        city: "Sample City",
        region: "CO",
        startsAt: new Date("2026-09-10T15:00:00.000Z"),
        endsAt: new Date("2026-09-12T23:00:00.000Z"),
      })),
    },
    recipients: {
      list: vi.fn(async () => [{
        contactId: "44444444-4444-4444-8444-444444444444",
        email: "booking@example.com",
        name: "Casey Organizer",
        verifiedAt: new Date("2026-08-27T12:00:00.000Z"),
        source: "profile" as const,
      }]),
    },
    relationships: {
      list: vi.fn(async () => [
        { sourceType: "act", direction: "outbound", occurredAt: new Date("2025-08-01T12:00:00.000Z"), excerpt: "Sent proposal" },
        { sourceType: "gmail", direction: "inbound", occurredAt: new Date("2026-08-20T12:00:00.000Z"), excerpt: "Please send updated information" },
      ]),
    },
    emailState: {
      countSent: vi.fn(async () => 1),
      currentDraftId: vi.fn(async () => "55555555-5555-4555-8555-555555555555"),
    },
    availability: {
      resolve: vi.fn(async () => ({
        calendarEvidence: [{ eventId: "calendar-1" }],
        packageAvailability: { status: "resolved", packages: [] },
      })),
    },
  };
}

describe("ProductionDraftContextSources", () => {
  it("uses explicit Opportunity automation controls and current profile evidence", async () => {
    const source = new ProductionDraftContextSources(deps());

    await expect(source.getProfileContext(organizationId, 2026)).resolves.toEqual(expect.objectContaining({
      eventName: "Sample Fair",
      protectedRecord: true,
      territoryExceptionApproved: true,
    }));
  });

  it("loads relationship evidence only for the verified recipient and keeps source/timing context", async () => {
    const dependencies = deps();
    const source = new ProductionDraftContextSources(dependencies);
    const summary = await source.listRelationshipSummary(organizationId, 2026, "booking@example.com");

    expect(dependencies.relationships.list).toHaveBeenCalledWith({
      organizationId,
      recipientEmail: "booking@example.com",
    });
    expect(summary).toEqual([
      "ACT outbound 2025-08-01: Sent proposal",
      "Gmail inbound 2026-08-20: Please send updated information",
    ]);
  });

  it("derives current-year decline, sent count, current draft, and availability from the same Opportunity", async () => {
    const dependencies = deps();
    dependencies.opportunities.get.mockResolvedValue({
      ...(await dependencies.opportunities.get()),
      status: "declined",
    });
    const source = new ProductionDraftContextSources(dependencies);

    await expect(source.hasSameYearDecline(opportunityId)).resolves.toBe(true);
    await expect(source.countSameYearSent(opportunityId)).resolves.toBe(1);
    await expect(source.getCurrentDraftId(opportunityId)).resolves.toBe("55555555-5555-4555-8555-555555555555");
    await expect(source.getCalendarEvidence(opportunityId)).resolves.toEqual([{ eventId: "calendar-1" }]);
    await expect(source.getPackageAvailability(opportunityId)).resolves.toEqual({ status: "resolved", packages: [] });
  });

  it("resolves one shared availability snapshot for concurrent calendar and package reads", async () => {
    const dependencies = deps();
    const source = new ProductionDraftContextSources(dependencies);

    const [calendarEvidence, packageAvailability] = await Promise.all([
      source.getCalendarEvidence(opportunityId),
      source.getPackageAvailability(opportunityId),
    ]);

    expect(calendarEvidence).toEqual([{ eventId: "calendar-1" }]);
    expect(packageAvailability).toEqual({ status: "resolved", packages: [] });
    expect(dependencies.availability.resolve).toHaveBeenCalledTimes(1);
  });
});
