import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaperNoteBatchPreflightDialog } from "./paper-note-batch-preflight-dialog";

const ready = {
  ready: true,
  batchId: "10000000-0000-4000-8000-000000000001",
  approvedCount: 2,
  skippedCount: 1,
  blocking: [],
  preview: {
    profilesCreated: 1,
    profilesUpdated: 1,
    locationsCreated: 0,
    contactsCreated: 1,
    contactsLinked: 0,
    phonesCreatedOrUpdated: 2,
    historicalNotesCreated: 2,
    followUpsCreated: 0,
    entriesSkipped: 1,
  },
};

describe("PaperNoteBatchPreflightDialog", () => {
  it("shows exact planned changes and uses the approved confirm wording", () => {
    const onConfirm = vi.fn();
    render(<PaperNoteBatchPreflightDialog preflight={ready} busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText("1 new profile")).toBeInTheDocument();
    expect(screen.getByText("2 historical notes")).toBeInTheDocument();
    expect(screen.getByText("No current follow-ups")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import Approved Entries" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables import and announces blocking issues when the batch is not ready", () => {
    render(<PaperNoteBatchPreflightDialog
      preflight={{ ...ready, ready: false, blocking: [{ entryId: null, code: "PAGE_NOT_RESOLVED", message: "One page still needs attention." }] }}
      busy={false}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />);
    expect(screen.getByRole("alert")).toHaveTextContent("One page still needs attention.");
    expect(screen.getByRole("button", { name: "Import Approved Entries" })).toBeDisabled();
  });
});
