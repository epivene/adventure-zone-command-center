import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { YearEndInspectionEntryCard } from "./year-end-inspection-entry-card";
import type { ManagerApi, YearEndInspectionEntryDto } from "@/lib/year-end-inspections-api";

const entry: YearEndInspectionEntryDto = {
  id: "20000000-0000-4000-8000-000000000001",
  pieceId: "30000000-0000-4000-8000-000000000001",
  pieceCodeSnapshot: "NEW-A058BD54",
  canRemoveAsAccidental: true,
  pieceNameSnapshot: "Hot Air Balloon Castle",
  resourceIdSnapshot: "60000000-0000-4000-8000-000000000001",
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
    resources={[{ id: "60000000-0000-4000-8000-000000000001", name: "Ballon combo" }]}
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

  it("includes status, attraction group, and a zero-photo count in the closed dropdown summary", () => {
    render(<YearEndInspectionEntryCard
      entry={entry}
      inspectionId="10000000-0000-4000-8000-000000000001"
      legId="40000000-0000-4000-8000-000000000001"
      managerApi={vi.fn()}
      onSave={vi.fn(async () => undefined)}
    />);

    expect(screen.getByText("0 photos saved")).toBeVisible();
    expect(screen.getByRole("button", {
      name: /Open NEW-A058BD54 Hot Air Balloon Castle\. Attraction: Ballon combo\. Not started\. 0 photos saved/,
    })).toBeVisible();
  });

  it("keeps saved photos collapsed below the inspection fields until requested", async () => {
    const user = userEvent.setup();
    render(<YearEndInspectionEntryCard
      entry={{
        ...entry,
        photos: [{
          id: "50000000-0000-4000-8000-000000000001",
          signedUrl: "https://example.test/photo",
          description: "Saved entrance photo",
          annotations: { version: 1, ellipses: [] },
        }],
      }}
      inspectionId="10000000-0000-4000-8000-000000000001"
      legId="40000000-0000-4000-8000-000000000001"
      managerApi={vi.fn()}
      onSave={vi.fn(async () => undefined)}
    />);

    expect(screen.getByText("1 photo saved")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Saved entrance photo" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Attraction name")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open NEW-A058BD54 Hot Air Balloon Castle/ }));

    expect(screen.getByLabelText("Attraction name")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Saved entrance photo" })).not.toBeInTheDocument();
    const photoButton = screen.getByRole("button", { name: "View saved photos (1)" });
    expect(screen.getByLabelText("Condition").compareDocumentPosition(photoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(photoButton);
    expect(screen.getByRole("img", { name: "Saved entrance photo" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Close NEW-A058BD54 Hot Air Balloon Castle/ })).toBeVisible();
  });

  it("creates and assigns a named attraction from an unassigned inspection card", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<YearEndInspectionEntryCard
      entry={{ ...entry, resourceIdSnapshot: null, resourceNameSnapshot: null }}
      inspectionId="10000000-0000-4000-8000-000000000001"
      legId="40000000-0000-4000-8000-000000000001"
      managerApi={vi.fn()}
      onSave={onSave}
      resources={[{ id: "60000000-0000-4000-8000-000000000001", name: "Ballon combo" }]}
      initiallyOpen
    />);

    expect(screen.getAllByText("No attraction assigned yet")[0]).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Attraction assignment"), "new");
    expect(screen.getByLabelText("New attraction name")).toHaveValue("Hot Air Balloon Castle");
    await user.selectOptions(screen.getByLabelText("Condition"), "good");
    await user.click(screen.getByRole("button", { name: "Save attraction inspection" }));

    expect(onSave).toHaveBeenCalledWith(entry.id, expect.objectContaining({
      resourceAssignment: {
        mode: "new",
        resourceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: "Hot Air Balloon Castle",
      },
    }));
  });

  it("lets the leg manager correct the attraction name and code", async () => {
    const user = userEvent.setup();
    const onSave = renderCard();

    await user.clear(screen.getByLabelText("Attraction code"));
    await user.type(screen.getByLabelText("Attraction code"), "BC-001");
    await user.clear(screen.getByLabelText("Attraction name"));
    await user.type(screen.getByLabelText("Attraction name"), "Balloon Castle");
    await user.selectOptions(screen.getByLabelText("Condition"), "good");
    await user.click(screen.getByRole("button", { name: "Save attraction inspection" }));

    expect(onSave).toHaveBeenCalledWith(entry.id, expect.objectContaining({
      pieceCodeSnapshot: "BC-001",
      pieceNameSnapshot: "Balloon Castle",
    }));
  });

  it("lets both role-specific APIs describe and delete a saved photo", async () => {
    const user = userEvent.setup();
    const managerApi = vi.fn(async () => ({})) as unknown as ManagerApi;
    vi.spyOn(window, "prompt").mockReturnValue("Updated description");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<YearEndInspectionEntryCard
      entry={{
        ...entry,
        photos: [{
          id: "50000000-0000-4000-8000-000000000001",
          signedUrl: "https://example.test/photo",
          description: "Saved entrance photo",
          annotations: { version: 1, ellipses: [] },
        }],
      }}
      inspectionId="10000000-0000-4000-8000-000000000001"
      legId="40000000-0000-4000-8000-000000000001"
      managerApi={managerApi}
      apiPrefix="/manager-admin"
      onSave={vi.fn(async () => undefined)}
    />);

    await user.click(screen.getByRole("button", { name: /Open NEW-A058BD54 Hot Air Balloon Castle/ }));
    await user.click(screen.getByRole("button", { name: "View saved photos (1)" }));
    await user.click(screen.getByRole("button", { name: "Edit description" }));
    expect(managerApi).toHaveBeenCalledWith(
      "/manager-admin/year-end-inspections/10000000-0000-4000-8000-000000000001/photos/50000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "PATCH" }),
    );

    await user.click(screen.getByRole("button", { name: "Delete photo" }));
    expect(managerApi).toHaveBeenCalledWith(
      "/manager-admin/year-end-inspections/10000000-0000-4000-8000-000000000001/photos/50000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("labels a completed attraction without repairs as All Good", () => {
    render(<YearEndInspectionEntryCard
      entry={{ ...entry, entryState: "inspected", condition: "good" }}
      inspectionId="10000000-0000-4000-8000-000000000001"
      legId="40000000-0000-4000-8000-000000000001"
      managerApi={vi.fn()}
      onSave={vi.fn(async () => undefined)}
    />);

    expect(screen.getByText("All Good")).toBeVisible();
    expect(screen.getByRole("button", {
      name: /Open NEW-A058BD54 Hot Air Balloon Castle\. Attraction: Ballon combo\. All Good\. 0 photos saved/,
    })).toBeVisible();
  });


  it("does not label an attraction that needs cleaning as All Good", () => {
    render(<YearEndInspectionEntryCard
      entry={{ ...entry, entryState: "inspected", condition: "needs_cleaning", repairNeeded: false }}
      inspectionId="10000000-0000-4000-8000-000000000001"
      legId="40000000-0000-4000-8000-000000000001"
      managerApi={vi.fn()}
      onSave={vi.fn(async () => undefined)}
    />);

    expect(screen.getByText("Needs cleaning")).toBeVisible();
    expect(screen.queryByText("All Good")).not.toBeInTheDocument();
  });

});
