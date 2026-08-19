import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const today = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");
const needsAttention = fs.readFileSync(path.resolve(__dirname, "../components/today/needs-attention.tsx"), "utf8");
const bookingsPage = fs.readFileSync(path.resolve(__dirname, "BookingsPage.tsx"), "utf8");
const bookingList = fs.readFileSync(path.resolve(__dirname, "../components/bookings/booking-list.tsx"), "utf8");

describe("Needs attention new-lead navigation", () => {
  it("opens the full new-lead list instead of one profile", () => {
    expect(needsAttention).toContain('href: "/bookings?status=new_lead"');
    expect(today).not.toContain("firstNewLead");
    expect(today).not.toContain("newLeadHref");
  });

  it("initializes the Bookings status filter from the URL", () => {
    expect(bookingsPage).toContain("useSearch");
    expect(bookingsPage).toContain('params.get("status")');
    expect(bookingsPage).toContain("initialStatus");
    expect(bookingList).toContain("initialStatus");
    expect(bookingList).toContain("useState(initialStatus)");
  });
});
