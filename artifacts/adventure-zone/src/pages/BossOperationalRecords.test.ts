import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Boss operational record controls", () => {
  it("opens and removes saved maintenance records", () => {
    const source = readFileSync("src/pages/BossMaintenancePage.tsx", "utf8");
    expect(source).toContain("Open record");
    expect(source).toContain("Close record");
    expect(source).toContain("bossDelete(`/boss/maintenance/${item.id}`)");
  });

  it("removes obsolete review-due items", () => {
    const source = readFileSync("src/pages/BossReviewsPage.tsx", "utf8");
    expect(source).toContain("Remove from Review Due");
    expect(source).toContain("bossDelete(`/boss/reviews/due/${item.bookingId}`)");
  });

  it("lets the admin permanently remove office tasks", () => {
    const source = readFileSync("src/pages/OfficeCoordinatorAdminPage.tsx", "utf8");
    expect(source).toContain("Remove “${task.title}” permanently?");
    expect(source).toContain("apiDelete(`/office-admin/tasks/${task.id}`)");
  });
});