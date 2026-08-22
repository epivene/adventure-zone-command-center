import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MarketingHomePage.tsx", import.meta.url), "utf8");

describe("Marketing workspace home", () => {
  it("uses shared CRM context instead of creating fake marketing data", () => {
    expect(source).toContain("shared profiles, contacts, and approved Google business context");
    expect(source).toContain('href="/profiles"');
    expect(source).toContain('href="/office-coordinator"');
  });

  it("reserves clear areas for future working campaign tools without dead links", () => {
    expect(source).toContain("Mass marketing emails");
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
