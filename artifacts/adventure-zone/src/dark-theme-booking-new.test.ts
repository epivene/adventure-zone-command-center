import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookings = readFileSync("src/pages/BookingsPage.tsx", "utf8");
const marketing = readFileSync("src/pages/MarketingHomePage.tsx", "utf8");

describe("dark theme surfaces and booking creation routing", () => {
  it("sends Add Event / Lead into the working Quick Add flow", () => {
    expect(bookings).toContain('href="/quick-add"');
    expect(bookings).not.toContain('href="/bookings/new"');
  });

  it("uses theme-aware Marketing setup surfaces", () => {
    expect(marketing).toContain("bg-card");
    expect(marketing).toContain("border-border");
    expect(marketing).toContain("text-muted-foreground");
    expect(marketing).not.toContain("bg-slate-100/70");
  });
});
