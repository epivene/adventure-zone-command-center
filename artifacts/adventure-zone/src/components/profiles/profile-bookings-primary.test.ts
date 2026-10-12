import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");

describe("bookings inside the permanent event profile", () => {
  it("groups bookings under the profile's Records destination", () => {
    expect(source).toContain('label: "Records"');
    expect(source).toContain('const recordsOpen = ["contacts", "events", "documents"]');
    expect(source).toContain('>Bookings & opportunities</h2>');
    expect(source).not.toContain('label="Upcoming events"');
  });

  it("keeps individual yearly booking details reachable from the profile", () => {
    expect(source).toContain('href={`${routePrefix}/bookings/${booking.id}`}');
    expect(source).toContain('{booking.status.replaceAll("_", " ")}');
  });
});
