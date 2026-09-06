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
    expect(source).toContain("bossPatch(`/boss/reviews/${item.id}`");
    expect(source).toContain("bossDelete(`/boss/reviews/${item.id}`)");
  });

  it("shows receipt photos and keeps booking management out of Boss", () => {
    const receipts = readFileSync("src/pages/BossReceiptsPage.tsx", "utf8");
    const schedule = readFileSync("src/pages/BossSchedulePage.tsx", "utf8");
    const shell = readFileSync("src/components/boss/boss-shell.tsx", "utf8");
    expect(receipts).toContain("Open photo");
    expect(receipts).toContain("r.imageUrl");
    expect(schedule).toContain("Events assigned by Desie");
    expect(schedule).not.toContain("Booked Events");
    expect(schedule).not.toContain("assignBookingToLeg");
    expect(shell).not.toContain('label: "Bookings"');
  });

  it("lets the admin permanently remove office tasks", () => {
    const source = readFileSync("src/pages/OfficeCoordinatorAdminPage.tsx", "utf8");
    expect(source).toContain("Remove “${task.title}” permanently?");
    expect(source).toContain("apiDelete(`/office-admin/tasks/${task.id}`)");
  });
});