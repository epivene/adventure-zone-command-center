import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync("src/components/navigation/app-shell.tsx", "utf8");
const mobileSource = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("simple Admin shell", () => {
  it("keeps only Today Profiles Schedule and Menu in primary navigation", () => {
    expect(shellSource).toContain('{ href: "/today", label: "Today"');
    expect(shellSource).toContain('{ href: "/profiles", label: "Profiles"');
    expect(shellSource).toContain('{ href: "/schedule", label: "Schedule"');
    expect(shellSource).not.toContain('{ href: "/bookings", label: "Bookings"');
    expect(mobileSource).toContain("<AppMenu mobile />");
    expect(menuSource).toContain('aria-label="Menu"');
  });

  it("keeps lower-frequency destinations reachable from Menu", () => {
    for (const href of [
      "/bookings",
      "/calls/workspace",
      "/quick-add",
      "/contacts",
      "/routes",
      "/manager-communications",
      "/manager-finance",
      "/manager-crew",
      "/manager-aftermath",
      "/manager-issues",
      "/settings/act-migration",
      "/settings/act-recovery",
      "/settings/packages-resources",
    ]) {
      expect(menuSource).toContain(`href: "${href}"`);
    }
  });

  it("hides the floating assistant launcher while a full profile is open", () => {
    expect(shellSource).toContain("hideAssistantLauncher");
    expect(shellSource).toContain('location.startsWith("/profiles/")');
    expect(shellSource).toContain('location.startsWith("/event-profiles/")');
    expect(shellSource).toContain("!hideAssistantLauncher ? <AssistantLauncher /> : null");
  });
});
