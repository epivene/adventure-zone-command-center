import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/assistant/booking-context-repository.ts", "utf8");

describe("Booking Assistant booking schedule context", () => {
  it("loads start, end, venue, city, and region for current and related bookings", () => {
    expect(source.match(/ends_at/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source.match(/venue_name/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source.match(/\bcity\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source.match(/\bregion\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source).toContain("endsAt: dateOrNull(row.ends_at)");
    expect(source).toContain("venueName:");
    expect(source).toContain("city:");
    expect(source).toContain("region:");
  });
});
