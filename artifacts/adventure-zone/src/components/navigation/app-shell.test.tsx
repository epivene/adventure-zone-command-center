import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync("src/components/navigation/app-shell.tsx", "utf8");
const launcherSource = readFileSync("src/components/assistant/assistant-launcher.tsx", "utf8");
const mobileSource = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const switcherSource = readFileSync("src/components/navigation/workspace-switcher.tsx", "utf8");

describe("workspace-aware Admin shell", () => {
  it("keeps the Booking top bar focused on Today Profiles and Schedule", () => {
    const bookingStart = shellSource.indexOf('if (workspace === "booking")');
    const operationsStart = shellSource.indexOf('if (workspace === "operations")');
    const bookingPrimary = shellSource.slice(bookingStart, operationsStart);

    expect(bookingPrimary).toContain('{ href: "/today", label: "Today"');
    expect(bookingPrimary).toContain('{ href: "/profiles", label: "Profiles"');
    expect(bookingPrimary).toContain('{ href: "/schedule", label: "Schedule"');
    expect(bookingPrimary).not.toContain('label: "Marketing"');
  });

  it("uses the workspace identity as the single workspace switcher", () => {
    expect(shellSource).toContain("<WorkspaceSwitcher");
    expect(switcherSource).toContain("Adventure Zone");
    expect(switcherSource).toContain("Booking");
    expect(switcherSource).toContain("Marketing");
    expect(switcherSource).toContain("Legs & Operations");
    expect(switcherSource).toContain("Command Panel");
    expect(switcherSource).toContain("Admin Tools");
  });

  it("gives Operations its own primary navigation", () => {
    expect(shellSource).toContain('{ href: "/routes", label: "Legs & Routes"');
    expect(shellSource).toContain('{ href: "/manager-communications", label: "Communications"');
    expect(shellSource).toContain('{ href: "/manager-crew", label: "Crew"');
  });

  it("keeps the Booking overflow menu short and nonduplicative", () => {
    const bookingStart = menuSource.indexOf("const bookingItems");
    const operationsStart = menuSource.indexOf("const operationsGroups");
    const bookingMenu = menuSource.slice(bookingStart, operationsStart);

    expect(bookingMenu).toContain('{ href: "/bookings", label: "Bookings" }');
    expect(bookingMenu).toContain('{ href: "/calls/workspace", label: "Calls" }');
    expect(bookingMenu).toContain('{ href: "/office-coordinator", label: "Office Coordinator" }');
    expect(bookingMenu).toContain('{ href: "/research-sources", label: "Research Sources" }');
    expect(bookingMenu).toContain('{ href: "/contacts", label: "All contacts" }');
    expect(bookingMenu).not.toContain('label: "Marketing"');
    expect(bookingMenu).not.toContain('label: "Quick add"');
  });

  it("keeps Admin Tools available without expanding it by default", () => {
    expect(menuSource).toContain('label: "Admin Tools"');
    expect(menuSource).toContain('const expanded = openGroups[group.label] ?? (index === 0 && workspace !== "booking")');
    for (const href of [
      "/settings/paper-notes",
      "/settings/act-migration",
      "/settings/act-recovery",
      "/settings/packages-resources",
    ]) expect(menuSource).toContain(`href: "${href}"`);
  });

  it("keeps mobile workspace access available", () => {
    expect(mobileSource).toContain('{ href: "/command", label: "Panel"');
    expect(mobileSource).toContain("<AppMenu mobile");
  });

  it("restores a saved Booking destination from Marketing", () => {
    expect(shellSource).toContain("readBookingReturnPath");
    expect(shellSource).toContain('label: "Back to Booking"');
    expect(mobileSource).toContain('label: "Booking", icon: ArrowLeft');
  });

  it("restores the assistant as a compact desktop top-toolbar button", () => {
    expect(shellSource).toContain('<AssistantLauncher placement="toolbar" />');
    expect(launcherSource).toContain('placement?: "toolbar" | "floating"');
    expect(launcherSource).toContain('placement === "toolbar"');
    expect(launcherSource).toContain('aria-label="Open Booking Assistant"');
  });

  it("keeps the floating assistant only on mobile and hides it on full profiles", () => {
    expect(shellSource).toContain("hideFloatingAssistantLauncher");
    expect(shellSource).toContain('location.startsWith("/profiles/")');
    expect(shellSource).toContain('location.startsWith("/event-profiles/")');
    expect(shellSource).toContain('<AssistantLauncher placement="floating" />');
    expect(launcherSource).toContain("md:hidden");
  });
});
