import { describe, expect, it } from "vitest";

import { buildBookingBrief } from "./booking-brief";
import type { BookingAssistantContextBundle } from "./assistant-types";

function sparseProfileBundle(): BookingAssistantContextBundle {
  return {
    context: { kind: "organization", recordId: "org-1", label: "16th Street Fair (Denver) CO" },
    profile: {
      organizationId: "org-1",
      contactIds: ["contact-1"],
      contacts: [{ id: "contact-1", label: "Downtown Denver", isPrimary: true }],
      eventFamilyId: null,
    },
    currentBooking: null,
    priorBookings: [],
    recentActivities: [],
    openFollowUps: [],
    packageHistorySignals: [],
    routeContext: null,
    derivedFacts: [],
    businessKnowledge: [],
    sources: [
      { id: "src-contact", kind: "activity", recordId: "contact-1", label: "Downtown Denver", occurredAt: null },
    ],
    generatedAt: "2026-08-20T13:07:00.000Z",
  };
}

describe("buildBookingBrief without a current booking", () => {
  it("returns a sparse profile brief instead of reading currentBooking.id", () => {
    const result = buildBookingBrief(sparseProfileBundle());

    expect(result.headline).toContain("16th Street Fair");
    expect(result.items.some((item) => item.key === "attraction_count")).toBe(false);
  });
});
