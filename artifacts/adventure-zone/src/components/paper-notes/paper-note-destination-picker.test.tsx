import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/paper-notes/paper-note-client", () => ({
  searchPaperNoteProfiles: vi.fn(async () => [{
    organizationId: "10000000-0000-4000-8000-000000000009",
    organizationLocationId: null,
    name: "Hidden County Fair",
    city: "Minot",
    region: "ND",
    strength: "possible",
    score: 0,
    reasons: ["manual profile search"],
    contacts: [],
    organizationPhones: [],
  }]),
}));

import { PaperNoteDestinationPicker } from "./paper-note-destination-picker";

const review = {
  event: { name: "County Fair", city: "Minot", region: "ND", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
  activity: { occurredOn: null, method: "call" as const, outcome: "", summary: "" },
  contacts: [], organizationPhones: [], oldReminder: "", starredOnPaper: false, generalNotes: [], conflicts: {},
  destination: null,
  currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
};

describe("PaperNoteDestinationPicker", () => {
  it("finds a profile manually when it is not in the suggested matches", async () => {
    const onRememberMatch = vi.fn();
    const onChooseExisting = vi.fn();
    render(
      <PaperNoteDestinationPicker
        review={review}
        matches={[]}
        onChooseExisting={onChooseExisting}
        onChooseNewLocation={vi.fn()}
        onChooseNewProfile={vi.fn()}
        onNewLocationChange={vi.fn()}
        onRememberMatch={onRememberMatch}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search existing profiles"), { target: { value: "Hidden County" } });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
    expect(await screen.findByText("Hidden County Fair")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Hidden County Fair" }));

    await waitFor(() => expect(onRememberMatch).toHaveBeenCalledWith(expect.objectContaining({ name: "Hidden County Fair" })));
    expect(onChooseExisting).toHaveBeenCalledWith(expect.objectContaining({ name: "Hidden County Fair" }));
  });
});
