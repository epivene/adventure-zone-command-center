import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { YearEndInspectionEntryCard } from "./year-end-inspection-entry-card";
import type { YearEndInspectionEntryDto } from "@/lib/year-end-inspections-api";

const entry: YearEndInspectionEntryDto = {
  id: "20000000-0000-4000-8000-000000000001",
  pieceId: "30000000-0000-4000-8000-000000000001",
  pieceCodeSnapshot: "NEW-A058BD54",
  pieceNameSnapshot: "Hot Air Balloon Castle",
  resourceNameSnapshot: "Ballon combo",
  entryState: "not_started",
  condition: null,
  inspectionNotes: null,
  repairNeeded: false,
  repairNotes: "Existing repair detail",
  retainForFutureUse: true,
};

function renderCard(onSave = vi.fn(async () => undefined)) {
  render(<YearEndInspectionEntryCard
    entry={entry}
    inspectionId="10000000-0000-4000-8000-000000000001"
    legId="40000000-0000-4000-8000-000000000001"
    managerApi={vi.fn()}
    onSave={onSave}
    initiallyOpen
  />);
  return onSave;
}

it("requires a second click before removing an accidental discovered piece", async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn(async () => undefined);
  render(<YearEndInspectionEntryCard
    entry={entry}
    inspectionId="10000000-0000-4000-8000-000000000001"
    legId="40000000-0000-4000-8000-000000000001"
    managerApi={vi.fn()}
    onSave={vi.fn(async () => undefined)}
    onRemove={onRemove}
    initiallyOpen
  />);

  await user.click(screen.getByRole("button", { name: "Remove accidental attraction" }));
  expect(onRemove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  expect(onRemove).toHaveBeenCalledWith(entry.id);
});

describe("YearEndInspectionEntryCard", () => {
  it("uses one notes field for both the inspection and a needed repair", async () => {
    const user = userEvent.setup();
    const onSave = renderCard();

    expect(screen.queryByLabelText("Repair notes")).not.toBeInTheDocument();
    const notes = screen.getByLabelText("Inspection notes");
    expect(notes).toHaveValue("Existing repair detail");

    await user.selectOptions(screen.getByLabelText("Condition"), "minor_repair");
    await user.clear(notes);
    await user.type(notes, "Patch the entrance seam");
    await user.click(screen.getByRole("button", { name: "Save attraction inspection" }));

    expect(onSave).toHaveBeenCalledWith(entry.id, expect.objectContaining({
      inspectionNotes: "Patch the entrance seam",
      repairNeeded: true,
      repairNotes: "Patch the entrance seam",
    }));
  });

  it("places photo capture before the final save controls", () => {
    renderCard();

    const photoHeading = screen.getByText("Add a photo");
    const saveButton = screen.getByRole("button", { name: "Save attraction inspection" });
    expect(photoHeading.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
