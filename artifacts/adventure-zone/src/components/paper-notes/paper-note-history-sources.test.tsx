import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/paper-notes/paper-note-client", () => ({
  getPaperNoteActivitySource: vi.fn(async () => ({
    url: "https://signed.example/profile-paper",
    kind: "original",
  })),
}));

import { PaperNoteHistorySources } from "./paper-note-history-sources";

describe("PaperNoteHistorySources", () => {
  it("shows paper-note provenance and opens the source paper", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <PaperNoteHistorySources
        notes={[
          {
            id: "40000000-0000-4000-8000-000000000041",
            body: "Imported from paper notes\nSpoke with Tina.",
            historicalDateUnknown: true,
            paperNoteSource: { activityId: "40000000-0000-4000-8000-000000000041" },
          },
        ]}
      />,
    );

    expect(screen.getByText("Paper note history (1)")).toBeInTheDocument();
    expect(screen.getByText("Historical date unknown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View source paper" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(
      "https://signed.example/profile-paper",
      "_blank",
      "noopener,noreferrer",
    ));
  });
});
