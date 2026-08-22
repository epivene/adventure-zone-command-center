import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

describe("workspace menu business-drive reconciliation", () => {
  it("preserves the newer workspace-aware menu architecture", () => {
    expect(source).toContain("groupsForWorkspace");
    expect(source).toContain("AdminWorkspace");
    expect(source).toContain("AppearanceChoices");
    expect(source).toContain("saveBookingReturnPath");
  });

  it("keeps Business Drive tools under Admin Tools", () => {
    expect(source).toContain('{ href: "/settings/business-sources", label: "Business sources" }');
    expect(source).toContain('{ href: "/imports/attendance-history", label: "Attendance history" }');
    expect(source).toContain('{ href: "/settings/communication-templates", label: "Email templates" }');
  });
});
