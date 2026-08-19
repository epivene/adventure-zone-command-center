import { describe, expect, it } from "vitest";

import { buildBookingBrief } from "./booking-brief";
import type { BookingAssistantContextBundle } from "./assistant-types";

function bundle(): BookingAssistantContextBundle {
  return {
    context: { kind: "booking", recordId: "booking-current", label: "County Fair 2026" },
    profile: {
      organizationId: "org-1",
      contactIds: ["contact-1"],
      contacts: [{ id: "contact-1", label: "Lisa Smith", isPrimary: true }],
      eventFamilyId: null,
    },
    currentBooking: {
      id: "booking-current",
      label: "County Fair 2026",
      startsAt: "2026-07-10T12:00:00.000Z",
      status: "possible",
      physicalAttractionTotal: 9,
      packageNames: ["Adventure Zone"],
      specialResourceNames: [],
    },
    priorBookings: [
      {
        id: "booking-prior",
        label: "County Fair 2025",
        startsAt: "2025-07-10T12:00:00.000Z",
        status: "completed",
        physicalAttractionTotal: 12,
        packageNames: ["Adventure Zone", "Pirate's Rebellion"],
        specialResourceNames: ["Paintball trailer"],
      },
    ],
    recentActivities: [],
    openFollowUps: [
      {
        id: "follow-1",
        kind: "call",
        dueAt: "2026-08-18T15:00:00.000Z",
        label: "Call Lisa",
      },
    ],
    packageHistorySignals: [
      {
        kind: "usual_package_mix",
        packageNames: ["Adventure Zone", "Pirate's Rebellion"],
        sourceBookingIds: ["booking-prior"],
      },
      {
        kind: "main_attraction_difference",
        previousCount: 12,
        currentCount: 9,
        difference: -3,
        sourceBookingId: "booking-prior",
      },
      {
        kind: "missing_prior_resource",
        resourceId: "paintball",
        resourceName: "Paintball trailer",
        sourceBookingId: "booking-prior",
      },
    ],
    routeContext: { id: "route-1", label: "Leg 3 nearby", summary: "Leg 3 is already nearby that week." },
    derivedFacts: [
      {
        id: "fact-1",
        factKind: "prior_outcome",
        summary: "Price was the sticking point last year.",
        confidence: "high",
        status: "confirmed",
        sourceIds: ["src-activity-1"],
      },
      {
        id: "fact-price",
        factKind: "historical_price",
        summary: "2025 ACT note says Adventure Zone + paintball was quoted at $7,500.",
        confidence: "high",
        status: "confirmed",
        sourceIds: ["src-price"],
      },
    ],
    businessKnowledge: [],
    sources: [
      { id: "src-current", kind: "booking", recordId: "booking-current", label: "County Fair 2026", occurredAt: "2026-07-10T12:00:00.000Z" },
      { id: "src-prior", kind: "booking", recordId: "booking-prior", label: "County Fair 2025", occurredAt: "2025-07-10T12:00:00.000Z" },
      { id: "src-follow", kind: "follow_up", recordId: "follow-1", label: "Call Lisa", occurredAt: "2026-08-18T15:00:00.000Z" },
      { id: "src-contact", kind: "activity", recordId: "contact-1", label: "Lisa Smith", occurredAt: null },
      { id: "src-route", kind: "route", recordId: "route-1", label: "Leg 3 nearby", occurredAt: null },
      { id: "src-activity-1", kind: "activity", recordId: "activity-1", label: "2025 booking note", occurredAt: "2025-07-11T12:00:00.000Z" },
      { id: "src-price", kind: "activity", recordId: "activity-price", label: "2025 pricing note", occurredAt: "2025-06-02T12:00:00.000Z" },
    ],
    generatedAt: "2026-08-17T21:00:00.000Z",
  };
}

describe("buildBookingBrief", () => {
  it("builds a source-backed brief from structured and historical facts", () => {
    const result = buildBookingBrief(bundle());
    expect(result.headline).toContain("County Fair 2026");
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "package_history", sourceIds: ["src-prior"] }),
        expect.objectContaining({ key: "last_outcome", sourceIds: ["src-activity-1"] }),
        expect.objectContaining({ key: "historical_price", sourceIds: ["src-price"] }),
        expect.objectContaining({ key: "attraction_count", sourceIds: ["src-current", "src-prior"] }),
        expect.objectContaining({ key: "follow_up", sourceIds: ["src-follow"] }),
        expect.objectContaining({ key: "route_fit", sourceIds: ["src-route"] }),
        expect.objectContaining({ key: "next_action", sourceIds: ["src-follow"] }),
      ]),
    );
    expect(result.items.find((item) => item.key === "historical_price")?.text).toContain(
      "Historical pricing only",
    );
  });

  it("does not surface unconfirmed historical prices as booking facts", () => {
    const context = bundle();
    const price = context.derivedFacts.find((fact) => fact.factKind === "historical_price");
    if (price) price.status = "proposed";

    const result = buildBookingBrief(context);

    expect(result.items.some((item) => item.key === "historical_price")).toBe(false);
  });

  it("omits unsupported claims for a sparse customer", () => {
    const sparse = bundle();
    sparse.priorBookings = [];
    sparse.packageHistorySignals = [];
    sparse.derivedFacts = [];
    sparse.routeContext = null;
    sparse.openFollowUps = [];
    const result = buildBookingBrief(sparse);
    expect(result.items.some((item) => item.key === "package_history")).toBe(false);
    expect(result.items.some((item) => item.key === "last_outcome")).toBe(false);
    expect(result.items.some((item) => item.key === "historical_price")).toBe(false);
    expect(result.items.some((item) => item.key === "route_fit")).toBe(false);
  });

  it("prefers structured current records over conflicting derived facts", () => {
    const context = bundle();
    context.derivedFacts.push({
      id: "fact-conflict",
      factKind: "usual_attraction_count",
      summary: "They need 20 attractions this year.",
      confidence: "high",
      status: "confirmed",
      sourceIds: ["src-activity-1"],
    });
    const result = buildBookingBrief(context);
    const attraction = result.items.find((item) => item.key === "attraction_count");
    expect(attraction?.text).toContain("9");
    expect(attraction?.text).not.toContain("20");
  });
});