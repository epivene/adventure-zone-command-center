import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync("src/components/navigation/app-shell.tsx", "utf8");
const mobileSource = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("workspace-aware Admin shell", () => {
  it("keeps Booking focused on Today Profiles Schedule plus a Marketing shortcut", () => {
    expect(shellSource).toContain('{ href: "/today", label: "Today"');
    expect(shellSource).toContain('{ href: "/profiles", label: "Profiles"');
    expect(shellSource).toContain('{ href: "/schedule", label: "Schedule"');
    expect(shellSource).toContain('{ href: "/marketing", label: "Marketing"');
    expect(shellSource).toContain("saveBookingReturnPath(location)");
  });

  it("gives Operations its own primary navigation", () => {
    expect(shellSource).toContain('{ href: "/routes", label: "Legs & Routes"');
    expect(shellSource).toContain('{ href: "/manager-communications", label: "Communications"');
    expect(shellSource).toContain('{ href: "/manager-crew", label: "Crew"');
  });

  it("keeps Command Panel permanently reachable", () => {
    expect(shellSource).toContain('href="/command"');
    expect(shellSource).toContain("Command Panel");
    expect(mobileSource).toContain('{ href: "/command", label: "Panel"');
    expect(menuSource).toContain('<Link href="/command">Command Panel</Link>');
  });

  it("separates Booking and Operations menu contents", () => {
    expect(menuSource).toContain("const bookingGroups");
    expect(menuSource).toContain("const operationsGroups");
    expect(menuSource).toContain('{ href: "/calls/workspace", label: "Calls" }');
    expect(menuSource).toContain('{ href: "/manager-finance", label: "Finances" }');
    expect(menuSource).toContain('if (workspace === "booking") return bookingGroups');
    expect(menuSource).toContain('if (workspace === "operations") return operationsGroups');
  });

  it("keeps Admin Tools compact but reachable from every working workspace", () => {
    expect(menuSource).toContain('label: "Admin Tools"');
    for (const href of [
      "/settings/paper-notes",
      "/settings/act-migration",
      "/settings/act-recovery",
      "/settings/packages-resources",
    ]) expect(menuSource).toContain(`href: "${href}"`);
  });

  it("restores a saved Booking destination from Marketing", () => {
    expect(shellSource).toContain("readBookingReturnPath");
    expect(shellSource).toContain('label: "Back to Booking"');
    expect(mobileSource).toContain('label: "Booking", icon: ArrowLeft');
  });

  it("hides the floating assistant launcher while a full profile is open", () => {
    expect(shellSource).toContain("hideAssistantLauncher");
    expect(shellSource).toContain('location.startsWith("/profiles/")');
    expect(shellSource).toContain('location.startsWith("/event-profiles/")');
    expect(shellSource).toContain("!hideAssistantLauncher ? <AssistantLauncher /> : null");
  });
});
