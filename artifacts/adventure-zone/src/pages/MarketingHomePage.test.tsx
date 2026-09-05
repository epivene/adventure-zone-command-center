import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/MarketingHomePage.tsx", "utf8");

describe("Marketing workspace home", () => {
  it("keeps Marketing tools focused on marketing-owned work", () => {
    expect(source).toContain('href="/design-studio"');
    expect(source).not.toContain('href="/profiles"');
    expect(source).not.toContain('href="/office-coordinator"');
    expect(source).not.toContain('href="/research-sources"');
  });

  it("reserves clear areas for future working campaign tools without dead links", () => {
    expect(source).toContain("Email campaigns");
    expect(source).toContain("Brochures & promos");
    expect(source).toContain("Audiences & lists");
    expect(source).toContain("Campaign history");
  });

  it("restores a saved Booking location when one exists", () => {
    expect(source).toContain("readBookingReturnPath");
    expect(source).toContain("Back to Booking");
    expect(source).toContain('href={bookingReturnPath ?? "/today"}');
  });
});
