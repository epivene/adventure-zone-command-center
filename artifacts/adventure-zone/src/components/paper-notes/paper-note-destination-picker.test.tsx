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
  listPaperNoteEventFamilies: vi.fn(async () => [
    { id: "90000000-0000-4000-8000-000000000001", name: "Water Lantern Festival", memberCount: 12 },
  ]),
}));

import { PaperNoteDestinationPicker } from "./paper-note-destination-picker";

const review = {
  event: { name: "County Fair", city: "Minot", region: "ND", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
  activity: { occurredOn: null, method: "call" as const, outcome: "", summary: "" },
  contacts: [], organizationPhones: [], oldReminder: "", starredOnPaper: false, generalNotes: [], conflicts: {},
  destination: null,
  currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
};

const suggestedMatch = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  organizationLocationId: null,
  name: "County Fair",
  city: "Minot",
  region: "ND",
  strength: "strong" as const,
  score: 140,
  reasons: ["same phone number", "same city/state"],
  contacts: [],
  organizationPhones: [],
};

describe("PaperNoteDestinationPicker", () => {
  it("shows a matched-existing-profile confirmation and reveals alternatives only after Change", () => {
    render(
      <PaperNoteDestinationPicker
        review={{
          ...review,
          destination: {
            mode: "existing_profile",
            organizationId: suggestedMatch.organizationId,
            organizationLocationId: null,
          },
        } as any}
        matches={[suggestedMatch]}
        onChooseExisting={vi.fn()}
        onChooseNewLocation={vi.fn()}
        onChooseNewProfile={vi.fn()}
        onNewLocationChange={vi.fn()}
        onNewProfileFamilyChange={vi.fn()}
        onRememberMatch={vi.fn()}
      />,
    );

    expect(screen.getByText(/Matched to existing profile/i)).toBeInTheDocument();
    expect(screen.getByText(/County Fair · Minot, ND/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Search existing profiles")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Change matched profile/i }));
    expect(screen.getByLabelText("Search existing profiles")).toBeInTheDocument();
    expect(screen.getByText("Suggested matches")).toBeInTheDocument();
  });

  it("still shows the matched profile after reload when only the saved location id differs", () => {
    render(
      <PaperNoteDestinationPicker
        review={{
          ...review,
          destination: {
            mode: "existing_profile",
            organizationId: suggestedMatch.organizationId,
            organizationLocationId: "20000000-0000-4000-8000-000000000001",
          },
        } as any}
        matches={[suggestedMatch]}
        onChooseExisting={vi.fn()}
        onChooseNewLocation={vi.fn()}
        onChooseNewProfile={vi.fn()}
        onNewLocationChange={vi.fn()}
        onNewProfileFamilyChange={vi.fn()}
        onRememberMatch={vi.fn()}
      />,
    );

    expect(screen.getByText(/County Fair · Minot, ND/i)).toBeInTheDocument();
    expect(screen.getByText(/same phone number/i)).toBeInTheDocument();
    expect(screen.queryByText("Existing CRM profile")).not.toBeInTheDocument();
  });

  it("shows automatic evidence matches separately from manual search results", async () => {
    render(
      <PaperNoteDestinationPicker
        review={review}
        matches={[suggestedMatch]}
        onChooseExisting={vi.fn()}
        onChooseNewLocation={vi.fn()}
        onChooseNewProfile={vi.fn()}
        onNewLocationChange={vi.fn()}
        onNewProfileFamilyChange={vi.fn()}
        onRememberMatch={vi.fn()}
      />,
    );

    expect(screen.getByText("Suggested matches")).toBeInTheDocument();
    expect(screen.getByText("County Fair")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search existing profiles"), { target: { value: "Hidden County" } });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));

    expect(await screen.findByText("Search results")).toBeInTheDocument();
    expect(await screen.findByText("Hidden County Fair")).toBeInTheDocument();
  });

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
        onNewProfileFamilyChange={vi.fn()}
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

  it("offers an optional existing event family when creating a new profile", async () => {
    const onNewProfileFamilyChange = vi.fn();
    render(
      <PaperNoteDestinationPicker
        review={{ ...review, destination: { mode: "new_profile", eventFamilyId: null } } as any}
        matches={[]}
        onChooseExisting={vi.fn()}
        onChooseNewLocation={vi.fn()}
        onChooseNewProfile={vi.fn()}
        onNewLocationChange={vi.fn()}
        onNewProfileFamilyChange={onNewProfileFamilyChange}
        onRememberMatch={vi.fn()}
      />,
    );

    const family = await screen.findByLabelText("Event family (optional)");
    expect(screen.getByRole("option", { name: /Water Lantern Festival/ })).toBeInTheDocument();
    fireEvent.change(family, { target: { value: "90000000-0000-4000-8000-000000000001" } });
    expect(onNewProfileFamilyChange).toHaveBeenCalledWith("90000000-0000-4000-8000-000000000001");
  });
});
