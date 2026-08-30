import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookingsPageSource = readFileSync("src/pages/BookingsPage.tsx", "utf8");
const todayPageSource = readFileSync("src/pages/TodayPage.tsx", "utf8");
const todayFocusSource = readFileSync("src/features/today/today-focus.ts", "utf8");

describe("profile-first booking navigation", () => {
  it("redirects the legacy top-level Bookings list to Profiles", () => {
    expect(bookingsPageSource).toContain('<Redirect to="/profiles" />');
    expect(bookingsPageSource).not.toContain('apiGet<any>("/bookings")');
  });

  it("routes Today booking work into Profiles instead of the hidden list", () => {
    expect(todayPageSource).not.toContain('href="/bookings"');
    expect(todayFocusSource).toContain('primaryHref: "/profiles"');
    expect(todayFocusSource).not.toContain('primaryHref: "/bookings"');
  });
});
