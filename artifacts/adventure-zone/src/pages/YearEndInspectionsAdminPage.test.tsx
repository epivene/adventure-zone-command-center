import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { YearEndInspectionsAdminContent, type AdminInspectionApi } from "./YearEndInspectionsAdminPage";

describe("YearEndInspectionsAdminPage", () => {
  it("quick-adds pieces without a fixed inventory limit", async () => {
    const user = userEvent.setup();
    const pieces: any[] = [];
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path.startsWith("/manager-admin/equipment-pieces") && !options?.method) return { pieces };
      if (path === "/manager-admin/year-end-inspections") return { inspections: [] };
      if (path === "/manager-admin/equipment-pieces" && options?.method === "POST") {
        const piece = { id: crypto.randomUUID(), ...JSON.parse(String(options.body)), currentResourceName: null, archivedAt: null };
        pieces.push(piece);
        return { piece };
      }
      throw new Error(`Unexpected request ${path}`);
    });

    render(<YearEndInspectionsAdminContent
      api={api as unknown as AdminInspectionApi}
      legs={[{ id: "30000000-0000-4000-8000-000000000001", name: "Leg 1" }]}
    />);
    await user.click(await screen.findByRole("button", { name: "Add piece" }));
    await user.type(screen.getByLabelText("Piece code"), "AZ-059");
    await user.type(screen.getByLabelText("Piece name"), "Warrior wall section");
    await user.selectOptions(screen.getByLabelText("Leg"), "30000000-0000-4000-8000-000000000001");
    await user.click(screen.getByRole("button", { name: "Save and add another" }));
    expect(await screen.findByText("AZ-059")).toBeVisible();
    expect(screen.getByLabelText("Piece code")).toHaveValue("");
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
      if (path.startsWith("/manager-admin/equipment-pieces") && !options?.method) return { pieces: [] };
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

    expect(await screen.findByText("Kristy's 2026 inspection was reset. 1 photo and 2 test pieces were removed.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Kristy's Leg · 2026/ })).not.toBeInTheDocument();
  });

  it("lets an admin edit an attraction inside a selected inspection", async () => {
    const user = userEvent.setup();
    const entry = {
      id: "20000000-0000-4000-8000-000000000001",
      pieceId: "30000000-0000-4000-8000-000000000001",
      pieceCodeSnapshot: "OLD-1",
      pieceNameSnapshot: "Old attraction name",
      resourceNameSnapshot: null,
      entryState: "not_started",
      condition: null,
      inspectionNotes: null,
      repairNeeded: false,
      repairNotes: null,
      retainForFutureUse: true,
      photos: [],
    };
    const inspection: any = {
      id: "10000000-0000-4000-8000-000000000001",
      legId: "40000000-0000-4000-8000-000000000001",
      inspectionYear: 2026,
      status: "in_progress",
      entries: [entry],
      progress: { total: 1, inspected: 0, notPresent: 0, notStarted: 1, needsAttention: 0, percentComplete: 0 },
    };
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path.startsWith("/manager-admin/equipment-pieces") && !options?.method) return { pieces: [] };
      if (path === "/manager-admin/year-end-inspections" && !options?.method) return { inspections: [inspection] };
      if (path === `/manager-admin/year-end-inspections/${inspection.id}` && !options?.method) return { inspection };
      if (path === `/manager-admin/year-end-inspections/${inspection.id}/entries/${entry.id}` && options?.method === "PATCH") {
        return { entry: { ...entry, ...JSON.parse(String(options.body)) } };
      }
      throw new Error(`Unexpected request ${path}`);
    });

    render(<YearEndInspectionsAdminContent api={api as unknown as AdminInspectionApi} legs={[{ id: inspection.legId, name: "Leg 1" }]} />);
    await user.click(await screen.findByRole("button", { name: /Leg 1 · 2026/ }));
    await user.click(await screen.findByRole("button", { name: "Edit attraction" }));
    await user.clear(screen.getByLabelText("Attraction name"));
    await user.type(screen.getByLabelText("Attraction name"), "Balloon Castle");
    await user.click(screen.getByRole("button", { name: "Save attraction inspection" }));

    expect(api).toHaveBeenCalledWith(
      `/manager-admin/year-end-inspections/${inspection.id}/entries/${entry.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(await screen.findByText(/Balloon Castle/)).toBeVisible();
  });
});
