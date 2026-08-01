import { describe, expect, it } from "vitest";

import {
  createActivityInputSchema,
  editActivityInputSchema,
} from "@/features/activities/activity-input";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("createActivityInputSchema", () => {
  it("rejects blank activity text", () => {
    const result = createActivityInputSchema.safeParse({
      organizationId,
      kind: "note",
      body: "   ",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    });

    expect(result.success).toBe(false);
  });

  it("requires an organization, contact, or booking parent", () => {
    const result = createActivityInputSchema.safeParse({
      kind: "note",
      body: "Left a message.",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    });

    expect(result.success).toBe(false);
  });

  it("trims activity text and the edit reason", () => {
    expect(
      editActivityInputSchema.parse({
        activityId: organizationId,
        body: "  Confirmed the August date.  ",
        reason: "  Corrected call notes. ",
      }),
    ).toEqual({
      activityId: organizationId,
      body: "Confirmed the August date.",
      reason: "Corrected call notes.",
    });
  });
});
