import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync("src/components/navigation/app-shell.tsx", "utf8");
const launcherSource = readFileSync("src/components/assistant/assistant-launcher.tsx", "utf8");
const mobileSource = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");
const menuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const switcherSource = readFileSync("src/components/navigation/workspace-switcher.tsx", "utf8");
const bookingNavigationSource = readFileSync("src/features/navigation/booking-navigation.ts", "utf8");

describe("workspace-aware Admin shell", () => {
  it("uses a persistent token-based sidebar for core desktop navigation", () => {
    expect(shellSource).toContain("const showWorkspaceNavigation = primaryItems.length > 0;");
    expect(shellSource).toContain("fixed inset-y-0 left-0");
    expect(shellSource).toContain("bg-sidebar");
    expect(shellSource).toContain('aria-label="Main navigation"');
    expect(shellSource).toContain('aria-current={active ? "page" : undefined}');
    expect(shellSource).toContain("md:ml-60");
    expect(shellSource).toContain("<MobileBottomNav workspace={workspace}");
  });

  it("keeps core Booking destinations and Website Inquiries in the desktop sidebar", () => {
    const bookingStart = shellSource.indexOf('if (workspace === "booking")');
    const operationsStart = shellSource.indexOf('if (workspace === "operations")');
    const bookingPrimary = shellSource.slice(bookingStart, operationsStart);

    expect(bookingPrimary).toContain("bookingNavigation()");
    for (const href of ["/today", "/profiles", "/emails", "/website-inquiries", "/business-documents", "/schedule"]) {
      expect(bookingNavigationSource).toContain(`href: "${href}"`);
    }
    expect(bookingNavigationSource).toContain('label: "Website Inquiries"');
    expect(bookingNavigationSource).toContain("!mobile");
    expect(bookingPrimary).not.toContain('label: "Marketing"');
  });

  it("polls the inquiry count independently on the existing cadence", () => {
    expect(shellSource).toContain('apiGet<{ newCount: number }>("/website-inquiries/count")');
    expect(shellSource).toContain("setWebsiteInquiryCount");
    expect(shellSource).toContain("60000");
    expect(shellSource).toContain("websiteInquiryCount > 99");
    expect(shellSource).toContain("<MobileBottomNav workspace={workspace} websiteInquiryCount={websiteInquiryCount}");
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

  it("puts secondary Booking work under the desktop Booking tools submenu", () => {
    expect(menuSource).toContain('label="Booking tools"');
    expect(menuSource).toContain("DropdownMenuSub");
    const bookingToolsStart = menuSource.indexOf("const bookingItems");
    const bookingToolsEnd = menuSource.indexOf("const operationsGroups");
    const bookingTools = menuSource.slice(bookingToolsStart, bookingToolsEnd);
    for (const [href, label] of [
      ["/profiles", "Profiles"],
      ["/calls/workspace", "Calls"],
      ["/research-sources", "Research Sources"],
      ["/needs-answer", "Needs Answer"],
    ]) expect(bookingTools).toContain(`{ href: "${href}", label: "${label}"`);
    expect(bookingTools).not.toContain('{ href: "/bookings", label: "Bookings" }');
    expect(bookingTools).not.toContain('{ href: "/office-coordinator", label: "Office Coordinator" }');
  });

  it("keeps Admin Tools grouped and progressively disclosed", () => {
    for (const label of ["Data & Imports", "Business Setup", "Connections", "System"]) {
      expect(menuSource).toContain(`label: "${label}"`);
    }
    expect(menuSource).toContain('label="Administration"');
    expect(menuSource).toContain("nestedGroups");
    expect(menuSource).toContain("DropdownMenuSubContent");
    for (const href of [
      "/settings/paper-notes",
      "/settings/act-migration",
      "/settings/act-recovery",
      "/settings/packages-resources",
    ]) expect(menuSource).toContain(`href: "${href}"`);
  });

  it("keeps mobile workspace access compact", () => {
    expect(mobileSource).toContain('{ href: "/command", label: "Panel"');
    expect(mobileSource).toContain("<AppMenu workspace={workspace} mobile websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} searchItems={searchItems} />");
  });

  it("reserves space below mobile content for the fixed navigation and clips horizontal overflow", () => {
    expect(shellSource).toContain("min-w-0 overflow-x-clip");
    expect(shellSource).toContain("pb-32 md:min-h-screen");
    expect(mobileSource).toContain("env(safe-area-inset-bottom)");
  });

  it("restores a saved Booking destination from Marketing", () => {
    expect(shellSource).toContain("readBookingReturnPath");
    expect(shellSource).toContain('label: "Back to Booking"');
    expect(mobileSource).toContain('label: "Booking", icon: ArrowLeft');
  });

  it("keeps Messages and Assistant in the desktop overflow with accessible state", () => {
    expect(shellSource).toContain("<AppMenu workspace={workspace} unreadMessages={unreadMessages} websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} />");
    expect(menuSource).toContain('href="/manager-communications"');
    expect(menuSource).toContain("unreadMessages > 0");
    expect(menuSource).toContain('aria-label={unreadMessages ? `Messages, ${unreadMessages} unread` : "Messages"}');
    expect(menuSource).toContain("openAssistant");
    expect(menuSource).toContain("Assistant workspace");
    expect(menuSource).toContain("Older conversations & tools");
    expect(shellSource).not.toContain('<AssistantLauncher placement="toolbar" />');
    expect(launcherSource).toContain('placement?: "toolbar" | "floating"');
    expect(launcherSource).toContain('aria-label="Open Assistant"');
  });

  it("keeps the shared assistant drawer and hides mobile navigation on full profiles", () => {
    expect(shellSource).toContain("immersiveProfile");
    expect(shellSource).toContain('location.startsWith("/profiles/")');
    expect(shellSource).toContain('location.startsWith("/event-profiles/")');
    expect(shellSource).toContain("const { isOpen } = useAssistantContext()");
    expect(shellSource).toContain("if (isOpen) setAssistantRequested(true)");
    expect(shellSource).toContain("<AssistantDrawer />");
    expect(shellSource).toContain('{!immersiveProfile ? <div className="print:hidden"><MobileBottomNav');
  });
});
