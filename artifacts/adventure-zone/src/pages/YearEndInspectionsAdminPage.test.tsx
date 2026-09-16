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
});
