import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync("src/components/navigation/app-shell.tsx", "utf8");
const launcherSource = readFileSync("src/components/assistant/assistant-launcher.tsx", "utf8");
const mobileSource = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const switcherSource = readFileSync("src/components/navigation/workspace-switcher.tsx", "utf8");

describe("workspace-aware Admin shell", () => {
  it("keeps the six canonical Booking destinations in the desktop top bar", () => {
    const bookingStart = shellSource.indexOf('if (workspace === "booking")');
    const operationsStart = shellSource.indexOf('if (workspace === "operations")');
    const bookingPrimary = shellSource.slice(bookingStart, operationsStart);

    for (const [href, label] of [
      ["/today", "Today"],
      ["/bookings", "Bookings"],
      ["/profiles", "Profiles"],
      ["/calls/workspace", "Calls"],
      ["/schedule", "Schedule"],
      ["/research-sources", "Research"],
    ]) expect(bookingPrimary).toContain(`{ href: "${href}", label: "${label}"`);
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

  it("gives Operations its own canonical primary navigation", () => {
    expect(shellSource).toContain('{ href: "/operations/legs", label: "Leg management"');
    expect(shellSource).toContain('{ href: "/manager-communications", label: "Communications"');
    expect(shellSource).toContain('{ href: "/manager-crew", label: "Crew"');
    expect(mobileSource).toContain('{ href: "/operations/legs", label: "Legs"');
  });

  it("keeps desktop Booking More focused on secondary work while mobile keeps overflow access", () => {
    expect(menuSource).toContain('const bookingMenuItems = mobile');
    expect(menuSource).toContain('item.label === "Office Coordinator" || item.label === "Needs Answer"');
    expect(menuSource).toContain('{ href: "/bookings", label: "Bookings" }');
    expect(menuSource).toContain('{ href: "/calls/workspace", label: "Calls" }');
    expect(menuSource).toContain('{ href: "/research-sources", label: "Research Sources" }');
    expect(menuSource).toContain('{ href: "/profiles", label: "Profiles" }');
    expect(menuSource).not.toContain('label: "Quick add"');
    expect(menuSource).not.toContain('label: "All contacts"');
  });

  it("keeps Admin Tools grouped and collapsed by default", () => {
    for (const label of ["Data & Imports", "Business Setup", "Connections", "System"]) {
      expect(menuSource).toContain(`label: "${label}"`);
    }
    expect(menuSource).toContain("isAdminToolGroup");
    for (const href of [
      "/settings/paper-notes",
      "/settings/act-migration",
      "/settings/act-recovery",
      "/settings/packages-resources",
    ]) expect(menuSource).toContain(`href: "${href}"`);
  });

  it("keeps mobile workspace access compact", () => {
    expect(mobileSource).toContain('{ href: "/command", label: "Panel"');
    expect(mobileSource).toContain("<AppMenu workspace={workspace} mobile />");
  });

  it("restores a saved Booking destination from Marketing", () => {
    expect(shellSource).toContain("readBookingReturnPath");
    expect(shellSource).toContain('label: "Back to Booking"');
    expect(mobileSource).toContain('label: "Booking", icon: ArrowLeft');
  });

  it("keeps Messages and Assistant as compact always-available desktop toolbar icons", () => {
    const toolbarStart = shellSource.indexOf('<div className="ml-auto flex items-center gap-1.5">');
    const toolbarEnd = shellSource.indexOf("</div>", toolbarStart);
    const toolbar = shellSource.slice(toolbarStart, toolbarEnd);

    expect(toolbar).toContain("<MessageBubbleLink");
    expect(toolbar).toContain('href="/manager-communications"');
    expect(toolbar).toContain('label="Messages"');
    expect(toolbar).toContain("unreadCount={unreadMessages}");
    expect(toolbar).toContain('<AssistantLauncher placement="toolbar" />');
    expect(toolbar.indexOf("<MessageBubbleLink")).toBeLessThan(toolbar.indexOf("<AssistantLauncher"));
    expect(toolbar).not.toContain('workspace === "operations" ? <MessageBubbleLink');
    expect(launcherSource).toContain('placement?: "toolbar" | "floating"');
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
