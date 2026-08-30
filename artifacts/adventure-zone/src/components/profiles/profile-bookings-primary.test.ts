import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");

describe("bookings inside the permanent event profile", () => {
  it("opens the profile's booking records by default when they exist", () => {
    expect(source).toContain('profile.bookings.length ? "events" : null');
    expect(source).toContain('label="Bookings"');
    expect(source).toContain('>Bookings & opportunities</h2>');
    expect(source).not.toContain('label="Upcoming events"');
  });

  it("keeps individual yearly booking details reachable from the profile", () => {
    expect(source).toContain('href={`/bookings/${booking.id}`}');
    expect(source).toContain('{booking.status.replaceAll("_", " ")}');
  });
});
