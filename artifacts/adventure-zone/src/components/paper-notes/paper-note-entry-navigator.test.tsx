import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaperNoteEntryNavigator } from "./paper-note-entry-navigator";

describe("PaperNoteEntryNavigator", () => {
  it("shows one selected position and moves backward/forward", () => {
    const onSelect = vi.fn();
    render(<PaperNoteEntryNavigator
      entries={[
        { id: "a", state: "needs_review" },
        { id: "b", state: "approved" },
        { id: "c", state: "skipped" },
      ] as any}
      selectedId="b"
      onSelect={onSelect}
    />);
    expect(screen.getByText("Entry 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous paper entry" }));
    expect(onSelect).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "Next paper entry" }));
    expect(onSelect).toHaveBeenCalledWith("c");
  });
});
