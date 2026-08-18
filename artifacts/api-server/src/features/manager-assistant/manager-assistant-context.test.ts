import { describe, expect, it } from "vitest";

import { buildManagerAssistantContext } from "./manager-assistant-context";

const source = {
  async getLeg(legId: string) {
    return { id: legId, name: legId === "leg-a" ? "Leg A" : "Leg B" };
  },
  async listAssignedEvents(legId: string) {
    return legId === "leg-a"
      ? [
          {
            id: "booking-a",
            name: "Fair A",
            city: "A City",
            region: "ND",
            startsAt: "2026-08-20T12:00:00.000Z",
            endsAt: "2026-08-21T12:00:00.000Z",
            status: "confirmed",
            packageNames: ["Adventure Zone"],
            resourceNames: ["Paintball"],
            setupSummary: "Setup begins Thursday.",
          },
        ]
      : [
          {
            id: "booking-b",
            name: "Fair B",
            city: "B City",
            region: "SD",
            startsAt: null,
            endsAt: null,
            status: "confirmed",
            packageNames: [],
            resourceNames: [],
            setupSummary: null,
          },
        ];
  },
  async getRoute(legId: string) {
    return legId === "leg-a"
      ? {
          tripId: "trip-a",
          label: "Leg A Route",
          startDate: "2026-08-18T00:00:00.000Z",
          endDate: "2026-08-30T00:00:00.000Z",
          stops: [{ bookingId: "booking-a", label: "Fair A", sortOrder: 1 }],
        }
      : null;
  },
  async listHandoffs() { return []; },
  async listAcknowledgments() { return []; },
  async listOperationalInstructions() { return []; },
  async listKnowledge() { return []; },
};

describe("manager assistant context", () => {
  it("uses only the authenticated leg when building leg context", async () => {
    const context = await buildManagerAssistantContext({
      authenticatedLegId: "leg-a",
      request: { contextKind: "leg", contextRecordId: "leg-a" },
      source,
      now: new Date("2026-08-17T12:00:00.000Z"),
    });
    expect(context?.leg.id).toBe("leg-a");
    expect(context?.assignedEvents.map((event) => event.id)).toEqual(["booking-a"]);
    expect(context?.assignedEvents.some((event) => event.id === "booking-b")).toBe(false);
  });

  it("rejects a booking outside the authenticated leg", async () => {
    const context = await buildManagerAssistantContext({
      authenticatedLegId: "leg-a",
      request: { contextKind: "booking", contextRecordId: "booking-b" },
      source,
    });
    expect(context).toBeNull();
  });

  it("rejects a route outside the authenticated leg", async () => {
    const context = await buildManagerAssistantContext({
      authenticatedLegId: "leg-a",
      request: { contextKind: "route", contextRecordId: "trip-b" },
      source,
    });
    expect(context).toBeNull();
  });
});
