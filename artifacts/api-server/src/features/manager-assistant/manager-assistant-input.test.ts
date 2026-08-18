import { describe, expect, it } from "vitest";

import {
  managerAskInputSchema,
  managerContextInputSchema,
} from "./manager-assistant-input";

describe("manager assistant input", () => {
  it("accepts an event context without accepting a leg id", () => {
    const result = managerContextInputSchema.safeParse({
      contextKind: "booking",
      contextRecordId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
    if (result.success) expect("legId" in result.data).toBe(false);
  });

  it("rejects client supplied authorization leg ids", () => {
    expect(
      managerAskInputSchema.safeParse({
        legId: "22222222-2222-4222-8222-222222222222",
        contextKind: "operations",
        contextRecordId: "33333333-3333-4333-8333-333333333333",
        question: "Do we need a forklift?",
      }).success,
    ).toBe(false);
  });

  it("trims and bounds manager questions", () => {
    const valid = managerAskInputSchema.safeParse({
      contextKind: "booking",
      contextRecordId: "11111111-1111-4111-8111-111111111111",
      question: "  What time is setup?  ",
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.question).toBe("What time is setup?");

    expect(
      managerAskInputSchema.safeParse({
        contextKind: "leg",
        contextRecordId: "11111111-1111-4111-8111-111111111111",
        question: "x".repeat(4001),
      }).success,
    ).toBe(false);
  });

  it("accepts a valid IANA time zone and rejects made-up zones", () => {
    const valid = managerAskInputSchema.safeParse({
      contextKind: "booking",
      contextRecordId: "11111111-1111-4111-8111-111111111111",
      question: "What time did we check in?",
      timeZone: "America/Denver",
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.timeZone).toBe("America/Denver");

    expect(
      managerAskInputSchema.safeParse({
        contextKind: "booking",
        contextRecordId: "11111111-1111-4111-8111-111111111111",
        question: "What time did we check in?",
        timeZone: "Mountain-ish",
      }).success,
    ).toBe(false);
  });
});
