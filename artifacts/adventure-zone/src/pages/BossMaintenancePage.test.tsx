import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { bossGet, bossPost } = vi.hoisted(() => ({ bossGet: vi.fn(), bossPost: vi.fn() }));
vi.mock("@/lib/boss-auth-context", () => ({ bossGet, bossPost, bossDelete: vi.fn() }));

import BossMaintenancePage from "./BossMaintenancePage";

describe("BossMaintenancePage annual inspections", () => {
  beforeEach(() => {
    bossGet.mockReset();
    bossPost.mockReset();
  });

  it("shows a completed leg inspection with photos and repair follow-up", async () => {
    const user = userEvent.setup();
    bossGet.mockImplementation(async (path: string) => {
      if (path === "/boss/dashboard") return { checklistAndMaintenance: [{
        id: "year-end:10000000-0000-4000-8000-000000000001",
        inspectionId: "10000000-0000-4000-8000-000000000001",
        recordKind: "year_end_inspection",
        legId: "30000000-0000-4000-8000-000000000001",
        legName: "Leg 3",
        title: "Leg 3 · 2026 year-end inspection",
        phase: "year_end_inspection",
        status: "completed",
      }] };
      if (path === "/boss/year-end-inspections/10000000-0000-4000-8000-000000000001") return { inspection: {
        id: "10000000-0000-4000-8000-000000000001",
        legId: "30000000-0000-4000-8000-000000000001",
        inspectionYear: 2026,
        status: "completed",
        copiedFromInspectionId: null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        progress: { total: 1, notStarted: 0, inspected: 1, notPresent: 0, needsAttention: 1, percentComplete: 100 },
        entries: [{
          id: "entry-1",
          pieceId: "piece-1",
          pieceCodeSnapshot: "AZ-017",
          pieceNameSnapshot: "Anchor panel",
          resourceNameSnapshot: "Warrior Wall",
          entryState: "inspected",
          condition: "major_repair",
          inspectionNotes: "Anchor panel tear",
          repairNeeded: true,
          repairNotes: "Patch before reuse",
          retainForFutureUse: true,
          photos: [{ id: "photo-1", signedUrl: "https://example.test/anchor.jpg", description: "Circle shows the worn anchor panel", annotations: { version: 1, ellipses: [{ id: "e1", x: .5, y: .5, radiusX: .1, radiusY: .1 }] } }],
          maintenanceItem: { id: "repair-1", state: "open", resolutionNotes: null },
        }],
      } };
      throw new Error(`Unexpected ${path}`);
    });

    render(<BossMaintenancePage />);
    await user.click(await screen.findByRole("button", { name: /Leg 3, 1 maintenance record/ }));
    await user.click(await screen.findByRole("button", { name: /Leg 3.*2026 year-end inspection/ }));
    expect(await screen.findByText("Anchor panel tear")).toBeVisible();
    expect(screen.getByAltText("Circle shows the worn anchor panel")).toBeVisible();
    expect(screen.getByText("Circle shows the worn anchor panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark repair completed" })).toBeVisible();
  });
});
