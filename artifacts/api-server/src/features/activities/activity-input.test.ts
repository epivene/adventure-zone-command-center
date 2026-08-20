import { describe, expect, it } from "vitest";

import { createActivityInputSchema } from "./activity-input";

describe("createActivityInputSchema", () => {
  it("accepts the ISO timestamp shape produced by JSON note requests", () => {
    const result = createActivityInputSchema.safeParse({
      organizationId: "10000000-0000-4000-8000-000000000001",
      kind: "note",
      body: "Called the organizer and left a voicemail.",
      occurredAt: "2026-08-20T02:30:00.000Z",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.occurredAt).toBeInstanceOf(Date);
    expect(result.data.occurredAt.toISOString()).toBe("2026-08-20T02:30:00.000Z");
  });

  it("still rejects an invalid timestamp", () => {
    const result = createActivityInputSchema.safeParse({
      organizationId: "10000000-0000-4000-8000-000000000001",
      kind: "note",
      body: "Called the organizer.",
      occurredAt: "not-a-date",
    });

    expect(result.success).toBe(false);
  });
});
