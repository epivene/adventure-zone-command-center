import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/ManagerIssuesAdminPage.tsx", "utf8");

describe("ManagerIssuesAdminPage safety oversight", () => {
  it("shows checklist safety issues alongside schedule issues", () => {
    expect(source).toContain("Event safety issues");
    expect(source).toContain("Checklist history");
    expect(source).toContain("Manager schedule issues");
    expect(source).toContain("/manager-admin/resource-condition-issues?state=open");
    expect(source).toContain("/manager-admin/events/checklists");
  });

  it("keeps issue resolution separate from lifecycle override", () => {
    expect(source).toContain("Resolve condition");
    expect(source).toContain("Allow ready to operate");
    expect(source).toContain("Allow checkout");
    expect(source).toContain("Override reason");
  });

  it("lets the admin open and remove saved checklist records and review-due items", () => {
    expect(source).toContain("Open record");
    expect(source).toContain("Remove from Review Due");
    expect(source).toContain("apiDelete(`/manager-admin/events/checklists/${run.id}`)");
    expect(source).toContain("apiDelete(`/manager-admin/reviews/due/${item.bookingId}`)");
  });
});
