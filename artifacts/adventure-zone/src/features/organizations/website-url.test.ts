import { describe, expect, it } from "vitest";

import { normalizeExternalWebsite } from "./website-url";

describe("normalizeExternalWebsite", () => {
  it.each([
    ["waterlanternfestival.com", "https://waterlanternfestival.com/"],
    ["https://waterlanternfestival.com/reno", "https://waterlanternfestival.com/reno"],
    ["http://example.com", "http://example.com/"],
    ["example.com:443/path", "https://example.com/path"],
    ["localhost:3000", "https://localhost:3000/"],
    ["javascript:alert(1)", null],
    ["ftp://example.com", null],
    ["not a website", null],
    [null, null],
  ])("normalizes %j to %j", (value, expected) => {
    expect(normalizeExternalWebsite(value)).toBe(expected);
  });
});
