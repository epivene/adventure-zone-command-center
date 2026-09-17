import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { YearEndInspectionsAdminContent, type AdminInspectionApi } from "./YearEndInspectionsAdminPage";

describe("YearEndInspectionsAdminPage", () => {
  it("uses leg inspection records instead of a separate piece inventory", async () => {
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/manager-admin/year-end-inspections") return { inspections: [] };
      throw new Error(`Unexpected request ${path}`);
    });

    render(<YearEndInspectionsAdminContent
      api={api as unknown as AdminInspectionApi}
      legs={[{ id: "30000000-0000-4000-8000-000000000001", name: "Leg 1" }]}
    />);
    expect(await screen.findByRole("heading", { name: "Leg inspection records" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Piece inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add piece" })).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("equipment-pieces"), expect.anything());
  });

  it("requires confirmation before fully resetting Kristy's selected inspection", async () => {
    const user = userEvent.setup();
    const inspection: any = {
      id: "10000000-0000-4000-8000-000000000001",
      legId: "30000000-0000-4000-8000-000000000001",
      inspectionYear: 2026,
      managerIdentitySnapshot: "manager:Kristy",
      status: "in_progress",
      entries: [],
      progress: { total: 0, inspected: 0, notPresent: 0, notStarted: 0, needsAttention: 0, percentComplete: 0 },
    };
    let reset = false;
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/manager-admin/year-end-inspections" && !options?.method) return { inspections: reset ? [] : [inspection] };
      if (path === `/manager-admin/year-end-inspections/${inspection.id}` && !options?.method) return { inspection };
      if (path === `/manager-admin/year-end-inspections/${inspection.id}/reset` && options?.method === "POST") {
        reset = true;
        return { ok: true, deletedPhotos: 1, deletedPieces: 2 };
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<YearEndInspectionsAdminContent
      api={api as unknown as AdminInspectionApi}
      legs={[{ id: inspection.legId, name: "Kristy's Leg" }]}
    />);
    await user.click(await screen.findByRole("button", { name: /Kristy's Leg · 2026/ }));
    await user.click(await screen.findByRole("button", { name: "Fully reset inspection" }));

    expect(await screen.findByText("Kristy's 2026 inspection was reset. 1 photo and 2 attractions added during the inspection were removed.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Kristy's Leg · 2026/ })).not.toBeInTheDocument();
  });
});
