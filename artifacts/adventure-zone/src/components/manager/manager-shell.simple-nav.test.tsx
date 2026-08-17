import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navSource = readFileSync("src/components/manager/manager-mobile-nav.tsx", "utf8");
const menuSource = readFileSync("src/components/manager/manager-menu.tsx", "utf8");

describe("simple manager navigation", () => {
  it("uses Home Schedule Money Crew Menu as primary destinations", () => {
    expect(navSource).toContain('{ href: "/manager", label: "Home"');
    expect(navSource).toContain('{ href: "/manager/route", label: "Schedule"');
    expect(navSource).toContain('{ href: "/manager/money", label: "Money"');
    expect(navSource).toContain('{ href: "/manager/crew", label: "Crew"');
    expect(navSource).toContain("<ManagerMenu");
    expect(navSource).not.toContain('label: "Messages"');
  });

  it("keeps manager tools reachable from Menu", () => {
    for (const href of ["/manager/receipts", "/manager/operations", "/manager/reviews", "/manager/incidents", "/manager/messages"]) {
      expect(menuSource).toContain(`href: "${href}"`);
    }
  });
});
