import { describe, expect, it } from "vitest";

import { normalizeNanpPhone } from "./nanp-phone";

describe("normalizeNanpPhone", () => {
  it.each([
    ["(555) 123-4567", "+15551234567"],
    ["555.123.4567", "+15551234567"],
    ["1-555-123-4567", "+15551234567"],
    ["+1 (555) 123-4567", "+15551234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeNanpPhone(input)).toBe(expected);
  });

  it.each([
    "555-123-4567 ext 9",
    "555-123-4567 extension 9",
    "555-123-4567 x9",
    "911",
    "*67",
    "+44 20 7946 0958",
    "+5551234567",
    "155-123-4567",
    "call 555-123-4567",
    "++1 555 123 4567",
    "",
  ])("rejects non-callable input %s", (input) => {
    expect(normalizeNanpPhone(input)).toBeNull();
  });
});
