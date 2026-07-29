import { describe, expect, it } from "vitest";

import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";

describe("normalizeNorthAmericanPhone", () => {
  it.each([
    ["(406) 555-0101", "+14065550101"],
    ["1-406-555-0101", "+14065550101"],
    ["+1 406 555 0101", "+14065550101"],
  ])("normalizes %s", (value, expected) => {
    expect(normalizeNorthAmericanPhone(value)).toBe(expected);
  });

  it("rejects extensions instead of silently matching a different caller", () => {
    expect(normalizeNorthAmericanPhone("406-555-0101 ext. 8")).toBeNull();
    expect(normalizeNorthAmericanPhone("406-555-0101ext.8")).toBeNull();
    expect(normalizeNorthAmericanPhone("406-555-0101 x8")).toBeNull();
  });
});
