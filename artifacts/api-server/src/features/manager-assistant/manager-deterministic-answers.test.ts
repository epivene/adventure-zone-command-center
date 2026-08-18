import { describe, expect, it } from "vitest";

import { answerManagerDeterministically } from "./manager-deterministic-answers";
import type { ManagerAssistantContextBundle } from "./manager-assistant-types";

function context(): ManagerAssistantContextBundle {
  return {
    leg: { id: "leg-a", name: "Leg A" },
    activeContext: { kind: "booking", recordId: "booking-a", label: "County Fair" },
    assignedEvents: [
      {
        id: "booking-a",
        name: "County Fair",
        city: "Miles City",
        region: "MT",
        startsAt: "2026-08-18T17:00:00.000Z",
        endsAt: "2026-08-19T01:00:00.000Z",
        checkedInAt: "2026-08-18T02:58:00.000Z",
        checkedOutAt: null,
        checkInTimeZone: null,
        checkOutTimeZone: null,
        status: "confirmed",
        packageNames: ["Adventure Zone"],
        resourceNames: ["Paintball"],
        setupSummary: "Forklift confirmed for Thursday setup.",
      },
    ],
    activeEvent: null,
    route: {
      tripId: "trip-a",
      label: "Leg A Route",
      startDate: null,
      endDate: null,
      stops: [{ bookingId: "booking-a", label: "County Fair", sortOrder: 1 }],
    },
    handoffs: [{ id: "handoff-a", summary: "Paintball meetup at Highway 22 at 8 PM." }],
    acknowledgments: [{ id: "ack-a", summary: "New setup time needs acknowledgment." }],
    operationalInstructions: [{ id: "booking:booking-a", summary: "County Fair: Forklift confirmed for Thursday setup." }],
    knowledge: [],
    sources: [{ id: "manager_booking_booking-a", kind: "booking", recordId: "booking-a", label: "County Fair", occurredAt: "2026-08-18T17:00:00.000Z" }],
    generatedAt: "2026-08-18T03:00:00.000Z",
  };
}

describe("manager deterministic answers", () => {
  it("answers setup questions from authorized operational instructions", () => {
    const answer = answerManagerDeterministically({
      question: "Do we need a forklift?",
      context: context(),
    });
    expect(answer?.needsAdmin).toBe(false);
    expect(answer?.text).toContain("Forklift confirmed");
  });

  it("answers equipment meetup questions without cloud AI", () => {
    const answer = answerManagerDeterministically({
      question: "Where is the paintball meetup?",
      context: context(),
    });
    expect(answer?.needsAdmin).toBe(false);
    expect(answer?.text).toContain("Highway 22");
  });

  it("answers actual check-in time instead of scheduled event start", () => {
    const answer = answerManagerDeterministically({
      question: "What time did we check in?",
      context: context(),
      timeZone: "America/Denver",
    });
    expect(answer?.needsAdmin).toBe(false);
    expect(answer?.mode).toBe("deterministic");
    expect(answer?.text).toMatch(/checked in/i);
    expect(answer?.text).toMatch(/8:58 PM/);
    expect(answer?.text).not.toMatch(/17:00 UTC/);
    expect(answer?.sources.map((source) => source.recordId)).toContain("booking-a");
  });

  it("prefers the saved lifecycle time zone when present", () => {
    const value = context();
    value.assignedEvents[0]!.checkInTimeZone = "America/Denver";
    const answer = answerManagerDeterministically({
      question: "When did we check in?",
      context: value,
      timeZone: "America/Chicago",
    });
    expect(answer?.text).toMatch(/8:58 PM/);
  });

  it("answers actual check-out time separately from the event end time", () => {
    const value = context();
    value.assignedEvents[0]!.checkedOutAt = "2026-08-19T04:15:00.000Z";
    value.assignedEvents[0]!.checkOutTimeZone = "America/Denver";
    const answer = answerManagerDeterministically({
      question: "What time did we check out?",
      context: value,
      timeZone: "America/Chicago",
    });
    expect(answer?.text).toMatch(/checked out/i);
    expect(answer?.text).toMatch(/10:15 PM/);
  });

  it("escalates unsupported operational questions instead of guessing", () => {
    const answer = answerManagerDeterministically({
      question: "What generator model should I rent?",
      context: context(),
    });
    expect(answer?.needsAdmin).toBe(true);
    expect(answer?.escalationReason).toMatch(/saved operational/i);
  });
});
