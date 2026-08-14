/**
 * Unit tests for the location repository helpers.
 *
 * These tests focus on the pure logic and input-validation helpers that don't
 * require a live database connection (e.g. normalizeWebsite).
 *
 * Database-backed integration tests live in the sibling pglite test file.
 */
import { describe, expect, it } from "vitest";
import { inferLocationTravelLegId, normalizeWebsite } from "./location-repository";

describe("normalizeWebsite", () => {
  it("returns null for null input", () => {
    expect(normalizeWebsite(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeWebsite(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeWebsite("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeWebsite("   ")).toBeNull();
  });

  it("prepends https:// when no protocol is present", () => {
    expect(normalizeWebsite("example.com")).toBe("https://example.com");
  });

  it("prepends https:// for paths with no protocol", () => {
    expect(normalizeWebsite("www.example.com/path")).toBe("https://www.example.com/path");
  });

  it("preserves an existing https:// protocol", () => {
    expect(normalizeWebsite("https://example.com")).toBe("https://example.com");
  });

  it("preserves an existing http:// protocol", () => {
    expect(normalizeWebsite("http://example.com")).toBe("http://example.com");
  });

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeWebsite("  example.com  ")).toBe("https://example.com");
  });

  it("trims whitespace from an already-prefixed URL", () => {
    expect(normalizeWebsite("  https://example.com  ")).toBe("https://example.com");
  });

  it("is case-insensitive for the protocol check", () => {
    expect(normalizeWebsite("HTTPS://example.com")).toBe("HTTPS://example.com");
    expect(normalizeWebsite("HTTP://example.com")).toBe("HTTP://example.com");
  });
});

describe("inferLocationTravelLegId", () => {
  it("uses a leg when all assigned bookings agree", () => {
    expect(inferLocationTravelLegId([null, "north", "north"])).toBe("north");
  });

  it("leaves ambiguous and booking-less locations unassigned", () => {
    expect(inferLocationTravelLegId(["north", "south"])).toBeNull();
    expect(inferLocationTravelLegId([null, undefined])).toBeNull();
  });
});
