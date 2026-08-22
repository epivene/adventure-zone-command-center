import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const marketing = readFileSync("src/pages/MarketingHomePage.tsx", "utf8");

describe("dark theme surfaces and booking creation routing", () => {
  it("routes /bookings/new to the creation page before the booking id route", () => {
    expect(app).toContain('import BookingNewPage from "@/pages/BookingNewPage";');
    const newRoute = app.indexOf('<Route path="/bookings/new" component={BookingNewPage} />');
    const detailRoute = app.indexOf('<Route path="/bookings/:id">');
    expect(newRoute).toBeGreaterThan(-1);
    expect(detailRoute).toBeGreaterThan(newRoute);
  });

  it("uses theme-aware Marketing setup surfaces", () => {
    expect(marketing).toContain("bg-card");
    expect(marketing).toContain("border-border");
    expect(marketing).toContain("text-muted-foreground");
    expect(marketing).not.toContain("bg-slate-100/70");
  });
});
