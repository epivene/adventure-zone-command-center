import { describe, expect, it } from "vitest";

import { buildBookingContextBundle } from "./booking-context-builder";

describe("buildBookingContextBundle", () => {
  it("attaches deterministic sources as records enter the assistant bundle", () => {
    const result = buildBookingContextBundle({
      context: { kind: "booking", recordId: "booking-1", label: "County Fair" },
      profile: {
        organizationId: "org-1",
        eventFamilyId: null,
        contacts: [{ id: "contact-1", label: "Lisa Smith", isPrimary: true }],
      },
      currentBooking: {
        id: "booking-1",
        label: "County Fair",
        startsAt: new Date("2026-07-10T12:00:00Z"),
        status: "possible",
        physicalAttractionTotal: 10,
        packageNames: ["Adventure Zone"],
        specialResourceNames: [],
      },
      priorBookings: [],
      recentActivities: [
        {
          id: "activity-1",
          kind: "history",
          summary: "Asked us to call after the board meeting.",
          occurredAt: new Date("2025-08-10T12:00:00Z"),
        },
      ],
      openFollowUps: [
        {
          id: "follow-1",
          kind: "call",
          dueAt: new Date("2026-08-18T15:00:00Z"),
          label: "Call Lisa",
        },
      ],
      packageHistorySignals: [],
      routeContext: null,
      derivedFacts: [],
      businessKnowledge: [
        {
          id: "knowledge-1",
          title: "Flexible packages",
          body: "Package ranges are guidance, not hard caps.",
        },
      ],
      generatedAt: new Date("2026-08-17T21:00:00Z"),
    });

    expect(result.profile.contactIds).toEqual(["contact-1"]);
    expect(result.recentActivities[0]?.sourceIds).toEqual([
      "src_activity_activity-1",
    ]);
    expect(result.businessKnowledge[0]?.sourceIds).toEqual([
      "src_business_knowledge_knowledge-1",
    ]);
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining([
        "src_booking_booking-1",
        "src_activity_activity-1",
        "src_follow_up_follow-1",
        "src_business_knowledge_knowledge-1",
      ]),
    );
  });

  it("deduplicates repeated booking sources", () => {
    const result = buildBookingContextBundle({
      context: { kind: "booking", recordId: "booking-1", label: "County Fair" },
      profile: { organizationId: null, eventFamilyId: null, contacts: [] },
      currentBooking: {
        id: "booking-1",
        label: "County Fair",
        startsAt: null,
        status: "possible",
        physicalAttractionTotal: null,
        packageNames: [],
        specialResourceNames: [],
      },
      priorBookings: [
        {
          id: "booking-1",
          label: "County Fair",
          startsAt: null,
          status: "possible",
          physicalAttractionTotal: null,
          packageNames: [],
          specialResourceNames: [],
        },
      ],
      recentActivities: [],
      openFollowUps: [],
      packageHistorySignals: [],
      routeContext: null,
      derivedFacts: [],
      businessKnowledge: [],
      generatedAt: new Date("2026-08-17T21:00:00Z"),
    });
    expect(result.sources.filter((source) => source.id === "src_booking_booking-1")).toHaveLength(1);
  });
});
