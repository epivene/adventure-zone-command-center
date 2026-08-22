import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AdminCommandPanelPage.tsx", import.meta.url), "utf8");

describe("Admin Command Panel", () => {
  it("offers exactly the three approved day-to-day workspaces", () => {
    expect(source).toContain('title: "Booking"');
    expect(source).toContain('title: "Marketing"');
    expect(source).toContain('title: "Legs & Operations"');
    expect(source).toContain('href: "/today"');
    expect(source).toContain('href: "/marketing"');
    expect(source).toContain('href: "/routes"');
  });

  it("uses the approved plain-language workspace descriptions", () => {
    expect(source).toContain("Find it, contact it, book it.");
    expect(source).toContain("Promote it, mail it, campaign it.");
    expect(source).toContain("Route it, set it up, run it.");
  });

  it("keeps Admin Tools secondary instead of making it a fourth workspace card", () => {
    expect(source).toContain("Admin Tools");
    expect(source).toContain('href="/settings"');
    expect(source).toContain("clearBookingReturnPath");
  });
});
