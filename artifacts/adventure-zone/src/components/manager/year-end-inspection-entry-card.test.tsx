import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { YearEndInspectionEntryDto } from "@/lib/year-end-inspections-api";
import { YearEndInspectionEntryCard } from "./year-end-inspection-entry-card";

describe("YearEndInspectionEntryCard", () => {
  it("shows photos that were saved for the inspection piece", async () => {
    const user = userEvent.setup();
    const entry = {
      id: "20000000-0000-4000-8000-000000000001",
      pieceId: "piece-1",
      pieceCodeSnapshot: "AZ-017",
      pieceNameSnapshot: "Front section",
      resourceNameSnapshot: "Warrior Wall",
      entryState: "inspected",
      condition: "minor_repair",
      inspectionNotes: "Worn seam near entrance",
      repairNeeded: true,
      repairNotes: "Patch before next season",
      retainForFutureUse: true,
      photos: [{
        id: "40000000-0000-4000-8000-000000000001",
        signedUrl: "https://signed.example/year-end/photo",
        description: "Circle shows the worn seam",
        annotations: {
          version: 1,
          ellipses: [{ id: "circle-1", x: 0.5, y: 0.5, radiusX: 0.2, radiusY: 0.1 }],
        },
      }],
    } as YearEndInspectionEntryDto;

    render(<YearEndInspectionEntryCard
      entry={entry}
      inspectionId="10000000-0000-4000-8000-000000000001"
      legId="30000000-0000-4000-8000-000000000001"
      managerApi={vi.fn()}
      onSave={vi.fn()}
    />);

    await user.click(screen.getByRole("button", { name: /AZ-017 Front section/ }));

    expect(screen.getByRole("img", { name: "Circle shows the worn seam" })).toHaveAttribute(
      "src",
      "https://signed.example/year-end/photo",
    );
    expect(screen.getByText("Circle shows the worn seam")).toBeVisible();
    expect(screen.getByLabelText("Marked photo area")).toBeVisible();
  });
});
