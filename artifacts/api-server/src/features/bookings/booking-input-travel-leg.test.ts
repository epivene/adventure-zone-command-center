import { describe, expect, it } from "vitest";

import { bookingInputSchema } from "./booking-input";

const baseInput = {
  name: "Example Fair",
  city: "Fargo",
  region: "ND",
  probability: "possible" as const,
  status: "interested" as const,
  nextActionKind: "follow_up",
  nextActionDueAt: "2026-09-20",
};

describe("booking create input travel leg", () => {
  it("preserves a selected travel leg for initial manual assignment", () => {
    const travelLegId = "10000000-0000-4000-8000-000000000001";
    const parsed = bookingInputSchema.parse({ ...baseInput, travelLegId });
    expect(parsed.travelLegId).toBe(travelLegId);
  });

  it("normalizes an empty travel leg selection to null", () => {
    const parsed = bookingInputSchema.parse({ ...baseInput, travelLegId: "" });
    expect(parsed.travelLegId).toBeNull();
  });
});
