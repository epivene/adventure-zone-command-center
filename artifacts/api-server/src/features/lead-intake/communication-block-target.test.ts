import { describe, expect, it } from "vitest";

import { normalizeRecipientBlockEmail } from "./communication-block-target";

describe("normalizeRecipientBlockEmail", () => {
  it("accepts and normalizes an ordinary recipient address", () => {
    expect(normalizeRecipientBlockEmail("  Person@Example.com  ")).toBe("person@example.com");
  });

  it.each([
    "",
    "person",
    "person@example",
    "person @example.com",
    "person@example .com",
    "person@example.com extra",
  ])("rejects malformed recipient target %j", (value) => {
    expect(normalizeRecipientBlockEmail(value)).toBeNull();
  });
});
