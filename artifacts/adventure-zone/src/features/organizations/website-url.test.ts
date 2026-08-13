import { describe, expect, it } from "vitest";

import { normalizeExternalWebsite } from "./website-url";

describe("normalizeExternalWebsite", () => {
  it.each([
    ["waterlanternfestival.com", "https://waterlanternfestival.com/"],
    ["https://waterlanternfestival.com/reno", "https://waterlanternfestival.com/reno"],
    ["http://example.com", "http://example.com/"],
    ["javascript:alert(1)", null],
    ["ftp://example.com", null],
    ["not a website", null],
    [null, null],
  ])("normalizes %j to %j", (value, expected) => {
    expect(normalizeExternalWebsite(value)).toBe(expected);
  });
});
