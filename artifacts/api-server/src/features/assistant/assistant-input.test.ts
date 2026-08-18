import { describe, expect, it } from "vitest";

import { askBookingAssistantInputSchema } from "./assistant-input";

const baseInput = {
  contextKind: "booking" as const,
  contextRecordId: "2b277ed7-6a50-4bc4-a0ba-357dfdcb4bb9",
  question: "What time is the event?",
};

describe("askBookingAssistantInputSchema time zone", () => {
  it("accepts an IANA time zone so schedule answers match the staff device", () => {
    const parsed = askBookingAssistantInputSchema.parse({
      ...baseInput,
      timeZone: "America/Denver",
    });

    expect(parsed.timeZone).toBe("America/Denver");
  });

  it("rejects an invalid time zone instead of silently formatting the wrong time", () => {
    expect(
      askBookingAssistantInputSchema.safeParse({
        ...baseInput,
        timeZone: "Miles City Standard Time",
      }).success,
    ).toBe(false);
  });

  it("remains compatible with older clients that do not send a time zone", () => {
    expect(askBookingAssistantInputSchema.safeParse(baseInput).success).toBe(true);
  });
});
