import { describe, expect, it } from "vitest";

import {
  normalizeRecipientBlockEmail,
  parseRecipientCommunicationBlockTarget,
} from "./communication-block-target";

describe("communication-block recipient route input", () => {
  it("accepts and normalizes an ordinary recipient address", () => {
    expect(normalizeRecipientBlockEmail("  Person@Example.com  ")).toBe("person@example.com");
    expect(parseRecipientCommunicationBlockTarget({
      targetType: "recipient_email",
      normalizedEmail: "  Person@Example.com  ",
    })).toEqual({
      targetType: "recipient_email",
      normalizedEmail: "person@example.com",
    });
  });

  it.each([
    "",
    "person",
    "person@example",
    "person @example.com",
    "person@example .com",
    "person@example.com extra",
  ])("rejects malformed recipient target %j", (normalizedEmail) => {
    expect(parseRecipientCommunicationBlockTarget({
      targetType: "recipient_email",
      normalizedEmail,
    })).toBeNull();
  });

  it("rejects recipient payloads with a second stable target", () => {
    expect(parseRecipientCommunicationBlockTarget({
      targetType: "recipient_email",
      normalizedEmail: "person@example.com",
      organizationId: "10000000-0000-4000-8000-000000000001",
    })).toBeNull();
  });
});
