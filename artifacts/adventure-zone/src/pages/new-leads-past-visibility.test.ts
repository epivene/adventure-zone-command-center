import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/BookingsPage.tsx", "utf8");
const list = readFileSync("src/components/bookings/booking-list.tsx", "utf8");

describe("new lead deep link visibility", () => {
  it("shows past-dated leads when opened from the New leads status link", () => {
    expect(page).toContain('initialShowPast={initialStatus === "new_lead"}');
    expect(list).toContain("initialShowPast = false");
    expect(list).toContain("useState(initialShowPast)");
  });
});
