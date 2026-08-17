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
        city: "Town",
        region: "ND",
        startsAt: "2026-08-20T12:00:00.000Z",
        endsAt: "2026-08-21T12:00:00.000Z",
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
    sources: [],
    generatedAt: "2026-08-17T00:00:00.000Z",
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

  it("escalates unsupported operational questions instead of guessing", () => {
    const answer = answerManagerDeterministically({
      question: "What generator model should I rent?",
      context: context(),
    });
    expect(answer?.needsAdmin).toBe(true);
    expect(answer?.escalationReason).toMatch(/saved operational/i);
  });
});
